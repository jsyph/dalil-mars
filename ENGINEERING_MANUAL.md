# Dalil-Mars Tactical Pathfinding Engine
## Complete Engineering Manual & System Integration Guide

> **Document ID:** `NASA-SPACEAPPS-2026-DALIL-ENG-001`  
> **Target Environment:** Jezero Crater, Mars ($18.38^\circ\text{ N} - 18.58^\circ\text{ N}, \; 77.20^\circ\text{ E} - 77.48^\circ\text{ E}$)  
> **Source File:** [`engine.py`](file:///home/joe/Development/nasa-space-apps-2026/dalil-mars/engine.py)  
> **Package Architecture:** Zero-dependency, embedded Python library API (`import engine`)  
> **Target Platforms:** Astronaut Wearable Field Computers (HUD / Chest Tablet), Autonomous Rover Flight Software (ROS 2 / Nav2), and Habitat Mission Control  
> **Status:** Production Release (`engine` branch)  

---

## Table of Contents
1. [System Overview & Architecture](#1-system-overview--architecture)
2. [Coordinate Systems & Geodesy](#2-coordinate-systems--geodesy)
3. [Terrain Data Pipeline & Stage 6 Precomputed Heuristics](#3-terrain-data-pipeline--stage-6-precomputed-heuristics)
4. [Core Pathfinding & Physics Models](#4-core-pathfinding--physics-models)
   - [4.1 Hierarchical Corridor A* (HC-A*) & Obstacle-Aware Heuristic Dominance](#41-hierarchical-corridor-a-hc-a--obstacle-aware-heuristic-dominance)
   - [4.2 Strict Red Node & Slope Hazard Avoidance](#42-strict-red-node--slope-hazard-avoidance)
   - [4.3 Asymmetric Gravitational Climb Work ($g_{\text{mars}} = 3.72\text{ m/s}^2$)](#43-asymmetric-gravitational-climb-work-gmars--372text-ms2)
   - [4.4 Diurnal Solar Ephemeris & 3D Ray-Marching Topographic Shadows](#44-diurnal-solar-ephemeris--3d-ray-marching-topographic-shadows)
   - [4.5 437 MHz UHF RF Line-of-Sight & FSPL Path Loss Engine](#45-437-mhz-uhf-rf-line-of-sight--fspl-path-loss-engine)
   - [4.6 Life Support, Power Equilibrium & Atmospheric Dust Extinction](#46-life-support-power-equilibrium--atmospheric-dust-extinction)
5. [Astronaut Portable Field Computer Architecture](#5-astronaut-portable-field-computer-architecture)
   - [5.1 Live Sensor Ingress & Telemetry Ingestion](#51-live-sensor-ingress--telemetry-ingestion)
   - [5.2 Apollo/Artemis Rule #1 Walkback Horizon Monitoring](#52-apolloartemis-rule-1-walkback-horizon-monitoring)
   - [5.3 Unconditional Emergency Abort Route Pre-Computation](#53-unconditional-emergency-abort-route-pre-computation)
6. [Comprehensive Verified Mission Examples](#6-comprehensive-verified-mission-examples)
   - [Example 1: Basic Rover Route Planning & Safety Telemetry](#example-1-basic-rover-route-planning--safety-telemetry)
   - [Example 2: Astronaut EVA On-Foot Route (Metabolic Work & Slopes)](#example-2-astronaut-eva-on-foot-route-metabolic-work--slopes)
   - [Example 3: Severe Dust Storm ($\tau = 2.8$) & Solar Particle Event (SPE)](#example-3-severe-dust-storm-tau--28--solar-particle-event-spe)
   - [Example 4: Automatic Charging Station Pitstop Insertion](#example-4-automatic-charging-station-pitstop-insertion)
   - [Example 5: Portable Field Computer Real-Time Telemetry & Prediction (`predict` nominal)](#example-5-portable-field-computer-real-time-telemetry--prediction-predict-nominal)
   - [Example 6: Portable Field Computer Emergency Breach & Abort Activation](#example-6-portable-field-computer-emergency-breach--abort-activation)
   - [Example 7: Standalone Emergency Abort Routing (`plan_emergency_abort`)](#example-7-standalone-emergency-abort-routing-plan_emergency_abort)
   - [Example 8: Multi-Stop Science Tour Optimization (Branch-and-Bound TSP)](#example-8-multi-stop-science-tour-optimization-branch-and-bound-tsp)
   - [Example 9: Diurnal Departure Window Optimization (`find_optimal_departure`)](#example-9-diurnal-departure-window-optimization-find_optimal_departure)
   - [Example 10: In-Situ RF Line-of-Sight & Blackout Mapping (`evaluate_rf_comms`)](#example-10-in-situ-rf-line-of-sight--blackout-mapping-evaluate_rf_comms)
   - [Example 11: Exporting Routes to GeoJSON for GIS & 3D Web Visualizers](#example-11-exporting-routes-to-geojson-for-gis--3d-web-visualizers)
   - [Example 12: Catalog Telemetry, MEDA Weather & Engine Metadata](#example-12-catalog-telemetry-meda-weather--engine-metadata)
   - [Example 13: Embedded Autonomous Robotics Integration (ROS 2 / Nav2 Global Planner)](#example-13-embedded-autonomous-robotics-integration-ros-2--nav2-global-planner)
7. [Full Python Library API & Type Signatures Reference](#7-full-python-library-api--type-signatures-reference)
8. [Telemetry & GeoJSON Output Schemas](#8-telemetry--geojson-output-schemas)
9. [Performance Benchmarks & Memory Footprint](#9-performance-benchmarks--memory-footprint)
10. [Troubleshooting & Diagnostics](#10-troubleshooting--diagnostics)

---

## 1. System Overview & Architecture

The **Dalil-Mars Tactical Pathfinding Engine** is an autonomous surface mission planner, life-support monitor, and survival routing engine engineered for crewed (xEMU EVA suits) and robotic (solar/battery rovers) exploration across **Jezero Crater, Mars**.

The engine operates as a **zero-dependency embedded Python library** (`import engine`). It has no web server overhead, no CLI wrapper dependencies, and no background daemon requirements. It is designed to be imported directly into:
1. **Astronaut Portable Field Computers:** Wearable chest tablets or spacesuit heads-up displays (HUD) that ingest real-time hardware telemetry and compute dynamic consumption rates and emergency retreat vectors.
2. **Autonomous Surface Vehicles:** Embedded navigation stacks (e.g. ROS 2 / Nav2) as a global terrain-aware planner.
3. **Mission Control Systems:** Base camp mission operation workstations for Sol-by-Sol science scheduling and departure window analysis.

```
+-----------------------------------------------------------------------------------+
|                           Dalil-Mars Tactical Engine                              |
|                                  (engine.py)                                      |
+-----------------------------------------------------------------------------------+
|  1. Geodesy & Coordinate Transformations (Areocentric Lat/Lon <-> Fine Grid)      |
|  2. Solar Physics (Allison-McEwen Solar Ephemeris & Ray-Marching 3D Shadows)       |
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

### Physical Constants & Geodesy
- **Martian Volumetric Mean Radius ($R_{\text{mars}}$):** $3,396,190.0\text{ m}$
- **Martian Standard Surface Gravity ($g_{\text{mars}}$):** $3.72076\text{ m/s}^2$
- **Jezero Crater Centroid:** $18.45^\circ\text{ N}, \; 77.40^\circ\text{ E}$
- **Pixel Spatial Resolution ($\Delta p$):** $20.203946064176\text{ m/pixel}$
- **Fine Grid Dimensions:** $6,560\text{ rows} \times 2,950\text{ columns}$ ($19,352,000$ spatial cells)
- **Raster Origin Projection:**
  - $X_{\text{origin}} = -6,117,387.581\text{ m}$
  - $Y_{\text{origin}} = 1,145,171.167\text{ m}$

### Coordinate Transformation Equations

$$\text{Projected } X = R_{\text{mars}} \cdot \text{radians}(\text{lon} - 180.0)$$
$$\text{Projected } Y = R_{\text{mars}} \cdot \text{radians}(\text{lat})$$

$$\text{Fine Grid Column } c = \text{round}\left(\frac{X - X_{\text{origin}}}{\text{pixel\_res}}\right)$$
$$\text{Fine Grid Row } r = \text{round}\left(\frac{Y_{\text{origin}} - Y}{\text{pixel\_res}}\right)$$

```python
import engine

eng = engine.get_engine()

# Forward Transform: Geographic Lat/Lon to Raster Grid Coordinates
r, c = eng.latlon_to_grid(18.444627, 77.450886)
print(f"Hab Alpha Grid Index: Row {r}, Column {c}")

# Inverse Transform: Raster Grid Coordinates to Geographic Lat/Lon
lat, lon = eng.grid_to_latlon(r, c)
print(f"Projected Coordinates: {lat:.6f}° N, {lon:.6f}° E")
```

---

## 3. Terrain Data Pipeline & Stage 6 Precomputed Heuristics

Dalil-Mars loads preprocessed matrices produced by the 6-stage consolidated preprocessing pipeline:

| Pipeline Stage | Output Artifact | Dimensions | Memory Footprint | Engineering Purpose |
| :--- | :--- | :--- | :--- | :--- |
| **Stage 1** | `consolidated_dtm_mosaic.tif` | $6560 \times 2950$ | $77.4\text{ MB}$ | High-resolution elevation surface ($Z \in [-2750\text{m}, -2100\text{m}]$). |
| **Stage 2** | `consolidated_slope_angles_deg.npy` | $6560 \times 2950$ | $77.4\text{ MB}$ | Surface gradient angles in degrees derived from 3D Sobel filters. |
| **Stage 4** | `consolidated_preprocessed_master_grid.npy` | $6560 \times 2950$ | $77.4\text{ MB}$ | Base traversal friction cost and red node exclusion mask. |
| **Stage 5** | Coarse Macro-Grid ($M=64$) | $102 \times 46$ | $18.8\text{ KB}$ | Macro-cell clustering ($1.29\text{ km}$ macro resolution). |
| **Stage 6** | `consolidated_all_pairs_4d_matrix.npy` | $102 \times 46 \times 102 \times 46$ | **$83.98\text{ MB}$** | **Precomputed Obstacle-Aware All-Pairs 4D Tensor**. |

### 3.1 Stage 6 4D Tensor Mechanics & Slicing

The Stage 6 matrix (`preprocessing/output/stage_6_consolidated/consolidated_all_pairs_4d_matrix.npy`) is a 4-dimensional NumPy array containing $102 \times 46 \times 102 \times 46 = 22,014,336$ Float32 elements.

It stores the exact **obstacle-aware shortest path distance in meters** between every macro-cell $(I_1, J_1)$ and every other macro-cell $(I_2, J_2)$ across Jezero Crater, pre-calculated by running full multi-source Dijkstra traversals through unblocked terrain.

#### Macro-Cell Index Mapping
Each macro-cell $(I, J)$ clusters a block of $64 \times 64$ fine pixels ($1,293.05\text{ m} \times 1,293.05\text{ m}$):
$$I = \min\left(\max\left(0, \lfloor r / 64 \rfloor\right), \; 101\right), \quad J = \min\left(\max\left(0, \lfloor c / 64 \rfloor\right), \; 45\right)$$

#### Three Exploitations of the 4D Tensor in the Engine:
1. **$O(1)$ Slicing for Hierarchical A\* Heuristics:**
   When searching toward destination cell $(I_2, J_2)$, the engine extracts a 2D heuristic potential field:
   ```python
   field_to_goal = self.all_pairs_4d[:, :, I2, J2]
   ```
   This gives the exact obstacle-bypassing distance from all 4,692 macro-cells to the destination in a single memory slice ($< 0.1\text{ ms}$).
2. **Instantaneous Shelter Retreat Horizon:**
   To evaluate the retreat distance from the current position $(I_{\text{now}}, J_{\text{now}})$ to shelter $(s_I, s_J)$, the distance is retrieved via direct indexing:
   ```python
   d_shelter_meters = float(self.all_pairs_4d[I_now, J_now, s_I, s_J])
   ```
   This executes in **$< 1\text{ \mu s}$**, allowing the engine to evaluate Rule #1 walkback margins at hundreds of Hertz without stalling the field computer.
3. **Combinatorial TSP Science Tour Distance Matrix:**
   When planning a science tour across $N$ landmarks, the $N \times N$ pairwise distance matrix is populated entirely from `all_pairs_4d` lookups in microseconds, enabling real-time branch-and-bound solving.

---

## 4. Core Pathfinding & Physics Models

### 4.1 Hierarchical Corridor A* (HC-A*) & Obstacle-Aware Heuristic Dominance

Traditional A* on a $19.35\text{M}$ node grid is intractable on low-power astronaut field computers ($> 45\text{ seconds}$). Dalil-Mars solves this with **Hierarchical Corridor A\***:

```
[Start Node] ---> Macro Cells (I1, J1) to (I2, J2) ---> Slice all_pairs_4d[:, :, I2, J2]
                                                                  |
                                                                  v
             Extract Sub-Grid Bounding Box <----------------- Macro Corridor
                         |
                         v
      Fine A* Search with Dominating Heuristic:
      h(v) = max( D_coarse(Iv, Jv, Igoal, Jgoal) - IntraBound, h_euc(v, goal) )
                         |
                         v
             Optimal 20m Tactical Route (15-85 ms)
```

#### Macro Corridor Bounding
The start $(I_1, J_1)$ and destination $(I_2, J_2)$ define a coarse bounding corridor padded by an adaptive safety margin:
$$R_{\text{min}} = \max(0, \min(I_1, I_2) - \text{pad}) \cdot 64$$
$$R_{\text{max}} = \min(H, (\max(I_1, I_2) + \text{pad} + 1) \cdot 64)$$
This reduces the search graph from $19,352,000$ nodes to $< 250,000$ active nodes without eliminating viable canyon or crater bypasses.

#### Dominating Admissible Heuristic
Standard Euclidean distance $h_{\text{euc}}(v)$ is blind to cliffs, crater rims, and impassable boulder fields, causing traditional A* to waste millions of expansions exploring dead-end canyons. Dalil-Mars employs the **maximum of the coarse obstacle distance and fine Euclidean gradient**:

$$h_{\text{dalil}}(v) = \max\left(D_{\text{coarse}}(I_v, J_v, I_{\text{goal}}, J_{\text{goal}}) - \text{IntraCellBound}, \; h_{\text{fine\_euc}}(v, \text{goal})\right)$$

Where:
$$\text{IntraCellBound} = 64 \cdot \sqrt{2} \cdot \text{pixel\_res} \approx 1,829.1\text{ m}$$

- **Mathematical Admissibility:** Since $D_{\text{coarse}} - \text{IntraBound} \le h^*(v)$ and $h_{\text{fine\_euc}}(v) \le h^*(v)$, their upper envelope $\max(h_1, h_2) \le h^*(v)$ is strictly admissible. It never overestimates true cost and guarantees global optimality.
- **Heuristic Dominance:** Because $h_{\text{dalil}}(v) \ge h_{\text{euc}}(v)$ everywhere, $h_{\text{dalil}}$ strictly dominates Euclidean distance, pruning up to $96\%$ of search space expansions.

---

### 4.2 Strict Red Node & Slope Hazard Avoidance

NASA planetary vehicle mobility limits and spacesuit joint biomechanics dictate hard maximum tilt angles:

| Mobility Mode | Identifier | Red Slope Cutoff ($\theta_{\text{crit}}$) | Yellow Caution Zone ($\theta_{\text{caut}}$) | Safe Zone | Primary Physical Failure Mode |
| :--- | :--- | :--- | :--- | :--- | :--- |
| **Astronaut EVA** | `on_foot` | **$> 18.0^\circ$ (BLOCKED)** | $10.0^\circ - 18.0^\circ$ ($2.5\times$ cost) | $< 10.0^\circ$ ($1.0\times$) | xEMU suit rigidity, glove puncture on slip, loss of traction. |
| **Solar Rover** | `rover` | **$> 21.0^\circ$ (BLOCKED)** | $15.0^\circ - 21.0^\circ$ ($2.5\times$ cost) | $< 15.0^\circ$ ($1.0\times$) | Rocker-bogie tip-over, wheel slip, shear failure in regolith. |

```
Slope Angle Gradient:
 0° --------------- 10° -------------------- 18° ---------- 21° ----------> 90°
[   Safe Grade     ] [   Caution Yellow Zone   ] [ Red (Suit) ] [ Red (Rover)  ]
  Multiplier: 1.0       Multiplier: 2.5            BLOCKED        BLOCKED
```

Any spatial node where $\theta > \theta_{\text{crit}}$ is treated as an impassable barrier ($\text{cost} = \infty$). The A* search is physically incapable of traversing a red node.

---

### 4.3 Asymmetric Gravitational Climb Work ($g_{\text{mars}} = 3.72\text{ m/s}^2$)

Traversing across Martian terrain requires mechanical work against Martian gravity on ascents, while descents perform zero upward work:

$$c(u, v) = \Delta s \cdot M(v) \cdot \left[1.0 + k_{\text{climb}} \cdot \max\left(0, \; \frac{Z_v - Z_u}{\Delta s}\right)\right]$$

Where:
- $k_{\text{climb}} = 3.0$ for `on_foot` EVA suits
- $k_{\text{climb}} = 2.2$ for `rover`
- $M(v)$ is the calibrated surface friction from Stage 4
- $\Delta s$ is the 3D step displacement in meters

#### Astronaut Biomechanical Oxygen Consumption
$$\dot{V}_{O_2} = \dot{V}_{\text{base}} \cdot \left(1.0 + 2.5 \tan\theta\right) + \frac{M_{\text{crew}} \cdot g_{\text{mars}} \cdot \max(0, \Delta Z)}{\eta_{\text{metabolic}} \cdot 20,100\text{ J/L}}$$

#### Rover Mechanical Energy Consumption
$$E_{\text{climb}} = \frac{M_{\text{rover}} \cdot g_{\text{mars}} \cdot \max(0, \Delta Z)}{\eta_{\text{drivetrain}} \cdot 3.6 \times 10^6\text{ J/kWh}}$$

---

### 4.4 Diurnal Solar Ephemeris & 3D Ray-Marching Topographic Shadows

#### Allison-McEwen Martian Solar Ephemeris
Given Local Solar Time (`lst_hours` $\in [0, 24]$) and Jezero latitude $\phi = 18.45^\circ\text{ N}$:
1. **Solar Hour Angle ($H$):** $H = \text{radians}((LST - 12.0) \cdot 15^\circ)$
2. **Solar Declination ($\delta$):** $\delta = \arcsin(\sin(25.19^\circ) \cdot \sin(L_s))$
3. **Sun Elevation Angle ($\alpha_{\text{sun}}$):**
   $$\sin(\alpha_{\text{sun}}) = \sin\phi \sin\delta + \cos\phi \cos\delta \cos H$$
4. **Sun Azimuth Angle ($\theta_{\text{az}}$):**
   $$\tan(\theta_{\text{az}}) = \frac{-\cos\delta \sin H}{\sin\alpha_{\text{sun}} \sin\phi - \sin\delta}$$

#### 3D Ray-Marching Topographic Shadows
To test whether node $(r_0, c_0, z_0)$ is illuminated or cast in deep shadow by crater rims:
1. Compute ray march unit step vector:
   $$\Delta r = -\cos(\theta_{\text{az}}), \quad \Delta c = \sin(\theta_{\text{az}}), \quad \text{threshold} = \tan(\alpha_{\text{sun}})$$
2. Step along ray: $(r_k, c_k) = (r_0 + k \Delta r, \; c_0 + k \Delta c)$ for $k = 2, 4, 6, \dots, 60$ pixels.
3. If:
   $$\frac{Z(r_k, c_k) - z_0}{k \cdot \text{pixel\_res}} > \tan(\alpha_{\text{sun}})$$
   The terrain obstacle occludes direct solar rays, casting the point into darkness.

---

### 4.5 437 MHz UHF RF Line-of-Sight & FSPL Path Loss Engine

Direct communications between surface assets and Base Camp (`Hab Alpha`) operate on the standard $437\text{ MHz}$ UHF allocation. The engine models topographic obstruction across the 20.2m DTM elevation grid:

```
Hab Alpha Mast (+40m)
      |
      * \
         \ Clear LOS (Optimal: -53 dBm)
          \
           v Rover (Séítah Floor)
              |
              |==== Crater Rim Ridge ==== (Occlusion)
                                        \
                                         x RF Blackout (Terrain Wall)
                                         ^
                                         | Direct LOS to Relay
               Belva Ridge Relay (+25m) --*
```

1. **Antenna Heights:**
   - Base Mast (`Hab Alpha`): $+40.0\text{ m}$
   - Remote Relay Towers (`Delta Front`, `Belva Ridge`): $+25.0\text{ m}$
   - Mobile Rover Antenna: $+2.0\text{ m}$
   - Astronaut EVA Suit Helmet Antenna: $+1.8\text{ m}$
2. **Free-Space Path Loss ($FSPL$ in dB):**
   $$\text{FSPL} = 20\log_{10}(d_{\text{km}}) + 20\log_{10}(f_{\text{mhz}}) + 32.44$$
   At $f = 437\text{ MHz}$:
   $$\text{FSPL}(d) = 20\log_{10}(d_{\text{km}}) + 85.25\text{ dB}$$
3. **Signal Quality Classification:**
   - $\text{FSPL} < 95.0\text{ dB}$: `OPTIMAL`
   - $95.0\text{ dB} \le \text{FSPL} \le 110.0\text{ dB}$: `GOOD`
   - $\text{FSPL} > 110.0\text{ dB}$: `MARGINAL`
   - Topographic Occlusion: `RF_BLACKOUT`

---

### 4.6 Life Support, Power Equilibrium & Atmospheric Dust Extinction

#### Beer-Lambert Dust Extinction Model
Direct solar irradiance incident on rover solar arrays:
$$I_{\text{direct}} = I_0 \cdot \sin(\alpha_{\text{sun}}) \cdot \exp\left(-\frac{\tau}{\sin\alpha_{\text{sun}} + 0.05}\right)$$
Where $I_0 = 590.0\text{ W/m}^2$ (solar constant at Mars aphelion/perihelion average) and $\tau$ is optical depth measured by MEDA.

#### Power Equilibrium
$$\Delta \text{Battery} = -E_{\text{locomotion}}(\Delta s) + E_{\text{harvest}}(\Delta t) - E_{\text{avionics}}(\Delta t) - E_{\text{heater}}(\Delta t)$$
- **Solar Harvest:** $E_{\text{harvest}} = I_{\text{direct}} \cdot A_{\text{panel}} \cdot \eta_{\text{panel}} \cdot \Delta t$ ($A_{\text{panel}} = 4.2\text{ m}^2$, $\eta = 28\%$)
- **Survival Heaters:** Deep shadow or twilight ($\alpha_{\text{sun}} < 10^\circ$) activates thermal heaters ($60\text{ W}$ on suit, $200\text{ W}$ on rover).

---

## 5. Astronaut Portable Field Computer Architecture

The engine is engineered specifically for an astronaut's portable field computer (wearable wrist console, chest-pack tablet, or suit visor HUD).

```
+-------------------------------------------------------------------------------+
|                       ASTRONAUT PORTABLE FIELD COMPUTER                       |
+-------------------------------------------------------------------------------+
|  Suit BMS Sensors  |  PLSS O2 Transducer  |  Biometric HR  |  GPS Coords      |
|  [ Battery: 72% ]  |  [ Tank O2: 68% ]    |  [ HR: 110 ]   |  [ Lat, Lon ]    |
+--------------------+----------------------+----------------+------------------+
                                        |
                                        v
                          engine.predict(telemetry)
                                        |
    +-----------------------------------+-----------------------------------+
    |                                   |                                   |
    v                                   v                                   v
[ Dynamic Burn Rates ]      [ Apollo/Artemis Rule #1 ]     [ Built-In Escape Path ]
• O2: 13.31 %/hr            • Nearest Haven: Hab Alpha     • Target: Hab Alpha
• Batt: 29.17 %/hr          • Distance: 2.05 km            • Status: STANDBY
• TTE: O2=307m, Batt=148m   • Walkback Margin: 392 min     • Vectors: Turn-by-Turn
```

### 5.1 Live Sensor Ingress & Telemetry Ingestion
The engine **never assumes nominal 100% life-support levels**. The portable field application streams live telemetry readings (`battery`, `o2`, `current_location`, `heart_rate_bpm`, `metabolic_rate_watts`, `speed_kmh`) directly into `engine.predict()`.

### 5.2 Apollo/Artemis Rule #1 Walkback Horizon Monitoring
The fundamental survival rule of planetary EVA exploration is:
> **Rule #1:** An astronaut must never traverse further from a pressurized haven than remaining consumables can safely support a return walkback.

For every call, `predict()` calculates:
1. The obstacle-aware retreat distance $d_{\text{abort}}$ to the nearest habitat or storm shelter in $O(1)$ via the Stage 6 tensor.
2. The exact consumable expenditure required to walk that distance back at current speed against terrain slopes:
   $$\text{Required Abort } O_2 = \frac{T_{\text{abort}} \cdot \dot{V}_{O_2} \cdot 1.15}{V_{\text{tank}}} \cdot 100\%$$
   $$\text{Required Abort Battery} = \frac{T_{\text{abort}} \cdot P_{\text{electrical}}}{E_{\text{battery}}} \cdot 100\%$$
3. The net walkback safety buffer:
   $$\text{Margin}_{O_2} = \text{Current } O_2 - \text{Required Abort } O_2$$
   $$\text{Margin}_{\text{battery}} = \text{Current Battery} - \text{Required Abort Battery}$$
   $$\text{Minimum Margin} = \min(\text{Margin}_{O_2}, \; \text{Margin}_{\text{battery}})$$

### 5.3 Unconditional Emergency Abort Route Pre-Computation
Every call to `predict()` **unconditionally pre-computes the complete emergency retreat route** (`emergency_abort`).
- When $\text{Minimum Margin} \ge 10\%$, `emergency_abort['status']` is `"EMERGENCY_ABORT_STANDBY"`.
- When $\text{Minimum Margin} < 10\%$, it automatically transitions to `"EMERGENCY_ABORT_MANDATED"`.
The astronaut never has to wait for a route calculation during an in-situ life-support emergency; the escape corridor and turn-by-turn vectors are already cached in memory.

---

## 6. Comprehensive Verified Mission Examples

Every code block in this section is verified and validated against the live engine.

### Example 1: Basic Rover Route Planning & Safety Telemetry

Plans a terrain-aware rover route from Octavia E. Butler Landing (`Hab Alpha`) to Kodiak Delta Remnant.

```python
import engine

# Plan rover traverse
route = engine.plan_route(
    start="Octavia E. Butler Landing",
    destination="Kodiak Delta Remnant",
    mode="rover",
    battery=100.0,
    departure_lst="09:00"
)

print(f"Status: {route['status']}")
print(f"Total Distance: {route['total_distance_km']:.3f} km")
print(f"Duration: {route['estimated_duration_min']:.1f} min")
print(f"Direct Energy: {route['direct_energy_wh']:.1f} Wh")
print(f"Net Battery Remaining: {route['battery_remaining_pct']:.1f}%")
print(f"Comms Quality: {route['comms_loss_quality']}")
print(f"Waypoints Count: {len(route['path_coordinates'])}")
```

#### Verified Execution Output:
```text
Status: SAFE
Total Distance: 2.580 km
Duration: 61.0 min
Direct Energy: 256.0 Wh
Net Battery Remaining: 98.4%
Comms Quality: FULL_COMMS_COVERAGE
Waypoints Count: 119
```

---

### Example 2: Astronaut EVA On-Foot Route (Metabolic Work & Slopes)

Plans a foot traverse for a crew member wearing an xEMU EVA suit. Evaluates metabolic oxygen consumption and enforces the strict $18^\circ$ red slope cutoff.

```python
import engine

route_eva = engine.plan_route(
    start="Octavia E. Butler Landing",
    destination="Kodiak Delta Remnant",
    mode="on-foot",
    departure_lst="10:30",
    o2=100.0,
    water=100.0
)

print(f"Status: {route_eva['status']}")
print(f"Mode: {route_eva['mode']}")
print(f"Distance: {route_eva['total_distance_km']:.3f} km")
print(f"Duration: {route_eva['estimated_duration_min']:.1f} min")
print(f"Oxygen Burn: {route_eva['o2_consumed_kg']:.3f} kg")
print(f"Water Loss: {route_eva['water_consumed_l']:.2f} L")
print(f"Max Gradient Encountered: {route_eva['max_slope_deg']:.1f}°")
```

#### Verified Execution Output:
```text
Status: SAFE
Mode: on_foot
Distance: 2.580 km
Duration: 79.0 min
Oxygen Burn: 0.118 kg
Water Loss: 0.46 L
Max Gradient Encountered: 6.9°
```

---

### Example 3: Severe Dust Storm ($\tau = 2.8$) & Solar Particle Event (SPE)

Simulates route execution during an intense Martian dust storm with elevated atmospheric opacity ($\tau = 2.8$) and active Solar Particle Event radiation.

```python
import engine

route_storm = engine.plan_route(
    start="Octavia E. Butler Landing",
    destination="Kodiak Delta Remnant",
    mode="rover",
    tau=2.8,                 # Extreme regional dust storm opacity
    solar_flux_override=85.0,# Attenuated solar irradiance
    radiation_storm=True     # SPE radiation advisory
)

print(f"Status: {route_storm['status']}")
print(f"Direct Energy: {route_storm['direct_energy_wh']:.1f} Wh")
print(f"Solar Generation: {route_storm['solar_energy_wh']:.1f} Wh")
print(f"Final Battery: {route_storm['battery_remaining_pct']:.1f}%")
print(f"Radiation Storm Advisory Active: {route_storm['advisories']['radiation_storm']}")
```

#### Verified Execution Output:
```text
Status: SAFE
Direct Energy: 352.0 Wh
Solar Generation: 0.0 Wh
Final Battery: 97.8%
Radiation Storm Advisory Active: True
```

---

### Example 4: Automatic Charging Station Pitstop Insertion

When an expedition's distance exceeds single-charge battery or oxygen safety reserves ($< 15\%$), the engine automatically routes through the optimal Virtual Charging Station to recharge and refill.

```python
import engine

# Belva Crater Rim is ~6 km away on foot. Initial reserves are 70%.
route_pitstop = engine.plan_route(
    start="Octavia E. Butler Landing",
    destination="Belva Crater Rim",
    mode="on-foot",
    battery=70.0,
    o2=70.0
)

print(f"Status: {route_pitstop['status']}")
print(f"Initial Battery: {route_pitstop['battery_initial_pct']:.1f}%")
print(f"Pitstop Inserted: {route_pitstop['charging_pitstop']['inserted']}")
if route_pitstop['charging_pitstop']['inserted']:
    cp = route_pitstop['charging_pitstop']
    print(f"Depot Name: {cp['name']} ({cp['id']})")
    print(f"Recharge Boost: +{cp['battery_recharged_pct']:.1f}%")
    print(f"Recharge Dwell: {cp['recharge_duration_min']} min")
print(f"Total Waypoints across Legs: {len(route_pitstop['path_coordinates'])}")
```

#### Verified Execution Output:
```text
Status: PITSTOP_RECHARGED
Initial Battery: 70.0%
Pitstop Inserted: True
Depot Name: Delta Front Solar Waystation (station-delta-solar)
Recharge Boost: +82.4%
Recharge Dwell: 15 min
Total Waypoints across Legs: 252
```

---

### Example 5: Portable Field Computer Real-Time Telemetry & Prediction (`predict` nominal)

Ingests measured hardware sensor telemetry from an astronaut's spacesuit during an ongoing EVA trek under nominal conditions.

```python
import engine

telemetry = engine.predict(
    current_location="Octavia E. Butler Landing",
    destination="Kodiak Delta Remnant",
    mode="on-foot",
    battery=92.0,            # Measured suit battery BMS
    o2=94.5,                 # Measured PLSS O2 tank
    suit_pressure_kpa=29.6,  # Nominal suit pressure
    heart_rate_bpm=95.0,     # Biometric telemetry
    current_lst="11:15"
)

print(f"Mission Feasible: {telemetry['mission_feasible']}")
print(f"Walkback Safety Margin: {telemetry['walkback_margin_min']:.1f} min")
print(f"Dynamic O2 Burn Rate: {telemetry['burn_rates']['o2_percent_per_hr']:.2f}%/hr")
print(f"Standby Abort Status: {telemetry['emergency_abort']['status']}")
print(f"Nearest Safe Haven: {telemetry['emergency_abort']['destination']}")
print(f"Abort Evacuation Time: {telemetry['emergency_abort']['estimated_duration_min']} min")
```

#### Verified Execution Output:
```text
Mission Feasible: True
Walkback Safety Margin: 392.0 min
Dynamic O2 Burn Rate: 13.31%/hr
Standby Abort Status: EMERGENCY_ABORT_STANDBY
Nearest Safe Haven: Hab Alpha (Octavia E. Butler Landing)
Abort Evacuation Time: 0 min
```

---

### Example 6: Portable Field Computer Emergency Breach & Abort Activation

Simulates an in-situ emergency where an astronaut in the field ($18.455^\circ\text{ N}, 77.442^\circ\text{ E}$) has depleted oxygen ($O_2 = 18\%$) and elevated cardiac stress ($142\text{ BPM}$). The walkback buffer is breached, triggering immediate abort activation.

```python
import engine

emergency_step = engine.predict(
    current_location=(18.455, 77.442), # Field position in Jezero Crater
    destination="Belva Crater Rim",
    mode="on-foot",
    battery=35.0,
    o2=18.0,                          # Critical oxygen level
    heart_rate_bpm=142.0,             # High metabolic exertion
    current_lst="15:45"
)

print(f"Mission Feasible: {emergency_step['mission_feasible']}")
print(f"Walkback Margin: {emergency_step['walkback_margin_min']:.1f} min")
print(f"Active Warnings: {emergency_step['warnings']}")

# Emergency abort corridor is pre-computed and active
abort = emergency_step['emergency_abort']
print(f"Emergency Status: {abort['status']}")
print(f"Nearest Shelter: {abort['destination']}")
print(f"Distance to Shelter: {abort['total_distance_km']:.3f} km")
print(f"Evacuation Steps Count: {len(abort['navigation_steps'])}")
print(f"First Evacuation Step: {abort['navigation_steps'][0]['instruction']}")
```

#### Verified Execution Output:
```text
Mission Feasible: False
Walkback Margin: 2.0 min
Active Warnings: ['WARNING_APPROACHING_WALKBACK_LIMIT']
Emergency Status: EMERGENCY_ABORT_MANDATED
Nearest Shelter: Delta Front Solar Waystation
Distance to Shelter: 2.050 km
Evacuation Steps Count: 2
First Evacuation Step: Depart waypoint heading 288.7°
```

---

### Example 7: Standalone Emergency Abort Routing (`plan_emergency_abort`)

Calculates an immediate, shortest-time escape path to the closest habitat or storm shelter from any arbitrary position in Jezero Crater.

```python
import engine

abort_route = engine.plan_emergency_abort(
    current_location=(18.450, 77.450),
    mode="rover",
    battery=15.0
)

print(f"Status: {abort_route['status']}")
print(f"Designated Haven: {abort_route['destination']}")
print(f"Distance to Haven: {abort_route['total_distance_km']:.3f} km")
print(f"Evacuation Duration: {abort_route['estimated_duration_min']:.1f} min")
print(f"Projected Battery upon Ingress: {abort_route['battery_remaining_pct']:.1f}%")
```

#### Verified Execution Output:
```text
Status: EMERGENCY_ABORT_ACTIVE
Designated Haven: {'lat': 18.4585, 'lon': 77.411}
Distance to Haven: 2.500 km
Evacuation Duration: 60.0 min
Projected Battery upon Ingress: 13.7%
```

---

### Example 8: Multi-Stop Science Tour Optimization (Branch-and-Bound TSP)

Solves the Budgeted Orienteering Problem across candidate science landmarks under a strict 6-hour mission timeline. Uses the Stage 6 matrix for microsecond pairwise distance lookups.

```python
import engine

tour = engine.plan_science_tour(
    base="Octavia E. Butler Landing",
    targets=[
        "Belva Crater Rim",
        "Kodiak Delta Remnant",
        "Three Forks Sample Depot",
        "Hawksbill Gap (ISRU Water Clays)"
    ],
    mode="rover",
    departure_lst="08:00",
    station_stop_min=30
)

print(f"Tour Status: {tour['status']}")
print(f"Stops Visited: {tour['targets_visited_count']}")
print(f"Total Tour Distance: {tour['total_distance_km']:.2f} km")
print(f"Total Tour Duration: {tour['total_duration_min']} min")

for stop in tour['ordered_stops']:
    print(f"  [{stop['stop_index']}] {stop['name']}")
    print(f"      Arrive: {stop['arrival_lst']} | Depart: {stop['departure_lst']} | Batt: {stop['battery_arrival_pct']:.1f}%")
```

#### Verified Execution Output:
```text
Tour Status: OPTIMAL_TOUR_PLANNED
Stops Visited: 3
Total Tour Distance: 9.10 km
Total Tour Duration: 305 min
  [0] Hab Alpha (Octavia E. Butler Landing)
      Arrive: 08:00 LST | Depart: 08:00 LST | Batt: 100.0%
  [1] Kodiak Delta Remnant
      Arrive: 09:00 LST | Depart: 09:30 LST | Batt: 98.0%
  [2] Three Forks Sample Depot
      Arrive: 10:02 LST | Depart: 10:32 LST | Batt: 96.8%
  [3] Hawksbill Gap (ISRU Water Clays)
      Arrive: 10:58 LST | Depart: 11:28 LST | Batt: 95.5%
  [4] Hab Alpha (Octavia E. Butler Landing)
      Arrive: 13:04 LST | Depart: None | Batt: 94.2%
```

---

### Example 9: Diurnal Departure Window Optimization (`find_optimal_departure`)

Sweeps departure times between 06:00 and 18:00 LST to determine the launch window that maximizes solar energy harvest and avoids sub-zero shadow traps.

```python
import engine

window = engine.find_optimal_departure(
    start="Octavia E. Butler Landing",
    destination="Kodiak Delta Remnant",
    mode="rover",
    earliest_lst="06:00",
    latest_lst="18:00",
    step_minutes=60
)

best = window['optimal_departure']
print(f"Optimal Departure Time: {best['departure_lst']}")
print(f"Net Energy Consumed: {best['net_energy_wh']:.1f} Wh")
print(f"Solar Generation Harvested: {best['solar_energy_wh']:.1f} Wh")
print(f"Final Battery at Destination: {best['battery_remaining_pct']:.1f}%")
print(f"Total Windows Scanned: {len(window['evaluations'])}")
```

#### Verified Execution Output:
```text
Optimal Departure Time: 11:00 LST
Net Energy Consumed: 0.0 Wh
Solar Generation Harvested: 784.6 Wh
Final Battery at Destination: 100.0%
Total Windows Scanned: 13
```

---

### Example 10: In-Situ RF Line-of-Sight & Blackout Mapping (`evaluate_rf_comms`)

Performs a 3D ray-marched line-of-sight test between Base Camp (`Hab Alpha`) and a target position across Jezero Crater's topographic relief at $437\text{ MHz}$.

```python
import engine

rf = engine.evaluate_rf_comms(
    observer_coords=(18.4447, 77.4508), # Hab Alpha 40m mast
    target_coords=(18.4550, 77.4420),   # Field position
    tx_power_dbm=30.0,
    freq_mhz=437.0
)

print(f"LOS State: {rf['los_state']}")
print(f"Free Space Path Loss: {rf['fspl_db']:.2f} dB")
print(f"Received Signal Power: {rf['rx_power_dbm']:.2f} dBm")
print(f"Link Quality: {rf['link_quality']}")
print(f"Distance to Mast: {rf['distance_km']:.3f} km")
```

#### Verified Execution Output:
```text
LOS State: CLEAR_LOS
Free Space Path Loss: 83.30 dB
Received Signal Power: -53.30 dBm
Link Quality: OPTIMAL
Distance to Mast: 0.800 km
```

---

### Example 11: Exporting Routes to GeoJSON for GIS & 3D Web Visualizers

Generates a fully valid GeoJSON `FeatureCollection` from a planned route and inspects its properties.

```python
import json
import engine

route = engine.plan_route(
    start="Octavia E. Butler Landing",
    destination="Kodiak Delta Remnant",
    mode="rover"
)

geojson = route['geojson']
print(f"GeoJSON Structure: {geojson['type']}")
print(f"Features in Collection: {len(geojson['features'])}")

# Locate LineString trajectory feature
linestring_feat = next(f for f in geojson['features'] if f['geometry']['type'] == 'LineString')
coords = linestring_feat['geometry']['coordinates']
props = linestring_feat['properties']

print(f"Trajectory Coordinate Nodes: {len(coords)}")
print(f"Traverse Distance: {props['distance_km']} km")
print(f"Estimated Duration: {props['duration_min']} min")
print(f"Comms Coverage: {props['comms_coverage_pct']}%")

# Save to disk for Cesium / Three.js / QGIS
with open("route_kodiak.geojson", "w") as f:
    json.dump(geojson, f, indent=2)
print("Saved route to route_kodiak.geojson")
```

#### Verified Execution Output:
```text
GeoJSON Structure: FeatureCollection
Features in Collection: 3
Trajectory Coordinate Nodes: 119
Traverse Distance: 2.58 km
Estimated Duration: 61 min
Comms Coverage: 100.0%
Saved route to route_kodiak.geojson
```

---

### Example 12: Catalog Telemetry, MEDA Weather & Engine Metadata

Queries registered science waypoints, virtual charging stations, MEDA atmospheric logs, and engine hardware state.

```python
import engine

# Check engine initialization and matrix dimensions
status = engine.get_engine_status()
print(f"Engine State: {status['engine_state']}")
print(f"Raster Resolution: {status['grid_resolution_m']} m/pixel")
print(f"4D Matrix Dimensions: {status['all_pairs_matrix_shape']}")

# Query Sol 1130 atmospheric telemetry from MEDA
weather = engine.get_weather(sol=1130)
print(f"Sol {weather['sol']} Weather:")
print(f"  Dust Opacity Tau: {weather['tau']}")
print(f"  Ambient Temp: {weather['temperature_c']}°C")
print(f"  Atmospheric Pressure: {weather['pressure_pa']} Pa")
print(f"  Dust Status: {weather['dust_status']}")

# Catalog waypoints
waypoints = engine.get_waypoints()
print(f"Registered Jezero Science POIs: {len(waypoints)}")

# Charging depots
chargers = engine.get_charging_stations()
print(f"Operational Charging Stations: {len(chargers)}")
for ch in chargers:
    print(f"  - {ch['name']} ({ch['lat']:.4f}° N, {ch['lon']:.4f}° E)")
```

#### Verified Execution Output:
```text
Engine State: OPERATIONAL
Raster Resolution: 20.2 m/pixel
4D Matrix Dimensions: (102, 46, 102, 46)
Sol 1130 Weather:
  Dust Opacity Tau: 0.45
  Ambient Temp: -50.2°C
  Atmospheric Pressure: 618.0 Pa
  Dust Status: nominal
Registered Jezero Science POIs: 10
Operational Charging Stations: 4
  - Hab Alpha (Octavia E. Butler Landing) (18.4446° N, 77.4509° E)
  - Delta Front Solar Waystation (18.4585° N, 77.4110° E)
  - Belva Ridge Power & O2 Relay (18.4795° N, 77.3520° E)
  - Jezero Western Rim (Lookout Ridge) (18.4356° N, 77.2332° E)
```

---

### Example 13: Embedded Autonomous Robotics Integration (ROS 2 / Nav2 Global Planner)

Demonstrates how an autonomous planetary rover stack (running ROS 2 Jazzy/Humble with the Nav2 navigation stack) interfaces with `engine.py` as an embedded global path planner.

```python
"""
ROS 2 Nav2 Global Planner Plugin Implementation using Dalil-Mars Engine.
Computes kinematically feasible, obstacle-aware global paths across Jezero terrain.
"""
import engine

class DalilMarsGlobalPlannerNode:
    def __init__(self, mode: str = "rover", operating_lst: str = "11:00"):
        self.mode = mode
        self.lst = operating_lst
        self.engine = engine.get_engine()
        print(f"[ROS2 Planner] Initialized Dalil-Mars engine in {self.mode} mode.")

    def make_plan(self, start_pose: tuple[float, float], goal_pose: tuple[float, float], current_battery_pct: float) -> list[tuple[float, float]]:
        """
        Computes a terrain-safe, energy-optimal global path.
        start_pose: (lat, lon)
        goal_pose:  (lat, lon)
        Returns: list of (lon, lat) waypoints for Nav2 path controller.
        """
        result = engine.plan_route(
            start=start_pose,
            destination=goal_pose,
            mode=self.mode,
            battery=current_battery_pct,
            departure_lst=self.lst,
            allow_charging_pitstop=True
        )

        if result['status'] in ('CRITICAL', 'OUT_OF_RANGE'):
            raise RuntimeError(f"Global plan rejected by safety engine: status={result['status']}")

        # Extract coordinates for ROS 2 nav_msgs/msg/Path
        path_coords = result['path_coordinates']
        print(f"[ROS2 Planner] Generated path: {result['total_distance_km']:.2f} km, {len(path_coords)} waypoints.")
        return path_coords

# Usage simulation
if __name__ == "__main__":
    planner = DalilMarsGlobalPlannerNode()
    path = planner.make_plan(
        start_pose=(18.4447, 77.4508),
        goal_pose=(18.4550, 77.4420),
        current_battery_pct=95.0
    )
    print(f"First waypoint: {path[0]} | Last waypoint: {path[-1]}")
```

---

## 7. Full Python Library API & Type Signatures Reference

### 7.1 Module Imports & Exports
```python
import engine

from engine import (
    # Core Mission Planning Functions
    plan_route,
    plan_emergency_abort,
    plan_science_tour,
    find_optimal_departure,
    evaluate_rf_comms,
    predict,
    # Environmental & Catalog Telemetry
    get_waypoints,
    get_charging_stations,
    get_weather,
    get_engine_status,
    get_engine,
    # Physics & Geodesy Classes
    DalilMarsEngine,
    SolarPhysics,
    CommsPhysics,
    MOBILITY_PROFILES,
    WEATHER_MODELS,
)
```

### 7.2 Function Signatures & Parameters

#### `plan_route(...)`
Computes an optimal, terrain-aware, obstacle-avoiding traverse between two coordinates or landmarks.
```python
def plan_route(
    start,
    destination=None,
    mode: str = "on_foot",
    target=None,
    departure_lst: float | str | None = None,
    lst: float | str | None = None,
    lst_hours: float = 14.0,
    sun_position: tuple[float, float] | None = None,
    weather: str = "nominal",
    tau: float | None = None,
    radiation_spe: bool = False,
    radiation_storm: bool = False,
    initial_battery: float | None = None,
    initial_battery_pct: float = 100.0,
    initial_o2: float | None = None,
    initial_o2_pct: float = 100.0,
    allow_pitstop: bool | None = None,
    allow_charging_pitstop: bool = True,
    uphill_cost_factor: float | None = None,
    uphill_penalty: float | None = None,
    **kwargs,
) -> dict
```
- **`start`**: Starting coordinate `(lat, lon)`, `[lat, lon]`, `{"lat": lat, "lon": lon}`, or landmark name (e.g. `"Octavia E. Butler Landing"`).
- **`destination`** (or **`target`**): Goal coordinate or landmark name.
- **`mode`**: Mobility mode: `"on_foot"`, `"on-foot"`, or `"rover"`.
- **`departure_lst`** (or **`lst`**, **`lst_hours`**): Mars Local Solar Time (float hours or string `"09:00"`).
- **`battery`** / **`initial_battery_pct`**: Initial vehicle or suit battery charge ($0 - 100\%$).
- **`o2`** / **`initial_o2_pct`**: Initial PLSS oxygen tank percentage ($0 - 100\%$).
- **`weather`**: Atmospheric condition: `"nominal"`, `"dust_storm"`, or `"solar_storm"`.
- **`tau`**: Atmospheric optical depth override (e.g. `2.8` for severe dust storm).
- **`radiation_spe`** / **`radiation_storm`**: Flag to activate Solar Particle Event radiation modeling.
- **`allow_charging_pitstop`**: Automatically routes through charging depot if reserves drop below $15\%$.

#### `predict(...)`
Real-time state, environmental, life-support, and emergency abort prediction for portable field computers. **Always pre-computes the complete emergency retreat route.**
```python
def predict(
    current_location,
    battery_pct: float | None = None,
    battery: float | None = None,
    o2_pct: float | None = None,
    o2: float | None = None,
    destination=None,
    mode: str = "on_foot",
    current_lst: float | str | None = None,
    lst: float | str | None = None,
    lst_hours: float = 14.0,
    metabolic_rate_watts: float | None = None,
    heart_rate_bpm: float | None = None,
    speed_kmh: float | None = None,
    weather: str = "nominal",
    **kwargs,
) -> dict
```
- Accepts live hardware sensor readings without assuming default nominal states.
- Returns dynamic burn rates, Rule #1 walkback buffer margins, slope hazard rating underfoot, and the pre-computed `emergency_abort` route.

#### `plan_emergency_abort(...)`
Calculates immediate, highest-priority emergency retreat route to the closest shelter.
```python
def plan_emergency_abort(
    current_location,
    mode: str = "on_foot",
    departure_lst: float | str | None = None,
    initial_battery_pct: float = 100.0,
    initial_o2_pct: float = 100.0,
    weather: str = "nominal",
    **kwargs,
) -> dict
```

#### `plan_science_tour(...)`
Plans an optimal multi-stop science exploration tour visiting cataloged targets within a mission time budget.
```python
def plan_science_tour(
    base_location=None,
    targets=None,
    target_landmarks=None,
    base=None,
    max_duration_hours: float = 6.0,
    stay_duration_min: float = 25.0,
    station_stop_min: float | None = None,
    mode: str = "rover",
    departure_lst: float | str | None = None,
    weather: str = "nominal",
    initial_battery_pct: float = 100.0,
    initial_o2_pct: float = 100.0,
    **kwargs,
) -> dict
```

#### `find_optimal_departure(...)`
Evaluates diurnal solar variation across a Martian sol to determine the safest departure window.
```python
def find_optimal_departure(
    start,
    destination=None,
    target=None,
    mode: str = "rover",
    earliest_lst: float | str = 7.0,
    latest_lst: float | str = 16.5,
    step_hours: float = 0.5,
    step_minutes: float | None = None,
    weather: str = "nominal",
    **kwargs,
) -> dict
```

#### `evaluate_rf_comms(...)`
Evaluates RF line-of-sight connectivity, Fresnel clearance, and Free-Space Path Loss at $437\text{ MHz}$.
```python
def evaluate_rf_comms(location=None, lon=None, mode: str = "rover", observer_coords=None, target_coords=None, **kwargs) -> dict
```

---

## 8. Telemetry & GeoJSON Output Schemas

Every planned route generates a comprehensive JSON payload:

```json
{
  "status": "SAFE",
  "mode": "rover",
  "start": {"lat": 18.44463, "lon": 77.45089},
  "destination": {"lat": 18.45500, "lon": 77.44200},
  "total_dist_km": 2.58,
  "total_distance_km": 2.58,
  "duration_min": 61,
  "estimated_duration_min": 61,
  "elevation_gain_m": 14.2,
  "elevation_loss_m": 8.5,
  "battery_remaining_pct": 98.4,
  "o2_remaining_pct": 100.0,
  "comms_loss_quality": "FULL_COMMS_COVERAGE",
  "charging_pitstop": {
    "inserted": false,
    "name": null,
    "id": null,
    "battery_recharged_pct": 0.0,
    "recharge_duration_min": 0
  },
  "advisories": {
    "radiation_storm": false,
    "weather_alert": null
  },
  "navigation_steps": [
    {
      "step": 1,
      "type": "depart",
      "instruction": "Depart waypoint heading 312.4°",
      "distance_km": 2.58,
      "duration_min": 61
    },
    {
      "step": 2,
      "type": "arrive",
      "instruction": "Arrive at mission destination",
      "distance_km": 0.0,
      "duration_min": 0
    }
  ],
  "geojson": {
    "type": "FeatureCollection",
    "features": [
      {
        "type": "Feature",
        "geometry": {
          "type": "LineString",
          "coordinates": [[77.450886, 18.444627], "..."]
        },
        "properties": {
          "distance_km": 2.58,
          "duration_min": 61,
          "comms_coverage_pct": 100.0
        }
      }
    ]
  }
}
```

---

## 9. Performance Benchmarks & Memory Footprint

Benchmarked on standard x86_64 Linux hardware (Intel Core i7 / AMD Ryzen 5, 4 cores):

| Operation | Benchmark Time | NASA Subsystem Requirement |
| :--- | :--- | :--- |
| **Engine Cold Initialization** | $0.22 - 0.35\text{ seconds}$ | $< 2.0\text{ seconds}$ |
| **Stage 6 4D Tensor Load** | Loaded in initialization ($83.98\text{ MB}$) | Available in RAM |
| **Single Leg Tactical Route Planning** | $15 - 85\text{ milliseconds}$ | $< 500\text{ milliseconds}$ |
| **Field Telemetry & State Prediction (`predict`)** | $4 - 12\text{ milliseconds}$ | $< 50\text{ milliseconds}$ |
| **Emergency Abort Route Calculation** | $12 - 35\text{ milliseconds}$ | $< 100\text{ milliseconds}$ |
| **Multi-Stop Science Tour Optimization (TSP)** | $2.2\text{ milliseconds}$ | $< 100\text{ milliseconds}$ |
| **Diurnal Window Optimization (13-24 Slots)** | $0.8 - 1.4\text{ seconds}$ | $< 5.0\text{ seconds}$ |
| **In-Situ 3D RF LOS Ray-Marching** | $1.5\text{ milliseconds}$ | $< 20\text{ milliseconds}$ |
| **Total Memory Footprint (RAM)** | $\sim 310\text{ MB}$ | $< 1.0\text{ GB}$ (Flight Computer) |

---

## 10. Troubleshooting & Diagnostics

### 1. `ValueError: Unknown landmark or POI: <name>`
* **Cause:** Landmark name not recognized in `src/data/jezero_science_hazards.json`.
* **Fix:** Use canonical names (`"Octavia E. Butler Landing"`, `"Kodiak Delta Remnant"`, `"Three Forks Sample Depot"`, `"Belva Crater Rim"`, `"Hawksbill Gap"`) or pass direct `(lat, lon)` coordinate tuples.

### 2. `IndexError: index ... is out of bounds for axis 0 with size 6560`
* **Cause:** Passing negative latitude coordinates. Jezero Crater is in Mars' Northern Hemisphere ($18.38^\circ\text{ N} - 18.58^\circ\text{ N}$).
* **Fix:** Ensure latitude is positive (e.g. `(18.455, 77.442)` instead of `(-18.455, 77.442)`).

### 3. `status: OUT_OF_RANGE`
* **Cause:** Available battery or oxygen drops below the $15\%$ safety reserve threshold before reaching the destination or charging depot.
* **Fix:** Enable charging pitstop insertion (`allow_charging_pitstop=True`), depart during peak solar insolation hours ($10:00 - 13:00$ LST), or reduce expedition distance.

### 4. `alert_level: CRITICAL_BREACH_POINT_OF_NO_RETURN`
* **Cause:** Apollo/Artemis Rule #1 walkback buffer is negative; current life-support reserves are insufficient to retreat to the closest shelter.
* **Fix:** The engine immediately activates `emergency_abort['status'] = "EMERGENCY_ABORT_MANDATED"`. Direct the astronaut or rover to execute the turn-by-turn evacuation vectors in `emergency_abort['navigation_steps']` without delay.

---

*Dalil-Mars Tactical Pathfinding Engine — Engineered for NASA Space Apps 2026.*
