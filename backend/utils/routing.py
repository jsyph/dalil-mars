"""
routing.py — Advanced Mars A* Pathfinding Engine
Optimizes for both safety (heat, radiation, chemical hazards, steep slopes)
and energy/distance cost.
"""
import math
import heapq
import numpy as np
import networkx as nx
from typing import List, Tuple, Dict, Any, Optional
from utils.elevation import get_elevation_at_point, synthetic_mola
from utils.hazards import evaluate_hazards_at_point

MARS_RADIUS_M = 3396190.0

def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Accurate great-circle distance on Mars in meters."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0)**2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlam / 2.0)**2
    return MARS_RADIUS_M * 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

def compute_step_cost(
    p1: Dict[str, float],
    p2: Dict[str, float],
    hazard_weight: float = 8.0,
    optimization_mode: str = "balanced",
    active_hazard_zones: Optional[List[Dict[str, Any]]] = None
) -> float:
    """
    Cost function for rover traversal between two points.
    Considers:
    - Distance (energy cost)
    - Slope / elevation delta (mechanical stress, rollover risk)
    - Radiation, Heat, Chemical hazard penalty
    - Custom drawn hazard zones
    """
    dist = haversine_m(p1["lat"], p1["lon"], p2["lat"], p2["lon"])
    elev_diff = p2["elevation"] - p1["elevation"]
    slope_deg = math.degrees(math.atan2(abs(elev_diff), max(dist, 1.0)))

    # Slope penalty: rover rollover risk increases exponentially above 15 deg
    slope_penalty = 1.0
    if slope_deg > 20.0:
        slope_penalty = 100.0  # Impassable
    elif slope_deg > 12.0:
        slope_penalty = 1.0 + (slope_deg - 12.0) * 2.5

    # Elevation uphill penalty (rovers spend more energy climbing)
    climb_factor = 1.0 + max(0.0, elev_diff / max(dist, 1.0)) * 3.0

    # Environmental hazards at p2
    hz = evaluate_hazards_at_point(p2["lat"], p2["lon"], active_hazard_zones)
    # Composite hazard score in [0, 1]
    composite_hazard = hz["composite_score"]

    if optimization_mode == "safety":
        hazard_mult = hazard_weight * 3.0
        return dist * (1.0 + composite_hazard * hazard_mult + (slope_penalty - 1.0) * 4.0)
    elif optimization_mode == "distance":
        return dist * climb_factor * slope_penalty
    else:  # balanced
        hazard_mult = hazard_weight * 1.5
        return dist * climb_factor * slope_penalty * (1.0 + composite_hazard * hazard_mult)

