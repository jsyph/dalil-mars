# ARES-EVA: Mars Maps — 4-Person Hackathon Team Plan

> **Project Vision:** *Google Maps + EV Trip Planner for Martian Astronauts in Jezero Crater.*
> Built for the **2026 NASA Space Apps Challenge** (*Interplanetary Survival Guide: Martian Map*).

---

## 1. Core Concept & Judging Edge
Astronauts exploring Jezero Crater need more than static satellite maps—they need a **live, Google-Maps-style survival navigator** that answers three critical questions before and during every Marswalk:
1. **Can I make it there safely?** (Terrain slope, sand/boulder hazards, and suit/rover Battery & $O_2$ range check).
2. **Do I need a recharge pit-stop?** (Automatic routing through **Virtual Base Charging & $O_2$ Stations** when direct energy reserves drop below a safe $15\%$ margin).
3. **What am I looking at on the ground?** (Synced real NASA *Perseverance* Mastcam-Z / Hazcam "Street View" imagery + live MEDA weather & solar radiation alerts).

---

## 2. 4-Person Team Structure & File Ownership

To move fast with **zero Git merge conflicts**, each teammate owns an isolated module and clear API contract:

| Teammate | Role | Owned Files | Key Responsibilities |
| :--- | :--- | :--- | :--- |
| **Member 1** | **Geospatial & Map Engine Lead** | `src/components/JezeroTacticalMap.jsx`<br>`src/index.css` | • Leaflet Mars basemap & 4 toggleable data layers (Slope, Hazards, POIs, Traverse).<br>• Distinct **Virtual Charging Station** pins & service-range rings.<br>• Two-leg route rendering (Pre-charge vs. Post-charge) + smooth animated GPS astronaut marker. |
| **Member 2** | **Routing, Energy & Charging Algorithm Lead** | `src/utils/pathfinder.js` | • A\* obstacle-avoiding grid search over Jezero Crater.<br>• Mobility loadout physics (`Solo`, `Heavy Kit`, `Rover Mule`).<br>• Battery/O₂ feasibility checker & automatic **Virtual Base Station** pit-stop optimizer.<br>• Human-readable turn-by-turn Martian directions generator. |
| **Member 3** | **Navigation UX & Live Telemetry Lead** | `src/App.jsx` | • **Glove-Compatible EVA Tablet UX** (`44px–48px` touch targets, `.glove-slider` controls, bottom step/walk dock).<br>• **Live EVA Field Mode** with **Martian Time-of-Day (`LST`)** scrubber, diurnal temperature & suit heater load.<br>• **Predictive Dust Storm Radar** ("Incoming Dust Storm Ahead" banner + one-tap Shelter Divert).<br>• Live "Start Marswalk" playback & turn-by-turn visor HUD. |
| **Member 4** | **NASA Data, Science Story & Pitch Lead** | `scripts/fetch_nasa_data.py`<br>`src/data/*.json`<br>Pitch Deck / Demo Video | • Maintain cached NASA M20 waypoints, MEDA weather logs, & Mastcam POV images.<br>• Curate Jezero science targets (Three Forks, Hawksbill Gap, Belva) & Virtual Base Charging Stations.<br>• Author project README, Space Apps submission page, and rehearse the 3-minute live demo. |

---

## 3. Git Branching & Integration Workflow

* **Main branch (`main`)**: Always deployable (`npm run build` must pass before merging).
* **Feature branches**:
  * `feat/map-engine` (Member 1)
  * `feat/routing-charging` (Member 2)
  * `feat/ui-live-nav` (Member 3)
  * `feat/nasa-data-docs` (Member 4)
* **Sync cadence**: Every 3–4 hours, run a 5-minute standup, merge verified branches into `main`, and pull `main` down to all branches.

---

## 4. Hackathon Execution Timeline

### Phase 1: Setup & Data Pipeline (Hours 0–4)
- [x] Scaffold Vite + React + Tailwind + Leaflet.
- [x] Run `python scripts/fetch_nasa_data.py` to cache 708 real NASA waypoints, MEDA weather, and Mastcam raw photos locally.
- [ ] Verify team environments (`npm install && npm run dev`).

### Phase 2: Parallel Feature Sprint (Hours 4–18)
- **Member 1:** Add Virtual Base Charging pins, 2-leg color-coded A\* polylines, and `liveMarkerRef` smooth `.setLatLng()` GPS tracking.
- **Member 2:** Implement battery drain math, `SAFE_RESERVE_PCT = 15%` check, multi-stop pit-stop routing, and turn-by-turn direction steps.
- **Member 3:** Build Battery/O₂ sliders, "Can I Make It?" status banner, Play/Pause Live Marswalk simulation, and turn-by-turn directions panel.
- **Member 4:** Place balanced Virtual Charging Waystations across Jezero Crater, verify all POV photos load cleanly, and draft slide deck outline.

### Phase 3: Integration & Polish (Hours 18–26)
- Connect all 4 tracks on `main`.
- Stress-test edge cases:
  - Short route with full battery -> Direct route clear.
  - Long route or low battery (`35%`) -> Auto-routes via Virtual Base Charging Station.
  - Critical low battery (`10%`) -> Displays "OUT OF RANGE" warning with Rover Mule / Abort recommendation.
  - Solar Flare / Dust Storm toggle -> Triggers emergency shelter routing.

### Phase 4: Demo Recording & Submission (Hours 26–36)
- Record a crisp 30-second fallback video + prepare live browser walkthrough.
- Verify `npm run build` passes cleanly with zero console errors.
- Submit to the NASA Space Apps portal with full data citations.

---

## 5. 3-Minute Judging Demo Script

1. **Hook (0:00–0:30):** *"NASA gives us global Mars maps, but an astronaut walking across Jezero Crater needs Google Maps + an EV trip planner. Meet ARES-EVA: Mars Maps."*
2. **Live NASA Data Layers (0:30–1:10):** Toggle the 4 layers—showing 708 real *Perseverance* telemetry points, slope hazards, ISRU clay water deposits, and real MEDA temperatures (`-79°C` night to `-24°C` day).
3. **The "Can I Make It?" & Virtual Charging Demo (1:10–2:10):**
   - Select a cross-crater trip (`Hab Alpha` → `Neretva Vallis`), lower starting Suit/Rover Battery to `40%`.
   - Show how the app flags insufficient direct reserve and **automatically routes through a Virtual Base Charging Station** (`Delta Front Solar Waystation` or `Belva Ridge Power & O2 Relay`).
   - Click **"Start Marswalk"** (`3x` speed) and watch the astronaut move live on the map, drain battery/O₂, dock at the Virtual Base Station to recharge to `100%`, and arrive safely while NASA Mastcam "Street View" photos update in real time.
4. **Emergency Abort & Close (2:10–3:00):** Flip on **Solar Flare (SPE)**, hit **Plot Abort Route**, and summarize how ARES-EVA bridges decades of robotic Mars data into human survival navigation.
