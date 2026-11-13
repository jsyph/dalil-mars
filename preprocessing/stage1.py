import sys
import os
import json
import numpy as np

# Enable cross-celestial reprojection if rasterio/PROJ is used
os.environ["PROJ_IGNORE_CELESTIAL_BODY"] = "YES"

class Stage1ElevationPipeline:
    """
    STAGE 1: Pure Elevation Grid Pipeline
    --------------------------------------
    Role: Extract and produce the PURE unconstrained elevation map (X, Y, Z).
    Contains ZERO obstacles, ZERO hazard masks, and ZERO cost penalties.
    This pure baseline serves as Stage 1 input for higher pipeline layers.
    """
    def __init__(self, raster_path="./sim3464_JezeroNili/Rasters/USGS_CTX_Stereo_DTMs/B18_016575_1978_B17_016219_1978_20m_DTM.tif", output_dir="./output/stage_1"):
        self.raster_path = raster_path
        self.output_dir = output_dir
        os.makedirs(self.output_dir, exist_ok=True)

    def extract_pure_elevation(self, bounds=(77.35, 77.55, 18.35, 18.55), resolution_m=20):
        print("==================================================")
        print("STAGE 1: PURE ELEVATION GRID PIPELINE")
        print("==================================================")

        min_lon, max_lon, min_lat, max_lat = bounds

        # Check if real CTX DTM raster exists locally
        if os.path.exists(self.raster_path):
            print(f"Loading real CTX 20m DTM raster: {self.raster_path}")
            import rasterio
            with rasterio.open(self.raster_path) as src:
                elevation_matrix = src.read(1).astype(np.float32)
                nodata_val = src.nodata

                # Mask GDAL NoData sentinel values to NaN
                if nodata_val is not None:
                    elevation_matrix[elevation_matrix == nodata_val] = np.nan
                # Extra safety check for unmasked sentinel values
                elevation_matrix[elevation_matrix < -10000] = np.nan

                transform = src.transform
                crs = str(src.crs)
                bounds_dict = {
                    "left": src.bounds.left,
                    "bottom": src.bounds.bottom,
                    "right": src.bounds.right,
                    "top": src.bounds.top
                }
        else:
            print("CTX DTM raster doesn't exist")
            sys.exit(1)

        rows, cols = elevation_matrix.shape
        min_elev = float(np.nanmin(elevation_matrix))
        max_elev = float(np.nanmax(elevation_matrix))

        print(f"Grid Resolution: {rows} x {cols} nodes")
        print(f"Elevation Range: {min_elev:.2f} m to {max_elev:.2f} m")

        # 1. Export Pure 2D Elevation Matrix (.npy)
        npy_path = os.path.join(self.output_dir, "base_elevation_matrix.npy")
        np.save(npy_path, elevation_matrix)
        print(f"Saved Pure Elevation Matrix -> {npy_path}")

        # 2. Export Metadata JSON
        meta = {
            "stage": 1,
            "description": "Pure unconstrained baseline elevation grid over Jezero Crater (Zero obstacles)",
            "grid_dimensions": {"rows": rows, "cols": cols},
            "spatial_bounds": bounds_dict,
            "elevation_stats": {
                "min_elevation_m": min_elev,
                "max_elevation_m": max_elev,
                "mean_elevation_m": float(np.nanmean(elevation_matrix))
            },
            "crs": crs,
            "has_obstacles": False
        }
        meta_path = os.path.join(self.output_dir, "base_grid_metadata.json")
        with open(meta_path, "w") as f:
            json.dump(meta, f, indent=2)
        print(f"Saved Grid Metadata -> {meta_path}")

        # 3. Export Lightweight Pure Elevation Mesh (GeoJSON 3D Points sample for visualization)
        sample_step = max(1, rows // 40)  # Downsample for lightweight web viewer
        features = []
        lons = np.linspace(bounds_dict["left"], bounds_dict["right"], cols)
        lats = np.linspace(bounds_dict["bottom"], bounds_dict["top"], rows)

        for i in range(0, rows, sample_step):
            for j in range(0, cols, sample_step):
                z = float(elevation_matrix[i, j])
                if np.isnan(z):
                    continue  # Skip NaN elevation points to prevent JSON serialization errors
                features.append({
                    "type": "Feature",
                    "geometry": {
                        "type": "Point",
                        "coordinates": [round(lons[j], 5), round(lats[i], 5), round(z, 2)]
                    },
                    "properties": {
                        "elevation_m": round(z, 2),
                        "status": "UNCONSTRAINED_BASE"
                    }
                })

        geojson_data = {
            "type": "FeatureCollection",
            "name": "pure_elevation_grid",
            "features": features
        }

        geojson_path = os.path.join(self.output_dir, "pure_elevation_grid.geojson")
        with open(geojson_path, "w") as f:
            json.dump(geojson_data, f, indent=2)
        print(f"Saved Pure Elevation Mesh GeoJSON -> {geojson_path}")

        print("==================================================")
        print("STAGE 1 COMPLETE")
        print("==================================================")

if __name__ == "__main__":
    pipeline = Stage1ElevationPipeline()
    pipeline.extract_pure_elevation()
