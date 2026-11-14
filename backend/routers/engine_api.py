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


@router.get("/engine/point-telemetry")
async def api_engine_point_telemetry(
    lat: float = Query(..., description="Latitude in degrees North"),
    lon: float = Query(..., description="Longitude in degrees East"),
):
    """Query exact 20.2m consolidated DTM elevation, slope grade, and traversability status."""
    import math
    eng = dalil_engine.get_engine()
    H, W = eng.master_grid.shape
    r, c = eng.latlon_to_grid(lat, lon)
    r_clamped = max(0, min(H - 1, r))
    c_clamped = max(0, min(W - 1, c))
    in_bounds = (0 <= r < H) and (0 <= c < W)

    elev_m = (
        float(eng.elev_matrix[r_clamped, c_clamped])
        if eng.elev_matrix is not None and math.isfinite(float(eng.elev_matrix[r_clamped, c_clamped]))
        else -2500.0
    )
    slope_deg = (
        float(eng.slope_matrix[r_clamped, c_clamped])
        if eng.slope_matrix is not None and math.isfinite(float(eng.slope_matrix[r_clamped, c_clamped]))
        else 0.0
    )
    cost = float(eng.master_grid[r_clamped, c_clamped])

    if not math.isfinite(cost) or cost >= 1000.0 or slope_deg >= 22.0:
        status = "BLOCKED"
        hazard_label = f"CLIFF / BARRIER ({slope_deg:.1f}°)"
        is_fault = True
    elif slope_deg >= 12.0 or cost > 1.8:
        status = "CAUTION"
        hazard_label = f"STEEP GRADE ({slope_deg:.1f}°)"
        is_fault = True
    else:
        status = "PASSABLE"
        hazard_label = "CLEAR / PASSABLE"
        is_fault = False

    return {
        "lat": round(lat, 6),
        "lon": round(lon, 6),
        "grid_r": r_clamped,
        "grid_c": c_clamped,
        "in_bounds": in_bounds,
        "elevation_m": round(elev_m, 1),
        "slope_deg": round(slope_deg, 1),
        "cost": round(cost, 2) if math.isfinite(cost) else 9999.0,
        "status": status,
        "hazard_label": hazard_label,
        "is_fault": is_fault,
        "source": "consolidated_dtm_20m",
    }


@router.get("/engine/depth-grid")
async def api_engine_depth_grid(
    rows: int = Query(default=120, ge=20, le=300),
    cols: int = Query(default=120, ge=20, le=300),
    lat_min: float = Query(default=17.084077),
    lat_max: float = Query(default=19.319730),
    lon_min: float = Query(default=76.795971),
    lon_max: float = Query(default=77.801146),
):
    """Return a downsampled 2D depth, slope, and hazard grid from the consolidated 20.2m engine."""
    import numpy as np
    eng = dalil_engine.get_engine()
    H, W = eng.master_grid.shape
    lats = np.linspace(lat_max, lat_min, rows)
    lons = np.linspace(lon_min, lon_max, cols)

    elev_out = np.zeros((rows, cols), dtype=np.float32)
    slope_out = np.zeros((rows, cols), dtype=np.float32)
    hazard_out = np.zeros((rows, cols), dtype=np.int32)

    for ri, lat in enumerate(lats):
        for ci, lon in enumerate(lons):
            gr, gc = eng.latlon_to_grid(float(lat), float(lon))
            gr = max(0, min(H - 1, gr))
            gc = max(0, min(W - 1, gc))
            ev = float(eng.elev_matrix[gr, gc]) if eng.elev_matrix is not None else -2500.0
            sv = float(eng.slope_matrix[gr, gc]) if eng.slope_matrix is not None else 0.0
            cv = float(eng.master_grid[gr, gc])
            elev_out[ri, ci] = round(ev if np.isfinite(ev) else -2500.0, 1)
            slope_out[ri, ci] = round(sv if np.isfinite(sv) else 0.0, 1)
            if not np.isfinite(cv) or cv >= 1000.0 or sv >= 22.0:
                hazard_out[ri, ci] = 2
            elif sv >= 12.0 or cv > 1.8:
                hazard_out[ri, ci] = 1
            else:
                hazard_out[ri, ci] = 0

    return {
        "rows": rows,
        "cols": cols,
        "lat_min": lat_min,
        "lat_max": lat_max,
        "lon_min": lon_min,
        "lon_max": lon_max,
        "min_elev": round(float(np.min(elev_out)), 1),
        "max_elev": round(float(np.max(elev_out)), 1),
        "elevations": elev_out.ravel().tolist(),
        "slopes": slope_out.ravel().tolist(),
        "hazard_status": hazard_out.ravel().tolist(),
        "source": "consolidated_dtm_20m",
    }
