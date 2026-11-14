"""
tiles.py — FastAPI router for map tiles & tile endpoints
"""
from fastapi import APIRouter
from fastapi.responses import RedirectResponse

router = APIRouter()

# Mars 2020 HiRISE Tile server endpoints
M20_HIRISE_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/M20_HiRISE_RGB_mosaic_25cm_v4p2/{z}/{x}/{-y}.png"
M20_HILLSHADE_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/HMC_13E10_co5_colorcorrect_rect/{z}/{x}/{y}.png"
M20_NAMES_URL = "https://mars.nasa.gov/mmgis-maps/M20/Layers/M20_Placenames_175k_800dpi/{z}/{x}/{-y}.png"

@router.get("/config")
async def get_tile_configs():
    """Returns official NASA tile configurations for MapLibre/Leaflet."""
    return {
        "hirise": {
            "name": "HiRISE RGB Orthomosaic (~25cm/pixel)",
            "url": M20_HIRISE_URL,
            "tms": True,
            "maxzoom": 18,
            "minzoom": 6
        },
        "hillshade": {
            "name": "Mars Trek / CTX Hillshade Relief",
            "url": M20_HILLSHADE_URL,
            "tms": False,
            "maxzoom": 18,
            "minzoom": 6
        },
        "placenames": {
            "name": "Nomenclature & Surface Features",
            "url": M20_NAMES_URL,
            "tms": True,
            "maxzoom": 18,
            "minzoom": 6
        }
    }
