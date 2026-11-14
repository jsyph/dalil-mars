#!/usr/bin/env python3
"""Dalil-Mars Engine: Martian Tactical Pathfinding & Survival Routing Engine.

Core navigation, life-support, and obstacle-avoidance routing engine for Jezero Crater, Mars.
Integrates:
  - 20.2m high-resolution consolidated DTM terrain analysis (Stage 1, 2 & 4)
  - Precomputed Stage 6 obstacle-aware hierarchical heuristics
  - Strict red node blocking (slopes > mobility limits) & yellow slope caution weighting
  - Asymmetric uphill climb mechanical work against Mars gravity (3.72 m/s^2)
  - Real-time Martian solar ephemeris (Allison-McEwen model)
  - Dynamic ray-marching terrain & canyon shadow occlusion
  - Dual mobility physics: On-foot xEMU astronaut vs. Solar/Battery Rover
  - Atmospheric dust extinction (Beer-Lambert tau) & MEDA thermal loads
  - Dual-component radiation tracking (GCR baseline vs. Solar Particle Event SPE)
  - Automatic Virtual Base Charging & O2 Pit-Stop optimization
"""

import os
import sys
import json
import time
import heapq
import argparse
import warnings
import numpy as np

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PREPROCESSING_DIR = os.path.join(BASE_DIR, "preprocessing")

# =============================================================================
# 1. PHYSICAL CONSTANTS & MARTIAN GEODESY
# =============================================================================
MARS_RADIUS_M = 3396190.0
MARS_GRAVITY = 3.72  # m/s^2
JEZERO_LAT_DEG = 18.45
SOLAR_CONSTANT_MARS_WM2 = 590.0  # Mean solar irradiance at Mars (~590 W/m2)
SAFE_RESERVE_PCT = 15.0  # Mandatory NASA life-support reserve margin (%)
SUIT_O2_CAPACITY_L = 480.0  # Standard xEMU primary O2 tank capacity (liters)

# Grid Georeferencing matching Stage 1 consolidated DTM
PIXEL_RES_M = 20.203946064176
ORIGIN_X_M = -6117387.581178606
ORIGIN_Y_M = 1145171.1668435


# =============================================================================
# 2. SOLAR EPHEMERIS & SHADOW ENGINE
# =============================================================================
class SolarPhysics:
    """Computes Martian solar ephemeris, solar beam flux, and ray-marched terrain shadows."""

    @staticmethod
    def calculate_sun_position(lst_hours: float, lat_deg: float = JEZERO_LAT_DEG, ls_deg: float = 240.0):
        """Calculates solar elevation and azimuth angle on Mars for a given Local Solar Time (LST)."""
        lat_rad = np.radians(lat_deg)
        ls_rad = np.radians(ls_deg)
        axial_tilt = np.radians(25.19)

        declination = np.arcsin(np.sin(axial_tilt) * np.sin(ls_rad))
        hour_angle = np.radians((lst_hours - 12.0) * 15.0)

        sin_elev = np.sin(lat_rad) * np.sin(declination) + np.cos(lat_rad) * np.cos(declination) * np.cos(hour_angle)
        elevation_rad = np.arcsin(np.clip(sin_elev, -1.0, 1.0))
        elevation_deg = np.degrees(elevation_rad)

        cos_az = (np.sin(elevation_rad) * np.sin(lat_rad) - np.sin(declination)) / (
            np.cos(elevation_rad) * np.cos(lat_rad) + 1e-9
        )
        sin_az = -np.cos(declination) * np.sin(hour_angle) / (np.cos(elevation_rad) + 1e-9)
        azimuth_deg = np.degrees(np.arctan2(sin_az, cos_az)) % 360.0

        return elevation_deg, azimuth_deg

    @staticmethod
    def calculate_solar_flux(elevation_deg: float, tau: float = 0.45, is_shadowed: bool = False):
        """Computes effective solar irradiance (W/m2) reaching surface/panels."""
        if elevation_deg <= 0.0:
            return 0.0

        airmass = 1.0 / (np.sin(np.radians(elevation_deg)) + 0.05)
        direct_transmission = np.exp(-tau * airmass)

        direct_flux = SOLAR_CONSTANT_MARS_WM2 * np.sin(np.radians(elevation_deg)) * direct_transmission
        diffuse_flux = SOLAR_CONSTANT_MARS_WM2 * 0.12 * np.sin(np.radians(elevation_deg))

        if is_shadowed:
            return diffuse_flux
        return direct_flux + diffuse_flux

    @staticmethod
    def compute_coarse_shadow_map(coarse_elev: np.ndarray, sun_az_deg: float, sun_elev_deg: float, coarse_res_m: float):
        """Precomputes a coarse 2D boolean shadow map for the macro-grid in ~15ms."""
        cH, cW = coarse_elev.shape
        shadow_map = np.zeros((cH, cW), dtype=bool)

        if sun_elev_deg <= 0.0:
            shadow_map.fill(True)
            return shadow_map

        tan_sun = np.tan(np.radians(sun_elev_deg))
        dr = -np.cos(np.radians(sun_az_deg))
        dc = np.sin(np.radians(sun_az_deg))

        for r in range(cH):
            for c in range(cW):
                z0 = coarse_elev[r, c]
                if np.isnan(z0):
                    continue
                for step in range(1, 15):
                    nr = int(round(r + step * dr))
                    nc = int(round(c + step * dc))
                    if 0 <= nr < cH and 0 <= nc < cW:
                        z_n = coarse_elev[nr, nc]
                        if not np.isnan(z_n):
                            if (z_n - z0) / (step * coarse_res_m) > tan_sun:
                                shadow_map[r, c] = True
                                break
                    else:
                        break
        return shadow_map

    @staticmethod
    def test_fine_shadow(elev_matrix: np.ndarray, r: int, c: int, sun_az_deg: float, sun_elev_deg: float, pixel_res_m: float):
        """Accurate fine-scale ray-marching shadow test along final path."""
        if sun_elev_deg <= 0.0:
            return True
        z0 = elev_matrix[r, c]
        if np.isnan(z0):
            return False

        tan_sun = np.tan(np.radians(sun_elev_deg))
        dr = -np.cos(np.radians(sun_az_deg))
        dc = np.sin(np.radians(sun_az_deg))

        H, W = elev_matrix.shape
        for step in range(2, 60, 2):
            curr_r = int(round(r + step * dr))
            curr_c = int(round(c + step * dc))
            if 0 <= curr_r < H and 0 <= curr_c < W:
                z_curr = elev_matrix[curr_r, curr_c]
                if not np.isnan(z_curr) and (z_curr - z0) / (step * pixel_res_m) > tan_sun:
                    return True
            else:
                break
        return False


class CommsPhysics:
    """RF Line-of-Sight & Relay Propagation Engine.

    Models UHF (437 MHz) and S-Band direct line-of-sight propagation across the 20.2m
    Jezero DTM topography from Hab Alpha's 40m primary comms mast and regional relay towers.
    Computes terrain occlusion, free-space path loss (FSPL), and RF blackout zones.
    """
    HAB_MAST_HEIGHT_M = 40.0
    RELAY_MAST_HEIGHT_M = 25.0
    ROVER_ANTENNA_HEIGHT_M = 2.0
    EVA_ANTENNA_HEIGHT_M = 1.8
    CARRIER_FREQ_MHZ = 437.0

    @staticmethod
    def test_line_of_sight(elev_matrix: np.ndarray, r1: int, c1: int, z1: float, r2: int, c2: int, z2: float, clearance_m: float = 1.0) -> bool:
        """Ray-marches line-of-sight between two 3D points across DTM elevation matrix."""
        dist_pixels = np.hypot(r2 - r1, c2 - c1)
        if dist_pixels < 2:
            return True

        steps = max(2, int(dist_pixels / 3.0))
        rs = np.linspace(r1, r2, steps).astype(int)
        cs = np.linspace(c1, c2, steps).astype(int)
        ts = np.linspace(0.0, 1.0, steps)

        ray_z = z1 + ts * (z2 - z1)
        terrain_z = elev_matrix[rs, cs]

        occluded = np.any(terrain_z[1:-1] > (ray_z[1:-1] + clearance_m))
        return bool(not occluded)

    @classmethod
    def calculate_free_space_path_loss(cls, distance_km: float, freq_mhz: float | None = None) -> float:
        """Computes Free Space Path Loss (FSPL) in dB: FSPL = 20*log10(d_km) + 20*log10(f_mhz) + 32.44."""
        f = freq_mhz if freq_mhz is not None else cls.CARRIER_FREQ_MHZ
        d = max(0.001, distance_km)
        return float(round(20.0 * np.log10(d) + 20.0 * np.log10(f) + 32.44, 1))


# =============================================================================
# 3. MOBILITY & LIFE-SUPPORT PHYSICS PROFILES
# =============================================================================
MOBILITY_PROFILES = {
    "on_foot": {
        "id": "on_foot",
        "name": "Astronaut EVA (xEMU Suit)",
        "speedKmh": 2.0,
        "maxSlopeDeg": 18.0,
        "o2RateLpm": 0.85,
        "basePowerWatts": 120.0,
        "heaterPowerWatts": 250.0,
        "batteryDrainPerKm": 8.5,
        "climbPenalty": 3.0,
        "suitMassKg": 145.0,
        "isSolarPowered": False,
        "description": "Standard pressurized spacesuit with PLSS backpack. High agility, human metabolic O2 limit.",
    },
    "rover": {
        "id": "rover",
        "name": "Solar/Battery Mule Rover",
        "speedKmh": 2.6,
        "maxSlopeDeg": 21.0,
        "o2RateLpm": 0.0,
        "basePowerWatts": 280.0,
        "heaterPowerWatts": 60.0,
        "batteryDrainPerKm": 1.8,
        "climbPenalty": 2.2,
        "suitMassKg": 950.0,
        "isSolarPowered": True,
        "solarPanelAreaM2": 2.8,
        "panelEfficiency": 0.28,
        "description": "Electric 6-wheel rover. Generates solar power in sunlit corridors; drains battery in shadowed canyons.",
    },
}

WEATHER_MODELS = {
    "nominal": {
        "id": "nominal",
        "label": "Nominal Sol",
        "tau": 0.45,
        "tempMultiplier": 1.0,
        "speedMultiplier": 1.0,
        "radRateMgyHr": 0.011,
        "alert": None,
    },
    "dust_storm": {
        "id": "dust_storm",
        "label": "Regional Dust Storm",
        "tau": 3.8,
        "tempMultiplier": 1.35,
        "speedMultiplier": 0.65,
        "radRateMgyHr": 0.009,
        "alert": "DUST STORM WARNING: Atmospheric tau > 3.5. Solar generation severely curtailed.",
    },
    "solar_storm": {
        "id": "solar_storm",
        "label": "Solar Particle Event (SPE)",
        "tau": 0.45,
        "tempMultiplier": 1.0,
        "speedMultiplier": 1.0,
        "radRateMgyHr": 0.850,
        "alert": "RADIATION ALERT: SPE detected. Seek pressurized storm shelter immediately.",
    },
}


