#!/usr/bin/env python3
"""Dalil-Mars: Jezero Crater Mars Preprocessing Master Pipeline.

End-to-end orchestrator for stages 1 through 6:
  Stage 1: Consolidated DTM Mosaic & Elevation Matrix
  Stage 2: Topographic Slope Angle Gradient & Cost Multipliers
  Stage 3: Surface Hazard Overlays (Sand Dunes, Boulders, Dust)
  Stage 4: Structural Cliff Barriers & Cliff Drop-offs (Master Grid)
  Stage 5: Waypoint Snapping & Coordinate Georeferencing
  Stage 6: Obstacle-Aware Hierarchical Heuristics (All-Pairs Coarse Grid)
"""

import sys
import os
import time
import argparse

# Ensure working directory is the preprocessing folder so relative output paths resolve cleanly
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
if os.getcwd() != BASE_DIR:
    os.chdir(BASE_DIR)

# Add current directory to path so stage modules can be imported
if BASE_DIR not in sys.path:
    sys.path.insert(0, BASE_DIR)


def print_banner(text: str):
    print("\n" + "=" * 65)
    print(f" {text}")
    print("=" * 65)


def run_stage_1(render_preview: bool = True):
    print_banner("STAGE 1: CONSOLIDATED DTM MOSAIC & ELEVATION MATRIX")
    t0 = time.time()
    tif_path = "./output/stage_1_consolidated/consolidated_dtm_mosaic.tif"
    npy_path = "./output/stage_1_consolidated/consolidated_elevation_matrix.npy"

    if not os.path.exists(npy_path) and not os.path.exists(tif_path):
        raise FileNotFoundError(
            f"Neither {npy_path} nor {tif_path} was found in output/stage_1_consolidated/."
        )

    if render_preview:
        import subprocess

        cmd = [sys.executable, "stage1.py"]
        res = subprocess.run(cmd, check=True)
        if res.returncode != 0:
            print("Warning: stage1.py preview generation failed.")
    else:
        print(f"Verified Stage 1 artifacts present: {npy_path}")

    elapsed = time.time() - t0
    print(f" Stage 1 completed in {elapsed:.2f}s")
    return elapsed


def run_stage_2():
    from stage2 import Stage2SlopePipeline

    t0 = time.time()
    pipeline = Stage2SlopePipeline()
    pipeline.process_slope_mask()
    elapsed = time.time() - t0
    print(f" Stage 2 completed in {elapsed:.2f}s")
    return elapsed


def run_stage_3():
    from stage3 import Stage3SurfaceHazardPipeline

    t0 = time.time()
    pipeline = Stage3SurfaceHazardPipeline()
    pipeline.process_surface_hazards()
    elapsed = time.time() - t0
    print(f" Stage 3 completed in {elapsed:.2f}s")
    return elapsed


def run_stage_4():
    from stage4 import Stage4CliffBarrierPipeline

    t0 = time.time()
    pipeline = Stage4CliffBarrierPipeline()
    pipeline.process_cliff_barriers()
    elapsed = time.time() - t0
    print(f" Stage 4 completed in {elapsed:.2f}s")
    return elapsed


def run_stage_5():
    from stage5 import Stage5WaypointsPipeline

    t0 = time.time()
    pipeline = Stage5WaypointsPipeline()
    pipeline.process_waypoints()
    elapsed = time.time() - t0
    print(f" Stage 5 completed in {elapsed:.2f}s")
    return elapsed


def run_stage_6():
    from stage6 import Stage6HeuristicPipeline

    t0 = time.time()
    pipeline = Stage6HeuristicPipeline()
    pipeline.process_heuristics()
    elapsed = time.time() - t0
    print(f" Stage 6 completed in {elapsed:.2f}s")
    return elapsed


STAGE_RUNNERS = {
    1: ("DTM Elevation Mosaic", run_stage_1),
    2: ("Topographic Slope Mask", run_stage_2),
    3: ("Surface Hazard Overlays", run_stage_3),
    4: ("Structural Cliff Barriers", run_stage_4),
    5: ("Waypoints Snapping", run_stage_5),
    6: ("Hierarchical Heuristics", run_stage_6),
}


def main():
    parser = argparse.ArgumentParser(
        description="End-to-End Jezero Crater Mars Preprocessing Pipeline"
    )
    parser.add_argument(
        "stages",
        nargs="*",
        type=int,
        help="Optional stage numbers to run (e.g. 5 6). Default: run all stages 1-6.",
    )
    parser.add_argument(
        "--from-stage",
        type=int,
        default=1,
        help="Start running from this stage number up to 6.",
    )
    parser.add_argument(
        "--skip-preview",
        action="store_true",
        help="Skip high-resolution matplotlib preview in stage 1.",
    )

    args = parser.parse_args()

    if args.stages:
        stages_to_run = sorted(list(set(args.stages)))
    else:
        stages_to_run = [s for s in range(args.from_stage, 7)]

    print_banner("DALIL-MARS: JEZERO CRATER END-TO-END PREPROCESSING PIPELINE")
    print(f"Workspace Base: {BASE_DIR}")
    print(f"Stages Scheduled: {', '.join(str(s) for s in stages_to_run)}")

    total_t0 = time.time()
    timings = {}

    for s in stages_to_run:
        if s not in STAGE_RUNNERS:
            print(f"Error: Unknown stage {s}. Valid stages: 1 to 6.")
            sys.exit(1)

        name, runner = STAGE_RUNNERS[s]
        try:
            if s == 1:
                t = runner(render_preview=not args.skip_preview)
            else:
                t = runner()
            timings[s] = (name, t, "SUCCESS")
        except Exception as e:
            print(f"\n❌ Error during Stage {s} ({name}): {e}")
            timings[s] = (name, 0.0, f"FAILED: {e}")
            import traceback

            traceback.print_exc()
            sys.exit(1)

    total_elapsed = time.time() - total_t0

    # Summary Report
    print_banner("PIPELINE EXECUTION SUMMARY")
    print(f"{'Stage':<8} {'Name':<30} {'Status':<12} {'Time (s)':<10}")
    print("-" * 65)
    for s, (name, t, status) in timings.items():
        print(f"Stage {s:<2} {name:<30} {status:<12} {t:>8.2f}s")
    print("-" * 65)
    print(f"Total Execution Time: {total_elapsed:.2f}s")
    print("All requested stages completed successfully!\n")


if __name__ == "__main__":
    main()
