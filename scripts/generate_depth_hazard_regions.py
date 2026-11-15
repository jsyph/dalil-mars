#!/usr/bin/env python3
"""
Extract red hazard polygon regions from Dalil-Mars preprocess stage 1, 2, and 4 outputs
(consolidated DEM elevation, slope angles, and impassable barrier master grid) into
GUI/public/data/depth_hazard_regions.geojson.
"""
import json
import math
from pathlib import Path
import numpy as np

MARS_RADIUS_M = 3396190.0
ROOT = Path(__file__).resolve().parent.parent
OUT_DIR = ROOT / "preprocessing" / "output"
DEST_GEOJSON = ROOT / "GUI" / "public" / "data" / "depth_hazard_regions.geojson"


def grid_to_latlon(row: float, col: float, origin_x: float, origin_y: float, pixel_res: float):
    x = origin_x + col * pixel_res
    y = origin_y - row * pixel_res
    lon = 180.0 + math.degrees(x / MARS_RADIUS_M)
    lat = math.degrees(y / MARS_RADIUS_M)
    return lat, lon


def box_blur_2d(arr: np.ndarray, valid: np.ndarray) -> np.ndarray:
    """3x3 valid-aware smoothing to produce clean geological shapes."""
    h, w = arr.shape
    acc = np.zeros_like(arr, dtype=np.float32)
    cnt = np.zeros_like(arr, dtype=np.float32)
    for dr in (-1, 0, 1):
        for dc in (-1, 0, 1):
            r0 = max(0, dr)
            r1 = h + min(0, dr)
            c0 = max(0, dc)
            c1 = w + min(0, dc)
            sr0 = max(0, -dr)
            sr1 = h - max(0, dr)
            sc0 = max(0, -dc)
            sc1 = w - max(0, dc)
            v = valid[sr0:sr1, sc0:sc1]
            acc[r0:r1, c0:c1] += np.where(v, arr[sr0:sr1, sc0:sc1], 0.0)
            cnt[r0:r1, c0:c1] += v.astype(np.float32)
    return np.where(cnt > 0, acc / np.maximum(cnt, 1.0), 0.0)


def marching_squares_contours(field: np.ndarray, level: float) -> list[list[tuple[float, float]]]:
    """Extract closed contour loops at `level` from 2D scalar `field`."""
    # Pad with 0 outside so every boundary-touching region closes cleanly
    padded = np.pad(field, 1, mode="constant", constant_values=0.0)
    h, w = padded.shape
    segments: dict[tuple[int, int], list[tuple[float, float]]] = {}
    adj: dict[tuple[float, float], list[tuple[float, float]]] = {}

    def interp(v1, v2, p1, p2):
        if abs(v2 - v1) < 1e-9:
            return ((p1[0] + p2[0]) * 0.5, (p1[1] + p2[1]) * 0.5)
        t = (level - v1) / (v2 - v1)
        t = max(0.0, min(1.0, t))
        return (round(p1[0] + t * (p2[0] - p1[0]), 3), round(p1[1] + t * (p2[1] - p1[1]), 3))

    def add_seg(a, b):
        if a == b:
            return
        adj.setdefault(a, []).append(b)
        adj.setdefault(b, []).append(a)

    # Edge table for marching squares (tl, tr, br, bl)
    for r in range(h - 1):
        row0 = padded[r]
        row1 = padded[r + 1]
        for c in range(w - 1):
            v_tl = float(row0[c])
            v_tr = float(row0[c + 1])
            v_br = float(row1[c + 1])
            v_bl = float(row1[c])

            idx = (
                (8 if v_tl >= level else 0)
                | (4 if v_tr >= level else 0)
                | (2 if v_br >= level else 0)
                | (1 if v_bl >= level else 0)
            )
            if idx == 0 or idx == 15:
                continue

            # Edge midpoints/interpolations: top(0), right(1), bottom(2), left(3)
            # Coordinates in padded space (subtract 1 later to get unpadded)
            edges = {}
            if (idx & 8) != (idx & 4) >> 1 and False:
                pass
            if ((v_tl >= level) != (v_tr >= level)):
                edges[0] = interp(v_tl, v_tr, (r, c), (r, c + 1))
            if ((v_tr >= level) != (v_br >= level)):
                edges[1] = interp(v_tr, v_br, (r, c + 1), (r + 1, c + 1))
            if ((v_br >= level) != (v_bl >= level)):
                edges[2] = interp(v_br, v_bl, (r + 1, c + 1), (r + 1, c))
            if ((v_bl >= level) != (v_tl >= level)):
                edges[3] = interp(v_bl, v_tl, (r + 1, c), (r, c))

            if len(edges) == 2:
                pts = list(edges.values())
                add_seg(pts[0], pts[1])
            elif len(edges) == 4:
                center = 0.25 * (v_tl + v_tr + v_br + v_bl)
                if (idx == 5 and center >= level) or (idx == 10 and center < level):
                    add_seg(edges[0], edges[1])
                    add_seg(edges[2], edges[3])
                else:
                    add_seg(edges[0], edges[3])
                    add_seg(edges[1], edges[2])

    # Stitch segments into closed loops
    visited_edges: set[tuple[tuple[float, float], tuple[float, float]]] = set()
    loops: list[list[tuple[float, float]]] = []

    def edge_key(a, b):
        return (a, b) if a <= b else (b, a)

    for start in list(adj.keys()):
        for nxt in adj[start]:
            ek = edge_key(start, nxt)
            if ek in visited_edges:
                continue
            loop = [start, nxt]
            visited_edges.add(ek)
            curr = nxt
            prev = start
            for _ in range(50000):
                nbrs = adj.get(curr, [])
                chosen = None
                for cand in nbrs:
                    if cand != prev and edge_key(curr, cand) not in visited_edges:
                        chosen = cand
                        break
                if chosen is None:
                    break
                visited_edges.add(edge_key(curr, chosen))
                if chosen == start:
                    loop.append(start)
                    break
                loop.append(chosen)
                prev, curr = curr, chosen
            if len(loop) >= 6 and loop[0] == loop[-1]:
                # Shift back from padded space (-1)
                loops.append([(p[0] - 1.0, p[1] - 1.0) for p in loop])

    return loops


