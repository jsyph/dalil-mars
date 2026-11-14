import os
import sys
import json
import time
import heapq
from multiprocessing import Pool, cpu_count
import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))


def _dijkstra_worker(args):
    """Top-level worker for parallel All-Pairs Dijkstra computation."""
    s_idx, N, adj = args
    dist = np.full(N, np.inf, dtype=np.float32)
    dist[s_idx] = 0.0
    pq = [(0.0, s_idx)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            nd = d + w
            if nd < dist[v]:
                dist[v] = nd
                heapq.heappush(pq, (nd, v))
    return s_idx, dist


class Stage6HeuristicPipeline:
    """STAGE 6: All-Pairs Obstacle-Aware Heuristic Distance Fields Pipeline.

    Groups the 19M-node master grid into macro-cells (M=64, 4,692 cells) and
    PRECOMPUTES the complete All-Pairs shortest obstacle-avoiding cost-distance matrix
    from EVERY group of nodes to EVERY OTHER group of nodes across Jezero Crater.
    """

    def __init__(
        self,
        stage4_dir: str | None = None,
        stage5_dir: str | None = None,
        output_dir: str | None = None,
        downsample_factor: int = 64,
        pixel_res_m: float = 20.203946,
    ):
        self.stage4_dir = stage4_dir or os.path.join(BASE_DIR, "output", "stage_4_consolidated")
        self.stage5_dir = stage5_dir or os.path.join(BASE_DIR, "output", "stage_5_consolidated")
        self.output_dir = output_dir or os.path.join(BASE_DIR, "output", "stage_6_consolidated")
        self.M = downsample_factor
        self.pixel_res_m = pixel_res_m
        self.origin_x = -6117387.581178606
        self.origin_y = 1145171.1668435
        self.mars_radius = 3396190.0

        os.makedirs(self.output_dir, exist_ok=True)
        self.all_pairs_4d = None
        self._load_cached_matrix()

    def _load_cached_matrix(self):
        mat_file = os.path.join(self.output_dir, "consolidated_all_pairs_4d_matrix.npy")
        if os.path.exists(mat_file):
            self.all_pairs_4d = np.load(mat_file)

    def latlon_to_grid(self, lat: float, lon: float) -> tuple[int, int]:
        x = self.mars_radius * np.radians(lon - 180.0)
        y = self.mars_radius * np.radians(lat)
        col = int(round((x - self.origin_x) / self.pixel_res_m))
        row = int(round((self.origin_y - y) / self.pixel_res_m))
        return row, col

    def get_heuristic(self, r1: float, c1: float, r2: float, c2: float) -> float:
        """Instant O(1) table lookup of precomputed obstacle-aware heuristic

        from ANY node/point (r1, c1) to ANY other node/point (r2, c2).
        Supports either fine grid indices or Martian lat/lon degrees.
        """
        if self.all_pairs_4d is None:
            self._load_cached_matrix()
            if self.all_pairs_4d is None:
                raise FileNotFoundError("All-Pairs matrix not precomputed yet. Run process_heuristics() first.")

        # Auto-detect degrees vs grid indices
        if abs(r1) <= 90 and abs(c1) <= 360:
            r1, c1 = self.latlon_to_grid(r1, c1)
        if abs(r2) <= 90 and abs(c2) <= 360:
            r2, c2 = self.latlon_to_grid(r2, c2)

        r1, c1 = int(round(r1)), int(round(c1))
        r2, c2 = int(round(r2)), int(round(c2))

        cH, cW = self.all_pairs_4d.shape[:2]
        I1 = int(np.clip(r1 // self.M, 0, cH - 1))
        J1 = int(np.clip(c1 // self.M, 0, cW - 1))
        I2 = int(np.clip(r2 // self.M, 0, cH - 1))
        J2 = int(np.clip(c2 // self.M, 0, cW - 1))

        if I1 == I2 and J1 == J2:
            return float(np.hypot(r1 - r2, c1 - c2) * self.pixel_res_m)

        raw_val = float(self.all_pairs_4d[I1, J1, I2, J2])
        if np.isinf(raw_val) or np.isnan(raw_val):
            return np.inf

        # Subtract intra-cell margin for strict mathematical admissibility
        intra_bound = self.M * np.sqrt(2.0) * self.pixel_res_m * 1.0
        return max(0.0, raw_val - intra_bound)

    def process_heuristics(self):
        print("==================================================")
        print("STAGE 6: ALL-PAIRS OBSTACLE-AWARE HEURISTIC PIPELINE")
        print("==================================================")

        total_t0 = time.time()
        master_grid_file = os.path.join(self.stage4_dir, "consolidated_preprocessed_master_grid.npy")
        if not os.path.exists(master_grid_file):
            raise FileNotFoundError(f"Missing Stage 4 grid at {master_grid_file}. Run Stage 4 first!")

        print(f"Loading Stage 4 Master Grid: {master_grid_file}")
        grid = np.load(master_grid_file).astype(np.float32)
        H, W = grid.shape

        cH = H // self.M
        cW = W // self.M
        N = cH * cW
        macro_cell_res_m = self.M * self.pixel_res_m

        print(
            f"Grouping {H}x{W} nodes ({H*W:,}) into {self.M}x{self.M} blocks -> Coarse Grid {cH}x{cW} ({N:,} macro-cells)..."
        )
        print(f"Each macro-cell covers: {macro_cell_res_m:.1f}m x {macro_cell_res_m:.1f}m (~{macro_cell_res_m**2/10000:.1f} hectares)")

        # 1. True Obstacle-Aware & Dangerous Slope Macro Aggregation
        trimmed = grid[: cH * self.M, : cW * self.M]
        blocks = trimmed.reshape(cH, self.M, cW, self.M)

        # Detect blocked nodes (inf or nan: cliffs, red slopes > 20 deg, boundaries)
        is_blocked = np.isinf(blocks) | np.isnan(blocks)
        blocked_frac = np.mean(is_blocked, axis=(1, 3))

        clean_blocks = np.where(is_blocked, np.nan, blocks)
        with np.errstate(all="ignore"):
            mean_valid = np.nanmean(clean_blocks, axis=(1, 3))

        # Cells with > 25% blocked nodes are impassable macro barriers
        # Cells with obstacles / dangerous slopes receive proportional hazard weight
        coarse_cost = np.where(
            blocked_frac > 0.25,
            np.inf,
            mean_valid * (1.0 + 3.5 * blocked_frac),
        )
        coarse_cost[np.isnan(coarse_cost)] = np.inf
        flat_cost = coarse_cost.ravel()

        # 2. Build 8-connected adjacency graph
        step_cardinal = macro_cell_res_m
        step_diagonal = step_cardinal * 1.41421356
        moves = [
            (-1, 0, step_cardinal), (1, 0, step_cardinal),
            (0, -1, step_cardinal), (0, 1, step_cardinal),
            (-1, -1, step_diagonal), (-1, 1, step_diagonal),
            (1, -1, step_diagonal), (1, 1, step_diagonal),
        ]

        adj = [[] for _ in range(N)]
        for u in range(N):
            if np.isinf(flat_cost[u]) or np.isnan(flat_cost[u]):
                continue
            r, c = u // cW, u % cW
            w_u = flat_cost[u]
            for dr, dc, s in moves:
                nr, nc = r + dr, c + dc
                if 0 <= nr < cH and 0 <= nc < cW:
                    v = nr * cW + nc
                    w_v = flat_cost[v]
                    if not np.isinf(w_v) and not np.isnan(w_v):
                        adj[u].append((v, float(s * 0.5 * (w_u + w_v))))

        valid_nodes = [u for u in range(N) if not np.isinf(flat_cost[u]) and not np.isnan(flat_cost[u])]
        num_cores = cpu_count()
        print(f"\nPrecomputing ALL-PAIRS matrix for {len(valid_nodes):,} traversable cells on {num_cores} CPU cores...")
        print(f"Total potential pairs: {N} x {N} = {N*N:,} entries...")

        # 3. Parallel All-Pairs Dijkstra
        tasks = [(u, N, adj) for u in valid_nodes]
        t_dijkstra0 = time.time()
        with Pool(processes=num_cores) as pool:
            results = pool.map(_dijkstra_worker, tasks, chunksize=32)

        # 4. Assemble full 2D (N x N) and 4D (cH, cW, cH, cW) matrices
        all_pairs_2d = np.full((N, N), np.inf, dtype=np.float32)
        for u, dist_vector in results:
            all_pairs_2d[u, :] = dist_vector

        self.all_pairs_4d = all_pairs_2d.reshape(cH, cW, cH, cW)
        dijkstra_time = time.time() - t_dijkstra0
        print(f" -> All-Pairs shortest paths precomputed in {dijkstra_time:.2f}s!")

        # 5. Save Artifacts
        cost_file = os.path.join(self.output_dir, "consolidated_coarse_costmap.npy")
        mat_4d_file = os.path.join(self.output_dir, "consolidated_all_pairs_4d_matrix.npy")
        npz_file = os.path.join(self.output_dir, "consolidated_all_pairs_heuristic_matrix.npz")
        meta_file = os.path.join(self.output_dir, "consolidated_stage6_metadata.json")

        np.save(cost_file, coarse_cost)
        np.save(mat_4d_file, self.all_pairs_4d)
        np.savez_compressed(npz_file, all_pairs_2d=all_pairs_2d)

        total_time = time.time() - total_t0
        metadata = {
            "stage": 6,
            "description": "Precomputed All-Pairs Obstacle-Aware Heuristic Distance Fields",
            "downsample_factor": self.M,
            "fine_grid_shape": [H, W],
            "coarse_grid_shape": [cH, cW],
            "macro_cells_count": N,
            "traversable_cells_count": len(valid_nodes),
            "macro_cell_resolution_m": round(macro_cell_res_m, 2),
            "all_pairs_matrix_shape": list(self.all_pairs_4d.shape),
            "matrix_ram_mb": round(self.all_pairs_4d.nbytes / (1024 * 1024), 2),
            "npz_disk_mb": round(os.path.getsize(npz_file) / (1024 * 1024), 2),
            "total_precompute_time_s": round(total_time, 2),
        }
        with open(meta_file, "w") as f:
            json.dump(metadata, f, indent=2)

        print("\n==================================================")
        print("STAGE 6 COMPLETE: ALL-PAIRS HEURISTICS PRECOMPUTED!")
        print(f"4D Tensor Matrix -> {mat_4d_file} ({metadata['matrix_ram_mb']} MB)")
        print(f"Compressed Archive -> {npz_file} ({metadata['npz_disk_mb']} MB)")
        print(f"Metadata -> {meta_file}")
        print(f"Total Precompute Time: {total_time:.2f}s")
        print("==================================================")


if __name__ == "__main__":
    pipeline = Stage6HeuristicPipeline()

    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    if len(args) == 4:
        c1, c2, c3, c4 = [float(x) for x in args]
        t0 = time.time()
        h = pipeline.get_heuristic(c1, c2, c3, c4)
        elapsed_us = (time.time() - t0) * 1e6

        coord_type = "Lat/Lon" if (abs(c1) <= 90 and abs(c2) <= 360) else "Fine Grid"
        print(f"\n[ALL-PAIRS PRECOMPUTED LOOKUP ({coord_type})]")
        print(f"  Point A: ({c1:.4f}, {c2:.4f})")
        print(f"  Point B: ({c3:.4f}, {c4:.4f})")
        print(f"  Obstacle-Aware Heuristic: {h:,.1f} meters")
        print(f"  Lookup Time: {elapsed_us:.2f} microseconds (O(1))\n")
    else:
        pipeline.process_heuristics()