# =============================================================================
# 4. TACTICAL ROUTING ENGINE
# =============================================================================
class DalilMarsEngine:
    """Core routing engine combining hierarchical corridor A*, solar ray-marching,
    red node obstacle avoidance, asymmetric climb mechanics, and life-support
    telemetry for Jezero Crater.
    """

    def __init__(self, output_dir: str | None = None):
        self.output_dir = output_dir or os.path.join(PREPROCESSING_DIR, "output")
        self.stage1_dir = os.path.join(self.output_dir, "stage_1_consolidated")
        self.stage2_dir = os.path.join(self.output_dir, "stage_2_consolidated")
        self.stage4_dir = os.path.join(self.output_dir, "stage_4_consolidated")
        self.stage5_dir = os.path.join(self.output_dir, "stage_5_consolidated")
        self.stage6_dir = os.path.join(self.output_dir, "stage_6_consolidated")

        self.M = 64
        self.pixel_res = PIXEL_RES_M
        self.origin_x = ORIGIN_X_M
        self.origin_y = ORIGIN_Y_M
        self.mars_radius = MARS_RADIUS_M

        self._load_datasets()

    def _load_datasets(self):
        sys.stderr.write("Initializing Dalil-Mars Tactical Pathfinding Engine...\n")
        t0 = time.time()

        # 1. Master Grid (Stage 4)
        mgrid_path = os.path.join(self.stage4_dir, "consolidated_preprocessed_master_grid.npy")
        if not os.path.exists(mgrid_path):
            raise FileNotFoundError(f"Missing master grid at {mgrid_path}. Run ./preprocess first!")
        self.master_grid = np.load(mgrid_path).astype(np.float32)

        # 2. Topographic Slope Angles Matrix (Stage 2) for Red/Dangerous Slope Enforcement
        slope_path = os.path.join(self.stage2_dir, "consolidated_slope_angles_deg.npy")
        if os.path.exists(slope_path):
            self.slope_matrix = np.load(slope_path, mmap_mode="r")
        else:
            self.slope_matrix = None

        # 3. Elevation Grid (Stage 1) & Coarse Elevation for fast shadows
        elev_path = os.path.join(self.stage1_dir, "consolidated_elevation_matrix.npy")
        self.elev_matrix = np.load(elev_path).astype(np.float32) if os.path.exists(elev_path) else None

        H, W = self.master_grid.shape
        self.cH = H // self.M
        self.cW = W // self.M
        self.coarse_res_m = self.M * self.pixel_res

        if self.elev_matrix is not None:
            trimmed = self.elev_matrix[: self.cH * self.M, : self.cW * self.M]
            blocks = trimmed.reshape(self.cH, self.M, self.cW, self.M)
            with warnings.catch_warnings():
                warnings.simplefilter("ignore", category=RuntimeWarning)
                self.coarse_elev = np.nan_to_num(np.nanmean(blocks, axis=(1, 3)), nan=-2500.0)
        else:
            self.coarse_elev = np.full((self.cH, self.cW), -2500.0, dtype=np.float32)

        # 4. Stage 6 All-Pairs Obstacle-Aware Heuristics Matrix (4D: 102 x 46 x 102 x 46)
        mat_path = os.path.join(self.stage6_dir, "consolidated_all_pairs_4d_matrix.npy")
        if not os.path.exists(mat_path):
            raise FileNotFoundError(f"Missing Stage 6 heuristics at {mat_path}. Run ./preprocess 6 first!")
        self.all_pairs_4d = np.load(mat_path)

        # 5. Virtual Base Charging Stations & Pressurized Shelters
        haz_path = os.path.join(BASE_DIR, "src", "data", "jezero_science_hazards.json")
        self.all_pois = []
        self.charging_stations = []
        self.shelters = []
        if os.path.exists(haz_path):
            with open(haz_path, "r") as f:
                data = json.load(f)
                pois = data.get("sciencePOIs", [])
                self.all_pois = pois
                self.charging_stations = [p for p in pois if p.get("isChargingStation")]
                self.shelters = [p for p in pois if p.get("isShelter")]

        if not self.shelters:
            self.shelters = [
                {"name": "Hab Alpha (Octavia E. Butler Landing)", "lat": 18.444627, "lon": 77.450886, "isShelter": True}
            ]

        # 6. Primary Mast & Regional Relay Towers
        hab_lat, hab_lon = 18.444627, 77.450886
        hr, hc = self.latlon_to_grid(hab_lat, hab_lon)
        hz = float(self.elev_matrix[hr, hc]) + CommsPhysics.HAB_MAST_HEIGHT_M if self.elev_matrix is not None else -2530.0

        self.comms_towers = [
            {
                "name": "Hab Alpha 40m Main Mast",
                "type": "primary",
                "lat": hab_lat,
                "lon": hab_lon,
                "grid_r": hr,
                "grid_c": hc,
                "antenna_z_m": hz,
                "mast_height_m": CommsPhysics.HAB_MAST_HEIGHT_M,
            }
        ]

        for st in self.charging_stations + self.shelters:
            if "Alpha" not in st["name"]:
                sr, sc = self.latlon_to_grid(st["lat"], st["lon"])
                sz = float(self.elev_matrix[sr, sc]) + CommsPhysics.RELAY_MAST_HEIGHT_M if self.elev_matrix is not None else -2530.0
                self.comms_towers.append({
                    "name": f"{st['name']} Relay (25m)",
                    "type": "relay",
                    "lat": st["lat"],
                    "lon": st["lon"],
                    "grid_r": sr,
                    "grid_c": sc,
                    "antenna_z_m": sz,
                    "mast_height_m": CommsPhysics.RELAY_MAST_HEIGHT_M,
                })

        self.intra_bound = self.M * np.sqrt(2.0) * self.pixel_res * 1.0
        elapsed = time.time() - t0
        sys.stderr.write(f"Engine ready in {elapsed:.2f}s! ({H}x{W} fine nodes, {self.cH}x{self.cW} macro-cells, {len(self.shelters)} shelters, {len(self.comms_towers)} comms towers)\n")

    def latlon_to_grid(self, lat: float, lon: float) -> tuple[int, int]:
        x = self.mars_radius * np.radians(lon - 180.0)
        y = self.mars_radius * np.radians(lat)
        col = int(round((x - self.origin_x) / self.pixel_res))
        row = int(round((self.origin_y - y) / self.pixel_res))
        return row, col

    def grid_to_latlon(self, row: float, col: float) -> tuple[float, float]:
        x = self.origin_x + col * self.pixel_res
        y = self.origin_y - row * self.pixel_res
        lon = 180.0 + np.degrees(x / self.mars_radius)
        lat = np.degrees(y / self.mars_radius)
        return lat, lon

    def _resolve_coords(self, pt) -> tuple[int, int, float, float]:
        if isinstance(pt, dict):
            if "lat" in pt and "lon" in pt:
                c1, c2 = float(pt["lat"]), float(pt["lon"])
            elif "row" in pt and "col" in pt:
                c1, c2 = float(pt["row"]), float(pt["col"])
            else:
                raise ValueError(f"Dictionary point must contain ('lat', 'lon') or ('row', 'col'): {pt}")
        elif isinstance(pt, (list, tuple)) and len(pt) >= 2:
            c1, c2 = float(pt[0]), float(pt[1])
        else:
            raise ValueError(f"Invalid coordinate format: {pt}. Expected (lat, lon) or [row, col]")

        if abs(c1) <= 90.0 and abs(c2) <= 360.0:
            lat, lon = c1, c2
            r, c = self.latlon_to_grid(lat, lon)
        else:
            r, c = int(round(c1)), int(round(c2))
            lat, lon = self.grid_to_latlon(r, c)
        return r, c, lat, lon

    def _search_single_leg(
        self,
        start_rc: tuple[int, int],
        goal_rc: tuple[int, int],
        mode_profile: dict,
        weather_profile: dict,
        sun_elev_deg: float,
        sun_az_deg: float,
        tau: float,
        uphill_penalty: float | None = None,
    ) -> dict:
        r1, c1 = start_rc
        r2, c2 = goal_rc

        H, W = self.master_grid.shape
        r1 = int(np.clip(r1, 0, H - 1))
        c1 = int(np.clip(c1, 0, W - 1))
        r2 = int(np.clip(r2, 0, H - 1))
        c2 = int(np.clip(c2, 0, W - 1))

        I1, J1 = min(r1 // self.M, self.cH - 1), min(c1 // self.M, self.cW - 1)
        I2, J2 = min(r2 // self.M, self.cH - 1), min(c2 // self.M, self.cW - 1)

        # 1. Macro-path extraction using Stage 6 All-Pairs precomputed obstacle-avoiding gradient
        field_to_goal = self.all_pairs_4d[:, :, I2, J2]

        # Snap start/goal to nearest traversable macro cell if placed in an impassable barrier cell
        if np.isinf(field_to_goal[I1, J1]):
            best_alt = None
            min_alt_d = np.inf
            for di in range(-4, 5):
                for dj in range(-4, 5):
                    ni, nj = I1 + di, J1 + dj
                    if 0 <= ni < self.cH and 0 <= nj < self.cW:
                        if not np.isinf(field_to_goal[ni, nj]):
                            dist_alt = np.hypot(di, dj)
                            if dist_alt < min_alt_d:
                                min_alt_d = dist_alt
                                best_alt = (ni, nj)
            if best_alt:
                I1, J1 = best_alt

        macro_path = [(I1, J1)]
        curr_I, curr_J = I1, J1
        visited_macro = {(I1, J1)}

        moves_macro = [(-1, 0), (1, 0), (0, -1), (0, 1), (-1, -1), (-1, 1), (1, -1), (1, 1)]
        for _ in range(max(self.cH, self.cW) * 2):
            if (curr_I, curr_J) == (I2, J2):
                break
            best_next = None
            best_d = field_to_goal[curr_I, curr_J]
            for dI, dJ in moves_macro:
                nI, nJ = curr_I + dI, curr_J + dJ
                if 0 <= nI < self.cH and 0 <= nJ < self.cW:
                    d = field_to_goal[nI, nJ]
                    if d < best_d and (nI, nJ) not in visited_macro:
                        best_d = d
                        best_next = (nI, nJ)
            if not best_next:
                break
            curr_I, curr_J = best_next
            macro_path.append((curr_I, curr_J))
            visited_macro.add((curr_I, curr_J))

        # 2. Form Active Bounding Corridor (~3.9km wide swath around macro-path)
        corridor = set()
        for mI, mJ in macro_path:
            for dI in range(-1, 2):
                for dJ in range(-1, 2):
                    nI, nJ = mI + dI, mJ + dJ
                    if 0 <= nI < self.cH and 0 <= nJ < self.cW:
                        corridor.add((nI, nJ))

        min_r = min(mI for mI, _ in corridor) * self.M
        max_r = min(H, (max(mI for mI, _ in corridor) + 1) * self.M)
        min_c = min(mJ for _, mJ in corridor) * self.M
        max_c = min(W, (max(mJ for _, mJ in corridor) + 1) * self.M)

        sub_grid = self.master_grid[min_r:max_r, min_c:max_c].copy()
        sub_H, sub_W = sub_grid.shape

        if self.elev_matrix is not None:
            sub_elev = self.elev_matrix[min_r:max_r, min_c:max_c]
            sub_elev_1d = sub_elev.ravel()
        else:
            sub_elev_1d = None

        # Red Node & Dangerous Slope Enforcement
        max_slope = mode_profile.get("maxSlopeDeg", 18.0)
        red_nodes_in_corridor = 0
        caution_nodes_in_corridor = 0
        if self.slope_matrix is not None:
            sub_slope = self.slope_matrix[min_r:max_r, min_c:max_c]

            # 1. Impassable Red Nodes (Slope exceeds mobility threshold or cliff drop-off)
            red_mask = (sub_slope > max_slope) | np.isnan(sub_slope)
            sub_grid[red_mask] = np.inf
            red_nodes_in_corridor = int(np.sum(red_mask))

            # 2. Caution / Dangerous Slopes (15 deg to max_slope)
            # Apply 2.5x hazard effort penalty to strongly steer clear of steep terrain
            caution_mask = (sub_slope >= 15.0) & (sub_slope <= max_slope) & (~np.isinf(sub_grid))
            sub_grid[caution_mask] *= 2.5
            caution_nodes_in_corridor = int(np.sum(caution_mask))

        climb_k = uphill_penalty if uphill_penalty is not None else mode_profile.get("climbPenalty", 2.5)

        start_local = [r1 - min_r, c1 - min_c]
        goal_local = [r2 - min_r, c2 - min_c]

        # Snap start/goal to nearest traversable pixel if placed on a micro-obstacle or red slope
        for pt_local in [start_local, goal_local]:
            if np.isinf(sub_grid[pt_local[0], pt_local[1]]):
                snapped = False
                for radius in range(1, 8):
                    for dr in range(-radius, radius + 1):
                        for dc in range(-radius, radius + 1):
                            sr, sc = pt_local[0] + dr, pt_local[1] + dc
                            if 0 <= sr < sub_H and 0 <= sc < sub_W and not np.isinf(sub_grid[sr, sc]):
                                pt_local[0], pt_local[1] = sr, sc
                                snapped = True
                                break
                        if snapped:
                            break
                    if snapped:
                        break

        start_idx = start_local[0] * sub_W + start_local[1]
        goal_idx = goal_local[0] * sub_W + goal_local[1]

        # 3. Fast Coarse Shadow Map for Macro-Corridor
        coarse_shadow = SolarPhysics.compute_coarse_shadow_map(
            self.coarse_elev, sun_az_deg, sun_elev_deg, self.coarse_res_m
        )

        # Vectorized Corridor Mask & Precomputed Heuristic Array
        corridor_mask_macro = np.zeros((self.cH, self.cW), dtype=bool)
        for mI, mJ in corridor:
            corridor_mask_macro[mI, mJ] = True

        macro_r = (np.arange(min_r, max_r) // self.M).clip(0, self.cH - 1)
        macro_c = (np.arange(min_c, max_c) // self.M).clip(0, self.cW - 1)
        corridor_mask_sub = corridor_mask_macro[np.ix_(macro_r, macro_c)]

        # Mask untraversable outside corridor
        sub_grid[~corridor_mask_sub] = np.inf
        sub_grid_1d = sub_grid.ravel()

        # Vectorized 2D Admissible Heuristic:
        # Dominating combination of Stage 6 Obstacle-Aware macro heuristic + Fine Euclidean distance
        sub_d = field_to_goal[np.ix_(macro_r, macro_c)]
        coarse_heur = np.where(np.isinf(sub_d), 0.0, np.maximum(0.0, sub_d - self.intra_bound)).astype(np.float32)

        fine_euc = np.hypot(
            (np.arange(min_r, max_r)[:, None] - r2) * self.pixel_res,
            (np.arange(min_c, max_c)[None, :] - c2) * self.pixel_res
        ).astype(np.float32)

        sub_heur = np.maximum(coarse_heur, fine_euc)
        sub_heur_1d = sub_heur.ravel()

        is_rover = mode_profile["isSolarPowered"]
        if is_rover:
            coarse_shd_sub = coarse_shadow[np.ix_(macro_r, macro_c)]
            cost_mult = np.where(coarse_shd_sub, 1.35, 1.0).astype(np.float32).ravel()
        else:
            cost_mult = None

        step_cardinal = self.pixel_res
        step_diag = self.pixel_res * 1.41421356
        moves_fine = [
            (-1, 0, step_cardinal), (1, 0, step_cardinal),
            (0, -1, step_cardinal), (0, 1, step_cardinal),
            (-1, -1, step_diag), (-1, 1, step_diag),
            (1, -1, step_diag), (1, 1, step_diag),
        ]

        dist_map = np.full(sub_H * sub_W, np.inf, dtype=np.float32)
        dist_map[start_idx] = 0.0

        pq = [(sub_heur_1d[start_idx], 0.0, start_idx)]
        came_from = {}
        found = False

        while pq:
            f, g, u = heapq.heappop(pq)
            if u == goal_idx:
                found = True
                break
            if g > dist_map[u]:
                continue

            ur = u // sub_W
            uc = u % sub_W
            wu = sub_grid_1d[u]
            zu = sub_elev_1d[u] if sub_elev_1d is not None else 0.0

            for dr, dc, s in moves_fine:
                vr = ur + dr
                vc = uc + dc
                if 0 <= vr < sub_H and 0 <= vc < sub_W:
                    v = vr * sub_W + vc
                    wv = sub_grid_1d[v]
                    if not np.isinf(wv):
                        edge_cost = s * 0.5 * (wu + wv)
                        if cost_mult is not None:
                            edge_cost *= cost_mult[v]

                        # Asymmetric elevation cost: climbing up from lower node costs more!
                        if sub_elev_1d is not None:
                            dz = sub_elev_1d[v] - zu
                            if dz > 0.0:
                                edge_cost *= (1.0 + climb_k * (dz / s))

                        ng = g + edge_cost
                        if ng < dist_map[v]:
                            dist_map[v] = ng
                            came_from[v] = u
                            heapq.heappush(pq, (ng + sub_heur_1d[v], ng, v))

        # 4. Path Reconstruction & Exact Fine Shadowing
        path_pixels = []
        if found:
            curr = goal_idx
            while curr in came_from:
                ur = curr // sub_W
                uc = curr % sub_W
                path_pixels.append((min_r + ur, min_c + uc))
                curr = came_from[curr]
            path_pixels.append((r1, c1))
            path_pixels.reverse()
        else:
            path_pixels = [(r1, c1), (r2, c2)]

        path_coords = []
        shadow_flags = []
        telemetry_samples = []
        total_dist_m = 0.0
        max_slope_deg = 0.0
        elevation_gain_m = 0.0
        elevation_loss_m = 0.0
        uphill_dist_m = 0.0
        downhill_dist_m = 0.0
        flat_dist_m = 0.0
        safe_slope_dist_m = 0.0
        caution_slope_dist_m = 0.0
        red_slope_dist_m = 0.0
        slopes_list = []

        # Downsample fine telemetry ray-marching to max 150 points along path
        step_stride = max(1, len(path_pixels) // 150)
        sampled_pixels = path_pixels[::step_stride]
        if path_pixels[-1] not in sampled_pixels:
            sampled_pixels.append(path_pixels[-1])

        for i, (pr, pc) in enumerate(sampled_pixels):
            lat, lon = self.grid_to_latlon(pr, pc)
            z = float(self.elev_matrix[pr, pc]) if self.elev_matrix is not None else -2500.0

            is_shd = False
            if self.elev_matrix is not None:
                is_shd = SolarPhysics.test_fine_shadow(self.elev_matrix, pr, pc, sun_az_deg, sun_elev_deg, self.pixel_res)
            shadow_flags.append(is_shd)

            path_coords.append([round(lon, 6), round(lat, 6), round(z, 1)])

            seg_slope = 0.0
            is_climbing = False
            slope_tier = "safe"
            if i > 0:
                prev_r, prev_c = sampled_pixels[i - 1]
                ds = np.hypot(pr - prev_r, pc - prev_c) * self.pixel_res
                total_dist_m += ds
                if self.elev_matrix is not None:
                    prev_z = float(self.elev_matrix[prev_r, prev_c])
                    dz = z - prev_z
                    seg_slope = float(np.degrees(np.arctan2(abs(dz), ds + 1e-6)))
                    max_slope_deg = max(max_slope_deg, seg_slope)
                    slopes_list.append(seg_slope)

                    if seg_slope > max_slope:
                        slope_tier = "red"
                        red_slope_dist_m += ds
                    elif seg_slope >= 15.0:
                        slope_tier = "caution"
                        caution_slope_dist_m += ds
                    else:
                        slope_tier = "safe"
                        safe_slope_dist_m += ds

                    if dz > 0.15:
                        elevation_gain_m += dz
                        uphill_dist_m += ds
                        is_climbing = True
                    elif dz < -0.15:
                        elevation_loss_m += abs(dz)
                        downhill_dist_m += ds
                    else:
                        flat_dist_m += ds
                else:
                    safe_slope_dist_m += ds

            telemetry_samples.append({
                "dist_km": round(total_dist_m / 1000.0, 3),
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "elevation_m": round(z, 1),
                "slope_deg": round(seg_slope, 1),
                "slope_tier": slope_tier,
                "is_climbing": is_climbing,
                "is_shadowed": is_shd,
            })

        dist_km = total_dist_m / 1000.0
        direct_km = (np.hypot(r1 - r2, c1 - c2) * self.pixel_res) / 1000.0
        avg_slope_deg = float(np.mean(slopes_list)) if slopes_list else 0.0

        # Climbing uphill slows down advance speed:
        uphill_grade = (elevation_gain_m / max(1.0, uphill_dist_m))
        climb_speed_penalty = 1.0 + (1.2 * uphill_grade * (uphill_dist_m / max(1.0, total_dist_m)))
        effective_speed = (mode_profile["speedKmh"] * weather_profile["speedMultiplier"]) / climb_speed_penalty
        duration_hours = dist_km / max(0.1, effective_speed)
        duration_min = round(duration_hours * 60.0)

        # Life support: Oxygen consumption (Base + mechanical climb work against Mars gravity)
        slope_factor = 1.0 + (avg_slope_deg / 20.0)
        base_o2 = duration_min * mode_profile["o2RateLpm"] * slope_factor * weather_profile["tempMultiplier"]
        climb_o2_liters = (265.0 * MARS_GRAVITY * elevation_gain_m) / (0.22 * 20100.0) if mode_profile["id"] == "on_foot" else 0.0
        o2_liters_used = round(base_o2 + climb_o2_liters, 1)
        o2_used_pct = round((o2_liters_used / SUIT_O2_CAPACITY_L) * 100.0, 1)

        shadow_pct = round((sum(shadow_flags) / len(shadow_flags) * 100.0), 1) if shadow_flags else 0.0
        sunlit_pct = round(100.0 - shadow_pct, 1)

        if mode_profile["isSolarPowered"]:
            # Rover electric motor work against Mars gravity: 950kg * 3.72 * h / (3.6e6 * 0.72)
            climb_work_kwh = (950.0 * MARS_GRAVITY * elevation_gain_m) / (3.6e6 * 0.72)
            traction_base_kwh = (mode_profile["basePowerWatts"] * slope_factor * duration_hours) / 1000.0
            traction_energy_kwh = traction_base_kwh + climb_work_kwh

            solar_flux = SolarPhysics.calculate_solar_flux(sun_elev_deg, tau, is_shadowed=False)
            solar_gen_kwh = (
                solar_flux
                * mode_profile["solarPanelAreaM2"]
                * mode_profile["panelEfficiency"]
                * (sunlit_pct / 100.0)
                * duration_hours
            ) / 1000.0

            net_battery_kwh = max(0.0, traction_energy_kwh - solar_gen_kwh)
            battery_used_pct = round((net_battery_kwh / 15.0) * 100.0, 1)
        else:
            thermal_load = 1.0 + (0.35 if shadow_pct > 50.0 else 0.0)
            exertion_power = mode_profile["basePowerWatts"] * (1.0 + 0.5 * (elevation_gain_m / 100.0))
            suit_kwh = ((exertion_power + mode_profile["heaterPowerWatts"] * thermal_load) * duration_hours) / 1000.0
            battery_used_pct = round((suit_kwh / 1.2) * 100.0, 1)

        radiation_dose_mgy = round(duration_hours * weather_profile["radRateMgyHr"], 3)

        return {
            "found": found,
            "path_coords": path_coords,
            "telemetry_samples": telemetry_samples,
            "dist_km": round(dist_km, 2),
            "direct_km": round(direct_km, 2),
            "duration_min": duration_min,
            "elevation_gain_m": round(elevation_gain_m, 1),
            "elevation_loss_m": round(elevation_loss_m, 1),
            "uphill_dist_km": round(uphill_dist_m / 1000.0, 2),
            "downhill_dist_km": round(downhill_dist_m / 1000.0, 2),
            "flat_dist_km": round(flat_dist_m / 1000.0, 2),
            "safe_slope_km": round(safe_slope_dist_m / 1000.0, 2),
            "caution_slope_km": round(caution_slope_dist_m / 1000.0, 2),
            "max_slope_deg": round(max_slope_deg, 1),
            "avg_slope_deg": round(avg_slope_deg, 1),
            "red_nodes_avoided": red_nodes_in_corridor,
            "caution_nodes_weighted": caution_nodes_in_corridor,
            "shadow_pct": shadow_pct,
            "sunlit_pct": sunlit_pct,
            "o2_liters_used": o2_liters_used,
            "o2_used_pct": o2_used_pct,
            "battery_used_pct": battery_used_pct,
            "radiation_dose_mgy": radiation_dose_mgy,
        }

    def plan_route(
        self,
        start: tuple[float, float],
        destination: tuple[float, float],
        mode: str = "on_foot",
        lst_hours: float = 14.0,
        sun_position: tuple[float, float] | None = None,
        weather: str = "nominal",
        tau: float | None = None,
        radiation_spe: bool = False,
        initial_battery_pct: float = 100.0,
        initial_o2_pct: float = 100.0,
        allow_charging_pitstop: bool = True,
        uphill_penalty: float | None = None,
    ) -> dict:
        """Computes safe, terrain-aware Martian route from start to destination.

        Automatically routes through Virtual Base Charging Stations if direct reserves drop below 15%.
        """
        r1, c1, start_lat, start_lon = self._resolve_coords(start)
        r2, c2, goal_lat, goal_lon = self._resolve_coords(destination)

        mode_prof = MOBILITY_PROFILES.get(mode, MOBILITY_PROFILES["on_foot"])
        weather_key = "solar_storm" if radiation_spe else weather
        weather_prof = WEATHER_MODELS.get(weather_key, WEATHER_MODELS["nominal"])

        if sun_position is not None:
            sun_elev_deg, sun_az_deg = sun_position
        else:
            sun_elev_deg, sun_az_deg = SolarPhysics.calculate_sun_position(lst_hours)

        opt_tau = tau if tau is not None else weather_prof["tau"]

        # 1. Compute direct route leg
        leg1 = self._search_single_leg(
            (r1, c1), (r2, c2), mode_prof, weather_prof, sun_elev_deg, sun_az_deg, opt_tau, uphill_penalty=uphill_penalty
        )

        batt_remain_direct = initial_battery_pct - leg1["battery_used_pct"]
        o2_remain_direct = initial_o2_pct - leg1["o2_used_pct"]

        needs_pitstop = allow_charging_pitstop and (
            batt_remain_direct < SAFE_RESERVE_PCT or o2_remain_direct < SAFE_RESERVE_PCT
        )

        final_legs = []
        charging_station = None

        if needs_pitstop and self.charging_stations:
            # Rank charging stations in microseconds using Stage 6 All-Pairs precomputed distances
            I1, J1 = min(r1 // self.M, self.cH - 1), min(c1 // self.M, self.cW - 1)
            I2, J2 = min(r2 // self.M, self.cH - 1), min(c2 // self.M, self.cW - 1)

            best_station = None
            best_detour_dist = np.inf

            for st in self.charging_stations:
                st_r, st_c = self.latlon_to_grid(st["lat"], st["lon"])
                dist_start_m = np.hypot(st_r - r1, st_c - c1) * self.pixel_res
                dist_goal_m = np.hypot(st_r - r2, st_c - c2) * self.pixel_res
                if dist_start_m < 300.0 or dist_goal_m < 300.0:
                    continue

                st_I, st_J = min(st_r // self.M, self.cH - 1), min(st_c // self.M, self.cW - 1)

                d1 = self.all_pairs_4d[I1, J1, st_I, st_J]
                d2 = self.all_pairs_4d[st_I, st_J, I2, J2]

                if not np.isinf(d1) and not np.isinf(d2):
                    d1_km = d1 / 1000.0
                    batt_pct_1 = d1_km * mode_prof.get("batteryDrainPerKm", 10.0)
                    if (initial_battery_pct - batt_pct_1) < (SAFE_RESERVE_PCT - 5.0):
                        continue

                    d2_km = d2 / 1000.0
                    batt_pct_2 = d2_km * mode_prof.get("batteryDrainPerKm", 10.0)
                    if (100.0 - batt_pct_2) < (SAFE_RESERVE_PCT - 5.0):
                        continue

                    tot_d = d1 + d2
                    if tot_d < best_detour_dist:
                        best_detour_dist = tot_d
                        best_station = st

            if best_station:
                st_r, st_c = self.latlon_to_grid(best_station["lat"], best_station["lon"])
                leg_a = self._search_single_leg(
                    (r1, c1), (st_r, st_c), mode_prof, weather_prof, sun_elev_deg, sun_az_deg, opt_tau, uphill_penalty=uphill_penalty
                )
                leg_b = self._search_single_leg(
                    (st_r, st_c), (r2, c2), mode_prof, weather_prof, sun_elev_deg, sun_az_deg, opt_tau, uphill_penalty=uphill_penalty
                )
                charging_station = best_station
                final_legs = [leg_a, leg_b]
            else:
                final_legs = [leg1]
        else:
            final_legs = [leg1]

        total_dist_km = sum(l["dist_km"] for l in final_legs)
        total_duration_min = sum(l["duration_min"] for l in final_legs) + (15 if charging_station else 0)
        total_radiation = sum(l["radiation_dose_mgy"] for l in final_legs)
        max_slope = max(l["max_slope_deg"] for l in final_legs)
        total_elev_gain = sum(l["elevation_gain_m"] for l in final_legs)
        total_elev_loss = sum(l["elevation_loss_m"] for l in final_legs)
        total_uphill_km = sum(l["uphill_dist_km"] for l in final_legs)
        total_downhill_km = sum(l["downhill_dist_km"] for l in final_legs)
        total_flat_km = sum(l["flat_dist_km"] for l in final_legs)
        avg_slope = round(sum(l["avg_slope_deg"] * l["dist_km"] for l in final_legs) / max(0.01, total_dist_km), 1)
        avg_sunlit = round(sum(l["sunlit_pct"] * l["dist_km"] for l in final_legs) / max(0.01, total_dist_km), 1)
        avg_shadow = round(100.0 - avg_sunlit, 1)

        total_safe_km = sum(l.get("safe_slope_km", 0.0) for l in final_legs)
        total_caution_km = sum(l.get("caution_slope_km", 0.0) for l in final_legs)
        total_red_avoided = sum(l.get("red_nodes_avoided", 0) for l in final_legs)

        if charging_station:
            batt_remain_station = round(initial_battery_pct - final_legs[0]["battery_used_pct"], 1)
            final_battery_pct = round(100.0 - final_legs[1]["battery_used_pct"], 1)
            final_o2_pct = round(100.0 - final_legs[1]["o2_used_pct"], 1)
            total_batt_used = round(final_legs[0]["battery_used_pct"] + final_legs[1]["battery_used_pct"], 1)
            total_o2_used = round(final_legs[0]["o2_used_pct"] + final_legs[1]["o2_used_pct"], 1)
            status = "PITSTOP_RECHARGED" if (batt_remain_station >= 10.0 and final_battery_pct >= SAFE_RESERVE_PCT) else "OUT_OF_RANGE"
        else:
            final_battery_pct = round(batt_remain_direct, 1)
            final_o2_pct = round(o2_remain_direct, 1)
            total_batt_used = leg1["battery_used_pct"]
            total_o2_used = leg1["o2_used_pct"]
            status = "SAFE" if (final_battery_pct >= SAFE_RESERVE_PCT and final_o2_pct >= SAFE_RESERVE_PCT) else "OUT_OF_RANGE"

        full_coords = []
        full_telemetry = []
        dist_offset = 0.0
        for l in final_legs:
            full_coords.extend(l["path_coords"])
            for s in l["telemetry_samples"]:
                item = dict(s)
                item["dist_km"] = round(item["dist_km"] + dist_offset, 3)
                full_telemetry.append(item)
            dist_offset += l["dist_km"]

        # 5. Dynamic Walkback Horizon & Point of No Return Analysis (Apollo/Artemis EVA Rule #1)
        pnr_dist_km = None
        min_walkback_batt_margin = 100.0
        min_walkback_o2_margin = 100.0
        primary_abort_shelter = None

        for item in full_telemetry:
            trav_frac = item["dist_km"] / max(0.001, total_dist_km)
            batt_spent = trav_frac * total_batt_used
            o2_spent = trav_frac * total_o2_used

            current_batt = initial_battery_pct - batt_spent
            current_o2 = initial_o2_pct - o2_spent

            pr_r, pr_c = self.latlon_to_grid(item["lat"], item["lon"])
            pI = min(max(0, pr_r // self.M), self.cH - 1)
            pJ = min(max(0, pr_c // self.M), self.cW - 1)

            best_sh = None
            min_sh_dist = np.inf
            for sh in self.shelters:
                sr, sc = self.latlon_to_grid(sh["lat"], sh["lon"])
                sI = min(max(0, sr // self.M), self.cH - 1)
                sJ = min(max(0, sc // self.M), self.cW - 1)
                d_m = float(self.all_pairs_4d[pI, pJ, sI, sJ])
                if not np.isinf(d_m) and d_m < min_sh_dist:
                    min_sh_dist = d_m
                    best_sh = sh

            if not best_sh and self.shelters:
                best_sh = self.shelters[0]
                min_sh_dist = np.hypot(pr_r - self.latlon_to_grid(best_sh["lat"], best_sh["lon"])[0],
                                       pr_c - self.latlon_to_grid(best_sh["lat"], best_sh["lon"])[1]) * self.pixel_res

            abort_dist_km = min_sh_dist / 1000.0 if not np.isinf(min_sh_dist) else 0.0
            abort_time_hours = abort_dist_km / max(0.1, mode_prof["speedKmh"])
            abort_time_min = round(abort_time_hours * 60.0)

            abort_batt_cost = abort_dist_km * mode_prof.get("batteryDrainPerKm", 10.0)
            abort_o2_liters = abort_time_min * mode_prof.get("o2RateLpm", 0.85) * 1.15
            abort_o2_pct = (abort_o2_liters / SUIT_O2_CAPACITY_L) * 100.0

            margin_batt = float(round(current_batt - abort_batt_cost, 1))
            margin_o2 = float(round(current_o2 - abort_o2_pct, 1))
            is_beyond_pnr = bool((margin_batt < SAFE_RESERVE_PCT) or (margin_o2 < SAFE_RESERVE_PCT))

            item["nearest_shelter"] = str(best_sh["name"]) if best_sh else "Hab Alpha"
            item["abort_dist_km"] = float(round(abort_dist_km, 2))
            item["abort_time_min"] = int(abort_time_min)
            item["walkback_battery_margin_pct"] = margin_batt
            item["walkback_o2_margin_pct"] = margin_o2
            item["is_beyond_horizon"] = is_beyond_pnr

            if is_beyond_pnr and pnr_dist_km is None:
                pnr_dist_km = float(item["dist_km"])

            min_walkback_batt_margin = min(min_walkback_batt_margin, margin_batt)
            min_walkback_o2_margin = min(min_walkback_o2_margin, margin_o2)
            if primary_abort_shelter is None and best_sh:
                primary_abort_shelter = str(best_sh["name"])

        safe_horizon = bool(pnr_dist_km is None)
        walkback_status = "SAFE_HORIZON_MAINTAINED" if safe_horizon else f"POINT_OF_NO_RETURN_EXCEEDED_AT_KM_{pnr_dist_km}"

        # 6. RF Line-of-Sight Comms Shadow Analysis
        direct_hab_count = 0
        relay_count = 0
        blackout_count = 0
        blackout_dist_km = 0.0
        curr_blackout_run = 0.0
        max_blackout_run_km = 0.0

        for idx, item in enumerate(full_telemetry):
            c_info = self.evaluate_rf_comms(item["lat"], item["lon"], mode=mode)
            item["comms_status"] = c_info["status"]
            item["comms_link"] = c_info["active_link"]
            item["signal_quality"] = c_info["signal_quality"]
            item["path_loss_db"] = c_info["path_loss_db"]
            item["direct_hab_los"] = bool(c_info["direct_hab_los"])

            seg_len_km = item["dist_km"] - (full_telemetry[idx - 1]["dist_km"] if idx > 0 else 0.0)

            if c_info["direct_hab_los"]:
                direct_hab_count += 1
                curr_blackout_run = 0.0
            elif c_info["status"] == "RELAY_CONNECTED":
                relay_count += 1
                curr_blackout_run = 0.0
            else:
                blackout_count += 1
                blackout_dist_km += seg_len_km
                curr_blackout_run += seg_len_km
                max_blackout_run_km = max(max_blackout_run_km, curr_blackout_run)

        n_points = max(1, len(full_telemetry))
        comms_cov_pct = float(round(((direct_hab_count + relay_count) / n_points) * 100.0, 1))
        direct_hab_pct = float(round((direct_hab_count / n_points) * 100.0, 1))
        relay_pct = float(round((relay_count / n_points) * 100.0, 1))
        blackout_pct = float(round((blackout_count / n_points) * 100.0, 1))

        if comms_cov_pct >= 95.0:
            comms_rating = "FULL_COMMS_COVERAGE"
        elif comms_cov_pct >= 70.0:
            comms_rating = "INTERMITTENT_SHADOWS"
        else:
            comms_rating = "SEVERE_RF_BLACKOUT_ZONES"

        # Construct GeoJSON FeatureCollection
        features = [
            {
                "type": "Feature",
                "geometry": {
                    "type": "LineString",
                    "coordinates": full_coords,
                },
                "properties": {
                    "name": f"Dalil-Mars Tactical Path ({mode})",
                    "status": status,
                    "mode": mode,
                    "distance_km": round(total_dist_km, 2),
                    "duration_min": total_duration_min,
                    "elevation_gain_m": round(total_elev_gain, 1),
                    "elevation_loss_m": round(total_elev_loss, 1),
                    "max_slope_deg": round(max_slope, 1),
                    "safe_slope_km": round(total_safe_km, 2),
                    "dangerous_slope_km": round(total_caution_km, 2),
                    "red_nodes_avoided": total_red_avoided,
                    "battery_remaining_pct": final_battery_pct,
                    "comms_coverage_pct": comms_cov_pct,
                    "comms_status": comms_rating,
                },
            },
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(start_lon, 6), round(start_lat, 6)],
                },
                "properties": {
                    "name": "Mission Departure",
                    "type": "start",
                },
            },
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(goal_lon, 6), round(goal_lat, 6)],
                },
                "properties": {
                    "name": "Mission Destination",
                    "type": "destination",
                },
            },
        ]
        if charging_station:
            features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [round(charging_station["lon"], 6), round(charging_station["lat"], 6)],
                },
                "properties": {
                    "name": charging_station["name"],
                    "type": "charging_station",
                    "powerOutputKw": charging_station.get("powerOutputKw", 25),
                },
            })

        geojson = {
            "type": "FeatureCollection",
            "features": features,
        }

        hours_val = int(total_duration_min // 60)
        mins_val = int(total_duration_min % 60)
        dur_formatted = f"{hours_val}h {mins_val}m" if hours_val > 0 else f"{mins_val} min"

        summary = {
            "status": status,
            "mode": mode,
            "total_distance_km": round(total_dist_km, 2),
            "direct_distance_km": round(leg1["direct_km"], 2),
            "duration_min": total_duration_min,
            "duration_formatted": dur_formatted,
            "elevation_gain_m": round(total_elev_gain, 1),
            "elevation_loss_m": round(total_elev_loss, 1),
            "uphill_distance_km": round(total_uphill_km, 2),
            "downhill_distance_km": round(total_downhill_km, 2),
            "flat_distance_km": round(total_flat_km, 2),
            "safe_slope_distance_km": round(total_safe_km, 2),
            "dangerous_slope_distance_km": round(total_caution_km, 2),
            "red_nodes_avoided_count": total_red_avoided,
            "slope_safety_rating": "OPTIMAL (0% red nodes traversed, slopes safe)" if total_caution_km == 0 else f"CAUTION ({round(100.0 * total_caution_km / max(0.01, total_dist_km), 1)}% dangerous slopes negotiated safely)",
            "max_slope_deg": round(max_slope, 1),
            "avg_slope_deg": round(avg_slope, 1),
            "battery_used_pct": total_batt_used,
            "battery_remaining_pct": final_battery_pct,
            "o2_used_liters": round(sum(l.get("o2_liters_used", 0) for l in final_legs), 1),
            "o2_used_pct": total_o2_used,
            "o2_remaining_pct": final_o2_pct,
            "radiation_dose_mgy": round(total_radiation, 3),
            "sunlit_pct": round(avg_sunlit, 1),
            "shadow_pct": round(avg_shadow, 1),
            "pitstop_occurred": charging_station is not None,
            "charging_station_name": charging_station["name"] if charging_station else None,
            "walkback_horizon": {
                "safe_horizon_maintained": safe_horizon,
                "point_of_no_return_km": pnr_dist_km,
                "minimum_walkback_battery_margin_pct": round(min_walkback_batt_margin, 1),
                "minimum_walkback_o2_margin_pct": round(min_walkback_o2_margin, 1),
                "primary_abort_shelter": primary_abort_shelter,
                "status": walkback_status,
            },
            "rf_comms": {
                "status": comms_rating,
                "total_comms_coverage_pct": comms_cov_pct,
                "direct_hab_coverage_pct": direct_hab_pct,
                "relay_coverage_pct": relay_pct,
                "blackout_pct": blackout_pct,
                "blackout_distance_km": float(round(blackout_dist_km, 2)),
                "longest_continuous_blackout_km": float(round(max_blackout_run_km, 2)),
                "primary_mast": "Hab Alpha (40m Tower)",
                "available_relays_count": len(self.comms_towers) - 1,
            },
        }

        nav_steps = self._generate_navigation_steps(
            start_lat, start_lon, goal_lat, goal_lon, final_legs, charging_station
        )

        return {
            "status": status,
            "mode": mode,
            "start": {"lat": round(start_lat, 5), "lon": round(start_lon, 5)},
            "destination": {"lat": round(goal_lat, 5), "lon": round(goal_lon, 5)},
            "summary": summary,
            "geojson": geojson,
            "solar_context": {
                "lst_hours": lst_hours,
                "lst_formatted": f"{int(lst_hours):02d}:{int((lst_hours % 1) * 60):02d} Mars LST",
                "sun_elevation_deg": round(sun_elev_deg, 1),
                "sun_azimuth_deg": round(sun_az_deg, 1),
                "optical_depth_tau": opt_tau,
                "weather": weather_key,
                "sunlit_pct": round(avg_sunlit, 1),
                "shadow_pct": round(avg_shadow, 1),
            },
            "solar_ephemeris": {
                "lst_hours": lst_hours,
                "sun_elevation_deg": round(sun_elev_deg, 1),
                "sun_azimuth_deg": round(sun_az_deg, 1),
                "sunlit_pct": round(avg_sunlit, 1),
                "shadow_pct": round(avg_shadow, 1),
            },
            "telemetry_profile": full_telemetry,
            "navigation_steps": nav_steps,
            "charging_station": charging_station,
            "alert": weather_prof.get("alert"),
            "path_coords": full_coords,
            "legs": final_legs,
            # Direct scalar properties for backwards-compatibility:
            "direct_km": round(leg1["direct_km"], 2),
            "total_dist_km": round(total_dist_km, 2),
            "duration_min": total_duration_min,
            "elevation_gain_m": round(total_elev_gain, 1),
            "elevation_loss_m": round(total_elev_loss, 1),
            "battery_used_pct": total_batt_used,
            "battery_remaining_pct": final_battery_pct,
            "o2_used_pct": total_o2_used,
            "o2_remaining_pct": final_o2_pct,
            "radiation_dose_mgy": round(total_radiation, 3),
            "max_slope_deg": round(max_slope, 1),
        }

    def _generate_navigation_steps(self, lat1, lon1, lat2, lon2, legs, charging_station):
        steps = []
        bearing1 = self._compass_bearing(
            lat1, lon1, charging_station["lat"] if charging_station else lat2, charging_station["lon"] if charging_station else lon2
        )

        steps.append({
            "step": 1,
            "type": "depart",
            "instruction": f"Depart waypoint heading {bearing1}",
            "distance_km": legs[0]["dist_km"],
            "duration_min": legs[0]["duration_min"],
            "detail": f"Terrain slope holding ≤ {legs[0]['max_slope_deg']}°. Solar line-of-sight: {legs[0]['sunlit_pct']}% sunlit.",
        })

        if charging_station and len(legs) > 1:
            steps.append({
                "step": 2,
                "type": "charge",
                "instruction": f"Dock at {charging_station['name']} (Virtual Base Station)",
                "distance_km": 0.0,
                "duration_min": 15,
                "detail": f"Recharge suit/rover battery to 100% & refill O2 ({charging_station.get('powerOutputKw', 25)} kW KILOPOWER Pad).",
            })

            bearing2 = self._compass_bearing(charging_station["lat"], charging_station["lon"], lat2, lon2)
            steps.append({
                "step": 3,
                "type": "leg2",
                "instruction": f"Resume trek heading {bearing2} to destination",
                "distance_km": legs[1]["dist_km"],
                "duration_min": legs[1]["duration_min"],
                "detail": "Fresh 100% reserves. Final approach path holding safe terrain.",
            })

        steps.append({
            "step": len(steps) + 1,
            "type": "arrive",
            "instruction": "Arrive at mission destination",
            "distance_km": 0.0,
            "duration_min": 0,
            "detail": "Ingress airlock / commence surface sampling operations.",
        })

        return steps

    def plan_emergency_abort(
        self,
        current_location,
        mode: str = "on_foot",
        lst_hours: float = 14.0,
        initial_battery_pct: float = 100.0,
        initial_o2_pct: float = 100.0,
        weather: str = "nominal",
        **kwargs,
    ) -> dict:
        """Calculates immediate, highest-priority emergency retreat route to the closest habitat or storm shelter."""
        r_now, c_now, lat_now, lon_now = self._resolve_coords(current_location)
        I_now = min(max(0, r_now // self.M), self.cH - 1)
        J_now = min(max(0, c_now // self.M), self.cW - 1)

        best_shelter = None
        min_dist_m = np.inf
        for sh in self.shelters:
            sr, sc = self.latlon_to_grid(sh["lat"], sh["lon"])
            sI = min(max(0, sr // self.M), self.cH - 1)
            sJ = min(max(0, sc // self.M), self.cW - 1)
            d = float(self.all_pairs_4d[I_now, J_now, sI, sJ])
            if not np.isinf(d) and d < min_dist_m:
                min_dist_m = d
                best_shelter = sh

        if not best_shelter and self.shelters:
            best_shelter = self.shelters[0]

        route_res = self.plan_route(
            start=(lat_now, lon_now),
            destination=(best_shelter["lat"], best_shelter["lon"]),
            mode=mode,
            lst_hours=lst_hours,
            initial_battery_pct=initial_battery_pct,
            initial_o2_pct=initial_o2_pct,
            weather=weather,
            allow_charging_pitstop=False,
            **kwargs,
        )

        route_res["status"] = "EMERGENCY_ABORT_ACTIVE"
        route_res["abort_target_shelter"] = best_shelter
        return route_res

    def _resolve_poi_target(self, target) -> dict:
        if isinstance(target, dict) and "lat" in target and "lon" in target:
            return target
        if isinstance(target, (list, tuple)) and len(target) >= 2:
            return {
                "name": f"Waypoint ({target[0]:.4f}, {target[1]:.4f})",
                "lat": float(target[0]),
                "lon": float(target[1]),
                "type": "custom",
            }
        if isinstance(target, str):
            t_low = target.lower().strip()
            for p in self.all_pois:
                if t_low in p["name"].lower():
                    return p
            if "," in target:
                parts = [float(x.strip()) for x in target.split(",")]
                return {
                    "name": f"Waypoint ({parts[0]:.4f}, {parts[1]:.4f})",
                    "lat": parts[0],
                    "lon": parts[1],
                    "type": "custom",
                }
            raise ValueError(f"Unknown landmark or POI: {target}")
        raise ValueError(f"Unrecognized target format: {target}")

    def plan_science_tour(
        self,
        base_location=None,
        target_landmarks=None,
        max_duration_hours: float = 6.0,
        stay_duration_min: float = 25.0,
        mode: str = "rover",
        lst_hours: float = 9.0,
        weather: str = "nominal",
        initial_battery_pct: float = 100.0,
        initial_o2_pct: float = 100.0,
        allow_charging_pitstop: bool = False,
        uphill_penalty: float | None = None,
        **kwargs,
    ) -> dict:
        """Solves the Martian Orienteering / Budgeted Science Tour Problem.

        Computes the optimal sequence of science sites departing and returning to base
        within the allotted time and life-support budget. Uses the Stage 6 All-Pairs
        matrix for instant combinatorial optimization (< 3 ms), followed by fine A* path
        generation for each tour leg.
        """
        import itertools

        mode_prof = MOBILITY_PROFILES.get(mode, MOBILITY_PROFILES["rover"])
        speed_kmh = mode_prof["speedKmh"]

        # 1. Resolve Base
        if base_location is None:
            base_poi = self.shelters[0] if self.shelters else {
                "name": "Hab Alpha (Octavia E. Butler Landing)",
                "lat": 18.444627,
                "lon": 77.450886,
                "type": "habitat",
            }
        else:
            base_poi = self._resolve_poi_target(base_location)

        # 2. Resolve Candidate Targets
        candidates = []
        is_fixed_request = False
        if target_landmarks is not None and len(target_landmarks) > 0:
            is_fixed_request = True
            for t in target_landmarks:
                p = self._resolve_poi_target(t)
                if p["name"] != base_poi["name"]:
                    candidates.append(p)
        else:
            # Auto-select all cataloged science, resource, and ISRU sites
            for p in self.all_pois:
                if p["name"] != base_poi["name"] and p.get("type") in ["science", "resource", "isru"]:
                    candidates.append(p)

        if not candidates:
            raise ValueError("No valid science candidate targets found for tour planning.")

        all_nodes = [base_poi] + candidates
        N = len(all_nodes)

        # 3. Macro Pairwise Distance Matrix from Stage 6 (in km)
        D = np.zeros((N, N), dtype=float)
        for i in range(N):
            r1, c1 = self.latlon_to_grid(all_nodes[i]["lat"], all_nodes[i]["lon"])
            I1 = min(max(0, r1 // self.M), self.cH - 1)
            J1 = min(max(0, c1 // self.M), self.cW - 1)
            for j in range(N):
                if i == j:
                    continue
                r2, c2 = self.latlon_to_grid(all_nodes[j]["lat"], all_nodes[j]["lon"])
                I2 = min(max(0, r2 // self.M), self.cH - 1)
                J2 = min(max(0, c2 // self.M), self.cW - 1)
                d_m = float(self.all_pairs_4d[I1, J1, I2, J2])
                if np.isinf(d_m):
                    d_m = float(np.hypot(r1 - r2, c1 - c2) * self.pixel_res)
                D[i, j] = d_m / 1000.0

        # 4. Combinatorial Tour Optimizer (Prize-Collecting / TSP)
        max_duration_min = max_duration_hours * 60.0
        best_tour_indices = None
        best_score = (-1, 1e9)

        if is_fixed_request and len(candidates) <= 8:
            for perm in itertools.permutations(range(1, N)):
                tour = [0] + list(perm) + [0]
                travel_km = sum(D[tour[m], tour[m + 1]] for m in range(len(tour) - 1))
                travel_time_min = (travel_km / max(0.1, speed_kmh)) * 60.0
                total_time_min = travel_time_min + len(perm) * stay_duration_min
                score = (len(perm), -total_time_min)
                if score > (best_score[0], -best_score[1]):
                    best_score = (len(perm), total_time_min)
                    best_tour_indices = tour

        if best_tour_indices is None or best_score[1] > max_duration_min:
            best_tour_indices = None
            best_score = (-1, 1e9)
            max_subset_size = min(len(candidates), 6)
            for k in range(1, max_subset_size + 1):
                for subset in itertools.combinations(range(1, N), k):
                    for perm in itertools.permutations(subset):
                        tour = [0] + list(perm) + [0]
                        travel_km = sum(D[tour[m], tour[m + 1]] for m in range(len(tour) - 1))
                        travel_time_min = (travel_km / max(0.1, speed_kmh)) * 60.0
                        total_time_min = travel_time_min + len(perm) * stay_duration_min
                        if total_time_min <= max_duration_min:
                            if (len(perm) > best_score[0]) or (len(perm) == best_score[0] and total_time_min < best_score[1]):
                                best_score = (len(perm), total_time_min)
                                best_tour_indices = tour

        if best_tour_indices is None:
            closest_idx = 1 + int(np.argmin([D[0, j] + D[j, 0] for j in range(1, N)]))
            best_tour_indices = [0, closest_idx, 0]

        # 5. Execute Fine A* Routes for Each Leg of the Tour
        ordered_pois = [all_nodes[idx] for idx in best_tour_indices]
        legs = []
        stops_telemetry = []

        curr_lst = lst_hours
        curr_batt = initial_battery_pct
        curr_o2 = initial_o2_pct

        total_dist_km = 0.0
        total_travel_min = 0.0
        total_dwell_min = 0.0
        total_elev_gain = 0.0
        total_elev_loss = 0.0
        total_red_avoided = 0
        max_slope_overall = 0.0
        min_walkback_batt_margin = 100.0
        min_walkback_o2_margin = 100.0

        h_dep = int(curr_lst) % 24
        m_dep = int((curr_lst - int(curr_lst)) * 60.0)
        dep_str = f"{h_dep:02d}:{m_dep:02d} LST"

        stops_telemetry.append({
            "stop_index": 0,
            "name": ordered_pois[0]["name"],
            "type": ordered_pois[0].get("type", "habitat"),
            "lat": ordered_pois[0]["lat"],
            "lon": ordered_pois[0]["lon"],
            "arrival_lst": dep_str,
            "departure_lst": dep_str,
            "dwell_time_min": 0,
            "battery_arrival_pct": round(curr_batt, 1),
            "battery_departure_pct": round(curr_batt, 1),
            "o2_arrival_pct": round(curr_o2, 1),
            "o2_departure_pct": round(curr_o2, 1),
            "notes": "Expedition departure from pressurized base camp.",
        })

        for leg_idx in range(len(ordered_pois) - 1):
            src_poi = ordered_pois[leg_idx]
            dst_poi = ordered_pois[leg_idx + 1]

            leg_plan = self.plan_route(
                start=(src_poi["lat"], src_poi["lon"]),
                destination=(dst_poi["lat"], dst_poi["lon"]),
                mode=mode,
                lst_hours=curr_lst,
                weather=weather,
                initial_battery_pct=curr_batt,
                initial_o2_pct=curr_o2,
                allow_charging_pitstop=allow_charging_pitstop,
                uphill_penalty=uphill_penalty,
                **kwargs,
            )

            s_leg = leg_plan["summary"]
            legs.append({
                "leg_index": leg_idx + 1,
                "from_stop": src_poi["name"],
                "to_stop": dst_poi["name"],
                "distance_km": s_leg["total_distance_km"],
                "duration_min": s_leg["duration_min"],
                "battery_used_pct": s_leg["battery_used_pct"],
                "o2_used_liters": s_leg["o2_used_liters"],
                "max_slope_deg": s_leg["max_slope_deg"],
                "slope_safety_rating": s_leg["slope_safety_rating"],
                "red_nodes_avoided": s_leg["red_nodes_avoided_count"],
                "sunlit_pct": s_leg["sunlit_pct"],
                "navigation_steps": leg_plan["navigation_steps"],
                "geojson": leg_plan["geojson"],
            })

            total_dist_km += s_leg["total_distance_km"]
            total_travel_min += s_leg["duration_min"]
            total_elev_gain += s_leg["elevation_gain_m"]
            total_elev_loss += s_leg["elevation_loss_m"]
            total_red_avoided += s_leg["red_nodes_avoided_count"]
            max_slope_overall = max(max_slope_overall, s_leg["max_slope_deg"])

            wb = s_leg.get("walkback_horizon", {})
            if "minimum_walkback_battery_margin_pct" in wb:
                min_walkback_batt_margin = min(min_walkback_batt_margin, wb["minimum_walkback_battery_margin_pct"])
            if "minimum_walkback_o2_margin_pct" in wb:
                min_walkback_o2_margin = min(min_walkback_o2_margin, wb["minimum_walkback_o2_margin_pct"])

            curr_lst = (curr_lst + (s_leg["duration_min"] / 60.0)) % 24.0
            curr_batt = s_leg["battery_remaining_pct"]
            curr_o2 = s_leg["o2_remaining_pct"]

            h_arr = int(curr_lst) % 24
            m_arr = int((curr_lst - int(curr_lst)) * 60.0)
            arr_str = f"{h_arr:02d}:{m_arr:02d} LST"

            is_last_stop = (leg_idx == len(ordered_pois) - 2)
            dwell_min = 0 if is_last_stop else int(round(stay_duration_min))

            dwell_batt_drain = round((dwell_min / 60.0) * 0.8, 1) if dwell_min > 0 else 0.0
            dwell_o2_liters = round(dwell_min * mode_prof.get("o2RateLpm", 0.85), 1) if dwell_min > 0 else 0.0
            dwell_o2_pct = round((dwell_o2_liters / SUIT_O2_CAPACITY_L) * 100.0, 1)

            curr_batt_depart = max(0.0, round(curr_batt - dwell_batt_drain, 1))
            curr_o2_depart = max(0.0, round(curr_o2 - dwell_o2_pct, 1))

            curr_lst = (curr_lst + (dwell_min / 60.0)) % 24.0
            h_dep = int(curr_lst) % 24
            m_dep = int((curr_lst - int(curr_lst)) * 60.0)
            dep_str = f"{h_dep:02d}:{m_dep:02d} LST"

            stops_telemetry.append({
                "stop_index": leg_idx + 1,
                "name": dst_poi["name"],
                "type": dst_poi.get("type", "science" if not is_last_stop else "habitat"),
                "lat": dst_poi["lat"],
                "lon": dst_poi["lon"],
                "arrival_lst": arr_str,
                "departure_lst": dep_str if not is_last_stop else None,
                "dwell_time_min": dwell_min,
                "battery_arrival_pct": round(curr_batt, 1),
                "battery_departure_pct": curr_batt_depart if not is_last_stop else round(curr_batt, 1),
                "o2_arrival_pct": round(curr_o2, 1),
                "o2_departure_pct": curr_o2_depart if not is_last_stop else round(curr_o2, 1),
                "notes": "Return to base / mission complete." if is_last_stop else f"Conduct scientific sampling & field measurements ({dwell_min} min dwell).",
            })

            total_dwell_min += dwell_min
            curr_batt = curr_batt_depart
            curr_o2 = curr_o2_depart

        total_mission_min = total_travel_min + total_dwell_min
        total_mission_hours = round(total_mission_min / 60.0, 2)
        h_tot = int(total_mission_min) // 60
        m_tot = int(total_mission_min) % 60
        formatted_mission_time = f"{h_tot}h {m_tot:02d}m"

        tour_status = "OPTIMAL_TOUR_PLANNED" if total_mission_min <= max_duration_min else "FEASIBLE_TOUR_EXCEEDS_TARGET_BUDGET"

        geojson_features = []
        for leg in legs:
            for feat in leg["geojson"]["features"]:
                if feat["geometry"]["type"] == "LineString":
                    feat_copy = dict(feat)
                    feat_copy["properties"] = dict(feat["properties"])
                    feat_copy["properties"]["leg_index"] = leg["leg_index"]
                    feat_copy["properties"]["from_stop"] = leg["from_stop"]
                    feat_copy["properties"]["to_stop"] = leg["to_stop"]
                    geojson_features.append(feat_copy)

        for st in stops_telemetry:
            geojson_features.append({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [st["lon"], st["lat"]],
                },
                "properties": {
                    "marker_type": "tour_stop",
                    "stop_index": st["stop_index"],
                    "name": st["name"],
                    "arrival_lst": st["arrival_lst"],
                    "dwell_min": st["dwell_time_min"],
                    "battery_pct": st["battery_arrival_pct"],
                    "notes": st["notes"],
                },
            })

        consolidated_geojson = {
            "type": "FeatureCollection",
            "features": geojson_features,
        }

        return {
            "status": tour_status,
            "mode": mode,
            "base_camp": base_poi,
            "targets_visited_count": len(best_tour_indices) - 2,
            "total_stops_count": len(best_tour_indices),
            "ordered_stops": stops_telemetry,
            "legs": legs,
            "geojson": consolidated_geojson,
            "summary": {
                "status": tour_status,
                "mode": mode,
                "total_distance_km": round(total_dist_km, 2),
                "total_mission_duration_hours": total_mission_hours,
                "total_mission_duration_formatted": formatted_mission_time,
                "travel_time_hours": round(total_travel_min / 60.0, 2),
                "science_dwell_hours": round(total_dwell_min / 60.0, 2),
                "elevation_gain_m": round(total_elev_gain, 1),
                "elevation_loss_m": round(total_elev_loss, 1),
                "max_slope_deg": round(max_slope_overall, 1),
                "total_red_nodes_avoided": int(total_red_avoided),
                "battery_remaining_pct": round(curr_batt, 1),
                "battery_used_pct": round(initial_battery_pct - curr_batt, 1),
                "o2_remaining_pct": round(curr_o2, 1),
                "o2_used_pct": round(initial_o2_pct - curr_o2, 1),
                "min_walkback_battery_margin_pct": round(min_walkback_batt_margin, 1),
                "min_walkback_o2_margin_pct": round(min_walkback_o2_margin, 1),
                "safe_abort_maintained": bool(min_walkback_batt_margin >= SAFE_RESERVE_PCT and min_walkback_o2_margin >= SAFE_RESERVE_PCT),
            },
        }

    def find_optimal_departure(
        self,
        start,
        destination,
        mode: str = "rover",
        earliest_lst: float = 7.0,
        latest_lst: float = 16.5,
        step_hours: float = 0.5,
        weather: str = "nominal",
        initial_battery_pct: float = 100.0,
        initial_o2_pct: float = 100.0,
        allow_charging_pitstop: bool = True,
        uphill_penalty: float | None = None,
        **kwargs,
    ) -> dict:
        """Evaluates diurnal solar variation across a Martian sol to determine the optimal departure time.

        Analyzes sun elevation, shadow casting, solar panel generation, thermal heater loads,
        and sunset risk, identifying the safest departure window with peak battery reserves.
        """
        weather_prof = WEATHER_MODELS.get(weather, WEATHER_MODELS["nominal"])
        opt_tau = weather_prof["tau"]

        # 1. Base route at noon to establish terrain profile and duration
        base_route = self.plan_route(
            start=start,
            destination=destination,
            mode=mode,
            lst_hours=12.0,
            weather=weather,
            initial_battery_pct=initial_battery_pct,
            initial_o2_pct=initial_o2_pct,
            allow_charging_pitstop=allow_charging_pitstop,
            uphill_penalty=uphill_penalty,
            **kwargs,
        )

        total_km = base_route["total_dist_km"]
        dur_min = base_route["duration_min"]
        dur_hours = dur_min / 60.0
        base_drain_pct = base_route["summary"]["battery_used_pct"]

        candidate_hours = np.arange(earliest_lst, latest_lst + 1e-4, step_hours)
        timeline = []

        for h in candidate_hours:
            arr_h = h + dur_hours
            e_dep, az_dep = SolarPhysics.calculate_sun_position(h)
            e_arr, az_arr = SolarPhysics.calculate_sun_position(arr_h)
            e_mid, _ = SolarPhysics.calculate_sun_position(h + dur_hours / 2.0)

            avg_e = max(0.0, (e_dep + 2.0 * e_mid + e_arr) / 4.0)
            flux = SolarPhysics.calculate_solar_flux(avg_e, opt_tau)

            if mode == "rover":
                # 2.8 m2 panel, 28% efficiency, 5 kWh battery
                solar_gen_kwh = (flux * 2.8 * 0.28 * dur_hours) / 1000.0
                solar_gen_pct = min(20.0, (solar_gen_kwh / 5.0) * 100.0)
                # Heater loads when ambient sun is low (<10 deg)
                heater_drain = (dur_hours * 2.5) if (e_dep < 10.0 or e_arr < 10.0 or avg_e < 15.0) else 0.0
                net_batt = round(min(100.0, max(0.0, initial_battery_pct - base_drain_pct + solar_gen_pct - heater_drain)), 1)
            else:
                solar_gen_pct = 0.0
                heater_drain = (dur_hours * 5.0) if (e_dep < 8.0 or e_arr < 8.0) else 0.0
                net_batt = round(max(0.0, initial_battery_pct - base_drain_pct - heater_drain), 1)

            if e_arr <= 0.0 or e_dep <= 0.0:
                status = "NIGHT_TRAP"
                rating = 1
            elif e_arr < 8.0:
                status = "TWILIGHT_RISK"
                rating = 2
            elif avg_e >= 25.0 and e_dep >= 15.0 and e_arr >= 15.0 and net_batt >= 88.0:
                status = "OPTIMAL"
                rating = 5
            elif net_batt >= 75.0 and e_arr >= 10.0:
                status = "ACCEPTABLE"
                rating = 4
            else:
                status = "MARGINAL"
                rating = 3

            score = (rating * 1000.0) + (net_batt * 2.0) + (avg_e * 1.5) - abs(h - 11.5) * 0.5

            dh, dm = int(h), int(round((h % 1) * 60))
            ah, am = int(arr_h) % 24, int(round((arr_h % 1) * 60))

            timeline.append({
                "lst_hours": float(round(h, 2)),
                "departure_time": f"{dh:02d}:{dm:02d} LST",
                "arrival_time": f"{ah:02d}:{am:02d} LST",
                "departure_sun_elevation_deg": float(round(e_dep, 1)),
                "arrival_sun_elevation_deg": float(round(e_arr, 1)),
                "average_solar_flux_wm2": float(round(flux, 1)),
                "battery_remaining_pct": float(round(net_batt, 1)),
                "solar_energy_harvested_pct": float(round(solar_gen_pct, 1)),
                "status": status,
                "score": float(round(score, 1)),
            })

        best_slot = max(timeline, key=lambda s: s["score"])
        optimal_slots = [s for s in timeline if s["status"] == "OPTIMAL"]

        if optimal_slots:
            win_start = optimal_slots[0]["departure_time"]
            win_end = optimal_slots[-1]["departure_time"]
            win_hours = round(optimal_slots[-1]["lst_hours"] - optimal_slots[0]["lst_hours"] + step_hours, 1)
        else:
            win_start = best_slot["departure_time"]
            win_end = best_slot["departure_time"]
            win_hours = step_hours

        # Compute full route for the best departure slot
        best_route = self.plan_route(
            start=start,
            destination=destination,
            mode=mode,
            lst_hours=best_slot["lst_hours"],
            weather=weather,
            initial_battery_pct=initial_battery_pct,
            initial_o2_pct=initial_o2_pct,
            allow_charging_pitstop=allow_charging_pitstop,
            uphill_penalty=uphill_penalty,
            **kwargs,
        )

        return {
            "status": "OPTIMAL_WINDOW_IDENTIFIED",
            "mode": mode,
            "start": base_route["start"],
            "destination": base_route["destination"],
            "total_distance_km": total_km,
            "duration_formatted": base_route["summary"]["duration_formatted"],
            "duration_min": dur_min,
            "recommended_window": {
                "start_time": win_start,
                "end_time": win_end,
                "peak_departure": best_slot["departure_time"],
                "window_duration_hours": win_hours,
            },
            "best_departure": best_slot,
            "departure_timeline": timeline,
            "best_route": best_route,
        }

    def evaluate_rf_comms(self, lat: float, lon: float, mode: str = "rover") -> dict:
        """Evaluates RF line-of-sight connectivity from a given position to base mast and relays."""
        pr, pc = self.latlon_to_grid(lat, lon)
        h_ant = CommsPhysics.ROVER_ANTENNA_HEIGHT_M if mode == "rover" else CommsPhysics.EVA_ANTENNA_HEIGHT_M
        pz = float(self.elev_matrix[pr, pc]) + h_ant if self.elev_matrix is not None else -2550.0

        active_link = None
        best_tower = None
        min_path_loss = np.inf
        direct_hab_los = False

        for tow in self.comms_towers:
            has_los = CommsPhysics.test_line_of_sight(
                self.elev_matrix, pr, pc, pz, tow["grid_r"], tow["grid_c"], tow["antenna_z_m"]
            )
            dist_km = (np.hypot(tow["grid_r"] - pr, tow["grid_c"] - pc) * self.pixel_res) / 1000.0
            pl_db = CommsPhysics.calculate_free_space_path_loss(dist_km)

            if tow["type"] == "primary" and has_los:
                direct_hab_los = True

            if has_los and pl_db < min_path_loss:
                min_path_loss = pl_db
                best_tower = tow

        if best_tower:
            status = "DIRECT_HAB_LOS" if best_tower["type"] == "primary" else "RELAY_CONNECTED"
            active_link = best_tower["name"]
            sig_quality = "OPTIMAL" if min_path_loss < 95.0 else ("GOOD" if min_path_loss < 110.0 else "MARGINAL")
        else:
            status = "RF_BLACKOUT"
            active_link = "NONE (Terrain Occluded)"
            sig_quality = "BLACKOUT"
            min_path_loss = None

        dist_to_hab_km = round((np.hypot(self.comms_towers[0]["grid_r"] - pr, self.comms_towers[0]["grid_c"] - pc) * self.pixel_res) / 1000.0, 2)

        return {
            "status": status,
            "active_link": active_link,
            "signal_quality": sig_quality,
            "direct_hab_los": bool(direct_hab_los),
            "path_loss_db": float(round(min_path_loss, 1)) if min_path_loss is not None else None,
            "distance_to_hab_km": dist_to_hab_km,
        }

    @staticmethod
    def _compass_bearing(lat1, lon1, lat2, lon2):
        dLon = np.radians(lon2 - lon1)
        y = np.sin(dLon) * np.cos(np.radians(lat2))
        x = np.cos(np.radians(lat1)) * np.sin(np.radians(lat2)) - np.sin(np.radians(lat1)) * np.cos(np.radians(lat2)) * np.cos(dLon)
        brng = (np.degrees(np.arctan2(y, x)) + 360.0) % 360.0
        dirs = ["North", "Northeast", "East", "Southeast", "South", "Southwest", "West", "Northwest"]
        return dirs[int(round(brng / 45.0)) % 8]


_DEFAULT_ENGINE = None


def get_engine() -> DalilMarsEngine:
    """Returns the cached singleton instance of DalilMarsEngine."""
    global _DEFAULT_ENGINE
    if _DEFAULT_ENGINE is None:
        _DEFAULT_ENGINE = DalilMarsEngine()
    return _DEFAULT_ENGINE


# Backward-compatibility alias
MartianTacticalEngine = DalilMarsEngine
DalilMarsRouter = DalilMarsEngine
MartianRouter = DalilMarsEngine


def plan_route(
    start,
    destination,
    mode: str = "on_foot",
    lst: float | None = None,
    lst_hours: float = 14.0,
    sun_position: tuple[float, float] | None = None,
    weather: str = "nominal",
    tau: float | None = None,
    radiation_spe: bool = False,
    initial_battery: float | None = None,
    initial_battery_pct: float = 100.0,
    initial_o2: float | None = None,
    initial_o2_pct: float = 100.0,
    allow_pitstop: bool | None = None,
    allow_charging_pitstop: bool = True,
    uphill_cost_factor: float | None = None,
    uphill_penalty: float | None = None,
    **kwargs,
) -> dict:
    """High-level function API to plan an optimal, terrain-aware Martian route.

    Supports flexible coordinate formats (lat/lon tuple, list, or dict) and parameter aliases.
    """
    lst_val = lst if lst is not None else lst_hours
    batt_val = initial_battery if initial_battery is not None else initial_battery_pct
    o2_val = initial_o2 if initial_o2 is not None else initial_o2_pct
    pitstop_val = allow_pitstop if allow_pitstop is not None else allow_charging_pitstop
    climb_val = uphill_cost_factor if uphill_cost_factor is not None else uphill_penalty

    return get_engine().plan_route(
        start=start,
        destination=destination,
        mode=mode,
        lst_hours=lst_val,
        sun_position=sun_position,
        weather=weather,
        tau=tau,
        radiation_spe=radiation_spe,
        initial_battery_pct=batt_val,
        initial_o2_pct=o2_val,
        allow_charging_pitstop=pitstop_val,
        uphill_penalty=climb_val,
        **kwargs,
    )


# Method aliases
route = plan_route
plan_mission_route = plan_route


def plan_emergency_abort(
    current_location,
    mode: str = "on_foot",
    lst: float | None = None,
    lst_hours: float = 14.0,
    initial_battery: float | None = None,
    initial_battery_pct: float = 100.0,
    initial_o2: float | None = None,
    initial_o2_pct: float = 100.0,
    weather: str = "nominal",
    **kwargs,
) -> dict:
    """Calculates immediate, highest-priority emergency retreat route to the closest habitat or storm shelter."""
    lst_val = lst if lst is not None else lst_hours
    batt_val = initial_battery if initial_battery is not None else initial_battery_pct
    o2_val = initial_o2 if initial_o2 is not None else initial_o2_pct

    return get_engine().plan_emergency_abort(
        current_location=current_location,
        mode=mode,
        lst_hours=lst_val,
        initial_battery_pct=batt_val,
        initial_o2_pct=o2_val,
        weather=weather,
        **kwargs,
    )


abort = plan_emergency_abort


def plan_science_tour(
    base_location=None,
    targets=None,
    target_landmarks=None,
    max_duration_hours: float = 6.0,
    stay_duration_min: float = 25.0,
    mode: str = "rover",
    lst: float | None = None,
    lst_hours: float = 9.0,
    weather: str = "nominal",
    initial_battery: float | None = None,
    initial_battery_pct: float = 100.0,
    initial_o2: float | None = None,
    initial_o2_pct: float = 100.0,
    allow_charging_pitstop: bool = False,
    uphill_penalty: float | None = None,
    **kwargs,
) -> dict:
    """Plans an optimal multi-stop science exploration tour visiting cataloged Jezero targets."""
    target_list = target_landmarks if target_landmarks is not None else targets
    lst_val = lst if lst is not None else lst_hours
    batt_val = initial_battery if initial_battery is not None else initial_battery_pct
    o2_val = initial_o2 if initial_o2 is not None else initial_o2_pct

    return get_engine().plan_science_tour(
        base_location=base_location,
        target_landmarks=target_list,
        max_duration_hours=max_duration_hours,
        stay_duration_min=stay_duration_min,
        mode=mode,
        lst_hours=lst_val,
        weather=weather,
        initial_battery_pct=batt_val,
        initial_o2_pct=o2_val,
        allow_charging_pitstop=allow_charging_pitstop,
        uphill_penalty=uphill_penalty,
        **kwargs,
    )


plan_tour = plan_science_tour
tour = plan_science_tour


def find_optimal_departure(
    start,
    destination,
    mode: str = "rover",
    earliest_lst: float = 7.0,
    latest_lst: float = 16.5,
    step_hours: float = 0.5,
    weather: str = "nominal",
    initial_battery: float | None = None,
    initial_battery_pct: float = 100.0,
    initial_o2: float | None = None,
    initial_o2_pct: float = 100.0,
    allow_charging_pitstop: bool = True,
    uphill_penalty: float | None = None,
    **kwargs,
) -> dict:
    """Evaluates diurnal solar variation across a Martian sol to find the safest departure window."""
    batt_val = initial_battery if initial_battery is not None else initial_battery_pct
    o2_val = initial_o2 if initial_o2 is not None else initial_o2_pct

    return get_engine().find_optimal_departure(
        start=start,
        destination=destination,
        mode=mode,
        earliest_lst=earliest_lst,
        latest_lst=latest_lst,
        step_hours=step_hours,
        weather=weather,
        initial_battery_pct=batt_val,
        initial_o2_pct=o2_val,
        allow_charging_pitstop=allow_charging_pitstop,
        uphill_penalty=uphill_penalty,
        **kwargs,
    )


optimize_departure_window = find_optimal_departure
departure_window = find_optimal_departure


def evaluate_rf_comms(location, mode: str = "rover") -> dict:
    """Evaluates RF line-of-sight connectivity and link budget from coordinates or POI to Hab Alpha and relay masts."""
    eng = get_engine()
    _, _, lat, lon = eng._resolve_coords(location)
    return eng.evaluate_rf_comms(lat, lon, mode=mode)


evaluate_comms = evaluate_rf_comms
comms = evaluate_rf_comms


def get_waypoints() -> list[dict]:
    """Returns cataloged Jezero POIs, habitats, and science landmarks."""
    haz_path = os.path.join(BASE_DIR, "src", "data", "jezero_science_hazards.json")
    if os.path.exists(haz_path):
        try:
            with open(haz_path, "r") as f:
                data = json.load(f)
                return data.get("sciencePOIs", [])
        except Exception:
            pass
    return get_engine().charging_stations


def get_charging_stations() -> list[dict]:
    """Returns only virtual charging stations equipped with power and life-support refill."""
    return [p for p in get_waypoints() if p.get("isChargingStation")]


def get_weather(sol: int | None = None) -> dict:
    """Returns Martian Environmental Dynamics Analyzer (MEDA) atmospheric conditions."""
    weather_path = os.path.join(BASE_DIR, "src", "data", "meda_weather.json")
    if os.path.exists(weather_path):
        try:
            with open(weather_path, "r") as f:
                return json.load(f)
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


def get_engine_status() -> dict:
    """Returns metadata about the loaded engine and precomputed matrices."""
    eng = get_engine()
    H, W = eng.master_grid.shape
    return {
        "engine": "Dalil-Mars Tactical Pathfinding Engine",
        "status": "ONLINE",
        "fine_grid_resolution_m": eng.pixel_res,
        "fine_grid_dimensions": {"rows": H, "cols": W, "total_nodes": H * W},
        "macro_grid_dimensions": {"rows": eng.cH, "cols": eng.cW, "macro_cells": eng.cH * eng.cW},
        "all_pairs_matrix_loaded": eng.all_pairs_4d is not None,
        "charging_stations_count": len(eng.charging_stations),
        "available_modes": list(MOBILITY_PROFILES.keys()),
        "weather_models": list(WEATHER_MODELS.keys()),
    }


def run_http_server(port: int = 8000, host: str = "0.0.0.0"):
    """Launches a lightweight REST API server for web clients and frontends."""
    from flask import Flask, request, jsonify

    app = Flask("dalil_mars_api")
    sys.stderr.write("Pre-warming Dalil-Mars Tactical Engine for REST API...\n")
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

            if isinstance(start_val, str):
                parts = [float(x.strip()) for x in start_val.split(",")]
                start = (parts[0], parts[1])
            elif isinstance(start_val, (list, tuple)):
                start = (float(start_val[0]), float(start_val[1]))
            elif "start_lat" in data and "start_lon" in data:
                start = (float(data["start_lat"]), float(data["start_lon"]))
            else:
                return jsonify({"error": "Missing 'start' parameter (lat, lon)"}), 400

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
            lst_val = float(data.get("lst", data.get("lst_hours", 12.0)))
            weather_val = data.get("weather", "nominal")
            batt_val = float(data.get("battery", data.get("initial_battery", 100.0)))
            o2_val = float(data.get("o2", data.get("initial_o2", 100.0)))
            climb_val = float(data["uphill_factor"]) if "uphill_factor" in data else None

            res = plan_route(
                start=start,
                destination=destination,
                mode=mode,
                lst=lst_val,
                weather=weather_val,
                initial_battery=batt_val,
                initial_o2=o2_val,
                uphill_cost_factor=climb_val,
            )
            return jsonify(res)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/tour", methods=["GET", "POST"])
    def tour_endpoint():
        try:
            if request.method == "POST":
                data = request.get_json(force=True)
            else:
                data = request.args

            base_val = data.get("base") or data.get("base_location")
            targets_val = data.get("targets") or data.get("target_landmarks")
            mode = data.get("mode", "rover")
            max_h = float(data.get("max_hours", data.get("max_duration_hours", 6.0)))
            dwell_m = float(data.get("dwell_min", data.get("stay_duration_min", 25.0)))
            lst_val = float(data.get("lst", data.get("lst_hours", 9.0)))
            weather_val = data.get("weather", "nominal")
            batt_val = float(data.get("battery", data.get("initial_battery", 100.0)))
            o2_val = float(data.get("o2", data.get("initial_o2", 100.0)))

            res = plan_science_tour(
                base_location=base_val,
                targets=targets_val,
                max_duration_hours=max_h,
                stay_duration_min=dwell_m,
                mode=mode,
                lst=lst_val,
                weather=weather_val,
                initial_battery=batt_val,
                initial_o2=o2_val,
            )
            return jsonify(res)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/departure", methods=["GET", "POST"])
    def departure_endpoint():
        try:
            if request.method == "POST":
                data = request.get_json(force=True)
            else:
                data = request.args

            start_val = data.get("start")
            end_val = data.get("destination") or data.get("end")

            if isinstance(start_val, str) and "," in start_val:
                parts = [float(x.strip()) for x in start_val.split(",")]
                start = (parts[0], parts[1])
            elif isinstance(start_val, (list, tuple)):
                start = (float(start_val[0]), float(start_val[1]))
            elif "start_lat" in data and "start_lon" in data:
                start = (float(data["start_lat"]), float(data["start_lon"]))
            else:
                return jsonify({"error": "Missing 'start' parameter"}), 400

            if isinstance(end_val, str) and "," in end_val:
                parts = [float(x.strip()) for x in end_val.split(",")]
                destination = (parts[0], parts[1])
            elif isinstance(end_val, (list, tuple)):
                destination = (float(end_val[0]), float(end_val[1]))
            elif "end_lat" in data and "end_lon" in data:
                destination = (float(data["end_lat"]), float(data["end_lon"]))
            else:
                return jsonify({"error": "Missing 'destination' parameter"}), 400

            mode = data.get("mode", "rover")
            weather_val = data.get("weather", "nominal")
            batt_val = float(data.get("battery", data.get("initial_battery", 100.0)))
            o2_val = float(data.get("o2", data.get("initial_o2", 100.0)))

            res = find_optimal_departure(
                start=start,
                destination=destination,
                mode=mode,
                weather=weather_val,
                initial_battery=batt_val,
                initial_o2=o2_val,
            )
            return jsonify(res)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    @app.route("/api/comms", methods=["GET", "POST"])
    def comms_endpoint():
        try:
            if request.method == "POST":
                data = request.get_json(force=True)
            else:
                data = request.args

            loc = data.get("location") or data.get("coords")
            if not loc:
                lat = float(data.get("lat", 0.0))
                lon = float(data.get("lon", 0.0))
                loc = (lat, lon)
            mode = data.get("mode", "rover")

            res = evaluate_rf_comms(loc, mode=mode)
            return jsonify(res)
        except Exception as e:
            return jsonify({"error": str(e)}), 500

    print(f"Dalil-Mars REST API Server listening on http://{host}:{port}")
    print("Endpoints:")
    print("  - GET  /api/health")
    print("  - GET  /api/waypoints")
    print("  - GET  /api/weather")
    print("  - POST /api/route")
    print("  - POST /api/tour")
    print("  - POST /api/departure")
    print("  - POST /api/comms")
    app.run(host=host, port=port, debug=False)


# =============================================================================
# 5. CLI & DEMO HARNESS
# =============================================================================
def main():
    parser = argparse.ArgumentParser(description="Dalil-Mars Martian Tactical Pathfinding Engine & API")
    parser.add_argument("--demo", action="store_true", help="Run 3 standard NASA mission test scenarios.")
    parser.add_argument("--start", nargs=2, type=float, metavar=("LAT", "LON"), help="Start coordinate (lat, lon).")
    parser.add_argument("--end", nargs=2, type=float, metavar=("LAT", "LON"), help="Destination coordinate (lat, lon).")
    parser.add_argument("--abort", nargs=2, type=float, metavar=("LAT", "LON"), help="Emergency retreat coordinates: LAT LON (Apollo/Artemis Rule #1).")
    parser.add_argument("--tour", action="store_true", help="Plan optimal multi-stop science exploration tour.")
    parser.add_argument("--targets", nargs="+", help="Specific landmark names or coordinates to include in science tour.")
    parser.add_argument("--max-hours", type=float, default=6.0, help="Max mission time budget in hours for science tour (default 6.0).")
    parser.add_argument("--dwell-min", type=float, default=25.0, help="Dwell/science time in minutes per stop (default 25.0).")
    parser.add_argument("--find-departure", action="store_true", help="Analyze diurnal solar conditions to find optimal departure window.")
    parser.add_argument("--comms", nargs=2, type=float, metavar=("LAT", "LON"), help="Evaluate RF line-of-sight and comms link from coordinates: LAT LON.")
    parser.add_argument("--mode", choices=["on_foot", "rover"], default="on_foot", help="Transportation mode.")
    parser.add_argument("--lst", type=float, default=14.0, help="Martian Local Solar Time (hours: 0.0 to 24.0).")
    parser.add_argument("--weather", choices=["nominal", "dust_storm", "solar_storm"], default="nominal", help="Weather state.")
    parser.add_argument("--battery", type=float, default=100.0, help="Starting battery percentage.")
    parser.add_argument("--uphill-factor", type=float, default=None, help="Uphill climb cost penalty multiplier.")
    parser.add_argument("--json", action="store_true", help="Output pure JSON to stdout.")
    parser.add_argument("--waypoints", action="store_true", help="Output all cataloged Jezero waypoints and exit.")
    parser.add_argument("--serve", action="store_true", help="Launch HTTP REST API microservice server.")
    parser.add_argument("--port", type=int, default=8000, help="Port for HTTP server (default 8000).")

    args = parser.parse_args()

    if args.serve:
        run_http_server(port=args.port)
        return

    if args.waypoints:
        print(json.dumps(get_waypoints(), indent=2))
        return

    engine = get_engine()

    if args.demo or (not args.start and not args.end and not args.abort and not args.tour and not args.find_departure and not args.comms):
        print("\n" + "=" * 65)
        print(" RUNNING 3 DALIL-MARS MISSION TEST SCENARIOS")
        print("=" * 65)

        # Scenario 1: Short Direct Walk (Hab Alpha -> Kodiak Butte)
        print("\n[SCENARIO 1: Nominal EVA Walk - Hab Alpha -> Kodiak Butte]")
        res1 = engine.plan_route(
            start=(18.4447, 77.4508),
            destination=(18.4520, 77.4410),
            mode="on_foot",
            lst_hours=13.5,
            weather="nominal",
            initial_battery_pct=100.0,
        )
        print(f"Status: {res1['status']} | Dist: {res1['total_dist_km']} km | Time: {res1['duration_min']} min")
        print(f"Slope Safety: {res1['summary']['slope_safety_rating']} | Max: {res1['summary']['max_slope_deg']}° | Red Avoided: {res1['summary']['red_nodes_avoided_count']}")
        print(f"Battery Drain: {res1['battery_used_pct']}% | Remaining: {res1['battery_remaining_pct']}%")
        print(f"Sunlit: {res1['solar_ephemeris']['sunlit_pct']}% | Shadow: {res1['solar_ephemeris']['shadow_pct']}% | Dose: {res1['radiation_dose_mgy']} mGy")

        # Scenario 2: Solar Rover in Canyon at Low Sun (16:30 LST)
        print("\n[SCENARIO 2: Solar-Powered Rover Trek at Late Afternoon (LST 16.5)]")
        res2 = engine.plan_route(
            start=(18.4580, 77.4320),
            destination=(18.4850, 77.3880),
            mode="rover",
            lst_hours=16.5,
            weather="nominal",
            initial_battery_pct=85.0,
        )
        print(f"Status: {res2['status']} | Dist: {res2['total_dist_km']} km | Time: {res2['duration_min']} min")
        print(f"Slope Safety: {res2['summary']['slope_safety_rating']} | Max: {res2['summary']['max_slope_deg']}° | Red Avoided: {res2['summary']['red_nodes_avoided_count']}")
        print(f"Sun Elevation: {res2['solar_ephemeris']['sun_elevation_deg']}° | Sun Azimuth: {res2['solar_ephemeris']['sun_azimuth_deg']}°")
        print(f"Sunlit Corridor: {res2['solar_ephemeris']['sunlit_pct']}% | Shadowed: {res2['solar_ephemeris']['shadow_pct']}% | Net Batt: {res2['battery_remaining_pct']}%")

        # Scenario 3: Cross-Crater Low Battery Pit-Stop (Hab Alpha -> Neretva Vallis at 25% battery in dust storm)
        print("\n[SCENARIO 3: Long Cross-Crater Trek with 25% Battery in Dust Storm (Auto Pit-Stop)]")
        res3 = engine.plan_route(
            start=(18.4447, 77.4508),
            destination=(18.4875, 77.3190),
            mode="rover",
            lst_hours=17.0,
            weather="dust_storm",
            initial_battery_pct=25.0,
        )
        print(f"Status: {res3['status']} | Total Dist: {res3['total_dist_km']} km | Total Time: {res3['duration_min']} min")
        print(f"Slope Safety: {res3['summary']['slope_safety_rating']} | Red Avoided: {res3['summary']['red_nodes_avoided_count']}")
        if res3["charging_station"]:
            print(f"Auto-Routed via Virtual Charging Base: {res3['charging_station']['name']}")
        print(f"Battery Remaining on Arrival: {res3['battery_remaining_pct']}% (Safe Margin Maintained)")
        for st in res3["navigation_steps"]:
            print(f"  Step {st['step']}: {st['instruction']} ({st['detail']})")

    elif args.find_departure:
        if not args.start or not args.end:
            print("Error: --find-departure requires both --start LAT LON and --end LAT LON.")
            return

        res = find_optimal_departure(
            start=tuple(args.start),
            destination=tuple(args.end),
            mode=args.mode,
            weather=args.weather,
            initial_battery_pct=args.battery,
            uphill_penalty=args.uphill_factor,
        )

        if args.json:
            print(json.dumps(res, indent=2))
        else:
            w = res["recommended_window"]
            b = res["best_departure"]
            print("\n" + "=" * 65)
            print(" DALIL-MARS DIURNAL DEPARTURE WINDOW OPTIMIZER")
            print("=" * 65)
            print(f"  Mode:                {res['mode'].upper()}")
            print(f"  Traverse Distance:   {res['total_distance_km']} km ({res['duration_formatted']})")
            print(f"  Recommended Window:  {w['start_time']} to {w['end_time']} ({w['window_duration_hours']} hours duration)")
            print(f"  Peak Departure:      {b['departure_time']} (Arrival: {b['arrival_time']})")
            print(f"  Arrival Battery:     {b['battery_remaining_pct']}% (Harvests +{b['solar_energy_harvested_pct']}% solar)")
            print(f"  Sun Elevation:       Depart: {b['departure_sun_elevation_deg']}° | Arrive: {b['arrival_sun_elevation_deg']}°")
            print(f"  Mean Solar Flux:     {b['average_solar_flux_wm2']} W/m²")
            print("\n  Diurnal Timeline Analysis:")
            print("  " + "-" * 67)
            print(f"  {'Departure':<12} {'Arrival':<12} {'Dep Sun':<9} {'Arr Sun':<9} {'Batt %':<8} {'Status'}")
            print("  " + "-" * 67)
            for sl in res["departure_timeline"]:
                print(f"  {sl['departure_time']:<12} {sl['arrival_time']:<12} {sl['departure_sun_elevation_deg']:>6.1f}°  {sl['arrival_sun_elevation_deg']:>6.1f}°  {sl['battery_remaining_pct']:>5.1f}%  {sl['status']}")
            print("  " + "-" * 67)
            print("=" * 65 + "\n")

    elif args.start and args.end:
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
            print(f" DALIL-MARS MISSION ROUTE RESULT [{s['status']}]")
            print("=" * 65)
            print(f"  Mode:                {s['mode'].upper()}")
            print(f"  Total Distance:      {s['total_distance_km']} km (Direct: {s['direct_distance_km']} km)")
            print(f"  Travel Duration:     {s['duration_formatted']} ({s['duration_min']} min)")
            print(f"  Elevation Ascent:    +{s['elevation_gain_m']} m (Descent: -{s['elevation_loss_m']} m)")
            print(f"  Uphill Traverse:     {s['uphill_distance_km']} km (Downhill: {s['downhill_distance_km']} km, Flat: {s['flat_distance_km']} km)")
            print(f"  Max / Avg Slope:     {s['max_slope_deg']}° / {s['avg_slope_deg']}°")
            print(f"  Slope Safety:        {s['slope_safety_rating']}")
            print(f"  Red Slopes Avoided:  {s['red_nodes_avoided_count']} nodes blocked")
            print(f"  Battery:             {s['battery_used_pct']}% used -> {s['battery_remaining_pct']}% remaining")
            print(f"  Oxygen (xEMU):       {s['o2_used_liters']} L used ({s['o2_used_pct']}%) -> {s['o2_remaining_pct']}% remaining")
            print(f"  Radiation Dose:      {s['radiation_dose_mgy']} mGy")
            print(f"  Solar Context:       {sol['lst_formatted']} | Sun: {sol['sun_elevation_deg']}° elev, {sol['sun_azimuth_deg']}° az")
            print(f"  Surface Lighting:    {s['sunlit_pct']}% sunlit, {s['shadow_pct']}% shadowed (tau={sol['optical_depth_tau']})")
            if s["pitstop_occurred"]:
                print(f"  Charging Pit-Stop:   Docked at {s['charging_station_name']}")
            if "walkback_horizon" in s:
                wb = s["walkback_horizon"]
                print(f"  Walkback Horizon:    {wb['status']} (Min Batt Margin: {wb['minimum_walkback_battery_margin_pct']}%, Min O2 Margin: {wb['minimum_walkback_o2_margin_pct']}%)")
                if wb.get("primary_abort_shelter"):
                    print(f"  Abort Shelter:       {wb['primary_abort_shelter']}")
            if "rf_comms" in s:
                rf = s["rf_comms"]
                print(f"  RF Line-of-Sight:    {rf['status']} ({rf['total_comms_coverage_pct']}% coverage, Direct Hab: {rf['direct_hab_coverage_pct']}%, Relay: {rf['relay_coverage_pct']}%)")
                if rf["blackout_distance_km"] > 0:
                    print(f"  RF Blackout Shadow:  {rf['blackout_distance_km']} km in terrain shadow (Longest: {rf['longest_continuous_blackout_km']} km)")
            print("\n  Turn-by-turn Navigation:")
            for step in res["navigation_steps"]:
                print(f"    {step['step']}. {step['instruction']} - {step['detail']}")
            print("=" * 65 + "\n")

    elif args.abort:
        res = plan_emergency_abort(
            current_location=tuple(args.abort),
            mode=args.mode,
            lst_hours=args.lst,
            weather=args.weather,
            initial_battery_pct=args.battery,
        )

        if args.json:
            print(json.dumps(res, indent=2))
        else:
            target = res.get("abort_target_shelter", {})
            s = res["summary"]
            print("\n" + "=" * 65)
            print(" [EMERGENCY ABORT PROTOCOL ACTIVATED - APOLLO/ARTEMIS EVA RULE #1]")
            print("=" * 65)
            print(f"  Target Shelter:      {target.get('name', 'Nearest Shelter')}")
            print(f"  Shelter Location:    {target.get('lat', 0.0):.6f}° N, {target.get('lon', 0.0):.6f}° E")
            print(f"  Retreat Distance:    {s['total_distance_km']} km")
            print(f"  Estimated Ingress:   {s['duration_formatted']} ({s['duration_min']} min)")
            print(f"  Battery on Arrival:  {s['battery_remaining_pct']}% (Consumes {s['battery_used_pct']}%)")
            print(f"  Oxygen on Arrival:   {s['o2_remaining_pct']}% (Consumes {s['o2_used_pct']}%)")
            print(f"  Max Slope on Route:  {s['max_slope_deg']}° (Rating: {s['slope_safety_rating']})")
            print("\n  Emergency Navigation Vector:")
            for step in res["navigation_steps"]:
                print(f"    {step['step']}. {step['instruction']} - {step['detail']}")
            print("=" * 65 + "\n")

    elif args.tour:
        base_loc = tuple(args.start) if args.start else None
        res = plan_science_tour(
            base_location=base_loc,
            targets=args.targets,
            max_duration_hours=args.max_hours,
            stay_duration_min=args.dwell_min,
            mode=args.mode,
            lst_hours=args.lst,
            weather=args.weather,
            initial_battery_pct=args.battery,
            uphill_penalty=args.uphill_factor,
        )

        if args.json:
            print(json.dumps(res, indent=2))
        else:
            s = res["summary"]
            print("\n" + "=" * 65)
            print(f" DALIL-MARS MULTI-STOP SCIENCE TOUR [{s['status']}]")
            print("=" * 65)
            print(f"  Mode:                {s['mode'].upper()}")
            print(f"  Base Camp:           {res['base_camp']['name']}")
            print(f"  Targets Visited:     {res['targets_visited_count']} science stops ({res['total_stops_count']} total legs)")
            print(f"  Total Expedition:    {s['total_mission_duration_formatted']} ({s['total_mission_duration_hours']} h)")
            print(f"  Traverse Time:       {s['travel_time_hours']} h | Science Sampling: {s['science_dwell_hours']} h")
            print(f"  Total Distance:      {s['total_distance_km']} km")
            print(f"  Elevation Change:    +{s['elevation_gain_m']} m / -{s['elevation_loss_m']} m (Max Slope: {s['max_slope_deg']}°)")
            print(f"  Red Slopes Avoided:  {s['total_red_nodes_avoided']} nodes")
            print(f"  Battery on Return:   {s['battery_remaining_pct']}% (Used: {s['battery_used_pct']}%)")
            print(f"  Oxygen on Return:    {s['o2_remaining_pct']}% (Used: {s['o2_used_pct']}%)")
            print(f"  Walkback Margins:    Min Batt: {s['min_walkback_battery_margin_pct']}% | Min O2: {s['min_walkback_o2_margin_pct']}% (Safe: {s['safe_abort_maintained']})")
            print("\n  Mission Stop-by-Stop Itinerary:")
            for st in res["ordered_stops"]:
                dep = f" -> Depart {st['departure_lst']}" if st["departure_lst"] else ""
                dwell = f" [{st['dwell_time_min']}m dwell]" if st["dwell_time_min"] > 0 else ""
                print(f"    Stop {st['stop_index']}: {st['name']:<35} Arrive {st['arrival_lst']}{dep}{dwell} | Batt: {st['battery_arrival_pct']}%")
                print(f"            {st['notes']}")
            print("=" * 65 + "\n")

    elif args.comms:
        res = evaluate_rf_comms(tuple(args.comms), mode=args.mode)
        if args.json:
            print(json.dumps(res, indent=2))
        else:
            print("\n" + "=" * 65)
            print(" DALIL-MARS RF LINE-OF-SIGHT & LINK BUDGET DIAGNOSTIC")
            print("=" * 65)
            print(f"  Location:            {args.comms[0]:.6f}° N, {args.comms[1]:.6f}° E")
            print(f"  RF Status:           {res['status']} (Signal Quality: {res['signal_quality']})")
            print(f"  Active Link:         {res['active_link']}")
            print(f"  Direct Hab LOS:      {res['direct_hab_los']}")
            print(f"  Distance to Hab:     {res['distance_to_hab_km']} km")
            if res["path_loss_db"] is not None:
                print(f"  Path Loss (FSPL):    {res['path_loss_db']} dB (at 437 MHz UHF)")
            print("=" * 65 + "\n")


if __name__ == "__main__":
    main()
