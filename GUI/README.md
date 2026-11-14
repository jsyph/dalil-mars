# Dalil Mars — Jezero Surface Terminal & EVA Navigator (GUI)

Production-grade Martian EVA navigation, A* hazard-avoiding routing, and interactive Jezero Crater surface terminal built for the **2026 NASA Space Apps Challenge**.

## Getting Started

### 1. Install Dependencies
```bash
npm install
```

### 2. Start Development Server
```bash
npm run dev
```
The terminal will launch on `http://localhost:5173/`.

### 3. Production Build
```bash
npm run build
```

## Features
- **5-Layer Cartographic Basemap Engine**: Instant 1-tap cycling between CTX Satellite (6m), HRSC Shaded Relief, Hypsometric Elevation DTM, THEMIS Nighttime Thermal IR, and Planetary Coordinate Grid.
- **55 Authentic NASA Planetary Landmark Photos**: High-resolution, full-color surface photography, Mastcam-Z 360° panoramas, SuperCam outcrop profiles, and WATSON micro-imaging for all 11 Jezero Crater landmarks with zero image duplication.
- **Dynamic Loadout & Terminology**: Full support for Solo Suit (xEMU), Heavy Sample Kit, and Rover Mule Assist with dynamic "walk" vs. "drive" terminology.
- **Glove-Compatible Astronaut Tablet Interface**: Touch targets >= 44px, tactile slider controls, and Mars Local Solar Time (LST) simulation clock.
