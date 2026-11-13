#!/usr/bin/env python3
"""
Mars Terrain & Hazard 3D Stage Visualizer
High-performance 3D visualization tool for Jezero Crater pipeline stages.
Reads ./output folder stages and streams high-density voxel/block data to a WebGL 3D viewer.
"""

import os
import sys
import glob
import json
import time
import math
import struct
import argparse
import http.server
import socketserver
import urllib.parse
import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "output")
VIEWER_DIR = os.path.join(BASE_DIR, "viewer")


class StageDataManager:
    """Manages loading, caching, and streaming stage data from the output directory."""

    def __init__(self, output_dir: str):
        self.output_dir = output_dir
        self._cache = {}

    def get_stages(self):
        """Discovers all stage directories in output/ and parses their metadata."""
        if not os.path.exists(self.output_dir):
            return []

        stages = []
        for entry in sorted(os.listdir(self.output_dir)):
            stage_path = os.path.join(self.output_dir, entry)
            if not os.path.isdir(stage_path):
                continue

            clean_name = entry.replace("_", " ").title()
            if "Consolidated" in clean_name:
                clean_name = clean_name.replace("Consolidated", "(Consolidated)").strip()

            stage_info = {
                "id": entry,
                "name": clean_name,
                "path": stage_path,
                "has_elevation": False,
                "has_costmap": False,
                "has_slopes": False,
                "has_heuristics": False,
                "metadata": {},
                "files": os.listdir(stage_path)
            }

            # Check metadata files
            for f in os.listdir(stage_path):
                if f.endswith(".json"):
                    try:
                        with open(os.path.join(stage_path, f), "r") as mf:
                            data = json.load(mf)
                            stage_info["metadata"].update(data)
                            if "description" in data:
                                stage_info["description"] = data["description"]
                    except Exception:
                        pass

            # Detect elevation
            elev_path = self._find_elevation_file(entry)
            if elev_path:
                stage_info["has_elevation"] = True

            # Detect costmap / hazards
            cost_path = self._find_cost_file(entry)
            if cost_path:
                stage_info["has_costmap"] = True

            # Detect slopes
            slope_path = self._find_slope_file(entry)
            if slope_path:
                stage_info["has_slopes"] = True

            # Detect heuristics
            stage_info["has_heuristics"] = any("heuristic" in f.lower() and f.endswith(".npz") for f in stage_info["files"]) or "stage_6" in entry

            stages.append(stage_info)
        return stages

    def _find_elevation_file(self, stage_id: str) -> str:
        """Finds elevation matrix in stage directory or falls back to stage_1 / stage_1_consolidated."""
        stage_dir = os.path.join(self.output_dir, stage_id)
        if os.path.exists(stage_dir):
            for f in sorted(os.listdir(stage_dir)):
                fl = f.lower()
                if fl.endswith(".npy"):
                    # Strictly exclude costmaps, hazards, slopes, barriers, masks, grids
                    if any(bad in fl for bad in ["cost", "hazard", "slope", "barrier", "mask", "angle", "master", "grid"]):
                        continue
                    if any(k in fl for k in ["elevation", "dtm", "height"]):
                        return os.path.join(stage_dir, f)

        # Fallback to stage 1 (consolidated or standard)
        for s1_cand in ["stage_1_consolidated", "stage_1"]:
            s1_dir = os.path.join(self.output_dir, s1_cand)
            if os.path.exists(s1_dir):
                for f in sorted(os.listdir(s1_dir)):
                    fl = f.lower()
                    if fl.endswith(".npy") and any(k in fl for k in ["elevation", "dtm", "height"]):
                        if not any(bad in fl for bad in ["cost", "hazard", "slope", "barrier", "master", "grid"]):
                            return os.path.join(s1_dir, f)

        # Search any stage directory for elevation .npy
        for root, _, files in os.walk(self.output_dir):
            for f in sorted(files):
                fl = f.lower()
                if fl.endswith(".npy") and any(k in fl for k in ["elevation", "dtm"]):
                    if not any(bad in fl for bad in ["cost", "hazard", "slope", "barrier", "master", "grid"]):
                        return os.path.join(root, f)

        return ""

    def _find_cost_file(self, stage_id: str) -> str:
        """Finds cost, hazard, barrier, or preprocessed master grid file."""
        if "stage_1" in stage_id.lower():
            return ""
        stage_dir = os.path.join(self.output_dir, stage_id)
        if os.path.exists(stage_dir):
            # 1. Search priority patterns in stage dir (excluding coarse downsampled maps, heuristics, and tensors)
            patterns = [
                "*master*.npy",
                "*hazard*cost*.npy",
                "*slope*cost*.npy",
                "*barrier*.npy",
                "*hazard*.npy",
                "*cost*.npy",
                "*mask*.npy",
                "*grid*.npy"
            ]
            for pat in patterns:
                for match in glob.glob(os.path.join(stage_dir, pat)):
                    bname = os.path.basename(match).lower()
                    if not any(bad in bname for bad in ["coarse", "heuristic", "tensor", "waypoint"]):
                        return match
            # 2. Any .npy in directory that is not elevation and not slope and not coarse/heuristic/tensor
            for f in sorted(os.listdir(stage_dir)):
                fl = f.lower()
                if fl.endswith(".npy") and not any(k in fl for k in ["elevation", "dtm", "height", "slope", "angle", "coarse", "heuristic", "tensor", "waypoint"]):
                    return os.path.join(stage_dir, f)

        # 3. Fallback to preceding stage's master grid (e.g. stage 5 and 6 use stage 4 master grid)
        for prev in [
            "stage_5_consolidated", "stage_5",
            "stage_4_consolidated", "stage_4",
            "stage_3_consolidated", "stage_3",
            "stage_2_consolidated", "stage_2"
        ]:
            prev_dir = os.path.join(self.output_dir, prev)
            if os.path.exists(prev_dir):
                patterns = ["*master*.npy", "*hazard*.npy", "*barrier*.npy", "*cost*.npy", "*mask*.npy", "*grid*.npy"]
                for pat in patterns:
                    for match in glob.glob(os.path.join(prev_dir, pat)):
                        bname = os.path.basename(match).lower()
                        if not any(bad in bname for bad in ["coarse", "heuristic", "tensor", "waypoint"]):
                            return match
        return ""

    def _find_heuristics_file(self, stage_id: str = "stage_6_consolidated") -> str:
        """Finds heuristics maps npz file."""
        stage_dir = os.path.join(self.output_dir, stage_id)
        if os.path.exists(stage_dir):
            for pat in ["*heuristics*.npz", "*heuristic*.npz"]:
                matches = glob.glob(os.path.join(stage_dir, pat))
                if matches:
                    return matches[0]

        for s6_cand in ["stage_6_consolidated", "stage_6"]:
            s6_dir = os.path.join(self.output_dir, s6_cand)
            if os.path.exists(s6_dir):
                for pat in ["*heuristics*.npz", "*heuristic*.npz"]:
                    matches = glob.glob(os.path.join(s6_dir, pat))
                    if matches:
                        return matches[0]

        for root, _, files in os.walk(self.output_dir):
            for f in files:
                if "heuristic" in f.lower() and f.endswith(".npz"):
                    return os.path.join(root, f)
        return ""

    def _find_coarse_cost_file(self, stage_id: str = "stage_6_consolidated") -> str:
        """Finds coarse costmap npy file."""
        for s6_cand in [stage_id, "stage_6_consolidated", "stage_6"]:
            s6_dir = os.path.join(self.output_dir, s6_cand)
            if os.path.exists(s6_dir):
                for pat in ["*coarse*cost*.npy", "*coarse*.npy"]:
                    matches = glob.glob(os.path.join(s6_dir, pat))
                    if matches:
                        return matches[0]
        return ""

    def _find_all_pairs_matrix_file(self, stage_id: str = "stage_6_consolidated") -> str:
        """Finds precomputed all-pairs 4D matrix file (M=64 macro-cells)."""
        for s6_cand in [stage_id, "stage_6_consolidated", "stage_6"]:
            s6_dir = os.path.join(self.output_dir, s6_cand)
            if os.path.exists(s6_dir):
                for pat in ["*all_pairs*4d*.npy", "*all_pairs*.npy"]:
                    matches = glob.glob(os.path.join(s6_dir, pat))
                    if matches:
                        return matches[0]
        for root, _, files in os.walk(self.output_dir):
            for f in files:
                if "all_pairs" in f.lower() and f.endswith(".npy"):
                    return os.path.join(root, f)
        return ""

    def get_all_pairs_matrix(self, stage_id: str = "stage_6_consolidated"):
        """Returns memory-mapped 4D all-pairs distance matrix (102, 46, 102, 46)."""
        mat_path = self._find_all_pairs_matrix_file(stage_id)
        if mat_path and os.path.exists(mat_path):
            if not hasattr(self, "_all_pairs_cache") or self._all_pairs_cache.get("path") != mat_path:
                try:
                    arr = np.load(mat_path, mmap_mode="r")
                    self._all_pairs_cache = {"path": mat_path, "matrix": arr}
                except Exception as e:
                    print(f"Error memory-mapping 4D all-pairs matrix: {e}")
                    return None
            return self._all_pairs_cache["matrix"]
        return None

    def _get_waypoints_map(self, stage_id: str = "stage_6_consolidated"):
        """Returns dict of waypoint_id -> waypoint details dict with fine & coarse positions."""
        wp_dict = {}
        cand_dirs = [
            os.path.join(self.output_dir, stage_id),
            os.path.join(self.output_dir, "stage_5_consolidated"),
            os.path.join(self.output_dir, "stage_5")
        ]
        for cdir in cand_dirs:
            reg_file = os.path.join(cdir, "consolidated_waypoints_registry.json")
            if os.path.exists(reg_file):
                try:
                    with open(reg_file, "r") as f:
                        data = json.load(f)
                    for item in data:
                        wid = item.get("waypoint_id")
                        if not wid:
                            continue
                        pos = item.get("grid_position") or item.get("original_grid_position") or {}
                        fine_r = int(pos.get("row", 0))
                        fine_c = int(pos.get("col", 0))
                        wp_dict[wid] = {
                            "waypoint_id": wid,
                            "name": item.get("name", wid),
                            "type": item.get("type", "science_station"),
                            "priority": item.get("priority", "HIGH"),
                            "geologic_unit": item.get("geologic_unit", ""),
                            "description": item.get("description", ""),
                            "fine_position": [fine_r, fine_c],
                            "coarse_position": [min(101, fine_r // 64), min(45, fine_c // 64)],
                            "coarse_64": [min(101, fine_r // 64), min(45, fine_c // 64)],
                            "coarse_16": [min(409, fine_r // 16), min(183, fine_c // 16)],
                            "elevation_m": item.get("elevation_m")
                        }
                    if wp_dict:
                        return wp_dict
                except Exception as e:
                    print(f"Error loading {reg_file}: {e}")

        # Fallback to stage landmarks
        lms = self.get_stage_landmarks(stage_id)
        for lm in lms:
            if lm.get("is_waypoint") and lm.get("waypoint_id"):
                wid = lm["waypoint_id"]
                fine_r = int(round(lm.get("row", 0)))
                fine_c = int(round(lm.get("col", 0)))
                wp_dict[wid] = {
                    "waypoint_id": wid,
                    "name": lm.get("name", wid),
                    "type": lm.get("type", "science_station"),
                    "priority": lm.get("priority", "HIGH"),
                    "geologic_unit": lm.get("geologic_unit", ""),
                    "description": lm.get("description", ""),
                    "fine_position": [fine_r, fine_c],
                    "coarse_position": [min(101, fine_r // 64), min(45, fine_c // 64)],
                    "coarse_64": [min(101, fine_r // 64), min(45, fine_c // 64)],
                    "coarse_16": [min(409, fine_r // 16), min(183, fine_c // 16)],
                    "elevation_m": lm.get("z")
                }
        return wp_dict

    def get_heuristics_summary(self, stage_id: str = "stage_6_consolidated"):
        """Returns metadata, list of heuristic targets, and waypoint distance matrix."""
        meta_path = os.path.join(self.output_dir, stage_id, "consolidated_stage6_metadata.json")
        if not os.path.exists(meta_path):
            meta_path = os.path.join(self.output_dir, "stage_6_consolidated", "consolidated_stage6_metadata.json")

        meta = {}
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r") as f:
                    meta = json.load(f)
            except Exception:
                pass

        wp_dict = self._get_waypoints_map(stage_id)
        targets = list(wp_dict.keys())
        wp_list = list(wp_dict.values())

        # Distance matrix in kilometers between waypoints using All-Pairs 4D matrix or npz
        matrix = {}
        mat_4d = self.get_all_pairs_matrix(stage_id)
        if mat_4d is not None:
            cH, cW = mat_4d.shape[:2]
            M = 64
            for t1 in targets:
                matrix[t1] = {}
                fr1, fc1 = wp_dict[t1]["fine_position"]
                r1 = int(np.clip(fr1 // M, 0, cH - 1))
                c1 = int(np.clip(fc1 // M, 0, cW - 1))
                for t2 in targets:
                    fr2, fc2 = wp_dict[t2]["fine_position"]
                    r2 = int(np.clip(fr2 // M, 0, cH - 1))
                    c2 = int(np.clip(fc2 // M, 0, cW - 1))
                    d = float(mat_4d[r1, c1, r2, c2])
                    matrix[t1][t2] = round(d / 1000.0, 3) if not (np.isinf(d) or np.isnan(d)) else None
        else:
            npz_path = self._find_heuristics_file(stage_id)
            if npz_path and npz_path.endswith(".npz") and os.path.exists(npz_path):
                npz = np.load(npz_path)
                for t1 in targets:
                    matrix[t1] = {}
                    if t1 in npz:
                        arr = npz[t1]
                        for t2 in targets:
                            if t2 in wp_dict:
                                cr, cc = wp_dict[t2]["coarse_16"]
                                d = float(arr[cr, cc])
                                matrix[t1][t2] = round(d / 1000.0, 3) if not np.isinf(d) else None

        return {
            "stage_id": stage_id,
            "description": meta.get("description", "Precomputed All-Pairs Obstacle-Aware Heuristic Distance Fields"),
            "downsample_factor": meta.get("downsample_factor", 64),
            "fine_grid_shape": meta.get("fine_grid_shape", [6560, 2950]),
            "coarse_grid_shape": meta.get("coarse_grid_shape", [102, 46]),
            "macro_cells_count": meta.get("macro_cells_count", 4692),
            "traversable_cells_count": meta.get("traversable_cells_count", 3525),
            "macro_cell_resolution_m": meta.get("macro_cell_resolution_m", 1293.05),
            "all_pairs_matrix_shape": meta.get("all_pairs_matrix_shape", [102, 46, 102, 46]),
            "total_precompute_time_s": meta.get("total_precompute_time_s", 0.0),
            "targets": targets,
            "waypoints": wp_list,
            "matrix_km": matrix
        }

    def compute_heuristic_path(self, stage_id: str, from_point: str = None, to_point: str = None,
                               from_col: float = None, from_row: float = None,
                               to_col: float = None, to_row: float = None):
        """Computes optimal obstacle-aware trajectory and metrics between ANY 2 arbitrary points."""
        mat_4d = self.get_all_pairs_matrix(stage_id)
        wp_dict = self._get_waypoints_map(stage_id)

        # 1. Resolve Goal (Destination)
        goal_fc, goal_fr = None, None
        goal_name = to_point or "Custom Goal"

        if to_point and to_point in wp_dict:
            goal_fr, goal_fc = wp_dict[to_point]["fine_position"]
            goal_name = wp_dict[to_point]["name"]
        elif to_row is not None and to_col is not None:
            goal_fr, goal_fc = float(to_row), float(to_col)
            goal_name = f"Custom Goal ({int(goal_fc)}, {int(goal_fr)})"

        # 2. Resolve Start (Origin)
        start_fc, start_fr = None, None
        start_name = from_point or "Custom Start"

        if from_point and from_point in wp_dict:
            start_fr, start_fc = wp_dict[from_point]["fine_position"]
            start_name = wp_dict[from_point]["name"]
        elif from_row is not None and from_col is not None:
            start_fr, start_fc = float(from_row), float(from_col)
            start_name = f"Custom Start ({int(start_fc)}, {int(start_fr)})"

        if goal_fc is None or goal_fr is None or start_fc is None or start_fr is None:
            raise ValueError("Must specify valid start and goal locations")

        elev_arr = None
        try:
            elev_arr, _, _ = self.load_stage_arrays(stage_id)
        except Exception:
            pass

        # Primary: All-Pairs 4D Matrix (M=64 macro-cells) covers ANY arbitrary points
        if mat_4d is not None and mat_4d.ndim == 4:
            cH, cW = mat_4d.shape[:2]
            M = 64
            I1 = int(np.clip(start_fr // M, 0, cH - 1))
            J1 = int(np.clip(start_fc // M, 0, cW - 1))
            I2 = int(np.clip(goal_fr // M, 0, cH - 1))
            J2 = int(np.clip(goal_fc // M, 0, cW - 1))

            if I1 == I2 and J1 == J2:
                total_dist_m = float(np.hypot(start_fc - goal_fc, start_fr - goal_fr) * 20.203946)
                path_coarse = [(I1, J1)]
            else:
                raw_dist = float(mat_4d[I1, J1, I2, J2])
                if np.isinf(raw_dist) or np.isnan(raw_dist):
                    return {
                        "reachable": False,
                        "from": {"id": from_point, "name": start_name, "col": start_fc, "row": start_fr},
                        "to": {"id": to_point, "name": goal_name, "col": goal_fc, "row": goal_fr},
                        "error": "Goal is unreachable due to impassable terrain barriers or boundary"
                    }
                total_dist_m = raw_dist

                # Downhill gradient descent on precomputed distance field
                h_map = mat_4d[:, :, I2, J2]
                curr = (I1, J1)
                goal = (I2, J2)
                path_coarse = [curr]
                for _ in range(800):
                    if curr == goal:
                        break
                    r, c = curr
                    best_next = curr
                    best_val = h_map[r, c]
                    for dr in [-1, 0, 1]:
                        for dc in [-1, 0, 1]:
                            if dr == 0 and dc == 0:
                                continue
                            nr, nc = r + dr, c + dc
                            if 0 <= nr < cH and 0 <= nc < cW:
                                val = h_map[nr, nc]
                                if val < best_val:
                                    best_val = val
                                    best_next = (nr, nc)
                    if best_next == curr:
                        break
                    curr = best_next
                    path_coarse.append(curr)

            # High-density fine interpolation for smooth 3D elevation profiling
            macro_pts = []
            for i, (cr, cc) in enumerate(path_coarse):
                if i == 0:
                    fc, fr = start_fc, start_fr
                elif i == len(path_coarse) - 1:
                    fc, fr = goal_fc, goal_fr
                else:
                    fc = cc * 64.0 + 32.0
                    fr = cr * 64.0 + 32.0
                macro_pts.append((fc, fr, cr, cc))

            pts_dense = []
            for k in range(len(macro_pts) - 1):
                p0 = macro_pts[k]
                p1 = macro_pts[k + 1]
                dist_seg = float(np.hypot(p1[0] - p0[0], p1[1] - p0[1]))
                substeps = max(1, int(round(dist_seg / 24.0)))
                for s in range(substeps):
                    frac = s / float(substeps)
                    pts_dense.append((p0[0] + (p1[0] - p0[0]) * frac, p0[1] + (p1[1] - p0[1]) * frac, p0[2], p0[3]))
            pts_dense.append(macro_pts[-1])

            path_3d = []
            for cur_c, cur_r, cr, cc in pts_dense:
                z = -2500.0
                if elev_arr is not None:
                    r_idx = max(0, min(elev_arr.shape[0] - 1, int(round(cur_r))))
                    c_idx = max(0, min(elev_arr.shape[1] - 1, int(round(cur_c))))
                    cell_z = float(elev_arr[r_idx, c_idx])
                    if not np.isnan(cell_z):
                        z = round(cell_z, 1)
                path_3d.append({
                    "col": round(cur_c, 1),
                    "row": round(cur_r, 1),
                    "z": z,
                    "coarse": [cr, cc]
                })

            eucl_dist_m = float(np.hypot(start_fc - goal_fc, start_fr - goal_fr) * 20.203946)
            detour_pct = round(((total_dist_m / max(1.0, eucl_dist_m)) - 1.0) * 100.0, 1)

            return {
                "reachable": True,
                "from": {"id": from_point, "name": start_name, "col": start_fc, "row": start_fr},
                "to": {"id": to_point, "name": goal_name, "col": goal_fc, "row": goal_fr},
                "heuristic_distance_m": round(total_dist_m, 1),
                "heuristic_distance_km": round(total_dist_m / 1000.0, 2),
                "euclidean_distance_m": round(eucl_dist_m, 1),
                "euclidean_distance_km": round(eucl_dist_m / 1000.0, 2),
                "detour_pct": max(0.0, detour_pct),
                "steps_count": len(path_3d),
                "macro_steps": len(path_coarse),
                "path": path_3d
            }

        # Fallback: NPZ or Coarse Costmap (M=16)
        npz_path = self._find_heuristics_file(stage_id)
        if not npz_path or not os.path.exists(npz_path):
            raise FileNotFoundError("Heuristics data not found")

        start_cr = min(409, max(0, int(start_fr // 16)))
        start_cc = min(183, max(0, int(start_fc // 16)))
        goal_cr = min(409, max(0, int(goal_fr // 16)))
        goal_cc = min(183, max(0, int(goal_fc // 16)))

        npz = np.load(npz_path)
        if to_point in npz:
            h_map = npz[to_point]
            total_dist_m = float(h_map[start_cr, start_cc])
            if np.isinf(total_dist_m):
                return {
                    "reachable": False,
                    "from": {"id": from_point, "name": start_name, "col": start_fc, "row": start_fr},
                    "to": {"id": to_point, "name": goal_name, "col": goal_fc, "row": goal_fr},
                    "error": "Goal is unreachable due to impassable barriers"
                }
            path_coarse = [(start_cr, start_cc)]
            curr = (start_cr, start_cc)
            goal = (goal_cr, goal_cc)
            for _ in range(1200):
                if curr == goal:
                    break
                r, c = curr
                best_next = curr
                best_val = h_map[r, c]
                for dr in [-1, 0, 1]:
                    for dc in [-1, 0, 1]:
                        if dr == 0 and dc == 0:
                            continue
                        nr, nc = r + dr, c + dc
                        if 0 <= nr < h_map.shape[0] and 0 <= nc < h_map.shape[1]:
                            val = h_map[nr, nc]
                            if val < best_val:
                                best_val = val
                                best_next = (nr, nc)
                if best_next == curr:
                    break
                curr = best_next
                path_coarse.append(curr)

        elif from_point in npz:
            # Gradient descent backwards from goal to start on start's distance field
            h_map = npz[from_point]
            total_dist_m = float(h_map[goal_cr, goal_cc])

            if np.isinf(total_dist_m):
                return {
                    "reachable": False,
                    "from": {"id": from_point, "name": start_name, "col": start_fc, "row": start_fr},
                    "to": {"id": to_point, "name": goal_name, "col": goal_fc, "row": goal_fr},
                    "error": "Goal is unreachable due to impassable barriers or coverage boundary"
                }

            path_coarse = [(goal_cr, goal_cc)]
            curr = (goal_cr, goal_cc)
            goal = (start_cr, start_cc)

            for _ in range(1200):
                if curr == goal:
                    break
                r, c = curr
                best_next = curr
                best_val = h_map[r, c]
                for dr in [-1, 0, 1]:
                    for dc in [-1, 0, 1]:
                        if dr == 0 and dc == 0:
                            continue
                        nr, nc = r + dr, c + dc
                        if 0 <= nr < h_map.shape[0] and 0 <= nc < h_map.shape[1]:
                            val = h_map[nr, nc]
                            if val < best_val:
                                best_val = val
                                best_next = (nr, nc)
                if best_next == curr:
                    break
                curr = best_next
                path_coarse.append(curr)
            path_coarse.reverse()

        else:
            # Fast A* on coarse costmap matching Stage 6 edge costs (~25ms)
            coarse_cost_path = self._find_coarse_cost_file(stage_id)
            if not coarse_cost_path or not os.path.exists(coarse_cost_path):
                raise FileNotFoundError("Coarse costmap not found")
            coarse_cost = np.load(coarse_cost_path)
            R, C = coarse_cost.shape
            import heapq

            if np.isinf(coarse_cost[start_cr, start_cc]) or np.isinf(coarse_cost[goal_cr, goal_cc]):
                return {
                    "reachable": False,
                    "from": {"id": from_point, "name": start_name, "col": start_fc, "row": start_fr},
                    "to": {"id": to_point, "name": goal_name, "col": goal_fc, "row": goal_fr},
                    "error": "Origin or destination is inside an impassable terrain barrier"
                }

            def h_eucl(r, c):
                return float(np.hypot(r - goal_cr, c - goal_cc) * 323.26)

            g_score = np.full((R, C), np.inf, dtype=np.float32)
            g_score[start_cr, start_cc] = 0.0
            came_from = {}

            pq = [(h_eucl(start_cr, start_cc), 0.0, start_cr, start_cc)]
            moves = [
                (-1, 0, 323.26), (1, 0, 323.26), (0, -1, 323.26), (0, 1, 323.26),
                (-1, -1, 457.16), (-1, 1, 457.16), (1, -1, 457.16), (1, 1, 457.16)
            ]

            found = False
            while pq:
                f, g, r, c = heapq.heappop(pq)
                if (r, c) == (goal_cr, goal_cc):
                    found = True
                    break
                if g > g_score[r, c]:
                    continue
                w_u = coarse_cost[r, c]
                for dr, dc, step_cost in moves:
                    nr, nc = r + dr, c + dc
                    if 0 <= nr < R and 0 <= nc < C:
                        w_v = coarse_cost[nr, nc]
                        if np.isinf(w_v):
                            continue
                        edge_cost = step_cost * 0.5 * (w_u + w_v)
                        new_g = g + edge_cost
                        if new_g < g_score[nr, nc]:
                            g_score[nr, nc] = new_g
                            came_from[(nr, nc)] = (r, c)
                            heapq.heappush(pq, (new_g + h_eucl(nr, nc), new_g, nr, nc))

            if not found:
                return {
                    "reachable": False,
                    "from": {"id": from_point, "name": start_name, "col": start_fc, "row": start_fr},
                    "to": {"id": to_point, "name": goal_name, "col": goal_fc, "row": goal_fr},
                    "error": "Goal is unreachable due to impassable barriers"
                }

            total_dist_m = float(g_score[goal_cr, goal_cc])
            path_coarse = [(goal_cr, goal_cc)]
            curr = (goal_cr, goal_cc)
            while curr in came_from:
                curr = came_from[curr]
                path_coarse.append(curr)
            path_coarse.reverse()

        # Build 3D points
        path_3d = []
        for i, (cr, cc) in enumerate(path_coarse):
            if i == 0 and start_fc is not None and start_fr is not None:
                fc, fr = start_fc, start_fr
            elif i == len(path_coarse) - 1 and goal_fc is not None and goal_fr is not None:
                fc, fr = goal_fc, goal_fr
            else:
                fc = cc * 16.0 + 8.0
                fr = cr * 16.0 + 8.0

            z = -2500.0
            if elev_arr is not None:
                r_idx = max(0, min(elev_arr.shape[0] - 1, int(round(fr))))
                c_idx = max(0, min(elev_arr.shape[1] - 1, int(round(fc))))
                cell_z = float(elev_arr[r_idx, c_idx])
                if not np.isnan(cell_z):
                    z = round(cell_z, 1)

            path_3d.append({
                "col": round(fc, 1),
                "row": round(fr, 1),
                "z": z,
                "coarse": [cr, cc]
            })

        eucl_dist_m = float(np.hypot((start_fc or 0) - (goal_fc or 0), (start_fr or 0) - (goal_fr or 0)) * 20.203946)
        detour_pct = round(((total_dist_m / max(1.0, eucl_dist_m)) - 1.0) * 100.0, 1)

        return {
            "reachable": True,
            "from": {"id": from_point, "name": start_name, "col": start_fc, "row": start_fr},
            "to": {"id": to_point, "name": goal_name, "col": goal_fc, "row": goal_fr},
            "heuristic_distance_m": round(total_dist_m, 1),
            "heuristic_distance_km": round(total_dist_m / 1000.0, 2),
            "euclidean_distance_m": round(eucl_dist_m, 1),
            "euclidean_distance_km": round(eucl_dist_m / 1000.0, 2),
            "detour_pct": detour_pct,
            "steps_count": len(path_3d),
            "path": path_3d
        }

    def _find_slope_file(self, stage_id: str) -> str:
        # Stage 1 is pure unconstrained baseline elevation with zero obstacles
        if "stage_1" in stage_id.lower():
            return ""
        stage_dir = os.path.join(self.output_dir, stage_id)
        if os.path.exists(stage_dir):
            for f in sorted(os.listdir(stage_dir)):
                fl = f.lower()
                if fl.endswith(".npy"):
                    if any(bad in fl for bad in ["cost", "hazard", "barrier", "mask", "master", "grid"]):
                        continue
                    if any(k in fl for k in ["slope", "angle", "deg"]):
                        return os.path.join(stage_dir, f)

        # Fallback to stage_2 slope angles if available
        for s2_cand in ["stage_2_consolidated", "stage_2"]:
            s2_dir = os.path.join(self.output_dir, s2_cand)
            if os.path.exists(s2_dir):
                for f in sorted(os.listdir(s2_dir)):
                    fl = f.lower()
                    if fl.endswith(".npy") and any(k in fl for k in ["slope", "angle", "deg"]):
                        if not any(bad in fl for bad in ["cost", "hazard", "barrier", "master", "grid"]):
                            return os.path.join(s2_dir, f)
        return ""

    def load_stage_arrays(self, stage_id: str):
        """Loads and returns (elevation_matrix, cost_matrix, slope_matrix) with mtime auto-invalidation."""
        elev_path = self._find_elevation_file(stage_id)
        if not elev_path or not os.path.exists(elev_path):
            raise FileNotFoundError(f"No elevation data found for stage '{stage_id}'")

        cost_path = self._find_cost_file(stage_id)
        slope_path = self._find_slope_file(stage_id)

        elev_mtime = os.path.getmtime(elev_path)
        cost_mtime = os.path.getmtime(cost_path) if (cost_path and os.path.exists(cost_path)) else 0
        slope_mtime = os.path.getmtime(slope_path) if (slope_path and os.path.exists(slope_path)) else 0

        cache_key = (stage_id, elev_mtime, cost_mtime, slope_mtime)
        if cache_key in self._cache:
            return self._cache[cache_key]

        elev = np.load(elev_path, mmap_mode="r").astype(np.float32)
        cost = np.load(cost_path, mmap_mode="r").astype(np.float32) if (cost_path and os.path.exists(cost_path)) else None
        slope = np.load(slope_path, mmap_mode="r").astype(np.float32) if (slope_path and os.path.exists(slope_path)) else None

        # Ensure cost and slope matrices match elevation fine grid shape
        if cost is not None and cost.shape != elev.shape:
            # Fallback to stage 4 consolidated master grid
            s4_grid = os.path.join(self.output_dir, "stage_4_consolidated", "consolidated_preprocessed_master_grid.npy")
            if os.path.exists(s4_grid):
                cost = np.load(s4_grid, mmap_mode="r").astype(np.float32)
            else:
                cost = None

        if slope is not None and slope.shape != elev.shape:
            slope = None

        # Clean old keys for this stage
        self._cache = {k: v for k, v in self._cache.items() if k[0] != stage_id}
        self._cache[cache_key] = (elev, cost, slope)
        return elev, cost, slope

    def pack_binary_blocks(self, stage_id: str, step: int = 4, filter_mode: str = "all", roi: dict = None, heuristic_target: str = None, target_col: float = None, target_row: float = None):
        """
        Packs stage data into a compact binary buffer for high-performance WebGL rendering.
        Optionally overlays obstacle-aware heuristic distance fields for ANY target point.
        """
        t0 = time.time()
        elev, cost, slope = self.load_stage_arrays(stage_id)
        total_rows, total_cols = elev.shape

        step = max(1, int(step))

        # Handle ROI (Region of Interest)
        if roi and isinstance(roi, dict):
            r_min = max(0, int(roi.get("r_min", 0)))
            r_max = min(total_rows, int(roi.get("r_max", total_rows)))
            c_min = max(0, int(roi.get("c_min", 0)))
            c_max = min(total_cols, int(roi.get("c_max", total_cols)))
        else:
            r_min, r_max = 0, total_rows
            c_min, c_max = 0, total_cols

        # Slice sub-grids
        sub_elev = elev[r_min:r_max:step, c_min:c_max:step]
        sub_cost = cost[r_min:r_max:step, c_min:c_max:step] if cost is not None else None
        sub_slope = slope[r_min:r_max:step, c_min:c_max:step] if slope is not None else None

        HEADER_FMT = "<4sIIIIIffIII20s"

        valid_mask = ~np.isnan(sub_elev)
        if not np.any(valid_mask):
            # Return empty buffer with header
            header = struct.pack(HEADER_FMT, b"MARS", 1, 0, total_rows, total_cols, step, 0.0, 0.0, 0, 0, 0, b"\x00" * 20)
            return header

        r_indices, c_indices = np.nonzero(valid_mask)
        z_vals = sub_elev[valid_mask]

        # Calculate coordinates in original grid space
        x_coords = (c_min + c_indices * step).astype(np.float32)
        y_coords = (r_min + r_indices * step).astype(np.float32)

        # Status: 0=Safe, 1=Dangerous (Yellow), 2=Blocked/Barrier (Red)
        status = np.zeros(len(z_vals), dtype=np.uint8)
        costs = np.ones(len(z_vals), dtype=np.float32)
        slopes = np.zeros(len(z_vals), dtype=np.uint8)

        if sub_slope is not None:
            raw_slopes = sub_slope[valid_mask]
            slopes = np.clip(np.nan_to_num(raw_slopes, nan=0.0), 0, 90).astype(np.uint8)

        if sub_cost is not None:
            raw_costs = sub_cost[valid_mask]
            # Handle inf values for cost array
            is_blocked = np.isinf(raw_costs) | (raw_costs >= 999.0)
            is_danger = (raw_costs > 1.0) & (~is_blocked)
            status[is_danger] = 1
            status[is_blocked] = 2
            costs = np.where(is_blocked, -1.0, raw_costs).astype(np.float32)
        elif sub_slope is not None:
            # If cost matrix is missing but slope matrix exists
            is_blocked = slopes > 20
            is_danger = (slopes >= 15) & (slopes <= 20)
            status[is_danger] = 1
            status[is_blocked] = 2
            costs = np.where(is_blocked, -1.0, np.where(is_danger, 2.5, 1.0)).astype(np.float32)

        # Check if Heuristic distance field overlay is active
        mat_4d = self.get_all_pairs_matrix(stage_id)
        if mat_4d is not None and heuristic_target and heuristic_target != "none":
            target_cr, target_cc = None, None
            wp_dict = self._get_waypoints_map(stage_id)
            if heuristic_target in wp_dict:
                fine_r, fine_c = wp_dict[heuristic_target]["fine_position"]
                target_cr = int(np.clip(fine_r // 64, 0, mat_4d.shape[0] - 1))
                target_cc = int(np.clip(fine_c // 64, 0, mat_4d.shape[1] - 1))
            elif target_row is not None and target_col is not None:
                target_cr = int(np.clip(float(target_row) // 64, 0, mat_4d.shape[0] - 1))
                target_cc = int(np.clip(float(target_col) // 64, 0, mat_4d.shape[1] - 1))
            elif ":" in str(heuristic_target):
                parts = heuristic_target.split(":")
                if len(parts) >= 3:
                    fine_c = float(parts[1])
                    fine_r = float(parts[2])
                    target_cr = int(np.clip(fine_r // 64, 0, mat_4d.shape[0] - 1))
                    target_cc = int(np.clip(fine_c // 64, 0, mat_4d.shape[1] - 1))

            if target_cr is not None and target_cc is not None:
                try:
                    h_map = mat_4d[:, :, target_cr, target_cc]
                    rc = np.clip((y_coords // 64).astype(int), 0, h_map.shape[0] - 1)
                    cc = np.clip((x_coords // 64).astype(int), 0, h_map.shape[1] - 1)
                    h_vals = h_map[rc, cc]
                    is_unreach = np.isinf(h_vals) | np.isnan(h_vals) | (h_vals >= 99999.0)
                    status[is_unreach] = 2
                    costs = np.where(is_unreach, -1.0, h_vals).astype(np.float32)
                except Exception as e:
                    print(f"Error packing all-pairs heuristic target {heuristic_target}: {e}")
        else:
            heur_path = self._find_heuristics_file(stage_id)
            if heur_path and heuristic_target and heuristic_target != "none":
                target = heuristic_target
                try:
                    if heur_path.endswith(".npz"):
                        npz = np.load(heur_path)
                        if target in npz:
                            h_map = npz[target]
                            rc = np.clip((y_coords // 16).astype(int), 0, h_map.shape[0] - 1)
                            cc = np.clip((x_coords // 16).astype(int), 0, h_map.shape[1] - 1)
                            h_vals = h_map[rc, cc]
                            is_unreach = np.isinf(h_vals) | (h_vals >= 99999.0)
                            status[is_unreach] = 2
                            costs = np.where(is_unreach, -1.0, h_vals).astype(np.float32)
                except Exception as e:
                    print(f"Error packing fallback heuristic target {target}: {e}")

        # Apply user filter
        if filter_mode == "hazards":
            keep = status != 0
        elif filter_mode == "blocked":
            keep = status == 2
        elif filter_mode == "dangerous":
            keep = status == 1
        elif filter_mode == "safe":
            keep = status == 0
        else:
            keep = slice(None)

        if filter_mode != "all":
            x_coords = x_coords[keep]
            y_coords = y_coords[keep]
            z_vals = z_vals[keep]
            status = status[keep]
            slopes = slopes[keep]
            costs = costs[keep]

        total_nodes = len(z_vals)
        if total_nodes == 0:
            header = struct.pack(HEADER_FMT, b"MARS", 1, 0, total_rows, total_cols, step, 0.0, 0.0, 0, 0, 0, b"\x00" * 20)
            return header

        min_z = float(np.min(z_vals))
        max_z = float(np.max(z_vals))
        safe_count = int(np.sum(status == 0))
        dangerous_count = int(np.sum(status == 1))
        blocked_count = int(np.sum(status == 2))

        # Binary Header (64 bytes)
        # Format: magic(4s) + version(I) + count(I) + rows(I) + cols(I) + step(I) + min_z(f) + max_z(f) + safe(I) + danger(I) + blocked(I) + pad(20s)
        header = struct.pack(
            HEADER_FMT,
            b"MARS",
            1,
            total_nodes,
            total_rows,
            total_cols,
            step,
            min_z,
            max_z,
            safe_count,
            dangerous_count,
            blocked_count,
            b"\x00" * 20
        )

        # Packed record array (20 bytes per node)
        dtype = [
            ("x", "<f4"),
            ("y", "<f4"),
            ("z", "<f4"),
            ("status", "u1"),
            ("slope", "u1"),
            ("pad", "<u2"),
            ("cost", "<f4")
        ]
        packed = np.empty(total_nodes, dtype=dtype)
        packed["x"] = x_coords
        packed["y"] = y_coords
        packed["z"] = z_vals
        packed["status"] = status
        packed["slope"] = slopes
        packed["pad"] = 0
        packed["cost"] = costs

        payload = packed.tobytes()
        elapsed = (time.time() - t0) * 1000.0
        print(f"[API] Stage: {stage_id} | Step: {step} | Filter: {filter_mode} | Nodes: {total_nodes:,} ({len(payload)/1024/1024:.2f} MB) in {elapsed:.1f}ms")

        return header + payload

    @staticmethod
    def _latlon_to_grid(lat, lon):
        """Projects Martian geographic lat/lon to Jezero 6560x2951 grid (col, row)."""
        try:
            R = 3396190.0
            x_orig = -6117387.581178606
            y_orig = 1145171.1668435
            pix = 20.203946064176
            x_proj = R * (float(lon) - 180.0) * (math.pi / 180.0)
            y_proj = R * float(lat) * (math.pi / 180.0)
            col = (x_proj - x_orig) / pix
            row = (y_orig - y_proj) / pix
            if 0 <= col < 2951 and 0 <= row < 6560:
                return round(col, 1), round(row, 1)
        except Exception:
            pass
        return None

    def get_stage_landmarks(self, stage_id: str):
        """Discovers landmarks and waypoints from files in output/ and extracts key landmark nodes from stage matrices."""
        landmarks = []
        seen_ids = set()
        stage_dir = os.path.join(self.output_dir, stage_id)

        # 1. Authoritative Stage 5 Waypoint Registry Check (Priority)
        reg_file = None
        for pat in ["*waypoints_registry*.json", "*waypoints*.json", "*registry*.json"]:
            m = glob.glob(os.path.join(stage_dir, pat))
            if m:
                reg_file = m[0]
                break

        if not reg_file:
            for s5_cand in ["stage_5_consolidated", "stage_5"]:
                s5_dir = os.path.join(self.output_dir, s5_cand)
                if os.path.exists(s5_dir):
                    for pat in ["*waypoints_registry*.json", "*waypoints*.json"]:
                        m = glob.glob(os.path.join(s5_dir, pat))
                        if m:
                            reg_file = m[0]
                            break
                if reg_file:
                    break

        if not reg_file:
            for root, _, files in os.walk(self.output_dir):
                for f in files:
                    if "waypoints_registry" in f.lower() and f.endswith(".json"):
                        reg_file = os.path.join(root, f)
                        break
                if reg_file:
                    break

        # Load elevation array for accurate waypoint terrain snapping
        elev_arr = None
        try:
            elev_arr, _, _ = self.load_stage_arrays(stage_id)
        except Exception:
            pass

        if reg_file and os.path.exists(reg_file):
            try:
                with open(reg_file, "r") as jf:
                    wps = json.load(jf)
                    if isinstance(wps, list):
                        for item in wps:
                            wid = item.get("waypoint_id") or item.get("id")
                            gp = item.get("grid_position", {})
                            col = float(gp.get("col", 0))
                            row = float(gp.get("row", 0))

                            lat = item.get("lat")
                            lon = item.get("lon")
                            if lat is not None and lon is not None:
                                proj_coords = self._latlon_to_grid(lat, lon)
                                if proj_coords:
                                    col, row = proj_coords

                            # Sample actual ground elevation from elevation matrix
                            z_val = float(item.get("elevation_m", -2500.0))
                            if elev_arr is not None:
                                r_idx = max(0, min(elev_arr.shape[0] - 1, int(round(row))))
                                c_idx = max(0, min(elev_arr.shape[1] - 1, int(round(col))))
                                cell_z = float(elev_arr[r_idx, c_idx])
                                if not np.isnan(cell_z):
                                    z_val = round(cell_z, 1)

                            landmarks.append({
                                "id": wid,
                                "waypoint_id": wid,
                                "name": item.get("name"),
                                "type": item.get("type", "science_station"),
                                "priority": item.get("priority", "HIGH"),
                                "geologic_unit": item.get("geologic_unit", ""),
                                "col": col,
                                "row": row,
                                "z": z_val,
                                "description": item.get("description", ""),
                                "cost": float(item.get("cell_traversal_cost", 1.0)),
                                "is_waypoint": True
                            })
                            if wid:
                                seen_ids.add(wid)
            except Exception as e:
                print(f"Error loading waypoints registry {reg_file}: {e}")

        # 2. Check for other explicit landmark/waypoint/poi JSON or GeoJSON inside output/
        search_dirs = [stage_dir, self.output_dir]
        for sdir in search_dirs:
            if not os.path.exists(sdir):
                continue
            for f in sorted(os.listdir(sdir)):
                fl = f.lower()
                # Skip waypoints_registry and jezero_waypoints if registry already loaded
                if "waypoints_registry" in fl or ("jezero_waypoints" in fl and len(seen_ids) > 0):
                    continue
                if (any(k in fl for k in ["landmark", "waypoint", "poi", "nomenclature"]) and fl.endswith((".json", ".geojson"))) or (fl.endswith(".geojson") and "elevation" not in fl):
                    fp = os.path.join(sdir, f)
                    try:
                        with open(fp, "r") as jf:
                            content = json.load(jf)
                            if isinstance(content, dict) and "features" in content:
                                for i, feat in enumerate(content["features"]):
                                    props = feat.get("properties", {})
                                    geom = feat.get("geometry", {})
                                    coords = geom.get("coordinates", [])
                                    wid = props.get("waypoint_id") or f"geo_{i}"
                                    if wid in seen_ids:
                                        continue
                                    col = float(props.get("grid_col") if "grid_col" in props else 0)
                                    row = float(props.get("grid_row") if "grid_row" in props else 0)
                                    if len(coords) >= 2:
                                        proj_coords = self._latlon_to_grid(coords[1], coords[0])
                                        if proj_coords:
                                            col, row = proj_coords
                                    z_val = None
                                    if elev_arr is not None:
                                        r_idx = max(0, min(elev_arr.shape[0] - 1, int(round(row))))
                                        c_idx = max(0, min(elev_arr.shape[1] - 1, int(round(col))))
                                        cell_z = float(elev_arr[r_idx, c_idx])
                                        if not np.isnan(cell_z):
                                            z_val = round(cell_z, 1)
                                    if z_val is None:
                                        z_val = float(props.get("elevation_m", -2500.0))
                                    landmarks.append({
                                        "id": wid,
                                        "waypoint_id": props.get("waypoint_id"),
                                        "name": props.get("name") or props.get("title") or f"Waypoint {i+1}",
                                        "type": props.get("type") or props.get("class") or "waypoint",
                                        "priority": props.get("priority", "HIGH"),
                                        "geologic_unit": props.get("geologic_unit", ""),
                                        "col": float(col),
                                        "row": float(row),
                                        "z": z_val,
                                        "description": props.get("description") or props.get("desc") or "",
                                        "is_waypoint": True
                                    })
                                    seen_ids.add(wid)
                    except Exception as e:
                        print(f"Error loading landmark file {fp}: {e}")

        # 3. Extract key topographic landmarks directly from stage matrices in output/
        try:
            elev, cost, slope = self.load_stage_arrays(stage_id)
            valid = ~np.isnan(elev)

            elev_min = float(np.nanmin(elev))
            elev_max = float(np.nanmax(elev))

            if elev_max > elev_min:
                # A. Deepest Basin Landmark
                r_min, c_min = np.unravel_index(np.nanargmin(elev), elev.shape)
                landmarks.append({
                    "id": "basin_deepest",
                    "name": "Deepest Basin Floor",
                    "type": "basin",
                    "col": int(c_min),
                    "row": int(r_min),
                    "z": round(float(elev[r_min, c_min]), 1),
                    "description": f"Lowest lakebed elevation ({round(float(elev[r_min, c_min]), 1)}m)"
                })

                # B. Highest Rim Summit Landmark
                r_max, c_max = np.unravel_index(np.nanargmax(elev), elev.shape)
                landmarks.append({
                    "id": "rim_summit",
                    "name": "Western Rim Summit",
                    "type": "summit",
                    "col": int(c_max),
                    "row": int(r_max),
                    "z": round(float(elev[r_max, c_max]), 1),
                    "description": f"Highest topographic rim plateau ({round(float(elev[r_max, c_max]), 1)}m)"
                })

            # C. Steepest Cliff Scarp Landmark
            if slope is not None and np.nanmax(slope) > 0.0:
                r_slp, c_slp = np.unravel_index(np.nanargmax(slope), slope.shape)
                landmarks.append({
                    "id": "cliff_scarp",
                    "name": "Maximum Cliff Scarp",
                    "type": "scarp",
                    "col": int(c_slp),
                    "row": int(r_slp),
                    "z": round(float(elev[r_slp, c_slp]), 1),
                    "slope_deg": round(float(slope[r_slp, c_slp]), 1),
                    "description": f"Steepest topographic grade ({float(slope[r_slp, c_slp]):.1f}° slope)"
                })

            # D. Impassable Barrier Landmark
            if cost is not None:
                is_blk = (np.isinf(cost) | (cost >= 999.0)) & valid
                if np.any(is_blk):
                    b_rows, b_cols = np.nonzero(is_blk)
                    b_mid = len(b_rows) // 2
                    landmarks.append({
                        "id": "barrier_scarp",
                        "name": "Impassable Cliff Barrier Zone",
                        "type": "barrier",
                        "col": int(b_cols[b_mid]),
                        "row": int(b_rows[b_mid]),
                        "z": round(float(elev[b_rows[b_mid], b_cols[b_mid]]), 1),
                        "description": "Critical impassable structural cliff barrier"
                    })
        except Exception as e:
            print(f"Error computing matrix landmarks: {e}")

        return landmarks


class VisualizerServerHandler(http.server.SimpleHTTPRequestHandler):
    """Handles HTTP requests for 3D viewer assets and binary data streams."""

    def __init__(self, *args, data_manager=None, **kwargs):
        self.data_manager = data_manager
        super().__init__(*args, directory=VIEWER_DIR, **kwargs)

    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        # Favicon: return 204 No Content cleanly
        if path == "/favicon.ico":
            self.send_response(204)
            self.end_headers()
            return

        # Helper to get requested or default stage id
        stages = self.data_manager.get_stages()
        default_stage = stages[0]["id"] if stages else "stage_1_consolidated"

        # API: list available stages
        if path == "/api/stages":
            self._send_json(stages)
            return

        # API: stage detailed metadata
        elif path == "/api/stage_info":
            stage_id = query.get("stage", [default_stage])[0]
            info = next((s for s in stages if s["id"] == stage_id), None)
            if info:
                self._send_json(info)
            else:
                self._send_json({"error": "Stage not found"}, status=404)
            return

        # API: landmarks and waypoints
        elif path == "/api/landmarks":
            stage_id = query.get("stage", [default_stage])[0]
            landmarks = self.data_manager.get_stage_landmarks(stage_id)
            self._send_json(landmarks)
            return

        # API: heuristics summary & distance matrix
        elif path == "/api/heuristics":
            stage_id = query.get("stage", [default_stage])[0]
            summary = self.data_manager.get_heuristics_summary(stage_id)
            self._send_json(summary)
            return

        # API: point-to-point heuristic path calculation
        elif path == "/api/heuristics/path":
            stage_id = query.get("stage", [default_stage])[0]
            from_pt = query.get("from", [None])[0]
            to_pt = query.get("to", [None])[0]
            from_col = float(query["from_col"][0]) if "from_col" in query else None
            from_row = float(query["from_row"][0]) if "from_row" in query else None
            to_col = float(query["to_col"][0]) if "to_col" in query else None
            to_row = float(query["to_row"][0]) if "to_row" in query else None

            try:
                res = self.data_manager.compute_heuristic_path(
                    stage_id,
                    from_point=from_pt,
                    to_point=to_pt,
                    from_col=from_col,
                    from_row=from_row,
                    to_col=to_col,
                    to_row=to_row
                )
                self._send_json(res)
            except Exception as e:
                import traceback
                traceback.print_exc()
                self._send_json({"error": str(e)}, status=400)
            return

        # API: binary stream of 3D block nodes
        elif path == "/api/data":
            stage_id = query.get("stage", [default_stage])[0]
            step = int(query.get("step", [8])[0])
            filter_mode = query.get("filter", ["all"])[0]
            target = query.get("target", [None])[0]
            target_col = float(query["target_col"][0]) if "target_col" in query else None
            target_row = float(query["target_row"][0]) if "target_row" in query else None

            roi = None
            if "r_min" in query and "r_max" in query:
                roi = {
                    "r_min": int(query["r_min"][0]),
                    "r_max": int(query["r_max"][0]),
                    "c_min": int(query.get("c_min", [0])[0]),
                    "c_max": int(query.get("c_max", [99999])[0])
                }

            try:
                data = self.data_manager.pack_binary_blocks(stage_id, step=step, filter_mode=filter_mode, roi=roi, heuristic_target=target, target_col=target_col, target_row=target_row)
                self.send_response(200)
                self.send_header("Content-Type", "application/octet-stream")
                self.send_header("Content-Length", str(len(data)))
                self.send_header("Access-Control-Allow-Origin", "*")
                self.send_header("Cache-Control", "no-cache, no-store, must-revalidate")
                self.end_headers()
                self.wfile.write(data)
            except Exception as e:
                import traceback
                traceback.print_exc()
                self._send_json({"error": str(e)}, status=500)
            return

        # Serve viewer files
        return super().do_GET()

    def _send_json(self, data, status=200):
        body = json.dumps(data, indent=2).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        try:
            msg = format % args
            if "/api/" in msg:
                print(f"[HTTP API] {msg}")
            elif not any(code in msg for code in [" 200 ", " 304 ", " 204 "]):
                print(f"[HTTP] {msg}")
        except Exception:
            pass


class ThreadedHTTPServer(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


def start_server(port=8050, output_dir=OUTPUT_DIR):
    data_manager = StageDataManager(output_dir)

    def handler_factory(*args, **kwargs):
        return VisualizerServerHandler(*args, data_manager=data_manager, **kwargs)

    server = ThreadedHTTPServer(("0.0.0.0", port), handler_factory)
    print("=" * 60)
    print(" MARS TERRAIN & HAZARD 3D STAGE VISUALIZER")
    print("=" * 60)
    print(f" Reading stages from: {output_dir}")
    stages = data_manager.get_stages()
    print(f" Found {len(stages)} stage(s):")
    for s in stages:
        desc = s.get('description', 'No description')
        print(f"   • {s['id']}: {s['name']} - {desc}")
    print("-" * 60)
    print(f" WebGL 3D Viewer Running at: http://localhost:{port}")
    print(f" Open your browser to explore the 3D environment!")
    print("=" * 60)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping visualizer server...")
        server.shutdown()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="High-Performance 3D Stage Visualizer")
    parser.add_argument("--port", type=int, default=8050, help="Port to run visualizer server (default: 8050)")
    parser.add_argument("--output-dir", type=str, default=OUTPUT_DIR, help="Path to output directory (default: ./output)")
    args = parser.parse_args()

    start_server(port=args.port, output_dir=args.output_dir)
