import os
import json
import numpy as np

# Enable PROJ for Mars -> WGS84 reprojection if available
os.environ["PROJ_IGNORE_CELESTIAL_BODY"] = "YES"


BASE_DIR = os.path.dirname(os.path.abspath(__file__))


class Stage5WaypointsPipeline:
    """
    STAGE 5: Waypoints & Landmark Snapping Pipeline (Consolidated)
    Formalizes mission landmarks and science stations over the max-extent map.

    Operations:
    1. Georeferences Martian lat/lon coordinates to exact (row, col) grid cells on the Stage 4 Master Grid.
    2. Performs obstacle safety validation (checks if waypoint falls on inf / impassable slope/cliff).
    3. Auto-relocates / snaps waypoints to nearest safe, traversable cell if placed on an obstacle.
    4. Attaches elevation (Z) from Stage 1 and geologic unit context.
    5. Exports GeoJSON feature collection and JSON registry for downstream Pathfinding.
    """

    def __init__(
        self,
        stage1_dir: str | None = None,
        stage4_dir: str | None = None,
        output_dir: str | None = None,
    ):
        self.stage1_dir = stage1_dir or os.path.join(BASE_DIR, "output", "stage_1_consolidated")
        self.stage4_dir = stage4_dir or os.path.join(BASE_DIR, "output", "stage_4_consolidated")
        self.output_dir = output_dir or os.path.join(BASE_DIR, "output", "stage_5_consolidated")
        os.makedirs(self.output_dir, exist_ok=True)

        # Default Mars equirectangular projection parameters matching consolidated Stage 1 mosaic
        self.mars_radius = 3396190.0
        self.origin_x = -6117387.581178606
        self.origin_y = 1145171.1668435
        self.pixel_res_x = 20.203946064176
        self.pixel_res_y = 20.203946064176

        self.coord_transformer = None
        self.inv_geotransform = None
        self._init_geotransform()

    def _init_geotransform(self):
        """Initializes GDAL coordinate transformer and geotransform if available."""
        stage1_tif = os.path.join(self.stage1_dir, "consolidated_dtm_mosaic.tif")
        stage1_meta = os.path.join(self.stage1_dir, "consolidated_grid_metadata.json")

        if os.path.exists(stage1_meta):
            try:
                with open(stage1_meta, "r") as f:
                    meta = json.load(f)
                    if "transform" in meta and len(meta["transform"]) >= 6:
                        t = meta["transform"]
                        self.pixel_res_x = float(t[0])
                        self.origin_x = float(t[2])
                        self.pixel_res_y = abs(float(t[4]))
                        self.origin_y = float(t[5])
            except Exception as e:
                print(f"Notice reading metadata transform: {e}")

        if os.path.exists(stage1_tif):
            try:
                from osgeo import gdal, osr

                gdal.UseExceptions()
                ds = gdal.Open(stage1_tif)
                if ds is not None:
                    gt = ds.GetGeoTransform()
                    self.inv_geotransform = gdal.InvGeoTransform(gt)
                    proj_wkt = ds.GetProjection()
                    if proj_wkt:
                        target_srs = osr.SpatialReference()
                        target_srs.ImportFromWkt(proj_wkt)
                        src_srs = target_srs.CloneGeogCS()
                        src_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
                        target_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
                        self.coord_transformer = osr.CoordinateTransformation(src_srs, target_srs)
            except Exception as e:
                print(f"Notice setting up GDAL coordinate transformation: {e}. Using analytical Mars projection.")

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
                "priority": "HIGH",
            },
            {
                "waypoint_id": "WP-01",
                "name": "Kodiak Butte & Delta Front Clays",
                "type": "science_station",
                "lat": 18.4520,
                "lon": 77.4410,
                "geologic_unit": "NHjf1",
                "description": "Delta bottomset smectite clay mudstones. Prime biosignature preservation target.",
                "priority": "CRITICAL",
            },
            {
                "waypoint_id": "WP-02",
                "name": "Hawksbill Gap & Delta Topset Conglomerates",
                "type": "science_station",
                "lat": 18.4580,
                "lon": 77.4320,
                "geologic_unit": "NHjf2",
                "description": "High-energy fluvial gravel beds with prominent cross-bedding.",
                "priority": "HIGH",
            },
            {
                "waypoint_id": "WP-03",
                "name": "Margin Carbonate Unit (Ancient Shoreline)",
                "type": "science_station",
                "lat": 18.4610,
                "lon": 77.4150,
                "geologic_unit": "Nle",
                "description": "Alkaline lake shoreline deposits rich in Mg-carbonates and hydrated silica.",
                "priority": "CRITICAL",
            },
            {
                "waypoint_id": "WP-04",
                "name": "Séítah Formation & Dune Corridor",
                "type": "science_station",
                "lat": 18.4320,
                "lon": 77.4620,
                "geologic_unit": "Njf",
                "description": "Olivine-cumulate volcanic basement rocks flanked by active aeolian dunes (Aeb).",
                "priority": "MEDIUM",
            },
            {
                "waypoint_id": "WP-05",
                "name": "Neretva Vallis River Inlet Breach Canyon",
                "type": "landmark",
                "lat": 18.5900,
                "lon": 77.1900,
                "geologic_unit": "channel",
                "description": "Deep fluvial breach canyon where ancient floodwaters sliced into Jezero Crater.",
                "priority": "MEDIUM",
            },
            {
                "waypoint_id": "WP-06",
                "name": "Belva Crater Rim & Shock Megabreccia",
                "type": "science_station",
                "lat": 18.4850,
                "lon": 77.3880,
                "geologic_unit": "Nrb",
                "description": "Deep pre-Noachian Martian basement crust uplifted by Isidis basin impact.",
                "priority": "HIGH",
            },
        ]

    def coord_to_grid(self, lat: float, lon: float):
        """Converts Martian (lat, lon) in degrees to exact (row, col) raster indices.

        Supports both GDAL OSR projection transform and closed-form Mars Equirectangular conversion.
        """
        if self.coord_transformer is not None and self.inv_geotransform is not None:
            try:
                x, y, _ = self.coord_transformer.TransformPoint(lon, lat)
                col = int(
                    round(
                        self.inv_geotransform[0]
                        + self.inv_geotransform[1] * x
                        + self.inv_geotransform[2] * y
                    )
                )
                row = int(
                    round(
                        self.inv_geotransform[3]
                        + self.inv_geotransform[4] * x
                        + self.inv_geotransform[5] * y
                    )
                )
                return row, col
            except Exception:
                pass

        # Analytical Mars Equidistant Cylindrical / Equirectangular fallback
        # Mars Sphere Radius = 3396190 m, Central Meridian = 180°
        x = self.mars_radius * np.radians(lon - 180.0)
        y = self.mars_radius * np.radians(lat)
        col = int(round((x - self.origin_x) / self.pixel_res_x))
        row = int(round((self.origin_y - y) / self.pixel_res_y))
        return row, col

    def find_nearest_safe_cell(self, cost_matrix, row, col, max_radius=25):
        """Finds closest traversable node if waypoint lands on an impassable obstacle (inf/nan)."""
        rows, cols = cost_matrix.shape
        row = int(np.clip(row, 0, rows - 1))
        col = int(np.clip(col, 0, cols - 1))

        val = cost_matrix[row, col]
        if not np.isinf(val) and not np.isnan(val):
            return row, col, 0

        # Spiral outwards
        for r in range(1, max_radius + 1):
            for dr in range(-r, r + 1):
                for dc in range(-r, r + 1):
                    nr, nc = row + dr, col + dc
                    if 0 <= nr < rows and 0 <= nc < cols:
                        v = cost_matrix[nr, nc]
                        if not np.isinf(v) and not np.isnan(v):
                            return nr, nc, r
        return row, col, -1

    def process_waypoints(self):
        print("==================================================")
        print("STAGE 5: CONSOLIDATED WAYPOINTS & MISSION LANDMARK SNAPPING")
        print("==================================================")

        # 1. Load Stage 4 Consolidated Master Grid
        stage4_grid_file = os.path.join(self.stage4_dir, "consolidated_preprocessed_master_grid.npy")
        stage1_elev_file = os.path.join(self.stage1_dir, "consolidated_elevation_matrix.npy")

        if os.path.exists(stage4_grid_file):
            print(f"Loading Stage 4 Consolidated Master Grid: {stage4_grid_file}")
            cost_matrix = np.load(stage4_grid_file)
        else:
            raise FileNotFoundError(
                f"Missing Stage 4 master grid at {stage4_grid_file}. Run Stage 4 first!"
            )

        if os.path.exists(stage1_elev_file):
            elev_matrix = np.load(stage1_elev_file)
        else:
            elev_matrix = np.full(cost_matrix.shape, -2500.0, dtype=np.float32)

        raw_waypoints = self.get_raw_waypoints()
        snapped_waypoints = []
        geojson_features = []

        print(f"Snapping & Validating {len(raw_waypoints)} Mission Waypoints against Consolidated Grid...")

        for wp in raw_waypoints:
            r, c = self.coord_to_grid(wp["lat"], wp["lon"])
            snapped_r, snapped_c, offset = self.find_nearest_safe_cell(cost_matrix, r, c)

            in_bounds = (0 <= snapped_r < cost_matrix.shape[0] and 0 <= snapped_c < cost_matrix.shape[1])
            if in_bounds:
                elev_val = elev_matrix[snapped_r, snapped_c]
                base_elevation = float(elev_val) if not np.isnan(elev_val) else -2500.0
                cell_cost = cost_matrix[snapped_r, snapped_c]
                node_cost = float(cell_cost) if not np.isinf(cell_cost) and not np.isnan(cell_cost) else 999.0
                is_obstacle_free = not np.isinf(cell_cost) and not np.isnan(cell_cost)
            else:
                base_elevation = -2500.0
                node_cost = 999.0
                is_obstacle_free = False

            entry = {
                **wp,
                "grid_position": {"row": int(snapped_r), "col": int(snapped_c)},
                "original_grid_position": {"row": int(r), "col": int(c)},
                "snap_offset_cells": offset,
                "elevation_m": round(base_elevation, 2),
                "cell_traversal_cost": round(node_cost, 2),
                "is_safe_departure_point": is_obstacle_free,
            }
            snapped_waypoints.append(entry)

            # Build GeoJSON Feature
            feature = {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [wp["lon"], wp["lat"], round(base_elevation, 2)],
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
                    "description": wp["description"],
                },
            }
            geojson_features.append(feature)

            status_label = "[SAFE]" if is_obstacle_free else "[BLOCKED]"
            offset_str = f"offset {offset}px" if offset > 0 else "direct match"
            print(
                f"   {status_label} [{wp['waypoint_id']}] {wp['name']} -> Grid: ({snapped_r}, {snapped_c}) [{offset_str}] | Elev: {base_elevation:.1f}m | Cost: {node_cost:.1f} | Unit: {wp['geologic_unit']}"
            )

        # Export Stage 5 Outputs
        geojson_out = {
            "type": "FeatureCollection",
            "name": "jezero_mission_waypoints",
            "crs": {"type": "name", "properties": {"name": "urn:ogc:def:crs:OGC:1.3:CRS84"}},
            "features": geojson_features,
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
            "all_points_safe": all(w["is_safe_departure_point"] for w in snapped_waypoints),
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
