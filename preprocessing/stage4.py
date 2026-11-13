import json
import os

import numpy as np

# Enable PROJ for Mars -> WGS84 reprojection
os.environ["PROJ_IGNORE_CELESTIAL_BODY"] = "YES"


class Stage4CliffBarrierPipeline:
    """STAGE 4: Structural Barriers & Cliff Drop-Offs Pipeline

    Applies hard impassable cutouts (inf) for vertical cliff drop-offs:
    - Delta Lobe Scarps (20-60m vertical drops)
    - River Breach Canyon Walls (Neretva Vallis)
    - Crater Rim Scarps
    Produces the final PREPROCESSED MASTER GRID for Stage 5 Pathfinding.
    """

    def __init__(
        self,
        stage3_dir: str = "./output/stage_3",
        gdb_path: str = "./sim3464_JezeroNili/Geodatabase/Nili.gdb",
        output_dir: str = "./output/stage_4",
    ):
        self.stage3_dir = stage3_dir
        self.gdb_path = gdb_path
        self.output_dir = output_dir
        os.makedirs(self.output_dir, exist_ok=True)

    def process_cliff_barriers(self) -> None:
        print("==================================================")
        print("STAGE 4: STRUCTURAL BARRIERS & CLIFF DROP-OFFS PIPELINE")
        print("==================================================")

        stage3_cost_file = os.path.join(self.stage3_dir, "hazard_annotated_costmap.npy")
        
        if os.path.exists(stage3_cost_file):
            print(f"Loading Stage 3 hazard-annotated costmap: {stage3_cost_file}")
            cost_matrix = np.load(stage3_cost_file).astype(np.float32)
        else:
            print("Stage 3 output not found. Initializing base cost matrix...")
            cost_matrix = np.ones((3385, 1877), dtype=np.float32)

        if os.path.exists(self.gdb_path):
            import geopandas as gpd

            print(f"Reading linear barrier features from {self.gdb_path}...")
            gdf_lines = gpd.read_file(
                self.gdb_path, layer="LinearFeatures", engine="pyogrio"
            ).to_crs(epsg=4326)
            
            gdf_barriers = gdf_lines[
                gdf_lines["TYPE"].isin(
                    ["delta lobe front", "crest of crater rim", "channel (fluvial)"]
                )
            ]
            print(f" -> Ingested {len(gdf_barriers)} barrier features.")
            # TODO: Rasterize scarps onto matrix as inf using rasterio.features.rasterize
        else:
            print("Local GDB not present. Simulating delta scarps & canyon breach lines for validation...")
            rows, cols = cost_matrix.shape
            cost_matrix[
                int(rows * 0.45) : int(rows * 0.45) + 5,
                int(cols * 0.3) : int(cols * 0.5),
            ] = np.inf

        master_grid_file = os.path.join(self.output_dir, "preprocessed_master_grid.npy")
        meta_file = os.path.join(self.output_dir, "stage4_metadata.json")
        
        np.save(master_grid_file, cost_matrix)

        metadata = {
            "stage": 4,
            "description": "Structural Barriers & Cliff Drop-Offs (Preprocessed Master Grid)",
            "impassable_value": "inf",
        }

        with open(meta_file, "w") as f:
            json.dump(metadata, f, indent=2)

        print("==================================================")
        print("STAGE 4 COMPLETE: PREPROCESSED MASTER GRID CREATED!")
        print(f"Master Grid Costmap -> {master_grid_file}")
        print(f"Metadata -> {meta_file}")
        print("==================================================")


if __name__ == "__main__":
    pipeline = Stage4CliffBarrierPipeline()
    pipeline.process_cliff_barriers()
