#!/usr/bin/env python3
"""ARES-EVA: Martian Tactical Pathfinding & Survival Routing API.

High-level programmatic API interface for mission routing in Jezero Crater, Mars.
Can be imported directly as a Python library, invoked from the command line,
or launched as a local microservice via HTTP.

Usage Examples:
    # 1. Direct Python Import:
    import api
    result = api.plan_route(
        start=(18.4447, 77.4508),
        destination=(18.4520, 77.4410),
        mode="on_foot",
        lst=14.0,
        weather="nominal"
    )
    print(result["summary"]["duration_formatted"])
    print(result["geojson"])

    # 2. CLI JSON Output:
    python3 api.py --start 18.4447 77.4508 --end 18.4520 77.4410 --json

    # 3. Microservice Server:
    python3 api.py --serve --port 8000
"""

import os
import sys
import json
import argparse
from typing import Any, Union, Tuple, Dict, List, Optional

# Import core tactical engine
from engine import (
    MartianTacticalEngine,
    get_engine,
    plan_mission_route,
    MOBILITY_PROFILES,
    WEATHER_MODELS,
    BASE_DIR,
)

PointCoord = Union[Tuple[float, float], List[float], Dict[str, float]]


# =============================================================================
# 1. API HELPER & NORMALIZATION FUNCTIONS
# =============================================================================
def _normalize_point(pt: PointCoord) -> Tuple[float, float]:
    """Normalizes point inputs (tuple, list, or dict) into a (coord1, coord2) tuple."""
    if isinstance(pt, dict):
        if "lat" in pt and "lon" in pt:
            return float(pt["lat"]), float(pt["lon"])
        if "row" in pt and "col" in pt:
            return float(pt["row"]), float(pt["col"])
        raise ValueError(f"Dictionary point must contain ('lat', 'lon') or ('row', 'col'): {pt}")
    if isinstance(pt, (list, tuple)) and len(pt) >= 2:
        return float(pt[0]), float(pt[1])
    raise ValueError(f"Invalid coordinate format: {pt}. Expected (lat, lon) or [row, col]")


# =============================================================================
# 2. CORE PUBLIC API METHODS
# =============================================================================
def plan_route(
    start: PointCoord,
    destination: PointCoord,
    mode: str = "on_foot",
    lst: float = 12.0,
    weather: str = "nominal",
    initial_battery: float = 100.0,
    initial_o2: float = 100.0,
    allow_pitstop: bool = True,
    uphill_cost_factor: Optional[float] = None,
    tau: Optional[float] = None,
    radiation_spe: bool = False,
    sun_position: Optional[Tuple[float, float]] = None,
) -> Dict[str, Any]:
    """Calculates an optimal, terrain-aware Martian route between two coordinates.

    Args:
        start: Starting point as (lat, lon) degrees, (row, col) pixels, or {'lat': x, 'lon': y}
        destination: Destination point in matching format.
        mode: Mobility profile ('on_foot' for xEMU suit, 'rover' for electric solar rover).
        lst: Martian Local Solar Time (0.0 to 24.0 hours, e.g. 14.5 = 14:30 Martian Sol time).
        weather: Weather condition ('nominal', 'dust_storm', 'solar_storm').
        initial_battery: Starting battery charge percentage (0.0 to 100.0).
        initial_o2: Starting suit oxygen tank percentage (0.0 to 100.0).
        allow_pitstop: Auto-divert via virtual charging bases if reserves fall below 15%.
        uphill_cost_factor: Additional cost multiplier for climbing up from lower nodes.
                            Defaults to mode-calibrated values (3.0 for suit, 2.2 for rover).
        tau: Atmospheric dust optical depth override (e.g. 0.45 nominal, 3.8 dust storm).
        radiation_spe: Flag indicating an active Solar Particle Event spike.
        sun_position: Optional explicit (sun_elevation_deg, sun_azimuth_deg) override.

    Returns:
        A comprehensive processed data dictionary containing:
            - 'status': 'SAFE' | 'PITSTOP_RECHARGED' | 'OUT_OF_RANGE'
            - 'summary': High-level statistics (distance, time, elevation gain/loss, battery, O2, etc.)
            - 'solar_context': Sun elevation, azimuth, flux, and dust optical depth
            - 'geojson': GeoJSON FeatureCollection with 3D path LineString and Point markers
            - 'telemetry_profile': Elevation, slope, climbing, and shadow states along the route
            - 'navigation_steps': Actionable turn-by-turn guidance for the astronaut's visor HUD
            - 'charging_station': Station details if pit-stop was required, else None
            - 'legs': Breakdown of individual journey legs
    """
    s_norm = _normalize_point(start)
    d_norm = _normalize_point(destination)

    engine = get_engine()
    raw_result = engine.plan_route(
        start=s_norm,
        destination=d_norm,
        mode=mode,
        lst_hours=lst,
        sun_position=sun_position,
        weather=weather,
        tau=tau,
        radiation_spe=radiation_spe,
        initial_battery_pct=initial_battery,
        initial_o2_pct=initial_o2,
        allow_charging_pitstop=allow_pitstop,
        uphill_penalty=uphill_cost_factor,
    )

    return raw_result


