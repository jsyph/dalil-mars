#!/usr/bin/env python3
"""
Export Static Viewer Data for Dalil-Mars GitHub Pages.
Converts preprocessing numpy arrays and metadata into static binary buffers
and JSON endpoints for the static WebGL 3D viewer.
"""

import os
import sys
import json
import gzip
import time

# Ensure preprocessing directory is in path
ROOT_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PREPROCESS_DIR = os.path.join(ROOT_DIR, "preprocessing")
DOCS_DIR = os.path.join(ROOT_DIR, "docs")
VIEWER_DATA_DIR = os.path.join(DOCS_DIR, "viewer", "data")

if PREPROCESS_DIR not in sys.path:
    sys.path.insert(0, PREPROCESS_DIR)

from visualizer import StageDataManager


def export_static_data():
    os.makedirs(VIEWER_DATA_DIR, exist_ok=True)
    output_dir = os.path.join(PREPROCESS_DIR, "output")
    mgr = StageDataManager(output_dir)

    print("=" * 60)
    print(" DALIL-MARS: EXPORTING STATIC DATA FOR GITHUB PAGES VIEWER")
    print("=" * 60)
    print(f" Source output dir: {output_dir}")
    print(f" Target viewer data dir: {VIEWER_DATA_DIR}")

    # 1. Export Stages
    stages = mgr.get_stages()
    stages_path = os.path.join(VIEWER_DATA_DIR, "stages.json")
    with open(stages_path, "w") as f:
        json.dump(stages, f, indent=2)
    print(f"✓ Exported {len(stages)} stages -> {stages_path}")

    # 2. Export Stage Info for each stage
    stage_info_map = {}
    for st in stages:
        stage_id = st["id"]
        stage_info_map[stage_id] = st
    stage_info_path = os.path.join(VIEWER_DATA_DIR, "stage_info.json")
    with open(stage_info_path, "w") as f:
        json.dump(stage_info_map, f, indent=2)
    print(f"✓ Exported stage info map -> {stage_info_path}")

    # 3. Export Landmarks / Waypoints
    # We export for stage_5_consolidated (primary) and stage_6_consolidated
    landmarks = mgr.get_stage_landmarks("stage_5_consolidated")
    landmarks_path = os.path.join(VIEWER_DATA_DIR, "landmarks.json")
    with open(landmarks_path, "w") as f:
        json.dump(landmarks, f, indent=2)
    print(f"✓ Exported {len(landmarks)} landmarks -> {landmarks_path}")

    # 4. Export Heuristics summary & matrix
    heuristics = mgr.get_heuristics_summary("stage_6_consolidated")
    heuristics_path = os.path.join(VIEWER_DATA_DIR, "heuristics.json")
    with open(heuristics_path, "w") as f:
        json.dump(heuristics, f, indent=2)
    print(f"✓ Exported heuristics summary -> {heuristics_path}")

    # 5. Precompute and export paths between all known waypoints
    targets = heuristics.get("targets", [])
    paths = {}
    print(f" Computing precalculated paths for {len(targets)} waypoints...")
    for t1 in targets:
        for t2 in targets:
            if t1 == t2:
                continue
            pair_key = f"{t1}_{t2}"
            try:
                path_res = mgr.compute_heuristic_path("stage_6_consolidated", from_point=t1, to_point=t2)
                if path_res and path_res.get("reachable"):
                    paths[pair_key] = path_res
            except Exception as e:
                print(f"  Warning: path calculation failed for {pair_key}: {e}")
    paths_path = os.path.join(VIEWER_DATA_DIR, "heuristic_paths.json")
    with open(paths_path, "w") as f:
        json.dump(paths, f, indent=2)
    print(f"✓ Exported {len(paths)} waypoint traverse paths -> {paths_path}")

    # 6. Export Binary Blocks for key steps (16, 8, 4, 2)
    # Using consolidated Stage 1 (and fallback to Master Grid from Stage 4 for hazards/barriers)
    # Target primary stage: stage_5_consolidated or stage_4_consolidated
    primary_stage = "stage_5_consolidated" if any(s["id"] == "stage_5_consolidated" for s in stages) else stages[0]["id"]
    print(f" Generating static binary blocks for primary stage: {primary_stage}")

    steps_to_export = [16, 8, 4, 2]
    for step in steps_to_export:
        t0 = time.time()
        print(f" Packing binary blocks for Step {step}...")
        raw_bin = mgr.pack_binary_blocks(primary_stage, step=step, filter_mode="all")
        raw_size = len(raw_bin)

        # Write both raw .bin and compressed .bin.gz
        bin_filename = f"terrain_step{step}.bin"
        gz_filename = f"terrain_step{step}.bin.gz"

        bin_path = os.path.join(VIEWER_DATA_DIR, bin_filename)
        gz_path = os.path.join(VIEWER_DATA_DIR, gz_filename)

        # For step 2 (66.7 MB), compress with gzip level 6 for fast decompression in browser
        gz_data = gzip.compress(raw_bin, compresslevel=6)

        with open(gz_path, "wb") as f:
            f.write(gz_data)

        # For steps 16, 8, 4 (small to medium), write raw .bin as well
        if step != 2:
            with open(bin_path, "wb") as f:
                f.write(raw_bin)

        elapsed = time.time() - t0
        print(f"  -> Step {step}: Raw {raw_size/1024/1024:.2f} MB | Gzipped {len(gz_data)/1024/1024:.2f} MB ({elapsed:.2f}s)")

    print("\n✓ All static viewer data generated successfully!")


if __name__ == "__main__":
    export_static_data()
