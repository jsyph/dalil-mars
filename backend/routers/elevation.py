"""
elevation.py — FastAPI router for point and profile elevation queries
"""
from fastapi import APIRouter, Query, Body
from typing import List, Tuple
from utils.elevation import (
    get_elevation_at_point,
    get_elevation_profile,
    get_slope_at_point,
    get_dem_array
)

router = APIRouter()

@router.get("/point")
async def elevation_at_point(
    lat: float = Query(..., description="Latitude on Mars (degrees N)"),
    lon: float = Query(..., description="Longitude on Mars (degrees E)"),
):
    """Returns elevation in meters and estimated slope in degrees for a single point."""
    elev_data = get_elevation_at_point(lat, lon)
    slope = get_slope_at_point(lat, lon)
    return {
        "lat": lat,
        "lon": lon,
        "elevation_m": elev_data["elevation_m"],
        "slope_deg": slope,
        "source": elev_data.get("source", "mola")
    }

@router.post("/profile")
async def elevation_along_path(
    points: List[List[float]] = Body(..., description="List of [lat, lon] coordinates")
):
    """
    Returns an elevation profile (elevation at each waypoint/sample) along a path.
    Input format: [[lat1, lon1], [lat2, lon2], ...]
    """
    tuple_points = [(p[0], p[1]) for p in points if len(p) >= 2]
    profile = get_elevation_profile(tuple_points)
    elevations = [p["elevation_m"] for p in profile]
    return {
        "points": profile,
        "min_elevation_m": min(elevations) if elevations else 0,
        "max_elevation_m": max(elevations) if elevations else 0,
        "total_elevation_gain_m": sum(max(0, elevations[i] - elevations[i-1]) for i in range(1, len(elevations))) if len(elevations) > 1 else 0
    }

@router.get("/grid")
async def elevation_grid(
    min_lon: float = Query(76.0),
    min_lat: float = Query(17.0),
    max_lon: float = Query(79.0),
    max_lat: float = Query(20.0),
    resolution: int = Query(40, le=100)
):
    """Returns a 2D matrix of elevations across a bounding box for 3D terrain rendering."""
    bbox = [min_lon, min_lat, max_lon, max_lat]
    return get_dem_array(bbox, resolution=resolution)