# Friendly alias
route = plan_route


def get_waypoints() -> List[Dict[str, Any]]:
    """Returns the list of cataloged science POIs, habitats, and charging depots in Jezero."""
    haz_path = os.path.join(BASE_DIR, "src", "data", "jezero_science_hazards.json")
    if os.path.exists(haz_path):
        try:
            with open(haz_path, "r") as f:
                data = json.load(f)
                return data.get("sciencePOIs", [])
        except Exception:
            pass

    engine = get_engine()
    return engine.charging_stations


def get_charging_stations() -> List[Dict[str, Any]]:
    """Returns only the virtual charging stations equipped with power and life-support refill."""
    all_pois = get_waypoints()
    return [p for p in all_pois if p.get("isChargingStation")]


def get_weather(sol: Optional[int] = None) -> Dict[str, Any]:
    """Returns the Martian Environmental Dynamics Analyzer (MEDA) atmospheric conditions."""
    weather_path = os.path.join(BASE_DIR, "src", "data", "meda_weather.json")
    if os.path.exists(weather_path):
        try:
            with open(weather_path, "r") as f:
                data = json.load(f)
                return data
        except Exception:
            pass

    return {
        "sol": sol if sol is not None else 1000,
        "tau": 0.45,
        "temperature_c": -62.0,
        "pressure_pa": 612.0,
        "uv_index": 7.4,
        "dust_status": "nominal",
    }


def get_engine_status() -> Dict[str, Any]:
    """Returns metadata about the loaded tactical engine and precomputed matrices."""
    eng = get_engine()
    H, W = eng.master_grid.shape
    return {
        "engine": "ARES-EVA Tactical Pathfinding Engine",
        "status": "ONLINE",
        "fine_grid_resolution_m": eng.pixel_res,
        "fine_grid_dimensions": {"rows": H, "cols": W, "total_nodes": H * W},
        "macro_grid_dimensions": {"rows": eng.cH, "cols": eng.cW, "macro_cells": eng.cH * eng.cW},
        "all_pairs_matrix_loaded": eng.all_pairs_4d is not None,
        "charging_stations_count": len(eng.charging_stations),
        "available_modes": list(MOBILITY_PROFILES.keys()),
        "weather_models": list(WEATHER_MODELS.keys()),
    }


# =============================================================================
# 3. OBJECT-ORIENTED ROUTER WRAPPER CLASS
# =============================================================================
class MartianRouter:
    """Convenience class providing an object-oriented interface to the tactical engine."""

    def __init__(self):
        self.engine = get_engine()

    def route(self, start: PointCoord, destination: PointCoord, **kwargs) -> Dict[str, Any]:
        """Calculates a route with the given options."""
        return plan_route(start, destination, **kwargs)

    @property
    def waypoints(self) -> List[Dict[str, Any]]:
        """Returns cataloged Jezero POIs and depots."""
        return get_waypoints()

    @property
    def charging_stations(self) -> List[Dict[str, Any]]:
        """Returns active charging waystations."""
        return get_charging_stations()

    @property
    def status(self) -> Dict[str, Any]:
        """Returns engine operational state."""
        return get_engine_status()


# =============================================================================
# 4. HTTP MICROSERVICE SERVER (FLASK)
# =============================================================================
def run_http_server(port: int = 8000, host: str = "0.0.0.0"):
    """Launches a lightweight REST API server for web clients and frontends."""
    from flask import Flask, request, jsonify

    app = Flask("ares_eva_api")

    # Warm up engine singleton on server startup
    print(f"Pre-warming Martian Tactical Engine for REST API...")
    get_engine()

    @app.route("/api/health", methods=["GET"])
    def health():
        return jsonify(get_engine_status())

    @app.route("/api/waypoints", methods=["GET"])
    def waypoints():
        return jsonify({"waypoints": get_waypoints()})

    @app.route("/api/weather", methods=["GET"])
    def weather():
        return jsonify(get_weather())

    @app.route("/api/route", methods=["GET", "POST"])
    def route_endpoint():
        try:
            if request.method == "POST":
                data = request.get_json(force=True)
            else:
                data = request.args

            start_val = data.get("start")
            end_val = data.get("destination") or data.get("end")

            # Parse start coordinate
            if isinstance(start_val, str):
                parts = [float(x.strip()) for x in start_val.split(",")]
                start = (parts[0], parts[1])
            elif isinstance(start_val, (list, tuple)):
                start = (float(start_val[0]), float(start_val[1]))
            elif "start_lat" in data and "start_lon" in data:
                start = (float(data["start_lat"]), float(data["start_lon"]))
            else:
                return jsonify({"error": "Missing 'start' parameter (lat, lon)"}), 400

            # Parse destination coordinate
            if isinstance(end_val, str):
                parts = [float(x.strip()) for x in end_val.split(",")]
                destination = (parts[0], parts[1])
            elif isinstance(end_val, (list, tuple)):
                destination = (float(end_val[0]), float(end_val[1]))
            elif "end_lat" in data and "end_lon" in data:
                destination = (float(data["end_lat"]), float(data["end_lon"]))
            else:
                return jsonify({"error": "Missing 'destination' parameter (lat, lon)"}), 400

            mode = data.get("mode", "on_foot")
            lst = float(data.get("lst", 12.0))
            weather_state = data.get("weather", "nominal")
            initial_battery = float(data.get("battery", 100.0))
            initial_o2 = float(data.get("o2", 100.0))
            uphill_factor = float(data["uphill_factor"]) if "uphill_factor" in data else None

            res = plan_route(
                start=start,
                destination=destination,
                mode=mode,
                lst=lst,
                weather=weather_state,
                initial_battery=initial_battery,
                initial_o2=initial_o2,
                uphill_cost_factor=uphill_factor,
            )
            return jsonify(res)

        except Exception as e:
            return jsonify({"error": str(e)}), 500

    print(f"ARES-EVA REST API Server listening on http://{host}:{port}")
    print(f"Endpoints:")
    print(f"  - GET  /api/health")
    print(f"  - GET  /api/waypoints")
    print(f"  - GET  /api/weather")
    print(f"  - POST /api/route")
    app.run(host=host, port=port, debug=False)


