# Dalil-Mars Tactical Pathfinding Engine
## Complete Engineering Manual & System Integration Guide

> **Document ID:** `NASA-SPACEAPPS-2026-DALIL-ENG-001`  
> **Target Environment:** Jezero Crater, Mars ($18.38^\circ\text{ N} - 18.58^\circ\text{ N}, \; 77.20^\circ\text{ E} - 77.48^\circ\text{ E}$)  
> **Source File:** [`engine.py`](file:///home/joe/Development/nasa-space-apps-2026/dalil-mars/engine.py)  
> **Status:** Production Release (`engine` branch)  

---

## Table of Contents
1. [System Overview & Architecture](#1-system-overview--architecture)
2. [Coordinate Systems & Geodesy](#2-coordinate-systems--geodesy)
3. [Terrain Data Pipeline & Precomputed Matrices](#3-terrain-data-pipeline--precomputed-matrices)
4. [Core Pathfinding & Physics Models](#4-core-pathfinding--physics-models)
   - [4.1 Hierarchical Corridor A* (HC-A*) & Obstacle-Aware Heuristics](#41-hierarchical-corridor-a-hc-a--obstacle-aware-heuristics)
   - [4.2 Strict Red Node & Slope Hazard Avoidance](#42-strict-red-node--slope-hazard-avoidance)
   - [4.3 Asymmetric Gravitational Climb Penalty](#43-asymmetric-gravitational-climb-penalty)
   - [4.4 Diurnal Solar Ephemeris & Ray-Marching Topographic Shadows](#44-diurnal-solar-ephemeris--ray-marching-topographic-shadows)
   - [4.5 Life-Support & Power Equilibrium Physics](#45-life-support--power-equilibrium-physics)
5. [Advanced Mission Planning Subsystems](#5-advanced-mission-planning-subsystems)
   - [5.1 Walkback Horizon & Point of No Return (Apollo/Artemis Rule #1)](#51-walkback-horizon--point-of-no-return-apolloartemis-rule-1)
   - [5.2 Multi-Stop Science Tour Optimizer (Budgeted Orienteering / TSP)](#52-multi-stop-science-tour-optimizer-budgeted-orienteering--tsp)
   - [5.3 Diurnal Departure Window Optimizer](#53-diurnal-departure-window-optimizer)
   - [5.4 RF Line-of-Sight Comms Shadow Mapping](#54-rf-line-of-sight-comms-shadow-mapping)
6. [Programmatic Integration Guide (Python Library)](#6-programmatic-integration-guide-python-library)
7. [System Integration Patterns (Robotics, Autonomous Navigation & Mission Backends)](#7-system-integration-patterns-robotics-autonomous-navigation--mission-backends)
8. [Full Python Library API & Type Signatures Reference](#8-full-python-library-api--type-signatures-reference)
9. [Telemetry & GeoJSON Output Schemas](#9-telemetry--geojson-output-schemas)
10. [Performance Benchmarks & Memory Footprint](#10-performance-benchmarks--memory-footprint)
11. [Troubleshooting & Diagnostics](#11-troubleshooting--diagnostics)

---

## 1. System Overview & Architecture

The **Dalil-Mars Tactical Pathfinding Engine** is an autonomous surface mission planner and survival routing engine engineered for crewed (xEMU EVA suits) and robotic (solar/battery rovers) exploration across **Jezero Crater, Mars**.

Unlike generic pathfinders that treat terrain as an abstract cost grid, Dalil-Mars models real physical laws:
1. **Mars Gravity ($3.72\text{ m/s}^2$):** Directed gravitational work penalties on ascents.
2. **Terramechanics & Human Biomechanics:** Strict red slope cutoffs ($18^\circ$ on-foot, $21^\circ$ rover) and $2.5\times$ penalties on yellow caution grades.
3. **Orbital & Topographic Illumination:** Dynamic solar position calculation and ray-marched terrain shadows on a 20.2m Digital Terrain Model (DTM).
4. **Life Support & Energy Reserves:** Active oxygen consumption, solar power generation, battery drain, thermal heater loads, and cosmic/solar radiation dosimetry.
5. **Survival Guarantees:** Continuous Apollo/Artemis Rule #1 walkback point-of-no-return tracking and UHF radio line-of-sight comms shadow mapping.

```
+-----------------------------------------------------------------------------------+
|                           Dalil-Mars Tactical Engine                              |
|                                  (engine.py)                                      |
+-----------------------------------------------------------------------------------+
|  1. Geodesy & Coordinate Transformations (Areocentric Lat/Lon <-> Fine Grid)      |
|  2. Solar Physics (Allison-McEwen Solar Ephemeris & Ray-Marching Shadow Casting)   |
|  3. Comms Physics (437 MHz UHF Ray-Marched LOS & FSPL Path Loss Engine)           |
|  4. Mobility Profiles (xEMU EVA suit metabolic work & Rocker-bogie power balance)  |
|  5. Hierarchical Corridor A* (Coarse Dijkstra Matrix + Euclidean Fine Gradient)   |
|  6. Walkback Horizon Monitor (Instantaneous O(1) shelter abort margin tracking)   |
|  7. Multi-Stop Science Tour Optimizer (Branch-and-Bound Orienteering Solver)      |
|  8. Diurnal Departure Optimizer (24-step solar insolation & thermal sweep)        |
+-----------------------------------------------------------------------------------+
                                         |
                                         v
                      [ Pure Python Library API: import engine ]
    +-------------------------------------------------------------------------+
    | • plan_route()                   • predict() (Field Telemetry)          |
    | • plan_emergency_abort()         • plan_science_tour()                  |
    | • find_optimal_departure()       • evaluate_rf_comms()                  |
    | • get_waypoints() / get_weather()• get_charging_stations()              |
    +-------------------------------------------------------------------------+
                                         |
         +-------------------------------+-------------------------------+
         |                               |                               |
         v                               v                               v
[ Astronaut Field Computer / HUD ] [ Autonomous Rover (Nav2) ] [ Mission Control Backend ]
```

---

## 2. Coordinate Systems & Geodesy

The engine converts between planetary geographic coordinates and raster grid space using equirectangular projection centered on the Martian datum:

### Physical Constants
- **Martian Volumetric Mean Radius ($R_{\text{mars}}$):** $3,396,190.0\text{ m}$
- **Martian Standard Gravity ($g_{\text{mars}}$):** $3.72076\text{ m/s}^2$
- **Jezero Crater Centroid:** $18.45^\circ\text{ N}, \; 77.40^\circ\text{ E}$

### Coordinate Transformation Equations

$$\text{Projected } X = R_{\text{mars}} \cdot \text{radians}(\text{lon} - 180.0)$$
$$\text{Projected } Y = R_{\text{mars}} \cdot \text{radians}(\text{lat})$$

$$\text{Fine Grid Column } c = \text{round}\left(\frac{X - X_{\text{origin}}}{\text{pixel\_res}}\right)$$
$$\text{Fine Grid Row } r = \text{round}\left(\frac{Y_{\text{origin}} - Y}{\text{pixel\_res}}\right)$$

Where:
- $\text{pixel\_res} = 20.246876426477038\text{ m/pixel}$
- $X_{\text{origin}} = -6,076,826.685\text{ m}$
- $Y_{\text{origin}} = 1,114,845.547\text{ m}$
- Fine grid dimensions: $6,560\text{ rows} \times 2,950\text{ cols}$ ($19,352,000$ spatial cells)

### Python Coordinate Helper API
```python
import engine

eng = engine.get_engine()

# Lat/Lon to Grid
row, col = eng.latlon_to_grid(18.444627, 77.450886)
print(f"Hab Alpha Grid: row={row}, col={col}") # row=2567, col=1921

# Grid to Lat/Lon
lat, lon = eng.grid_to_latlon(2567, 1921)
print(f"Lat/Lon: {lat:.6f}, {lon:.6f}")
```

---

## 3. Terrain Data Pipeline & Precomputed Matrices

Dalil-Mars loads preprocessed matrices produced by the 6-stage consolidated pipeline (`./preprocess 1` through `6`):

| Pipeline Stage | Output Artifact | Dimensions | Data Type | Engineering Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Stage 1** | `consolidated_dtm_mosaic.tif` | $6560 \times 2950$ | Float32 | Baseline elevation surface ($Z \in [-2750\text{m}, -2100\text{m}]$). |
| **Stage 2** | `consolidated_slope_angles_deg.npy` | $6560 \times 2950$ | Float32 | Topographic slope gradients in degrees. |
| **Stage 4** | `consolidated_preprocessed_master_grid.npy` | $6560 \times 2950$ | Float32 | Calibrated base traversal friction cost. |
| **Stage 5** | Coarse Downsampled Grid ($M=64$) | $102 \times 46$ | Float32 | Macro-cell clustering ($1.29\text{ km}$ macro resolution). |
| **Stage 6** | `consolidated_all_pairs_4d_matrix.npy` | $102 \times 46 \times 102 \times 46$ | Float32 | **Obstacle-aware Dijkstra distance matrix** between all macro-cells ($22\text{ MB}$). |

### Macro-Cell Index Mapping
Each macro-cell $(I, J)$ groups a block of $64 \times 64$ fine pixels ($1,295.8\text{ m} \times 1,295.8\text{ m}$):
$$I = \min\left(\max\left(0, \lfloor r / 64 \rfloor\right), \; 101\right), \quad J = \min\left(\max\left(0, \lfloor c / 64 \rfloor\right), \; 45\right)$$

A distance query between any two cells $(I_1, J_1)$ and $(I_2, J_2)$ executes via direct array indexing in **$\sim 1\text{ \mu s}$**:
$$D_{\text{obstacle}}(I_1, J_1, I_2, J_2) = \text{all\_pairs\_4d}[I_1, J_1, I_2, J_2]$$

---

## 4. Core Pathfinding & Physics Models

### 4.1 Hierarchical Corridor A* (HC-A*) & Obstacle-Aware Heuristics

Traditional A* on a $19.35\text{M}$ node grid is too slow for real-time mission aborts. HC-A* solves this in two layers:

1. **Macro Corridor Bounding:**  
   The start $(I_1, J_1)$ and goal $(I_2, J_2)$ define a coarse bounding corridor padded by an adaptive safety buffer:
   $$R_{\text{min}} = \max(0, \min(I_1, I_2) - \text{pad}) \cdot 64$$
   $$R_{\text{max}} = \min(H, (\max(I_1, I_2) + \text{pad} + 1) \cdot 64)$$
   This shrinks the search space from $19.35\text{M}$ nodes to $< 250\text{k}$ nodes without cutting off alternate obstacle bypasses.

2. **Dominating Admissible Combined Heuristic:**  
   Standard Euclidean distance $h_{\text{euc}}(u)$ does not know that a cliff or crater rim is in between. Dalil-Mars defines:
   $$h_{\text{dalil}}(u) = \max\left(h_{\text{macro\_obstacle}}(u), \; h_{\text{fine\_euc}}(u)\right)$$
   
   - When far from the target or navigating around crater rims, $h_{\text{macro\_obstacle}}$ bends the search around the barrier.
   - When close to the target, $h_{\text{fine\_euc}}$ provides a smooth pixel-level gradient down to $0\text{ m}$.
   - **Mathematical Admissibility:** Since both $h_{\text{macro}} \le h^*$ and $h_{\text{euc}} \le h^*$, $\max(h_{\text{macro}}, h_{\text{euc}}) \le h^*$. Admissibility is strictly preserved ($h \le h^*$), guaranteeing the path is **globally optimal**.

```
Algorithm Flow:
1. (r1, c1), (r2, c2) -> Compute Macro Cells (I1, J1), (I2, J2)
2. Extract sub-grid corridor from Master Grid and Slope Matrix
3. Initialize PriorityQueue with start node (f = g + h)
4. While queue not empty:
     pop node u with lowest f(u)
     if u == goal: reconstruct path and break
     for each 8-neighbor v of u:
       slope = SlopeMatrix[v]
       if slope > ModeMaxSlope: continue  # Strict Red Node Avoidance
       cost = step_dist * MasterGrid[v] * GravityClimbPenalty(u, v)
       if g[u] + cost < g[v]:
         g[v] = g[u] + cost
         h[v] = max(all_pairs_4d[Iv, Jv, Igoal, Jgoal] - IntraCellBound, Euclidean(v, goal))
         f[v] = g[v] + h[v]
         push v to queue
```

---

### 4.2 Strict Red Node & Slope Hazard Avoidance

Each transportation mode enforces strict physical tilt thresholds based on NASA operational vehicle and suit specs:

| Mode | ID | Max Slope $\theta_{\text{max}}$ (Red Cutoff) | Caution Zone (Yellow Grade) | Safe Zone (Green Grade) | Physical Limiting Factor |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Astronaut EVA** | `on_foot` | **$18.0^\circ$** | $15.0^\circ - 18.0^\circ$ ($2.5\times$ penalty) | $< 15.0^\circ$ ($1.0\times$) | Suit joint stiffness, glove puncture risk, center of mass rollover. |
| **Solar Rover** | `rover` | **$21.0^\circ$** | $15.0^\circ - 21.0^\circ$ ($2.5\times$ penalty) | $< 15.0^\circ$ ($1.0\times$) | Rocker-bogie terramechanics, wheel slip, shear failure in regolith. |

```
Slope Angle:
 0° ---------------- 15° --------------------- 18° ---------- 21° ----------> 90°
[    Safe (Green)   ] [   Caution (Yellow)    ] [ Red (Suit) ] [ Red (Rover)  ]
  Multiplier: 1.0       Multiplier: 2.5           BLOCKED        BLOCKED
```

Any node with $\theta > \theta_{\text{max}}$ is treated as an impassable barrier ($\text{cost} = \infty$). The A* search is physically incapable of expanding through red nodes.

---

### 4.3 Asymmetric Gravitational Climb Penalty

Climbing uphill performs mechanical work against gravity ($g_{\text{mars}} = 3.72\text{ m/s}^2$). Flat and downhill traversals incur zero climb penalty.

$$c(u, v) = c_{\text{base}}(u, v) \cdot \left[1.0 + k_{\text{climb}} \cdot \max\left(0, \; \frac{Z_v - Z_u}{\Delta s}\right)\right]$$

Where:
- $k_{\text{climb}} = 3.0$ for `on_foot` EVA suits
- $k_{\text{climb}} = 2.2$ for `rover`
- $\Delta s$ is the 3D step displacement in meters

#### Metabolic $O_2$ Rate (Astronaut EVA)
$$\dot{V}_{O_2} = \dot{V}_{\text{base}} \cdot \left(1.0 + 0.05 \cdot \theta\right) + \frac{M_{\text{total}} \cdot g_{\text{mars}} \cdot \max(0, \Delta z)}{\eta_{\text{metabolic}} \cdot 20,100\text{ J/L}}$$

#### Mechanical Energy (Rover)
$$E_{\text{climb}} = \frac{M_{\text{rover}} \cdot g_{\text{mars}} \cdot \max(0, \Delta z)}{\eta_{\text{drivetrain}} \cdot 3.6 \times 10^6\text{ J/kWh}}$$

---

### 4.4 Diurnal Solar Ephemeris & Ray-Marching Topographic Shadows

#### Solar Ephemeris (Allison-McEwen Martian Model)
Given Local Solar Time (`lst_hours` $\in [0, 24]$) and Jezero latitude $\phi = 18.45^\circ\text{ N}$:
1. **Hour Angle ($H$):** $H = \text{radians}((LST - 12.0) \cdot 15^\circ)$
2. **Solar Declination ($\delta$):** $\delta \approx 25.19^\circ \cdot \sin(L_s)$ (seasonal solar longitude)
3. **Sun Elevation Angle ($\alpha_{\text{sun}}$):**
   $$\sin(\alpha_{\text{sun}}) = \sin\phi \sin\delta + \cos\phi \cos\delta \cos H$$
4. **Sun Azimuth Angle ($\theta_{\text{az}}$):**
   $$\tan(\theta_{\text{az}}) = \frac{-\cos\delta \sin H}{\sin\alpha_{\text{sun}} \sin\phi - \sin\delta}$$

#### Ray-Marching Topographic Shadows
To determine whether coordinate $(r_0, c_0, z_0)$ is illuminated or occluded by crater cliffs:
1. Compute ray march unit vector:
   $$\Delta r = -\cos(\theta_{\text{az}}), \quad \Delta c = \sin(\theta_{\text{az}}), \quad \text{threshold} = \tan(\alpha_{\text{sun}})$$
2. Step along ray: $(r_k, c_k) = (r_0 + k \Delta r, \; c_0 + k \Delta c)$ for $k = 2, 4, 6, \dots, 60$ pixels.
3. If $\frac{Z(r_k, c_k) - z_0}{k \cdot \text{pixel\_res}} > \tan(\alpha_{\text{sun}})$, point $(r_0, c_0)$ is in deep shadow.

#### Beer-Lambert Optical Depth Dust Extinction
Direct solar irradiance reaching the rover panel:
$$I_{\text{direct}} = I_0 \cdot \sin(\alpha_{\text{sun}}) \cdot \exp\left(-\frac{\tau}{\sin\alpha_{\text{sun}} + 0.05}\right)$$
Where $I_0 = 590.0\text{ W/m}^2$ and $\tau \in [0.45\text{ (nominal)}, 3.8\text{ (dust storm)}]$.

---

### 4.5 Life-Support & Power Equilibrium Physics

#### Rover Dual-Source Power Equilibrium
$$\Delta \text{Battery} = -E_{\text{drive}}(\Delta s) + E_{\text{solar}}(\Delta t) - E_{\text{heater}}(\Delta t)$$
- **Solar Harvest:** $E_{\text{solar}} = I_{\text{direct}} \cdot A_{\text{panel}} \cdot \eta_{\text{panel}} \cdot \Delta t$ ($A_{\text{panel}} = 2.8\text{ m}^2$, $\eta = 28\%$)
- **Thermal Heaters:** Low sun ($\alpha_{\text{sun}} < 10^\circ$) or deep shadow activates survival heaters ($2.5\% / \text{hour}$).

#### Radiation Dosimetry
Tracks cumulative ionizing radiation dosage along the path:
- **Galactic Cosmic Radiation (GCR) Baseline:** $0.011\text{ mGy/h}$
- **Solar Particle Event (SPE) Storm:** $0.850\text{ mGy/h}$ (automated emergency shelter divert)

---

## 5. Advanced Mission Planning Subsystems

### 5.1 Walkback Horizon & Point of No Return (Apollo/Artemis Rule #1)

The #1 safety rule of lunar and planetary surface EVA is: **Never walk further from a pressurized shelter than your remaining life support can walk you back.**

```
Hab Alpha (0 km) ======= safe walkback =======> [ PNR Mark ] --- UNAUTHORIZED ZONE ---> Destination
                                                   |
                     Remaining Battery = 15% + Abort Cost
                     Remaining O2      = 15% + Abort Cost
```

#### How it works:
1. For every sample step along the planned route, the engine computes in $O(1)$ via the Stage 6 matrix the obstacle-free retreat distance to all 4 Jezero shelters:
   - `Hab Alpha (Octavia E. Butler Landing)`: Base Camp ($18.444627^\circ\text{ N}, 77.450886^\circ\text{ E}$)
   - `Delta Front Solar Waystation`: Western delta base ($18.458500^\circ\text{ N}, 77.411000^\circ\text{ E}$)
   - `Belva Ridge Power & O2 Relay`: Mid-crater relay pod ($18.479500^\circ\text{ N}, 77.352000^\circ\text{ E}$)
   - `Jezero Western Rim (Lookout Ridge)`: High-elevation shelter ($18.435594^\circ\text{ N}, 77.233223^\circ\text{ E}$)
2. Evaluates the abort battery cost and oxygen cost from that position to the shelter.
3. If:
   $$\text{Current Battery} - \text{Abort Battery Cost} < 15.0\% \quad \text{or} \quad \text{Current } O_2 - \text{Abort } O_2 \text{ Cost} < 15.0\%$$
   The engine flags `POINT_OF_NO_RETURN_EXCEEDED` and identifies the exact kilometer mark.
4. **Emergency Abort Planning (`plan_emergency_abort`):** Immediately calculates a direct, safe escape corridor to the nearest survivable shelter with turn-by-turn vectors.

---

### 5.2 Multi-Stop Science Tour Optimizer (Budgeted Orienteering / TSP)

Solves the **Martian Orienteering Problem / Prize-Collecting TSP**: Given a base camp and candidate science landmarks, find the optimal subset and order of stops to visit that maximizes science return while guaranteeing return to base within a strict time budget.

#### How it works:
1. Resolves candidate Jezero science POIs (e.g. `Séítah`, `Three Forks`, `Kodiak Delta`, `Hawksbill Gap`, `Belva Crater`).
2. Extracts pairwise distance matrix $D_{ij}$ in $< 0.1\text{ ms}$ using the Stage 6 precomputed matrix.
3. Solves the combinatorial TSP / subset optimization using depth-first branch-and-bound ($< 3\text{ ms}$).
4. Stitches actual fine A* legs into a single continuous mission with arrival LST, dwell time ($25\text{ min/stop}$), and departure LST.

---

### 5.3 Diurnal Departure Window Optimizer

Rovers cannot depart at arbitrary times. Leaving too late traps the vehicle in sub-zero shadows after sunset; leaving too early pays heavy heater penalties in freezing dawn twilight.

#### How it works:
1. Samples candidate departure times from $07:00$ to $16:30$ LST in 30-minute increments.
2. For each candidate departure $T_0$, simulates progressive ingress along the route:
   - Sun elevation at departure ($E_{\text{dep}}$) and arrival ($E_{\text{arr}}$)
   - Integrated solar flux and net battery on arrival
3. Automatically classifies each window:
   - `OPTIMAL`: High sun elevation ($E \ge 15^\circ$), $>90\%$ sunlit corridor, $\ge 88\%$ arrival battery.
   - `ACCEPTABLE`: Full daylight maintained ($E \ge 10^\circ$).
   - `TWILIGHT_RISK`: Arrival sun elevation $< 8^\circ$.
   - `NIGHT_TRAP`: Sun drops below the horizon before arrival ($E_{\text{arr}} \le 0^\circ$).
4. Identifies the peak departure time and recommended window span.

---

### 5.4 RF Line-of-Sight Comms Shadow Mapping

UHF radio signals ($437\text{ MHz}$) from Hab Alpha's 40m mast cannot bend around crater rims. Dalil-Mars models real RF visibility across the 20.2m DTM topography:

```
Hab Alpha Mast (40m)
      |
      * \
         \ Direct LOS (Clear)
          \
           v Rover (Séítah Floor)
              |
              |==== Crater Rim Ridge ==== (Occlusion)
                                        \
                                         x RF Blackout (Behind Wall)
                                         ^
                                         | Direct LOS to Relay
               Belva Ridge Relay (25m) --*
```

#### How it works:
1. Models antenna heights:
   - Hab Alpha Mast: $+40.0\text{ m}$
   - Regional Relays (`Delta Front`, `Belva Ridge`): $+25.0\text{ m}$
   - Rover Antenna: $+2.0\text{ m}$ (EVA Suit: $+1.8\text{ m}$)
2. Ray-marches line-of-sight across the 20m DTM elevation matrix ($< 8\text{ ms}$ for 200 telemetry points).
3. If direct line-of-sight to Hab Alpha is blocked, automatically checks secondary relay masts.
4. Computes Free-Space Path Loss ($FSPL$ in dB):
   $$\text{FSPL} = 20\log_{10}(d_{\text{km}}) + 20\log_{10}(f_{\text{mhz}}) + 32.44$$
5. Classifies every telemetry point into `DIRECT_HAB_LOS`, `RELAY_CONNECTED`, or `RF_BLACKOUT` and reports total comms coverage percentage and longest continuous blackout distance.

---

## 6. Programmatic Integration Guide (Python Library)

All functions are available directly from `engine.py`.

### Basic Route Planning
```python
import engine

# Plan a route from Hab Alpha to Kodiak Butte
result = engine.plan_route(
    start=(18.4447, 77.4508),
    destination=(18.4520, 77.4410),
    mode="rover",          # "on_foot" or "rover"
    lst_hours=13.5,        # 13:30 Mars Local Solar Time
    weather="nominal",     # "nominal", "dust_storm", "solar_storm"
    initial_battery_pct=100.0,
)

summary = result["summary"]
print(f"Status: {summary['status']}")
print(f"Distance: {summary['total_distance_km']} km")
print(f"Duration: {summary['duration_formatted']}")
print(f"Battery Remaining: {summary['battery_remaining_pct']}%")
print(f"Max Slope: {summary['max_slope_deg']}° (Rating: {summary['slope_safety_rating']})")
print(f"Walkback Status: {summary['walkback_horizon']['status']}")
print(f"RF Comms Coverage: {summary['rf_comms']['total_comms_coverage_pct']}%")
```

---

### Emergency Abort Planning (Rule #1)
```python
import engine

# Emergency retreat to closest shelter
abort_result = engine.plan_emergency_abort(
    current_location=(18.4580, 77.4320),
    mode="on_foot",
    initial_battery_pct=35.0,
    initial_o2_pct=40.0,
)

target = abort_result["abort_target_shelter"]
summary = abort_result["summary"]
print(f"Retreat Target: {target['name']}")
print(f"Escape Distance: {summary['total_distance_km']} km ({summary['duration_formatted']})")
print(f"Battery on Ingress: {summary['battery_remaining_pct']}%")
print(f"O2 on Ingress: {summary['o2_remaining_pct']}%")
```

---

### Multi-Stop Science Tour Planning
```python
import engine

# Plan optimal closed-loop science tour under 6.0 hours budget
tour_result = engine.plan_science_tour(
    base_location=(18.444627, 77.450886), # Hab Alpha
    targets=["Séítah Olivine Cumulate", "Kodiak Delta Remnant", "Three Forks Sample Depot"],
    max_duration_hours=6.0,
    stay_duration_min=25.0,
    mode="rover",
    lst_hours=9.0,
)

print(f"Tour Status: {tour_result['status']}")
print(f"Stops Visited: {tour_result['targets_visited_count']}")
for stop in tour_result["ordered_stops"]:
    print(f"  Stop {stop['stop_index']}: {stop['name']} | Arrive {stop['arrival_lst']} | Batt: {stop['battery_arrival_pct']}%")
```

---

### Diurnal Departure Window Optimization
```python
import engine

# Find peak solar departure window
window_result = engine.find_optimal_departure(
    start=(18.4447, 77.4508),
    destination=(18.4875, 77.3190),
    mode="rover",
    earliest_lst=7.0,
    latest_lst=16.5,
)

rec = window_result["recommended_window"]
best = window_result["best_departure"]
print(f"Recommended Window: {rec['start_time']} to {rec['end_time']}")
print(f"Peak Departure: {best['departure_time']} (Arrival: {best['arrival_time']})")
print(f"Arrival Battery: {best['battery_remaining_pct']}% (Solar Harvest: +{best['solar_energy_harvested_pct']}%)")
```

---

### RF Comms Line-of-Sight Diagnostic
```python
import engine

# Check comms status and link budget from any point
comms_result = engine.evaluate_rf_comms((18.4875, 77.3190), mode="rover")
print(f"RF Status: {comms_result['status']}")
print(f"Active Link: {comms_result['active_link']}")
print(f"Path Loss: {comms_result['path_loss_db']} dB")
print(f"Direct Hab LOS: {comms_result['direct_hab_los']}")
```

---

### Portable Field Computer: Real-Time Telemetry & State Prediction (`predict`)
Designed for an astronaut's portable field computer, chest tablet, or spacesuit visor HUD. Rather than assuming nominal 100% life-support reserves, the field application streams live sensor telemetry (battery %, O2 %, biometric heart rate, coordinates) into `engine.predict()` at periodic intervals (e.g. every 10–60 seconds). The engine dynamically predicts metabolic burn rates, slope hazards underfoot, solar/shadow status, and instantaneous Apollo/Artemis Rule #1 walkback margins:

```python
import engine

# Periodic telemetry evaluation from spacesuit hardware sensors
telemetry_step = engine.predict(
    current_location=(18.4520, 77.4410),  # Astronaut GPS coordinates
    battery=72.5,                         # Measured from suit battery BMS
    o2=68.0,                              # Measured from primary PLSS O2 tank
    destination="Kodiak Delta Remnant",   # Intended science destination (or coordinates)
    mode="on_foot",
    lst_hours=13.5,                       # Current Mars Local Solar Time
    heart_rate_bpm=105.0,                 # Suit biometric telemetry
)

print(f"Status: {telemetry_step['status']} | Alert: {telemetry_step['alert_level']}")
print(f"Action: {telemetry_step['action']}")
print(f"Dynamic O2 Burn: {telemetry_step['dynamic_consumption_rates']['o2_consumption_rate_lpm']} L/min")
print(f"Time to Empty: O2={telemetry_step['dynamic_consumption_rates']['time_to_empty_o2_min']}m | Batt={telemetry_step['dynamic_consumption_rates']['time_to_empty_battery_min']}m")
print(f"Terrain Underfoot: Slope={telemetry_step['current_telemetry']['slope_deg']}° ({telemetry_step['current_telemetry']['slope_safety_rating']})")

wb = telemetry_step["walkback_horizon"]
print(f"Rule #1 Shelter: {wb['nearest_shelter']} ({wb['shelter_distance_km']} km away, ETA {wb['shelter_eta_min']}m)")
print(f"Safe Abort Margin: O2={wb['walkback_o2_margin_pct']}% | Batt={wb['walkback_battery_margin_pct']}%")

# The complete emergency escape corridor is ALWAYS pre-computed and immediately ready:
escape = telemetry_step["emergency_abort"]
print(f"Built-In Escape Target: {escape['abort_target_shelter']['name']} ({escape['summary']['total_distance_km']} km)")
print(f"Initial Departure Vector: {escape['navigation_steps'][0]['instruction']}")
```

---

## 7. System Integration Patterns (Robotics, Autonomous Navigation & Mission Backends)

The Dalil-Mars engine is designed as an embedded, zero-overhead algorithmic library that seamlessly integrates into onboard robotic autonomy architectures, real-time safety watchdogs, and mission control planning pipelines.

### 7.1 Autonomous Surface Vehicle / Rover Integration (ROS 2 / Nav2)

In an autonomous Mars rover stack (e.g. running ROS 2 Jazzy/Humble with Nav2), `engine.py` functions as the **Global Macro-Planner**. It evaluates terrain hazards, solar insolation, and battery budgets across kilometers of terrain, passing a kinematically feasible global corridor to local motion planners (e.g., TEB Local Planner, MPPI, or DWB Controller).

```python
"""
Example ROS 2 Global Planner Action Server Integration.
Wraps engine.plan_route to generate global Nav2 Path messages with slope awareness.
"""
import engine

class MarsNav2GlobalPlanner:
    def __init__(self, mode: str = "rover", default_lst: float = 11.5):
        self.mode = mode
        self.lst = default_lst
        self.engine_status = engine.get_engine_status()
        print(f"[NAV2] Dalil-Mars Global Planner Initialized: {self.engine_status['status']}")

    def compute_plan(self, current_pose: tuple[float, float], goal_pose: tuple[float, float], battery_pct: float = 100.0) -> dict:
        """
        Calculates terrain-safe path between two geographic coordinates.
        current_pose: (lat, lon)
        goal_pose: (lat, lon)
        """
        route_plan = engine.plan_route(
            start=current_pose,
            destination=goal_pose,
            mode=self.mode,
            lst_hours=self.lst,
            initial_battery_pct=battery_pct,
            allow_charging_pitstop=True,
        )

        if route_plan["status"] == "FAILED":
            raise RuntimeError(f"Global planning failed: {route_plan.get('error', 'Unknown obstacle blockage')}")

        summary = route_plan["summary"]
        features = route_plan["geojson"]["features"]
        path_geometry = features[0]["geometry"]["coordinates"]  # [[lon, lat], ...]

        # Generate waypoint list with altitude, slope, and solar exposure
        waypoints = []
        for lon, lat in path_geometry:
            waypoints.append({
                "latitude": lat,
                "longitude": lon,
            })

        return {
            "success": True,
            "waypoints": waypoints,
            "total_distance_km": summary["total_distance_km"],
            "expected_duration_min": summary["duration_min"],
            "max_slope_deg": summary["max_slope_deg"],
            "battery_arrival_pct": summary["battery_remaining_pct"],
            "walkback_safe": summary["walkback_horizon"]["safe_horizon_maintained"],
        }
```

### 7.2 Astronaut Portable Field Computer & Crew EVA Telemetry Loop

On a human Marswalk, the engine runs directly on the astronaut's portable field computer or chest/wrist unit. Rather than assuming default life-support states, the field software receives raw sensor telemetry every 10–60 seconds, invokes `engine.predict_life_support()`, and updates the suit HUD with dynamic burn rates, terrain safety, and walkback margins. If an abort threshold is breached, the escape vector is rendered on the visor immediately:

```python
"""
Example Portable Field Computer Real-Time EVA Monitor Loop.
Runs on the astronaut's field computer / tablet / suit HUD.
Calls engine.predict_life_support() on every sensor telemetry tick.
"""
import engine

class PortableSuitComputer:
    def __init__(self, astronaut_id: str = "ASTRONAUT-1", target_site=(18.4875, 77.3190)):
        self.astronaut_id = astronaut_id
        self.target_site = target_site

    def process_sensor_packet(self, sensor_packet: dict) -> dict:
        """
        sensor_packet receives raw hardware sensor readings:
        {
            "coords": (18.4520, 77.4410),
            "battery_pct": 68.5,
            "o2_pct": 64.0,
            "heart_rate_bpm": 110.0,
            "lst_hours": 14.2,
            "weather": "nominal"
        }
        """
        # Periodic assessment without assuming any default life-support states
        assessment = engine.predict(
            current_location=sensor_packet["coords"],
            battery=sensor_packet["battery_pct"],
            o2=sensor_packet["o2_pct"],
            destination=self.target_site,
            heart_rate_bpm=sensor_packet.get("heart_rate_bpm"),
            lst_hours=sensor_packet["lst_hours"],
            weather=sensor_packet.get("weather", "nominal"),
            mode="on_foot"
        )

        # Update HUD Display
        alert = assessment["alert_level"]
        rec = assessment["tactical_recommendation"]
        rates = assessment["dynamic_consumption_rates"]
        wb = assessment["walkback_horizon"]

        print(f"[{assessment['timestamp_lst']}] HUD Status: {alert} | Action: {assessment['action']}")
        print(f"   O2 Burn: {rates['o2_consumption_rate_lpm']} L/min | TTE: {rates['time_to_empty_o2_min']} min")
        print(f"   Walkback Safe Margin: {wb['minimum_margin_pct']}% to {wb['nearest_shelter']}")

        if assessment["action"] == "ABORT_IMMEDIATELY":
            print(f"   [HUD ALARM] FLASHING RED: {rec}")
            # Instantaneous abort geometry is already attached!
            abort_nav = assessment["emergency_abort_route"]
            return {"display_mode": "EMERGENCY_RETREAT_HUD", "nav_geometry": abort_nav}

        return {"display_mode": "NOMINAL_TACTICAL_HUD", "assessment": assessment}
```

### 7.3 Multi-Target Science Campaign Scheduler & Batch Geospatial Pipeline

For mission science teams, Dalil-Mars can schedule multi-day exploration campaigns or run batch Monte-Carlo traverses across hundreds of coordinates:

```python
"""
Example Batch Science Tour & Monte-Carlo Exploration Pipeline.
"""
import json
import engine

def run_science_campaign(max_sol_hours: float = 6.5):
    # Retrieve all cataloged Jezero science landmarks
    all_pois = engine.get_waypoints()
    science_targets = [poi["name"] for poi in all_pois if not poi.get("isChargingStation")][:5]
    hab_alpha = (18.444627, 77.450886)

    print(f"Planning tour across targets: {science_targets}")
    tour = engine.plan_science_tour(
        base_location=hab_alpha,
        targets=science_targets,
        max_duration_hours=max_sol_hours,
        stay_duration_min=20.0,
        mode="rover",
        lst_hours=9.5,
    )

    print(f"Tour Status: {tour['status']}")
    print(f"Visited: {tour['targets_visited_count']} stops | Distance: {tour['total_tour_distance_km']} km")

    # Export tour GeoJSON directly for GIS mapping
    with open("jezero_campaign_plan.geojson", "w") as f:
        json.dump(tour["geojson"], f, indent=2)
    print("Saved campaign geometry to jezero_campaign_plan.geojson")
```

---

## 8. Full Python Library API & Type Signatures Reference

`engine.py` exports a clean, strongly-typed public API defined via `__all__`.

### 8.1 Module Imports & Exports

```python
import engine

# Or import specific functions and classes
from engine import (
    plan_route,
    plan_emergency_abort,
    plan_science_tour,
    find_optimal_departure,
    evaluate_rf_comms,
    get_waypoints,
    get_charging_stations,
    get_weather,
    get_engine,
    get_engine_status,
    DalilMarsEngine,
    SolarPhysics,
    CommsPhysics,
    MOBILITY_PROFILES,
    WEATHER_MODELS,
)
```

### 8.2 Function Specifications

#### `plan_route(...)`
Computes an optimal, hazard-avoiding surface traverse between two coordinates.
```python
def plan_route(
    start: tuple[float, float] | list[float] | dict | str,
    destination: tuple[float, float] | list[float] | dict | str,
    mode: str = "on_foot",
    lst_hours: float = 14.0,
    weather: str = "nominal",
    initial_battery_pct: float = 100.0,
    initial_o2_pct: float = 100.0,
    allow_charging_pitstop: bool = True,
    uphill_penalty: float | None = None,
    sun_position: tuple[float, float] | None = None,
    tau: float | None = None,
    radiation_spe: bool = False,
    **kwargs,
) -> dict
```
* **Parameters:**
  * `start`: Source coordinates `(lat, lon)`, `[lat, lon]`, `{"lat": lat, "lon": lon}`, or landmark name string (e.g. `"Hab Alpha"`).
  * `destination`: Destination coordinates or landmark name string.
  * `mode`: Mobility mode: `"on_foot"` (xEMU EVA suit) or `"rover"` (Perseverance-class rocker-bogie).
  * `lst_hours`: Mars Local Solar Time (decimal hours, `0.0` to `24.0`). Default `14.0`.
  * `weather`: Atmospheric scenario: `"nominal"`, `"dust_storm"`, or `"solar_storm"`.
  * `initial_battery_pct`: Battery charge on departure ($0.0 - 100.0\%$).
  * `initial_o2_pct`: Oxygen reserve on departure ($0.0 - 100.0\%$, relevant for `on_foot`).
  * `allow_charging_pitstop`: If `True`, permits intermediate waypoint rerouting through charging shelters.
  * `uphill_penalty`: Custom scalar multiplier for gravitational slope resistance.
* **Returns:** `dict` containing `"status"`, `"mode"`, `"start"`, `"destination"`, `"summary"`, `"geojson"`, and `"intermediate_stops"`.

#### `plan_emergency_abort(...)`
Calculates an immediate, highest-priority escape route to the nearest safe habitat or storm shelter under Apollo/Artemis Rule #1.
```python
def plan_emergency_abort(
    current_location: tuple[float, float] | list[float] | dict | str,
    mode: str = "on_foot",
    lst_hours: float = 14.0,
    initial_battery_pct: float = 100.0,
    initial_o2_pct: float = 100.0,
    weather: str = "nominal",
    **kwargs,
) -> dict
```
* **Parameters:**
  * `current_location`: Current coordinates `(lat, lon)` or landmark name.
  * `mode`: `"on_foot"` or `"rover"`.
  * `lst_hours`: Current Mars Local Solar Time.
  * `initial_battery_pct`, `initial_o2_pct`: Current remaining reserves.
  * `weather`: Atmospheric model.
* **Returns:** `dict` containing `"status"`, `"mode"`, `"current_location"`, `"abort_target_shelter"`, `"summary"`, and `"geojson"`.

#### `plan_science_tour(...)`
Solves a Budgeted Orienteering Problem (TSP with time and energy budget constraints) across cataloged science landmarks.
```python
def plan_science_tour(
    base_location: tuple[float, float] | list[float] | dict | str = None,
    targets: list[str] | list[tuple[float, float]] | None = None,
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
) -> dict
```
* **Parameters:**
  * `base_location`: Starting and ending depot (defaults to Hab Alpha).
  * `targets`: List of landmark names or coordinate tuples to prioritize. If `None`, searches top cataloged Jezero POIs.
  * `max_duration_hours`: Hard mission timeline constraint.
  * `stay_duration_min`: On-site scientific sampling dwell time per visited landmark.
  * `mode`: `"rover"` or `"on_foot"`.
* **Returns:** `dict` containing `"status"`, `"base_location"`, `"ordered_stops"`, `"total_tour_distance_km"`, `"total_tour_duration_min"`, `"legs"`, and `"geojson"`.

#### `find_optimal_departure(...)`
Performs diurnal solar radiation, shadow, and thermal sweeps across daylight hours to determine the highest-efficiency departure window.
```python
def find_optimal_departure(
    start: tuple[float, float] | str,
    destination: tuple[float, float] | str,
    mode: str = "rover",
    earliest_lst: float = 7.0,
    latest_lst: float = 16.5,
    step_hours: float = 0.5,
    weather: str = "nominal",
    initial_battery_pct: float = 100.0,
    initial_o2_pct: float = 100.0,
    allow_charging_pitstop: bool = True,
    **kwargs,
) -> dict
```
* **Parameters:**
  * `earliest_lst`: First departure time to evaluate (e.g. `7.0` for 07:00 LST).
  * `latest_lst`: Latest departure time to evaluate (e.g. `16.5` for 16:30 LST).
  * `step_hours`: Sweep resolution in hours (e.g. `0.5` for 30-minute steps).
* **Returns:** `dict` containing `"status"`, `"recommended_window"`, `"best_departure"`, `"evaluations"`, and `"mode"`.

#### `evaluate_rf_comms(...)`
Calculates UHF line-of-sight visibility, Fresnel zone clearance, and Free-Space Path Loss from any coordinate to Hab Alpha and peripheral relay masts.
```python
def evaluate_rf_comms(location: tuple[float, float] | str, mode: str = "rover") -> dict
```
* **Parameters:**
  * `location`: `(lat, lon)` or landmark name string.
  * `mode`: Mobility profile.
* **Returns:** `dict` containing `"status"` (`"CONNECTED"` / `"BLACKOUT"`), `"direct_hab_los"` (`bool`), `"active_link"`, `"path_loss_db"`, `"masts_in_view"`, and `"all_links"`.

#### `predict(...)`
Comprehensive real-time telemetry, environmental, life-support, and emergency abort prediction for an astronaut's portable field computer. **Predicts everything in a single call**: dynamic consumption rates, terrain hazards underfoot, solar/shadow status, forward target projection, Apollo/Artemis Rule #1 walkback margins, and **always pre-computes the complete emergency retreat route** to the nearest safe shelter.
```python
def predict(
    current_location: tuple[float, float] | list[float] | dict | str,
    battery_pct: float | None = None,
    battery: float | None = None,
    o2_pct: float | None = None,
    o2: float | None = None,
    destination: tuple[float, float] | str | None = None,
    mode: str = "on_foot",
    lst_hours: float = 14.0,
    metabolic_rate_watts: float | None = None,
    heart_rate_bpm: float | None = None,
    speed_kmh: float | None = None,
    weather: str = "nominal",
    **kwargs,
) -> dict
```
* **Parameters:**
  * `current_location`: Astronaut's instantaneous coordinate `(lat, lon)` or landmark name.
  * `battery` / `battery_pct`: Current battery state-of-charge ($0.0 - 100.0\%$) streamed from BMS hardware.
  * `o2` / `o2_pct`: Primary PLSS oxygen tank percentage ($0.0 - 100.0\%$, relevant for `on_foot`).
  * `destination`: Optional target coordinate or landmark where the astronaut is currently walking.
  * `mode`: `"on_foot"` (xEMU EVA spacesuit) or `"rover"`.
  * `lst_hours`: Current Mars Local Solar Time.
  * `heart_rate_bpm`: Real-time biometric heart rate (scales metabolic work rate dynamically).
  * `metabolic_rate_watts`: Direct biometric metabolic power (defaults to nominal 300W scaled by terrain slope).
  * `speed_kmh`: Current ground speed (defaults to nominal $3.6\text{ km/h}$).
* **Returns:** `dict` containing:
  * `"status"`: Overall health status (`"NOMINAL"`, `"CAUTION"`, `"WARNING_LOW_MARGIN"`, or `"CRITICAL_ABORT_REQUIRED"`).
  * `"alert_level"`: Rule #1 alert rating.
  * `"action"`: Operational guidance (`"PROCEED"`, `"MONITOR_CLOSELY"`, `"TURN_BACK_NOW"`, or `"ABORT_IMMEDIATELY"`).
  * `"current_telemetry"`: Instantaneous elevation, slope angle, slope safety rating, sunlit status, solar flux, and RF comms link.
  * `"dynamic_consumption_rates"`: Real-time $O_2$ consumption rate ($L/min$), electrical discharge rate ($W$), and time-to-empty ($TTE_{O2}$, $TTE_{\text{battery}}$ in minutes).
  * `"walkback_horizon"`: Apollo/Artemis Rule #1 margins, nearest shelter, retreat distance and ETA, and net abort buffer.
  * `"destination_projection"`: ETA, distance remaining, and predicted arrival battery and $O_2$ reserves (if `destination` provided).
  * `"emergency_abort"` / `"emergency_abort_route"`: **Always pre-computed and included.** Contains target shelter, escape distance, ETA, projected reserves upon ingress, turn-by-turn navigation steps, and complete GeoJSON route.

#### Environmental & Catalog Telemetry Functions
* `get_waypoints() -> list[dict]`: Returns cataloged POIs, science sites, and habitats.
* `get_charging_stations() -> list[dict]`: Returns list of shelters equipped with power/O2 refill docks.
* `get_weather(sol: int | None = None) -> dict`: Returns active MEDA atmospheric telemetry.
* `get_engine_status() -> dict`: Returns raster dimensions, resolution, and precomputed matrix statuses.
* `get_engine() -> DalilMarsEngine`: Returns the shared singleton instance of `DalilMarsEngine`.

---

## 9. Telemetry & GeoJSON Output Schemas

Every route generated by `plan_route()` produces a comprehensive payload matching standard web GIS and avionics specifications:

```json
{
  "status": "SAFE",
  "mode": "rover",
  "start": {"lat": 18.4447, "lon": 77.4508},
  "destination": {"lat": 18.4875, "lon": 77.3190},
  "summary": {
    "status": "SAFE",
    "mode": "rover",
    "total_distance_km": 8.76,
    "direct_distance_km": 8.22,
    "duration_min": 209,
    "duration_formatted": "3h 29m",
    "elevation_gain_m": 239.7,
    "elevation_loss_m": 15.2,
    "uphill_distance_km": 6.48,
    "downhill_distance_km": 1.03,
    "flat_distance_km": 1.24,
    "safe_slope_distance_km": 8.76,
    "dangerous_slope_distance_km": 0.0,
    "red_nodes_avoided_count": 3710,
    "slope_safety_rating": "OPTIMAL (0% red nodes traversed, slopes safe)",
    "max_slope_deg": 8.6,
    "avg_slope_deg": 1.7,
    "battery_used_pct": 4.7,
    "battery_remaining_pct": 95.3,
    "o2_used_liters": 0.0,
    "o2_remaining_pct": 100.0,
    "radiation_dose_mgy": 0.038,
    "sunlit_pct": 100.0,
    "shadow_pct": 0.0,
    "walkback_horizon": {
      "safe_horizon_maintained": true,
      "point_of_no_return_km": null,
      "minimum_walkback_battery_margin_pct": 90.4,
      "minimum_walkback_o2_margin_pct": 100.0,
      "primary_abort_shelter": "Hab Alpha (Octavia E. Butler Landing)",
      "status": "SAFE_HORIZON_MAINTAINED"
    },
    "rf_comms": {
      "status": "INTERMITTENT_SHADOWS",
      "total_comms_coverage_pct": 88.2,
      "direct_hab_coverage_pct": 44.1,
      "relay_coverage_pct": 44.1,
      "blackout_pct": 11.8,
      "blackout_distance_km": 1.09,
      "longest_continuous_blackout_km": 1.09,
      "primary_mast": "Hab Alpha (40m Tower)",
      "available_relays_count": 6
    }
  },
  "geojson": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {
          "type": "LineString",
          "coordinates": [[77.45075, 18.444761, -2563.0], "..."]
        },
        "properties": {
          "name": "Dalil-Mars Tactical Path (rover)",
          "status": "SAFE",
          "distance_km": 8.76,
          "duration_min": 209,
          "comms_coverage_pct": 88.2
        }
      }
    ]
  },
  "telemetry_profile": [
    {
      "dist_km": 0.0,
      "lat": 18.444761,
      "lon": 77.45075,
      "elevation_m": -2563.0,
      "slope_deg": 1.1,
      "is_shadowed": false,
      "nearest_shelter": "Hab Alpha (Octavia E. Butler Landing)",
      "abort_dist_km": 0.05,
      "walkback_battery_margin_pct": 99.5,
      "walkback_o2_margin_pct": 100.0,
      "is_beyond_horizon": false,
      "comms_status": "DIRECT_HAB_LOS",
      "comms_link": "Hab Alpha 40m Main Mast",
      "path_loss_db": 62.1
    }
  ]
}
```

---

## 10. Performance Benchmarks & Memory Footprint

Tested on standard x86_64 Linux hardware (Intel/AMD 4-core):

| Metric | Measured Value | Standard NASA Specification |
| :--- | :--- | :--- |
| **Fine Grid Resolution** | $20.25\text{ m/pixel}$ | $\le 25\text{ m/pixel}$ |
| **Fine Grid Dimensions** | $6,560 \times 2,950$ ($19.35\text{M}$ nodes) | Active Crater Area |
| **Engine Cold Initialization** | $0.25 - 0.40\text{ seconds}$ | $< 2.0\text{ seconds}$ |
| **Single Leg Tactical A\*** | $15 - 85\text{ milliseconds}$ | $< 500\text{ milliseconds}$ |
| **Multi-Stop Science Tour Solve** | $2.6\text{ milliseconds}$ | $< 100\text{ milliseconds}$ |
| **Diurnal Window (20 Slots Sweep)** | $1.2\text{ seconds}$ | $< 5.0\text{ seconds}$ |
| **RF LOS Ray-Marching (200 pts)** | $7.0\text{ milliseconds}$ | $< 50\text{ milliseconds}$ |
| **Total Memory Footprint (RAM)** | $\sim 320\text{ MB}$ | $< 1.0\text{ GB}$ |

---

## 11. Troubleshooting & Diagnostics

### 1. `FileNotFoundError: Missing Stage 6 heuristics at ...`
* **Root Cause:** Preprocessing Stage 6 matrix is missing.
* **Remedy:** Run the consolidated preprocessor:
  ```bash
  ./preprocess 6
  ```

### 2. `POINT_OF_NO_RETURN_EXCEEDED_AT_KM_X.XX`
* **Root Cause:** The planned expedition takes the astronaut or rover further than remaining life support (battery or $O_2$) can safely retreat to the closest shelter.
* **Remedy:** Reduce expedition distance, increase initial battery/oxygen charge, or allow virtual base pit-stops (`allow_charging_pitstop=True`).

### 3. `status: OUT_OF_RANGE`
* **Root Cause:** Battery or oxygen dropped below $15\%$ before reaching the destination.
* **Remedy:** Switch mode to `rover` (lower energy drain per km), schedule a recharge pitstop, or plan a departure during peak solar hours ($10:00 - 13:00$ LST) to harvest solar power.

### 4. `NIGHT_TRAP` or `TWILIGHT_RISK`
* **Root Cause:** Departure time occurs too late in the Martian Sol; arrival happens after sunset ($17:30\text{ LST}$) in sub-zero shadows.
* **Remedy:** Use `find_optimal_departure` to select a morning or midday launch window ($08:00 - 12:30\text{ LST}$).

---

*Dalil-Mars Tactical Pathfinding Engine — Engineered for Space Apps 2026.*
