# Dalil Mars // Unified Jezero Surface Terminal & Ground Control

> **2026 NASA Space Apps Challenge** — *Interplanetary Survival Guide: Martian Map*  
> **Team Mahatet Mars** // *Alexandria, Egypt Local Event*  
> High-density, glove-compatible EVA navigation terminal & geospatial ground control system for astronauts and operators in **Jezero Crater, Mars**.

[![Status](https://img.shields.io/badge/Status-Production%20Grade-22c55e?style=flat-square)](#)
[![Design](https://img.shields.io/badge/Design-Aerospace%20Instrument%20Cluster-191d24?style=flat-square)](#)
[![Dataset](https://img.shields.io/badge/Dataset-USGS%20SIM%203464%20%7C%20NASA%20M20-blue?style=flat-square)](#)
[![WCAG](https://img.shields.io/badge/Accessibility-WCAG%20AA%20Compliant-22c55e?style=flat-square)](#)

---

## 1. System Overview

**Dalil Mars** merges the astronaut tablet navigation interface with mission-critical geospatial ground control. Built around authentic cartographic and in-situ scientific datasets from the **NASA Mars 2020 Perseverance** mission and **USGS Scientific Investigations Map 3464**, the system provides orbital-to-surface traverse planning, slope-aware $A^*$ routing, life-support telemetry, and geological landmark analysis.

### Primary Operational Environments:
1. **Astronaut EVA Tablet Navigation GUI (`browse` & `navigating`)**:
   - Ergonomically designed for pressurized EVA suit operations with high-contrast tactile touch targets ($\ge 48\text{ px}$ to $56\text{ px}$).
   - Streamlined top instrument bar displaying essential mission telemetry (`SOL 1133 | 11:45 LST | -24.7 °C`), with zero header clutter.
   - Collapsible bottom trip planning HUD bar (`Shrink` / `Expand`) that frees up 100% of the Jezero crater map view.
   - Aerospace fill-gauge sliders with sub-millisecond route recalculation for starting Battery and PLSS $O_2$ tank simulations.
   - Tactical sliding simulation drawer for real-time Martian atmospheric conditions (*Nominal Sol*, *Dust Storm*, *Solar Flare*) and one-tap mission scenario presets.
2. **Ground Control & Engineering DEV GUI (`dev-gui`)**:
   - Tactical split-screen engineering console with live telemetry feeds, raw coordinate readouts, coordinate overrides, and GeoJSON/CSV export pipelines.
   - Interactive operator-drawn hazard exclusion polygons (radiation hotspots, steep dunes, chemical perchlorate concentrations) with A* corridor recalculation.

---

## 2. Key Architecture & Features

### A. Aerospace Instrument Cluster Design System
- **Restrained Aerospace Palette**: Strictly neutral charcoal, slate-gray, and off-white backgrounds with single-accent status indicators in emerald green (`#22c55e` nominal/OK) and crimson (`#ef4444` fault/hazard).
- **Strict Visual Rules**: **Zero emojis** and **zero blues or oranges** in any shade across the entire interface.
- **Typography**: Dual-font typography hierarchy combining `Inter` for clean UI controls with `IBM Plex Mono` / `JetBrains Mono` for coordinates, headings, and telemetry readouts.
- **Tactile Glove Ergonomics**: Minimum $44\text{ px}$ to $56\text{ px}$ hit targets, tactile fill gauges, and clear labeled buttons (`ROUTE STEPS`, `START NAVIGATION`).

### B. Multi-Sensor Basemap Layer System (Google Maps Style)
Switch seamlessly between authentic planetary remote sensing layers:
- **NASA CTX Orbital Satellite**: High-resolution ($6\text{ m/px}$) Mars Reconnaissance Orbiter context orthomosaic.
- **ESA HRSC Shaded Relief & DTM**: Mars Express High Resolution Stereo Camera 3D topographic relief with slope-blending.
- **THEMIS Nighttime Infrared**: 2001 Mars Odyssey thermal inertia mapping surface rock abundance and regolith cohesion.

### C. A* Pathfinding Engine & Sub-Millisecond Route Memoization
- **Slope-Constrained Traversal**: Evaluates digital elevation models (DTM) and navigates around scarps and slopes exceeding maximum mobility thresholds.
- **Mobility Profiles**:
  - *Solo Suit (XEMU)*: $3.2\text{ km/h}$, low energy consumption, $18^\circ$ max slope.
  - *Heavy Kit / Science Pack*: $2.1\text{ km/h}$, increased $O_2$ consumption rate, $14^\circ$ max slope.
  - *Rover Mule*: $6.5\text{ km/h}$, motorized battery draw, $22^\circ$ max slope.
- **Automatic Recharge Pit-Stop Inserter**: Automatically detects out-of-range routes ($<15\%$ arrival margin) and plans optimal dual-leg waypoints through Jezero charging stations.
- **LRU Memoization Cache (`legCache`)**: Caches single-leg traversals to eliminate redundant CPU-heavy grid searches, enabling continuous 60 FPS slider dragging without UI lag.

### D. Interactive Battery & PLSS $O_2$ Fill Gauges
- **Active Fill Gauge Sliders**: Visual progress tracks that dynamically illuminate in green (`#22c55e`) or warning crimson (`#ef4444`) up to the tactile slider thumb.
- **Dynamic Projected Arrival Telemetry**: Real-time projection of arrival battery and oxygen percentages as the astronaut adjusts reserves.

### E. Sliding Simulation & Hazards Drawer
- Accessible via the **`SIM`** (Gauge icon) floating dock button:
  - **Atmospheric Weather Solvers**:
    - *Nominal Sol*: Baseline clear Jezero conditions.
    - *Dust Storm*: Atmospheric opacity $\tau$ scaling, $-39.5^\circ\text{C}$ drop, and $1.35\times$ energy consumption multiplier.
    - *Solar Flare*: High-energy SPE radiation alert ($1080\text{ W/m}^2$, $8.4\text{ mSv/h}$ dose rate).
  - **Tactical Scenario Presets**:
    1. *Direct Sample Collection*: Hab Alpha $\rightarrow$ Three Forks ($3.2\text{ km}$, Nominal, Solo Suit).
    2. *Recharge Pit-Stop Route*: Hab Alpha $\rightarrow$ Hawksbill Gap (Heavy Kit, $24\%$ Battery, Pit-Stop).
    3. *Dusk & Dust Squall Front*: Kodiak Butte $\rightarrow$ Belva Crater (Dust Alert, $62\%$ Battery, $70\%$ PLSS).
    4. *Solar SPE Emergency Abort*: Séítah Ridge $\rightarrow$ Western Rim (SPE Storm, Rover Mule, Abort).

### F. Scientific Dossier & Mars 360° Panoramic Viewer
- **Landmark Dossier Drawer**: Comprehensive geological data for 11 Jezero landmarks including mineralogy, bearing capacity, perchlorate wt%, and PIXL XRF elemental oxide chemistry.
- **Multi-Sensor Photo Galleries**: 5 curated high-resolution photos per landmark (55 authentic images total).
- **Mars 360° Panorama Viewer**: Interactive full-sphere panoramic viewer displaying authentic Mars 2020 Mastcam-Z gigapixel mosaics.

---

## 3. Tech Stack

- **Frontend Core**: React 18, Vite 8, Tailwind CSS, Lucide React (monochrome vector icons).
- **Mapping & GIS**: Leaflet, Proj4Leaflet, Custom Tile/Overlay Shaders.
- **Math & Solvers**: Custom A* Pathfinding Engine, Mars Great-Circle Haversine calculations, Mars 24h 39m Diurnal LST Clock.
- **Backend (Optional / Standalone)**: Python 3.10+, FastAPI, Uvicorn, NumPy.

---

## 4. Quick Start

### Repository Architecture
- **`GUI/`**: Interactive React + Leaflet Martian EVA Surface Terminal & Navigator (Vite, Tailwind, 5 Basemaps, 55 authentic NASA landmark photos, Glove-compatible tablet UX).
- **`backend/`**: Python FastAPI GIS & A* routing backend with elevation transects and hazard buffer services.
- **`preprocessing/`**: Python scientific data pipeline, DTM downsampling, heuristic generation, and rover telemetry processing.
- **`scripts/`**: Automation scripts to fetch and verify live NASA M20 Jezero Crater waypoints and weather data.

### Prerequisites
- Node.js 18+ & npm

### Installation & Run

#### Option A: From Repository Root
```bash
# 1. Install dependencies (npm workspaces automatically configures GUI)
npm install

# 2. Start the development server (delegates to GUI)
npm run dev

# 3. Production build check
npm run build
```

#### Option B: Directly inside `GUI/`
```bash
cd GUI
npm install
npm run dev
npm run build
```

---

## 5. Branch Workflow

- **`feat/unified-jezero-nav-v2`** *(Active / Primary)*: Unified production branch containing the full merged application (Glove Tablet UI, Google Maps layer switcher, slide-in drawers, fill gauge sliders, and ground control integration).
- **`feat/jezero-ground-control`**: Historical ground control implementation branch.
- **`master`**: Baseline repository branch.

---

## 6. Datasets & Attributions
- **NASA PDS Geosciences Node**: Mars 2020 Perseverance Rover Waypoints & MEDA atmospheric logs.
- **USGS Astrogeology Science Center**: SIM 3464 Geologic Map of Jezero Crater & Nili Planum.
- **NASA / JPL-Caltech / MSSS / ESA / DLR / FU Berlin**: CTX, HiRISE, HRSC, and Mastcam-Z imagery.