def plan_astar_route(
    start: Tuple[float, float],
    goal: Tuple[float, float],
    waypoints: Optional[List[Tuple[float, float]]] = None,
    grid_size: int = 40,
    hazard_weight: float = 8.0,
    optimization_mode: str = "balanced",
    active_hazard_zones: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """
    A* grid pathfinder between start, optional waypoints, and goal.
    """
    checkpoints = [start]
    if waypoints:
        checkpoints.extend(waypoints)
    checkpoints.append(goal)

    full_path = []
    total_distance_m = 0.0
    hazard_crossings = 0
    elevations = []

    for i in range(len(checkpoints) - 1):
        s_lat, s_lon = checkpoints[i]
        g_lat, g_lon = checkpoints[i + 1]

        seg_path = _solve_segment(
            s_lat, s_lon, g_lat, g_lon,
            grid_size=grid_size,
            hazard_weight=hazard_weight,
            opt_mode=optimization_mode,
            hazard_zones=active_hazard_zones
        )

        if i == 0:
            full_path.extend(seg_path)
        else:
            full_path.extend(seg_path[1:])

    # Compute statistics along the full path
    for idx, pt in enumerate(full_path):
        elevations.append(pt["elevation"])
        if idx > 0:
            total_distance_m += haversine_m(
                full_path[idx - 1]["lat"], full_path[idx - 1]["lon"],
                pt["lat"], pt["lon"]
            )
        hz = evaluate_hazards_at_point(pt["lat"], pt["lon"], active_hazard_zones)
        if hz["composite_score"] > 0.35:
            hazard_crossings += 1

    rover_speed_kmh = 0.14  # Perseverance standard drive speed
    est_hours = (total_distance_m / 1000.0) / rover_speed_kmh
    safety_score = max(5, int(100 - (hazard_crossings * 1.8)))

    return {
        "path": full_path,
        "geojson": {
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [[p["lon"], p["lat"], p["elevation"]] for p in full_path]
            },
            "properties": {
                "total_distance_km": round(total_distance_m / 1000.0, 3),
                "est_drive_hours": round(est_hours, 1),
                "hazard_crossings": hazard_crossings,
                "safety_score": safety_score,
                "min_elevation_m": min(elevations) if elevations else 0,
                "max_elevation_m": max(elevations) if elevations else 0,
            }
        },
        "stats": {
            "distance_km": round(total_distance_m / 1000.0, 3),
            "est_hours": round(est_hours, 1),
            "days": int(est_hours // 24),
            "remaining_hours": round(est_hours % 24, 1),
            "hazard_crossings": hazard_crossings,
            "safety_score": safety_score,
            "min_elevation_m": round(min(elevations), 1) if elevations else 0,
            "max_elevation_m": round(max(elevations), 1) if elevations else 0,
        }
    }

def _solve_segment(
    s_lat: float, s_lon: float,
    g_lat: float, g_lon: float,
    grid_size: int,
    hazard_weight: float,
    opt_mode: str,
    hazard_zones: Optional[List[Dict[str, Any]]]
) -> List[Dict[str, float]]:
    """Grid A* on local bounding region with margin."""
    margin = max(0.04, abs(g_lat - s_lat) * 0.4, abs(g_lon - s_lon) * 0.4)
    min_lat = min(s_lat, g_lat) - margin
    max_lat = max(s_lat, g_lat) + margin
    min_lon = min(s_lon, g_lon) - margin
    max_lon = max(s_lon, g_lon) + margin

    d_lat = (max_lat - min_lat) / (grid_size - 1)
    d_lon = (max_lon - min_lon) / (grid_size - 1)

    def to_rc(lat: float, lon: float) -> Tuple[int, int]:
        r = int(round((lat - min_lat) / d_lat))
        c = int(round((lon - min_lon) / d_lon))
        return max(0, min(grid_size - 1, r)), max(0, min(grid_size - 1, c))

    def to_coords(r: int, c: int) -> Dict[str, float]:
        lat = min_lat + r * d_lat
        lon = min_lon + c * d_lon
        elev = get_elevation_at_point(lat, lon)["elevation_m"]
        return {"lat": lat, "lon": lon, "elevation": elev}

    start_node = to_rc(s_lat, s_lon)
    goal_node = to_rc(g_lat, g_lon)

    node_cache = {}
    def get_node_data(r: int, c: int) -> Dict[str, float]:
        if (r, c) not in node_cache:
            node_cache[(r, c)] = to_coords(r, c)
        return node_cache[(r, c)]

    open_set = []
    # (f_score, counter, (r, c))
    counter = 0
    h_start = haversine_m(s_lat, s_lon, g_lat, g_lon)
    heapq.heappush(open_set, (h_start, counter, start_node))

    came_from = {}
    g_score = {start_node: 0.0}

    neighbors = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]

    iterations = 0
    max_iter = 8000

    while open_set and iterations < max_iter:
        iterations += 1
        current_f, _, current = heapq.heappop(open_set)

        if current == goal_node:
            # Reconstruct
            path = []
            curr = current
            while curr in came_from:
                data = get_node_data(*curr)
                path.append(data)
                curr = came_from[curr]
            path.append({"lat": s_lat, "lon": s_lon, "elevation": get_elevation_at_point(s_lat, s_lon)["elevation_m"]})
            path.reverse()
            path.append({"lat": g_lat, "lon": g_lon, "elevation": get_elevation_at_point(g_lat, g_lon)["elevation_m"]})
            return path

        curr_data = get_node_data(*current)

        for dr, dc in neighbors:
            nr, nc = current[0] + dr, current[1] + dc
            if 0 <= nr < grid_size and 0 <= nc < grid_size:
                nbr_node = (nr, nc)
                nbr_data = get_node_data(nr, nc)

                step_cost = compute_step_cost(
                    curr_data, nbr_data,
                    hazard_weight=hazard_weight,
                    optimization_mode=opt_mode,
                    active_hazard_zones=hazard_zones
                )

                tentative_g = g_score[current] + step_cost

                if nbr_node not in g_score or tentative_g < g_score[nbr_node]:
                    came_from[nbr_node] = current
                    g_score[nbr_node] = tentative_g
                    h = haversine_m(nbr_data["lat"], nbr_data["lon"], g_lat, g_lon)
                    counter += 1
                    heapq.heappush(open_set, (tentative_g + h, counter, nbr_node))

    # Fallback to direct linear interpolation with local elevation sampling
    steps = 25
    fallback = []
    for step in range(steps + 1):
        t = step / float(steps)
        lat = s_lat + (g_lat - s_lat) * t
        lon = s_lon + (g_lon - s_lon) * t
        fallback.append({
            "lat": lat, "lon": lon,
            "elevation": get_elevation_at_point(lat, lon)["elevation_m"]
        })
    return fallback