# =============================================================================
# 5. CLI INTERFACE
# =============================================================================
def main():
    parser = argparse.ArgumentParser(description="ARES-EVA Tactical Pathfinding API")
    parser.add_argument("--serve", action="store_true", help="Launch HTTP REST API microservice server.")
    parser.add_argument("--port", type=int, default=8000, help="Port for HTTP server (default 8000).")
    parser.add_argument("--start", nargs=2, type=float, metavar=("LAT", "LON"), help="Start coordinate (lat, lon).")
    parser.add_argument("--end", nargs=2, type=float, metavar=("LAT", "LON"), help="Destination coordinate (lat, lon).")
    parser.add_argument("--mode", choices=["on_foot", "rover"], default="on_foot", help="Transportation mode.")
    parser.add_argument("--lst", type=float, default=12.0, help="Martian Local Solar Time (0.0 to 24.0).")
    parser.add_argument("--weather", choices=["nominal", "dust_storm", "solar_storm"], default="nominal", help="Weather.")
    parser.add_argument("--battery", type=float, default=100.0, help="Starting battery percentage.")
    parser.add_argument("--uphill-factor", type=float, default=None, help="Uphill climb cost penalty multiplier.")
    parser.add_argument("--json", action="store_true", help="Output pure JSON to stdout.")
    parser.add_argument("--waypoints", action="store_true", help="Output all cataloged Jezero waypoints and exit.")

    args = parser.parse_args()

    if args.serve:
        run_http_server(port=args.port)
        return

    if args.waypoints:
        wp = get_waypoints()
        print(json.dumps(wp, indent=2))
        return

    if args.start and args.end:
        res = plan_route(
            start=tuple(args.start),
            destination=tuple(args.end),
            mode=args.mode,
            lst=args.lst,
            weather=args.weather,
            initial_battery=args.battery,
            uphill_cost_factor=args.uphill_factor,
        )

        if args.json:
            print(json.dumps(res, indent=2))
        else:
            s = res["summary"]
            sol = res["solar_context"]
            print("\n" + "=" * 65)
            print(f" ARES-EVA MISSION ROUTE RESULT [{s['status']}]")
            print("=" * 65)
            print(f"  Mode:                {s['mode'].upper()}")
            print(f"  Total Distance:      {s['total_distance_km']} km (Direct: {s['direct_distance_km']} km)")
            print(f"  Travel Duration:     {s['duration_formatted']} ({s['duration_min']} min)")
            print(f"  Elevation Ascent:    +{s['elevation_gain_m']} m (Descent: -{s['elevation_loss_m']} m)")
            print(f"  Uphill Traverse:     {s['uphill_distance_km']} km (Downhill: {s['downhill_distance_km']} km, Flat: {s['flat_distance_km']} km)")
            print(f"  Max / Avg Slope:     {s['max_slope_deg']}° / {s['avg_slope_deg']}°")
            print(f"  Battery:             {s['battery_used_pct']}% used -> {s['battery_remaining_pct']}% remaining")
            print(f"  Oxygen (xEMU):       {s['o2_used_liters']} L used ({s['o2_used_pct']}%) -> {s['o2_remaining_pct']}% remaining")
            print(f"  Radiation Dose:      {s['radiation_dose_mgy']} mGy")
            print(f"  Solar Context:       {sol['lst_formatted']} | Sun: {sol['sun_elevation_deg']}° elev, {sol['sun_azimuth_deg']}° az")
            print(f"  Surface Lighting:    {s['sunlit_pct']}% sunlit, {s['shadow_pct']}% shadowed (tau={sol['optical_depth_tau']})")
            if s["pitstop_occurred"]:
                print(f"  Charging Pit-Stop:   Docked at {s['charging_station_name']}")
            print("\n  Turn-by-turn Navigation:")
            for step in res["navigation_steps"]:
                print(f"    {step['step']}. {step['instruction']} - {step['detail']}")
            print("=" * 65 + "\n")
    else:
        # Default run: Show API usage info
        parser.print_help()


if __name__ == "__main__":
    main()
