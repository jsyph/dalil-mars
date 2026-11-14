"""
routing.py — FastAPI router for A* route planning
"""
from fastapi import APIRouter
from pydantic import BaseModel, Field
from typing import List, Tuple, Optional, Dict, Any
from utils.routing import plan_astar_route

router = APIRouter()

class RouteRequest(BaseModel):
    start: List[float] = Field(..., description="[lat, lon] of Base station")
    goal: List[float] = Field(..., description="[lat, lon] of Destination")
    waypoints: Optional[List[List[float]]] = Field(default=[], description="Optional intermediate stops [[lat, lon], ...]")
    hazard_weight: Optional[float] = Field(default=8.0, ge=1.0, le=20.0, description="Penalty multiplier for hazards")
    optimization_mode: Optional[str] = Field(default="balanced", description="'balanced', 'safety', or 'distance'")
    grid_size: Optional[int] = Field(default=40, ge=20, le=80, description="A* search resolution")
    active_hazard_zones: Optional[List[Dict[str, Any]]] = Field(default=[], description="User-drawn hazard GeoJSON features")

@router.post("/plan")
async def plan_route(req: RouteRequest):
    """
    Computes the safest and most efficient path between start coordinates and destination.
    Incorporates elevation gradient costs, Mars hazard overlays (heat, radiation, chemicals),
    and user-drawn avoidance/safe territory polygons.
    """
    start_tuple = (req.start[0], req.start[1])
    goal_tuple = (req.goal[0], req.goal[1])
    waypoints_tuples = [(w[0], w[1]) for w in req.waypoints] if req.waypoints else None

    result = plan_astar_route(
        start=start_tuple,
        goal=goal_tuple,
        waypoints=waypoints_tuples,
        grid_size=req.grid_size,
        hazard_weight=req.hazard_weight,
        optimization_mode=req.optimization_mode,
        active_hazard_zones=req.active_hazard_zones
    )
    return result
