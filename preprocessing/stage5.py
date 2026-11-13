import os
import json
import numpy as np
import rasterio

os.environ["PROJ_IGNORE_CELESTIAL_BODY"] = "YES"

class Stage5WaypointsPipeline:
    """
    STAGE 5: Waypoints & Landmark Snapping Pipeline (Consolidated)
    Formalizes mission landmarks and science stations over the max-extent map.

    Operations:
    1. Georeferences lat/lon coordinates to (row, col) grid cells on the Stage 4 Master Grid.
    2. Performs obstacle safety validation (checks if waypoint falls on inf / impassable slope/cliff).
    3. Auto-relocates / snaps waypoints to nearest safe, traversable cell if placed on an obstacle.
    4. Attaches elevation (Z) from Stage 1 and geologic unit context.
    5. Exports GeoJSON feature collection and JSON registry for downstream Pathfinding.
    """
    def __init__(self,
                 stage1_dir="./output/stage_1_consolidated",
                 stage4_dir="./output/stage_4_consolidated",
                 output_dir="./output/stage_5_consolidated"):
        self.stage1_dir = stage1_dir
        self.stage4_dir = stage4_dir
        self.output_dir = output_dir
        os.makedirs(self.output_dir, exist_ok=True)

    def get_raw_waypoints(self):
        return [
            {
                "waypoint_id": "WP-00",
                "name": "Octavia E. Butler Landing (Base Camp)",
                "type": "base_camp",
                "lat": 18.4447,
                "lon": 77.4508,
                "geologic_unit": "Njf",
                "description": "Perseverance touchdown site (Sol 0). Mission hub & primary EVA egress airlock.",
                "priority": "HIGH"
            },
            {
                "waypoint_id": "WP-01",
                "name": "Kodiak Butte & Delta Front Clays",
                "type": "science_station",
                "lat": 18.4520,
                "lon": 77.4410,
                "geologic_unit": "NHjf1",
                "description": "Delta bottomset smectite clay mudstones. Prime biosignature preservation target.",
                "priority": "CRITICAL"
            },
            {
                "waypoint_id": "WP-02",
                "name": "Hawksbill Gap & Delta Topset Conglomerates",
                "type": "science_station",
                "lat": 18.4580,
                "lon": 77.4320,
                "geologic_unit": "NHjf2",
                "description": "High-energy fluvial gravel beds with prominent cross-bedding.",
                "priority": "HIGH"
            },
            {
                "waypoint_id": "WP-03",
                "name": "Margin Carbonate Unit (Ancient Shoreline)",
                "type": "science_station",
                "lat": 18.4610,
                "lon": 77.4150,
                "geologic_unit": "Nle",
                "description": "Alkaline lake shoreline deposits rich in Mg-carbonates and hydrated silica.",
                "priority": "CRITICAL"
            },
            {
                "waypoint_id": "WP-04",
                "name": "Séítah Formation & Dune Corridor",
                "type": "science_station",
                "lat": 18.4320,
                "lon": 77.4620,
                "geologic_unit": "Njf",
                "description": "Olivine-cumulate volcanic basement rocks flanked by active aeolian dunes (Aeb).",
                "priority": "MEDIUM"
            },
            {
                "waypoint_id": "WP-05",
                "name": "Neretva Vallis River Inlet Breach Canyon",
                "type": "landmark",
                "lat": 18.5900,
                "lon": 77.1900,
                "geologic_unit": "channel",
                "description": "Deep fluvial breach canyon where ancient floodwaters sliced into Jezero Crater.",
                "priority": "MEDIUM"
            },
            {
                "waypoint_id": "WP-06",
                "name": "Belva Crater Rim & Shock Megabreccia",
                "type": "science_station",
                "lat": 18.4850,
                "lon": 77.3880,
                "geologic_unit": "Nrb",
                "description": "Deep pre-Noachian Martian basement crust uplifted by Isidis basin impact.",
                "priority": "HIGH"
            }
        ]

    def coord_to_grid(self, lat, lon, transform):
        """Converts lat/lon to grid row/col index using the exact affine transform from rasterio."""
        col, row = ~transform * (lon, lat)
        return int(row), int(col)

    def find_nearest_safe_cell(self, cost_matrix, row, col, max_radius=15):
        """Finds closest traversable node if waypoint lands on an impassable obstacle (inf)."""
        rows, cols = cost_matrix.shape
        # Boundary clipping just in case
        row = np.clip(row, 0, rows - 1)
        col = np.clip(col, 0, cols - 1)

        if not np.isinf(cost_matrix[row, col]) and not np.isnan(cost_matrix[row, col]):
            return row, col, 0

        for r in range(1, max_radius + 1):
            for dr in range(-r, r + 1):
                for dc in range(-r, r + 1):
                    nr, nc = row + dr, col + dc
                    if 0 <= nr < rows and 0 <= nc < cols:
                        if not np.isinf(cost_matrix[nr, nc]) and not np.isnan(cost_matrix[nr, nc]):
                            return nr, nc, r
        return row, col, -1

    def process_waypoints(self):
        print("==================================================")
        print("STAGE 5: CONSOLIDATED WAYPOINTS & MISSION LANDMARK SNAPPING")
        print("==================================================")

        # 1. Load Stage 4 Consolidated Master Grid
        stage4_grid_file = os.path.join(self.stage4_dir, "consolidated_preprocessed_master_grid.npy")
        stage1_elev_file = os.path.join(self.stage1_dir, "consolidated_elevation_matrix.npy")
        stage1_meta_file = os.path.join(self.stage1_dir, "consolidated_grid_metadata.json")
        stage1_tif_file = os.path.join(self.stage1_dir, "consolidated_dtm_mosaic.tif")

        if os.path.exists(stage4_grid_file):
            print(f"Loading Stage 4 Consolidated Master Grid: {stage4_grid_file}")
            cost_matrix = np.load(stage4_grid_file)
        else:
            raise FileNotFoundError(f"Missing Stage 4 master grid at {stage4_grid_file}. Run Stage 4 first!")

        if os.path.exists(stage1_elev_file):
            elev_matrix = np.load(stage1_elev_file)
        else:
            elev_matrix = np.full(cost_matrix.shape, -2500.0, dtype=np.float32)

        # 2. Extract Exact Transform for Accurate Snapping over Mosaicked Extent
        transform = None
        if os.path.exists(stage1_tif_file):
            try:
                with rasterio.open(stage1_tif_file) as src:
                    transform = src.transform
            except Exception as e:
                print(f"Warning reading GeoTIFF transform: {e}")

        if transform is None and os.path.exists(stage1_meta_file):
            try:
                with open(stage1_meta_file, "r") as f:
                    meta1 = json.load(f)
                    if "transform" in meta1:
                        from affine import Affine
                        transform = Affine(*meta1["transform"])
            except Exception as e:
                print(f"Warning reading metadata transform: {e}")

        if transform is None:
            raise ValueError("Could not determine spatial transform. Consolidated grid projection mapping required.")

        raw_waypoints = self.get_raw_waypoints()
        snapped_waypoints = []
        geojson_features = []

        print(f"Snapping & Validating {len(raw_waypoints)} Mission Waypoints against Consolidated Grid...")

        for wp in raw_waypoints:
            r, c = self.coord_to_grid(wp["lat"], wp["lon"], transform)
            snapped_r, snapped_c, offset = self.find_nearest_safe_cell(cost_matrix, r, c)

            base_elevation = float(elev_matrix[snapped_r, snapped_c]) if not np.isnan(elev_matrix[snapped_r, snapped_c]) else -2500.0
            node_traversability_cost = float(cost_matrix[snapped_r, snapped_c]) if not np.isinf(cost_matrix[snapped_r, snapped_c]) else 999.0
            is_obstacle_free = not np.isinf(cost_matrix[snapped_r, snapped_c])

            entry = {
                **wp,
                "grid_position": {"row": int(snapped_r), "col": int(snapped_c)},
                "original_grid_position": {"row": int(r), "col": int(c)},
                "snap_offset_cells": offset,
                "elevation_m": round(base_elevation, 2),
                "cell_traversal_cost": round(node_traversability_cost, 2),
                "is_safe_departure_point": is_obstacle_free
            }
            snapped_waypoints.append(entry)

            # Build GeoJSON Feature
            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [wp["lon"], wp["lat"], round(base_elevation, 2)]
                },
                "properties": {
                    "waypoint_id": wp["waypoint_id"],
                    "name": wp["name"],
                    "type": wp["type"],
                    "geologic_unit": wp["geologic_unit"],
                    "elevation_m": round(base_elevation, 2),
                    "grid_row": int(snapped_r),
                    "grid_col": int(snapped_c),
                    "priority": wp["priority"],
                    "description": wp["description"]
                }
            }
            geojson_features.append(feature)

            status_label = "[SAFE]" if is_obstacle_free else "[BLOCKED]"
            print(f"   {status_label} [{wp['waypoint_id']}] {wp['name']} -> Grid: ({snapped_r}, {snapped_c}) | Elev: {base_elevation:.1f}m | Unit: {wp['geologic_unit']}")

        # 3. Export Stage 5 Outputs
        geojson_out = {
            "type": "FeatureCollection",
            "name": "jezero_mission_waypoints",
            "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
            "features": geojson_features
        }

        geojson_file = os.path.join(self.output_dir, "consolidated_jezero_waypoints.geojson")
        registry_file = os.path.join(self.output_dir, "consolidated_waypoints_registry.json")
        meta_file = os.path.join(self.output_dir, "consolidated_stage5_metadata.json")

        with open(geojson_file, "w") as f:
            json.dump(geojson_out, f, indent=2)

        with open(registry_file, "w") as f:
            json.dump(snapped_waypoints, f, indent=2)

        metadata = {
            "stage": 5,
            "description": "Consolidated Mission Waypoints Registry & Grid Snapping Module",
            "total_waypoints": len(snapped_waypoints),
            "base_camp_id": "WP-00",
            "science_stations_count": sum(1 for w in snapped_waypoints if w["type"] == "science_station"),
            "landmarks_count": sum(1 for w in snapped_waypoints if w["type"] == "landmark"),
            "all_points_safe": all(w["is_safe_departure_point"] for w in snapped_waypoints)
        }

        with open(meta_file, "w") as f:
            json.dump(metadata, f, indent=2)

        print("==================================================")
        print("STAGE 5 CONSOLIDATED COMPLETE: Waypoints snapped and validated against expanded grid!")
        print(f"GeoJSON File -> {geojson_file}")
        print(f"Registry File -> {registry_file}")
        print(f"Metadata -> {meta_file}")
        print("==================================================")

if __name__ == "__main__":
    pipeline = Stage5WaypointsPipeline()
    pipeline.process_waypoints()
