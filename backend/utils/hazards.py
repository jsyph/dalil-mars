"""
hazards.py — Mars Jezero Hazard & Territory Evaluation Engine
Models heat, radiation, chemical, and user-marked safety zones.
Uses Shapely for point-in-polygon tests on vector hazard zones.
"""
import os
import math
from typing import Dict, Any, List, Optional
from shapely.geometry import Point, shape
import rasterio
import rasterio.warp
from rasterio.crs import CRS

THEMIS_NIGHT_PATH = os.getenv("THEMIS_NIGHT_PATH", "/Users/abdallah/Downloads/sim3464_JezeroNili_FINAL/Rasters/USGS_THEMIS_IR_controlled_mosaic_oct2018/nili_THEMIS_NightIR_Controlled_oct2018.tif")
_themis_src = None

def get_themis_src():
    global _themis_src
    if _themis_src is None and os.path.exists(THEMIS_NIGHT_PATH):
        try:
            _themis_src = rasterio.open(THEMIS_NIGHT_PATH)
        except Exception:
            _themis_src = False
    return _themis_src if _themis_src else None

latlon_crs = CRS.from_string('+proj=longlat +a=3396190 +b=3396190 +no_defs')

# Known scientific hazard focal points in Jezero / Nili Planum
SCIENTIFIC_HAZARD_ZONES = {
    "heat": [
        {"lat": 18.30, "lon": 77.30, "radius": 0.08, "intensity": 0.65, "name": "Southwest Basalt Warm Slope"},
        {"lat": 18.20, "lon": 77.60, "radius": 0.07, "intensity": 0.50, "name": "Southern Low-Albedo Basin"},
        {"lat": 18.50, "lon": 77.80, "radius": 0.10, "intensity": 0.70, "name": "Eastern High Thermal Inertia Rim"},
        {"lat": 18.10, "lon": 77.40, "radius": 0.09, "intensity": 0.55, "name": "South Floor Dark Dunes"},
        {"lat": 18.70, "lon": 77.60, "radius": 0.06, "intensity": 0.40, "name": "Northeast Slopes"},
    ],
    "radiation": [
        {"lat": 18.85, "lon": 77.50, "radius": 0.10, "intensity": 0.75, "name": "Nili Planum Thin Regolith Plateau"},
        {"lat": 18.40, "lon": 76.90, "radius": 0.08, "intensity": 0.60, "name": "Western Rim Crest High Exposure"},
        {"lat": 18.00, "lon": 77.70, "radius": 0.09, "intensity": 0.65, "name": "Southeast Rim Ridge"},
        {"lat": 18.60, "lon": 78.00, "radius": 0.07, "intensity": 0.50, "name": "Isidis Basin High Flux Edge"},
    ],
    "chemical": [
        {"lat": 18.56, "lon": 77.37, "radius": 0.12, "intensity": 0.85, "name": "Delta Fan Perchlorate Mudstones"},
        {"lat": 18.50, "lon": 77.50, "radius": 0.10, "intensity": 0.65, "name": "Central Jezero Lacustrine Smectites"},
        {"lat": 18.35, "lon": 77.55, "radius": 0.09, "intensity": 0.50, "name": "Séítah Olivine-Rich Corrosive Salines"},
        {"lat": 18.40, "lon": 77.20, "radius": 0.08, "intensity": 0.45, "name": "Inlet Channel Acidic Sulfate Residues"},
    ]
}

def query_themis_night(lat: float, lon: float) -> Optional[float]:
    """Query nighttime thermal brightness value from THEMIS raster."""
    src = get_themis_src()
    if src:
        try:
            xs, ys = rasterio.warp.transform(latlon_crs, src.crs, [lon], [lat])
            row, col = src.index(xs[0], ys[0])
            if 0 <= row < src.height and 0 <= col < src.width:
                val = float(src.read(1)[row, col])
                return val
        except Exception:
            pass
    return None


def evaluate_hazards_at_point(
    lat: float,
    lon: float,
    user_hazard_zones: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    Evaluates all hazard levels at a specific coordinate.
    Returns heat, radiation, chemical levels and whether inside user-marked zones.
    """
    scores = {"heat": 0.0, "radiation": 0.0, "chemical": 0.0}

    for hazard_type, zones in SCIENTIFIC_HAZARD_ZONES.items():
        for z in zones:
            dist = math.sqrt((lat - z["lat"])**2 + (lon - z["lon"])**2)
            if dist < z["radius"]:
                val = z["intensity"] * (1.0 - (dist / z["radius"]))
                if val > scores[hazard_type]:
                    scores[hazard_type] = round(val, 3)

    # Check user-drawn hazard zones (polygons)
    inside_user_zones = []
    user_modifier = 1.0
    pt = Point(lon, lat)

    if user_hazard_zones:
        for zone in user_hazard_zones:
            geom_data = zone.get("geometry")
            if geom_data:
                try:
                    poly = shape(geom_data)
                    if poly.contains(pt):
                        z_type = zone.get("properties", {}).get("hazard_type", "hazard")
                        inside_user_zones.append(z_type)
                        if z_type == "safe":
                            user_modifier *= 0.3  # Safe zone bonus
                        elif z_type == "heat":
                            scores["heat"] = max(scores["heat"], 0.9)
                        elif z_type == "radiation":
                            scores["radiation"] = max(scores["radiation"], 0.9)
                        elif z_type == "chemical":
                            scores["chemical"] = max(scores["chemical"], 0.9)
                        elif z_type == "rough":
                            user_modifier *= 2.5
                except Exception:
                    pass

    # Composite score calculation
    raw_composite = (
        scores["heat"] * 1.0 +
        scores["radiation"] * 1.3 +
        scores["chemical"] * 1.1
    ) / 3.4

    composite = min(1.0, raw_composite * user_modifier)

    # Hazard severity label
    if composite > 0.65:
        level_label = "CRITICAL"
        color = "#ff4444"
    elif composite > 0.40:
        level_label = "ELEVATED"
        color = "#ff9900"
    elif composite > 0.15:
        level_label = "MODERATE"
        color = "#ffd700"
    else:
        level_label = "SAFE"
        color = "#00e676"

    return {
        "lat": lat,
        "lon": lon,
        "heat": scores["heat"],
        "radiation": scores["radiation"],
        "chemical": scores["chemical"],
        "composite_score": round(composite, 3),
        "level": level_label,
        "color": color,
        "user_zones": inside_user_zones,
    }