def douglas_peucker(pts: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    if len(pts) <= 4:
        return pts
    first, last = pts[0], pts[-1]
    dx, dy = last[0] - first[0], last[1] - first[1]
    denom = math.hypot(dx, dy)
    max_d = -1.0
    idx = 0
    for i in range(1, len(pts) - 1):
        p = pts[i]
        if denom < 1e-9:
            d = math.hypot(p[0] - first[0], p[1] - first[1])
        else:
            d = abs(dy * p[0] - dx * p[1] + last[0] * first[1] - last[1] * first[0]) / denom
        if d > max_d:
            max_d = d
            idx = i
    if max_d > eps:
        left = douglas_peucker(pts[: idx + 1], eps)
        right = douglas_peucker(pts[idx:], eps)
        return left[:-1] + right
    return [first, last]


def polygon_area(pts: list[tuple[float, float]]) -> float:
    area = 0.0
    for i in range(len(pts) - 1):
        r1, c1 = pts[i]
        r2, c2 = pts[i + 1]
        area += r1 * c2 - r2 * c1
    return abs(area) * 0.5


def main():
    meta = json.loads((OUT_DIR / "stage_1_consolidated" / "consolidated_grid_metadata.json").read_text())
    elev = np.load(OUT_DIR / "stage_1_consolidated" / "consolidated_elevation_matrix.npy", mmap_mode="r")
    slope = np.load(OUT_DIR / "stage_2_consolidated" / "consolidated_slope_angles_deg.npy", mmap_mode="r")
    master = np.load(OUT_DIR / "stage_4_consolidated" / "consolidated_preprocessed_master_grid.npy", mmap_mode="r")

    H, W = elev.shape
    t = meta["transform"]
    pixel_res = float(t[0])
    origin_x = float(t[2])
    origin_y = float(t[5])

    block = 8
    bH = H // block
    bW = W // block
    elev_b = elev[: bH * block, : bW * block].reshape(bH, block, bW, block)
    slope_b = slope[: bH * block, : bW * block].reshape(bH, block, bW, block)
    master_b = master[: bH * block, : bW * block].reshape(bH, block, bW, block)

    valid_elev = ~np.isnan(elev_b)
    valid_cell = np.all(valid_elev, axis=(1, 3)) & np.all(~np.isnan(slope_b), axis=(1, 3))

    # Erode valid_cell by 2 cells so raster edges / nodata seams never appear as hazards
    eroded = valid_cell.copy()
    for dr in range(-2, 3):
        for dc in range(-2, 3):
            shifted = np.roll(np.roll(valid_cell, dr, axis=0), dc, axis=1)
            eroded &= shifted
    eroded[:2, :] = False
    eroded[-2:, :] = False
    eroded[:, :2] = False
    eroded[:, -2:] = False

    safe_slope = np.where(np.isnan(slope_b), 0.0, slope_b)
    # 75th percentile or mean-plus-std proxy via max/mean blend to capture steep rims without single-pixel noise
    slope_mean = np.mean(safe_slope, axis=(1, 3))
    slope_max = np.max(safe_slope, axis=(1, 3))
    inf_frac = np.mean(np.isinf(master_b), axis=(1, 3))

    # Boost slope where Stage 4 marks impassable barriers
    combined_score = np.where(eroded, np.maximum(0.65 * slope_max + 0.35 * slope_mean, inf_frac * 32.0), 0.0)
    smoothed = box_blur_2d(combined_score, eroded) * eroded.astype(np.float32)

    elev_safe = np.where(valid_elev, elev_b, 0.0)
    elev_min_cell = np.min(np.where(valid_elev, elev_b, 1e9), axis=(1, 3))
    elev_max_cell = np.max(np.where(valid_elev, elev_b, -1e9), axis=(1, 3))

    cell_km2 = ((block * pixel_res) ** 2) / 1e6

    features = []
    tiers = [
        ("high", 15.5, 0.04, "STEEP DEPTH-GRADIENT REGION"),
        ("critical", 23.0, 0.02, "CRITICAL CLIFF / ESCARPMENT"),
    ]

    for severity, threshold, min_km2, title in tiers:
        loops = marching_squares_contours(smoothed, threshold)
        for loop in loops:
            area_cells = polygon_area(loop)
            area_km2 = area_cells * cell_km2
            if area_km2 < min_km2:
                continue
            simp = douglas_peucker(loop[:-1], 0.45)
            if len(simp) < 4:
                continue
            simp.append(simp[0])

            # Sample peak slope & elevation range in bounding box
            rs = [int(max(0, min(bH - 1, round(p[0])))) for p in simp]
            cs = [int(max(0, min(bW - 1, round(p[1])))) for p in simp]
            r_lo, r_hi = min(rs), max(rs) + 1
            c_lo, c_hi = min(cs), max(cs) + 1
            peak_slope = float(np.max(slope_max[r_lo:r_hi, c_lo:c_hi]))
            z_min = float(np.min(elev_min_cell[r_lo:r_hi, c_lo:c_hi]))
            z_max = float(np.max(elev_max_cell[r_lo:r_hi, c_lo:c_hi]))

            ring = []
            for pr, pc in simp:
                lat, lon = grid_to_latlon((pr + 0.5) * block, (pc + 0.5) * block, origin_x, origin_y, pixel_res)
                ring.append([round(lon, 6), round(lat, 6)])

            features.append({
                "type": "Feature",
                "properties": {
                    "severity": severity,
                    "label": title,
                    "peakSlopeDeg": round(peak_slope, 1),
                    "minElevM": round(z_min, 1),
                    "maxElevM": round(z_max, 1),
                    "areaKm2": round(area_km2, 3),
                },
                "geometry": {
                    "type": "Polygon",
                    "coordinates": [ring],
                },
            })

    geojson = {
        "type": "FeatureCollection",
        "metadata": {
            "source": "Preprocess Stages 1, 2 & 4 (DEM Elevation + Slope + Barrier Grid)",
            "block_size_px": block,
            "feature_count": len(features),
        },
        "features": features,
    }
    DEST_GEOJSON.write_text(json.dumps(geojson))
    print(f"Wrote {len(features)} hazard polygon regions to {DEST_GEOJSON} ({DEST_GEOJSON.stat().st_size / 1024:.1f} KB)")


if __name__ == "__main__":
    main()
