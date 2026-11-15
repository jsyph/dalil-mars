# Jezero / Nili Ground Control & Surface Terminal

Branch: `feat/jezero-ground-control`  
Built for the **2026 NASA Space Apps Challenge** (*Interplanetary Survival Guide: Martian Map*).

---

## 1. Overview

This branch integrates the **Jezero Crater Ground Control & Surface Planning Terminal** into Dalil Mars, adding a production-grade Python FastAPI geospatial backend and a high-density mission terminal designed around the USGS SIM 3464 / MRO CTX / ESA HRSC cartographic dataset.

It provides orbital-to-surface traverse planning, slope-aware A* routing, dynamic exclusion hazard buffers, elevation transects, and an interactive Google Maps-style scientific dossier drawer with 5-image multi-sensor carousels for 11 key Martian landmarks.

---

## 2. Key Modules Added

### A. Python FastAPI Backend (`backend/`)
- **Location**: `backend/`
- **Entry point**: `backend/main.py`
- **Key Endpoints**:
  - `POST /api/route/plan` — Slope-constrained A* routing across Jezero topography.
  - `GET /api/elevation/at-point` — High-precision elevation (m) and slope (deg) query via HRSC DTM.
  - `POST /api/elevation/profile` — Longitudinal elevation transect along any arbitrary traverse vector.
  - `GET /api/hazards/zones` & `POST /api/hazards/buffer` — Spatial exclusion zones and buffer geometry.
  - `GET /api/layers/metadata` — Vector and raster layer catalogue from USGS SIM 3464.
  - `GET /data/*` — Static file server for regional rasters, GeoJSONs, and landmark image assets.

### B. Ground Control & Mission Terminal (`ground-control/`)
- **Location**: `ground-control/index.html`
- **UI Architecture**:
  - Aerospace / automotive instrument cluster design system (neutral dark/light grays, strict zero blue/orange, green/crimson WCAG AA status indicators).
  - Leaflet map view clamped to authentic USGS SIM 3464 regional bounds (`17.3000° N` to `18.7013° N`, `76.8000° E` to `77.9972° E`).
  - Regional Basemap Switcher:
    - **CTX Satellite**: MRO CTX 5 m/px orthomosaic.
    - **HRSC Relief**: ESA Mars Express HRSC 3D shaded relief DEM.
    - **Hypsometric DTM**: Color-coded elevation model.
    - **THEMIS Thermal IR**: Nighttime thermal inertia and surface rock abundance.
  - **Google Maps-Style Slide-In Side Drawer**:
    - Smooth slide-in panel displaying comprehensive landmark dossiers.
    - **5-Photo Carousel Per Landmark** (55 authentic images total) featuring CTX regional context, high-resolution pavement details, HRSC 3D relief, hypsometric elevation, and THEMIS thermal IR.
    - Image navigation with previous/next controls, counter badge, mission caption attribution, and clickable 5-thumbnail preview strip.
    - Regolith & soil in-situ telemetry (dominant unit, mineralogy, grain size, bearing capacity, perchlorate, biosignature potential).
    - PIXL XRF major elemental oxide chemistry table ($\text{SiO}_2$, $\text{FeO}$, $\text{Al}_2\text{O}_3$, $\text{MgO}$, $\text{CaO}$, $\text{SO}_3$).
    - Mars 2020 Perseverance cored sample logs.
    - Direct `SET BASE`, `SET TARGET`, and `ROUTE HERE` traverse actions.
  - Interactive exclusion zone drawing tools (thermal, radiation, perchlorate, rough terrain, safe corridors) with individual zone deletion and polygon coordinates display.
  - Live elevation profile transect graph with min/max bounds and slope grade classification.

### C. Curated Geospatial Assets (`ground-control/data/`, `public/data/`, `src/data/`)
- `landmarks.json` — 11 curated planetary landmarks:
  1. Octavia E. Butler Landing Site
  2. Kodiak Butte
  3. Three Forks Sample Depot
  4. South Séítah Olivine Complex
  5. Wildcat Ridge (Delta Front)
  6. Belva Crater Impact Rim
  7. Neretva Vallis Inflow Gorge
  8. Enchanted Lake Basal Outcrop
  9. Jezero Northern Rim Wall
  10. **Sedona Crater** (`17.8356° N, 77.5341° E`, elev: `-3,032.0 m`)
  11. **Hartwell Crater** (`18.5257° N, 77.7146° E`, elev: `-2,603.0 m`)
- `landmarks/*.png` — 55 cropped and normalized scientific assets (5 per landmark).
- GeoJSON Layers: `SurfaceFeatures.geojson`, `LocationFeatures.geojson`, `LinearFeatures.geojson`, `LandingEllipse.geojson`, `Nomenclature.geojson`.

---

## 3. Quick Start for Teammates

### Option 1: Running the FastAPI Backend & Terminal
```bash
# 1. Navigate to backend
cd backend

# 2. Create virtual environment & install dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 3. Start FastAPI server (serves API and Ground Control Terminal)
python3 -m uvicorn main:app --port 8000 --host 0.0.0.0
```
- Open your browser to `http://localhost:8000` to launch the **Ground Control Terminal**.
- Swagger API documentation is available at `http://localhost:8000/docs`.

### Option 2: Standalone Static Terminal
Simply open `ground-control/index.html` directly in any web browser.

### Option 3: Importing Landmarks into React EVA App
`landmarks.json` and `public/data/landmarks/` have been mirrored into the Vite project:
```javascript
// In React components (e.g. JezeroTacticalMap.jsx):
import landmarks from '../data/landmarks.json';
```
Image URLs are formatted as `data/landmarks/<id>_<1-5>.png` and resolve directly from Vite's `public/` directory.
