"""
layers.py — FastAPI router for discovering and streaming GDB vector layers
"""
from fastapi import APIRouter, Query, HTTPException
from typing import Optional, List
from utils.gdb_reader import list_layers, get_layer_geojson, get_raster_info

router = APIRouter()

@router.get("/")
async def get_all_layers():
    """List all available vector and raster datasets inside the GDB."""
    vector_layers = list_layers()
    raster_info = get_raster_info()
    return {
        "vector_layers": vector_layers,
        "raster": raster_info
    }

@router.get("/{layer_name}")
async def get_single_layer(
    layer_name: str,
    min_lon: Optional[float] = Query(None),
    min_lat: Optional[float] = Query(None),
    max_lon: Optional[float] = Query(None),
    max_lat: Optional[float] = Query(None),
):
    """
    Returns GeoJSON FeatureCollection for a named GDB layer,
    optionally filtered by bounding box [min_lon, min_lat, max_lon, max_lat].
    """
    bbox = None
    if all(v is not None for v in (min_lon, min_lat, max_lon, max_lat)):
        bbox = [min_lon, min_lat, max_lon, max_lat]

    geojson = get_layer_geojson(layer_name, bbox=bbox)
    if "error" in geojson and not geojson.get("features"):
        # Return graceful structure so frontend doesn't break
        return {
            "type": "FeatureCollection",
            "name": layer_name,
            "features": [],
            "message": f"Layer {layer_name} empty or reading fallback: {geojson.get('error')}"
        }
    return geojson
