"""
engine_api.py — FastAPI router exposing the Dalil-Mars Tactical Pathfinding Engine
"""
from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel, Field
from typing import Any, Dict, List, Optional, Union

from core import engine as dalil_engine

router = APIRouter()


class EngineRouteRequest(BaseModel):
    start: Union[List[float], Dict[str, float], str] = Field(..., description="Start [lat, lon], {lat, lon}, or landmark name")
    destination: Optional[Union[List[float], Dict[str, float], str]] = Field(default=None, description="Destination [lat, lon], {lat, lon}, or landmark name")
    goal: Optional[Union[List[float], Dict[str, float], str]] = Field(default=None, description="Alias for destination")
    mode: str = Field(default="on_foot", description="'on_foot' or 'rover'")
    loadout_key: Optional[str] = Field(default=None, description="GUI loadout key: 'light', 'heavy', or 'rover'")
    departure_lst: Union[float, str] = Field(default=14.0, description="Mars Local Solar Time (hours or HH:MM)")
    weather: str = Field(default="nominal", description="'nominal', 'dust_storm', or 'solar_storm'")
    tau: Optional[float] = Field(default=None, description="Optional optical depth override")
    radiation_spe: bool = Field(default=False, description="Solar Particle Event active")
    initial_battery_pct: float = Field(default=100.0, ge=0.0, le=100.0)
    initial_o2_pct: float = Field(default=100.0, ge=0.0, le=100.0)
    allow_charging_pitstop: bool = Field(default=True)
    custom_exclusion_zones: Optional[List[Dict[str, Any]]] = Field(default=None, description="Operator-drawn exclusion/safe polygons")


class EmergencyAbortRequest(BaseModel):
    current_location: Union[List[float], Dict[str, float], str]
    mode: str = "on_foot"
    departure_lst: Union[float, str] = 14.0
    initial_battery_pct: float = 100.0
    initial_o2_pct: float = 100.0
    weather: str = "nominal"


class ScienceTourRequest(BaseModel):
    base_location: Union[List[float], Dict[str, float], str] = "Octavia E. Butler Landing"
    targets: Optional[List[Union[List[float], Dict[str, float], str]]] = None
    max_duration_hours: float = 6.0
    stay_duration_min: float = 25.0
    mode: str = "rover"
    departure_lst: Union[float, str] = 9.0
    weather: str = "nominal"
    initial_battery_pct: float = 100.0
    initial_o2_pct: float = 100.0


class OptimalDepartureRequest(BaseModel):
    start: Union[List[float], Dict[str, float], str]
    destination: Union[List[float], Dict[str, float], str]
    mode: str = "rover"
    earliest_lst: Union[float, str] = 7.0
    latest_lst: Union[float, str] = 16.5
    step_hours: float = 0.5
    weather: str = "nominal"


class PredictTelemetryRequest(BaseModel):
    current_location: Union[List[float], Dict[str, float], str]
    battery_pct: Optional[float] = None
    o2_pct: Optional[float] = None
    destination: Optional[Union[List[float], Dict[str, float], str]] = None
    mode: str = "on_foot"
    current_lst: Union[float, str] = 14.0
    metabolic_rate_watts: Optional[float] = None
    heart_rate_bpm: Optional[float] = None
    speed_kmh: Optional[float] = None
    weather: str = "nominal"


class CommsEvalRequest(BaseModel):
    location: Union[List[float], Dict[str, float], str]
    mode: str = "rover"


@router.post("/route/plan")
async def api_plan_route(req: EngineRouteRequest):
    dest = req.destination if req.destination is not None else req.goal
    if dest is None:
        raise HTTPException(status_code=400, detail="destination (or goal) is required")
    try:
        return dalil_engine.plan_route(
            start=req.start,
            destination=dest,
            mode=req.mode,
            loadout_key=req.loadout_key,
            departure_lst=req.departure_lst,
            weather=req.weather,
            tau=req.tau,
            radiation_spe=req.radiation_spe,
            initial_battery_pct=req.initial_battery_pct,
            initial_o2_pct=req.initial_o2_pct,
            allow_charging_pitstop=req.allow_charging_pitstop,
            custom_exclusion_zones=req.custom_exclusion_zones,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/route/abort")
async def api_plan_emergency_abort(req: EmergencyAbortRequest):
    try:
        return dalil_engine.plan_emergency_abort(
            current_location=req.current_location,
            mode=req.mode,
            departure_lst=req.departure_lst,
            initial_battery_pct=req.initial_battery_pct,
            initial_o2_pct=req.initial_o2_pct,
            weather=req.weather,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/route/science-tour")
async def api_plan_science_tour(req: ScienceTourRequest):
    try:
        return dalil_engine.plan_science_tour(
            base_location=req.base_location,
            targets=req.targets,
            max_duration_hours=req.max_duration_hours,
            stay_duration_min=req.stay_duration_min,
            mode=req.mode,
            departure_lst=req.departure_lst,
            weather=req.weather,
            initial_battery_pct=req.initial_battery_pct,
            initial_o2_pct=req.initial_o2_pct,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/route/optimal-departure")
async def api_find_optimal_departure(req: OptimalDepartureRequest):
    try:
        return dalil_engine.find_optimal_departure(
            start=req.start,
            destination=req.destination,
            mode=req.mode,
            earliest_lst=req.earliest_lst,
            latest_lst=req.latest_lst,
            step_hours=req.step_hours,
            weather=req.weather,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/telemetry/predict")
async def api_predict_telemetry(req: PredictTelemetryRequest):
    try:
        return dalil_engine.predict(
            current_location=req.current_location,
            battery_pct=req.battery_pct,
            o2_pct=req.o2_pct,
            destination=req.destination,
            mode=req.mode,
            current_lst=req.current_lst,
            metabolic_rate_watts=req.metabolic_rate_watts,
            heart_rate_bpm=req.heart_rate_bpm,
            speed_kmh=req.speed_kmh,
            weather=req.weather,
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/comms/evaluate")
async def api_evaluate_comms(req: CommsEvalRequest):
    try:
        return dalil_engine.evaluate_rf_comms(location=req.location, mode=req.mode)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/engine/status")
async def api_engine_status():
    return dalil_engine.get_engine_status()


@router.get("/engine/waypoints")
async def api_engine_waypoints():
    return {"waypoints": dalil_engine.get_waypoints()}


@router.get("/engine/charging-stations")
async def api_engine_charging_stations():
    return {"charging_stations": dalil_engine.get_charging_stations()}


@router.get("/engine/weather")
async def api_engine_weather(sol: Optional[int] = Query(default=None)):
    return dalil_engine.get_weather(sol=sol)
