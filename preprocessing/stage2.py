import json
import os
import numpy as np


class Stage2SlopePipeline:
    """Pipeline for processing topographic slope masks and cost matrices.

    Updated to ingest the consolidated, max-extent elevation matrix from Stage 1.
    """

    def __init__(
        self,
        input_dir: str = "./output/stage_1_consolidated",
        output_dir: str = "./output/stage_2_consolidated",
        pixel_res_m: float = 20.0,
    ) -> None:
        self.input_dir = input_dir
        self.output_dir = output_dir
        self.pixel_res_m = pixel_res_m
        os.makedirs(self.output_dir, exist_ok=True)

    def process_slope_mask(self) -> None:
        print("==================================================")
        print("STAGE 2: CONSOLIDATED TOPOGRAPHIC SLOPE MASK PIPELINE")
        print("==================================================")

        matrix_path = os.path.join(self.input_dir, "consolidated_elevation_matrix.npy")
        if not os.path.exists(matrix_path):
            raise FileNotFoundError(
                f"Missing consolidated Stage 1 output at {matrix_path}. Run Stage 1 first!"
            )

        print(f"Loading consolidated Stage 1 elevation matrix: {matrix_path}")
        Z = np.load(matrix_path).astype(np.float32)

        # 1. Calculate terrain slope gradient angle in degrees
        print(
            f"Calculating terrain slope gradient over expanded map (Pixel Resolution: {self.pixel_res_m}m)..."
        )
        grad_y, grad_x = np.gradient(Z, self.pixel_res_m, self.pixel_res_m)
        slope_rad = np.arctan(np.sqrt(grad_x**2 + grad_y**2))
        slope_deg = np.degrees(slope_rad)

        # 2. Build Stage 2 Cost Matrix (G_topo)
        # All valid open terrain starts with base weight 1.0
        cost_matrix = np.ones_like(Z, dtype=np.float32)

        # Apply Slope Multipliers & Obstacle Masks
        caution_mask = (slope_deg >= 15.0) & (slope_deg <= 20.0)
        blocked_mask = slope_deg > 20.0
        nan_mask = np.isnan(Z)

        cost_matrix[caution_mask] = 2.5  # High suit effort
        cost_matrix[blocked_mask] = np.inf  # Impassable slope obstacle
        cost_matrix[nan_mask] = np.inf  # Off-map padding

        # Statistics
        total_nodes = Z.size
        valid_nodes = np.sum(~nan_mask)
        blocked_nodes = np.sum(blocked_mask)
        caution_nodes = np.sum(caution_mask)
        safe_nodes = np.sum((slope_deg < 15.0) & (~nan_mask))

        print(f"Consolidated Grid Dimensions: {Z.shape[0]} x {Z.shape[1]} nodes")
        print(
            f"Slope Range: {np.nanmin(slope_deg):.2f}° to {np.nanmax(slope_deg):.2f}°"
        )
        if valid_nodes > 0:
            print(
                f"Safe Terrain (<15°): {safe_nodes:,} nodes ({(safe_nodes / valid_nodes) * 100:.1f}%)"
            )
            print(
                f"Caution Terrain (15°-20°): {caution_nodes:,} nodes ({(caution_nodes / valid_nodes) * 100:.1f}%)"
            )
            print(
                f"Blocked Slopes (>20°): {blocked_nodes:,} nodes ({(blocked_nodes / valid_nodes) * 100:.1f}%)"
            )

        # 3. Save Stage 2 Outputs
        slope_matrix_file = os.path.join(
            self.output_dir, "consolidated_slope_angles_deg.npy"
        )
        cost_matrix_file = os.path.join(
            self.output_dir, "consolidated_slope_annotated_costmap.npy"
        )
        meta_file = os.path.join(self.output_dir, "consolidated_stage2_metadata.json")

        np.save(slope_matrix_file, slope_deg)
        np.save(cost_matrix_file, cost_matrix)

        metadata = {
            "stage": 2,
            "description": "Consolidated topographic slope gradient mask layer",
            "pixel_resolution_m": self.pixel_res_m,
            "grid_shape": list(Z.shape),
            "slope_stats": {
                "min_slope_deg": float(np.nanmin(slope_deg)),
                "max_slope_deg": float(np.nanmax(slope_deg)),
                "safe_pct": float((safe_nodes / valid_nodes) * 100) if valid_nodes > 0 else 0.0,
                "caution_pct": float((caution_nodes / valid_nodes) * 100) if valid_nodes > 0 else 0.0,
                "blocked_pct": float((blocked_nodes / valid_nodes) * 100) if valid_nodes > 0 else 0.0,
            },
        }

        with open(meta_file, "w") as f:
            json.dump(metadata, f, indent=2)

        print("==================================================")
        print("STAGE 2 CONSOLIDATED COMPLETE: Expanded slope obstacle matrix ready!")
        print(f"Slope Angles: {slope_matrix_file}")
        print(f"Annotated Costmap: {cost_matrix_file}")
        print("==================================================")


if __name__ == "__main__":
    pipeline = Stage2SlopePipeline()
    pipeline.process_slope_mask()
