# Dalil Mars // ARES-EVA Navigator

> **2026 NASA Space Apps Challenge** — *Interplanetary Survival Guide: Martian Map*
> A Google Maps + EV Trip Planner & Glove-Compatible EVA Tablet for Martian Astronauts in **Jezero Crater**.

---

## Key Features
- **Real NASA Telemetry & Data Layers:** 708 *Perseverance* rover waypoints (`M20_waypoints.json`), live MEDA diurnal weather, terrain slope/hazard heatmaps, ISRU water-clay targets, and Mastcam-Z "Street View" POV photos.
- **A\* Obstacle-Avoiding Pathfinding:** Routes around steep scarps, boulder fields, and sand traps while factoring in suit mobility modes (*Solo Suit*, *Heavy Kit*, *Rover Mule*).
- **"Can I Make It?" Range & Virtual Base Charging:** Evaluates starting Suit/Rover Battery & PLSS $O_2$ levels and automatically inserts recharge pit-stops at Virtual Base Stations when direct reserves fall below `15%`.
- **Glove-Compatible EVA Tablet UX:** Large `44px–48px` touch controls, predictive **Incoming Dust Storm Ahead** radar with one-tap shelter divert, and **Live EVA Field Mode** with an advancing Martian `LST` clock.

---

## Quick Start for Teammates

```bash
# 1. Install dependencies
npm install

# 2. Start local dev server
npm run dev

# 3. Build for production check
npm run build
```

*(Optional)* Refresh cached NASA Jezero Crater telemetry:
```bash
python scripts/fetch_nasa_data.py
```

---

## Team Plan & Role Ownership
See **[TEAM_PLAN.md](./TEAM_PLAN.md)** for the 4-person role split, file ownership map, Git branching workflow, and 3-minute judging demo script.
