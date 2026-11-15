"""
gdb_reader.py — GDAL/Fiona wrapper for reading Nili.gdb
Handles both vector layers (OGR) and raster bands (GDAL).
"""
import os
import json
from functools import lru_cache
from typing import Optional

_DEFAULT_GDB_PATH = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "../../preprocessing/sim3464_JezeroNili/Geodatabase/Nili.gdb")
)
GDB_PATH = os.getenv("GDB_PATH", _DEFAULT_GDB_PATH)


def get_gdb_path() -> str:
    return os.environ.get("GDB_PATH", GDB_PATH)


@lru_cache(maxsize=1)
def list_layers() -> list[dict]:
    """Return metadata for all layers in the GDB."""
    try:
        import fiona
        result = []
        for name in fiona.listlayers(get_gdb_path()):
            with fiona.open(get_gdb_path(), layer=name) as lyr:
                result.append({
                    "name": name,
                    "type": "vector",
                    "geometry": lyr.schema.get("geometry"),
                    "crs": str(lyr.crs),
                    "feature_count": len(lyr),
                    "fields": list(lyr.schema.get("properties", {}).keys()),
                    "bbox": list(lyr.bounds),
                })
        return result
    except ImportError:
        return [{"error": "fiona not installed — run: pip install fiona"}]
    except Exception as e:
        return [{"error": str(e)}]


def get_layer_geojson(layer_name: str, bbox: Optional[list] = None) -> dict:
    """
    Read a vector layer from the GDB and return as GeoJSON FeatureCollection.
    Optionally filter by bounding box [minLon, minLat, maxLon, maxLat].
    """
    try:
        import fiona
        from shapely.geometry import shape, mapping, box

        features = []
        with fiona.open(get_gdb_path(), layer=layer_name) as lyr:
            filter_geom = box(*bbox) if bbox else None
            for feat in lyr:
                geom = shape(feat["geometry"]) if feat["geometry"] else None
                if filter_geom and geom and not geom.intersects(filter_geom):
                    continue
                features.append({
                    "type": "Feature",
                    "geometry": mapping(geom) if geom else None,
                    "properties": dict(feat["properties"]),
                    "id": feat.get("id"),
                })
        return {"type": "FeatureCollection", "features": features}
    except Exception as e:
        return {"type": "FeatureCollection", "features": [], "error": str(e)}


def get_raster_info() -> dict:
    """Return metadata about raster bands in the GDB."""
    try:
        from osgeo import gdal
        ds = gdal.Open(get_gdb_path())
        if not ds:
            return {"error": "Could not open GDB as raster dataset"}
        info = {
            "raster_count": ds.RasterCount,
            "size": [ds.RasterXSize, ds.RasterYSize],
            "projection": ds.GetProjection(),
            "geotransform": list(ds.GetGeoTransform()),
            "bands": [],
        }
        for i in range(1, ds.RasterCount + 1):
            band = ds.GetRasterBand(i)
            info["bands"].append({
                "index": i,
                "description": band.GetDescription(),
                "nodata": band.GetNoDataValue(),
                "min": band.GetMinimum(),
                "max": band.GetMaximum(),
                "unit": band.GetUnitType(),
            })
        return info
    except Exception as e:
        return {"error": str(e)}
