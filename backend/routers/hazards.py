"""
hazards.py — FastAPI router for querying hazard risk & user-marked territory
"""
from fastapi import APIRouter, Query, Body
from typing import List, Dict, Any, Optional
from utils.hazards import evaluate_hazards_at_point, SCIENTIFIC_HAZARD_ZONES

router = APIRouter()

# In-memory session store for drawn hazard polygons (persisted across turn/sessions)
USER_HAZARDS_STORE: List[Dict[str, Any]] = []

@router.get("/point")
async def hazard_at_point(
    lat: float = Query(...),
    lon: float = Query(...)
):
    """Returns real-time heat, radiation, chemical levels and composite risk for a point."""
    return evaluate_hazards_at_point(lat, lon, USER_HAZARDS_STORE)

@router.get("/zones")
async def get_scientific_hazard_zones():
    """Returns the pre-modeled Jezero science hazard centers (heat, radiation, chemical)."""
    return SCIENTIFIC_HAZARD_ZONES

@router.get("/user-marked")
async def get_user_marked_hazards():
    """Returns GeoJSON FeatureCollection of all user-marked hazard/safe zones."""
    return {
        "type": "FeatureCollection",
        "features": USER_HAZARDS_STORE
    }

@router.post("/user-marked")
async def add_user_marked_hazard(
    feature: Dict[str, Any] = Body(...)
):
    """
    Saves a user-drawn hazard/safe zone polygon.
    Expects GeoJSON Feature with properties: { hazard_type: 'heat'|'radiation'|'chemical'|'rough'|'safe', name: str }
    """
    USER_HAZARDS_STORE.append(feature)
    return {
        "status": "added",
        "total_zones": len(USER_HAZARDS_STORE),
        "zone": feature
    }

@router.delete("/user-marked")
async def clear_user_marked_hazards():
    """Clears all user-drawn hazard zones."""
    USER_HAZARDS_STORE.clear()
    return {"status": "cleared", "total_zones": 0}
