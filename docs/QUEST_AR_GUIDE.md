# Ares-EVA Visor HUD on Meta Quest 2 / WebXR Guide

This guide describes how to run and demonstrate the **Ares-EVA Visor HUD** on the **Meta Quest 2** using WebXR, real-time head gyroscope tracking, Quest Touch controller thumbstick movement, and live 3D Martian terrain navigation in Jezero Crater.

---

## Architecture Overview

```
                      +---------------------------------------+
                      |      Meta Quest 2 (Android 14)        |
                      |   com.oculus.browser (WebXR API)      |
                      +-------------------+-------------------+
                                          |
                        WebXR 'immersive-vr' / 'immersive-ar'
                                          |
               +--------------------------v--------------------------+
               |                Three.js (r187)                      |
               |                                                     |
               |  +---------------------+   +---------------------+  |
               |  |       vrRig         |   |    Martian World    |  |
               |  |  (YXZ yaw aligned)  |   |  USGS SIM 3464 DEM  |  |
               |  |          |          |   |  Orbital CTX Ortho  |  |
               |  |   xrCam (6DOF head) |   |  3D A* Route Ribbon |  |
               |  |   + Head-locked HUD |   |  Waypoint Pylons    |  |
               |  |   + Floor Chevrons  |   |  POI 3D Sprites     |  |
               |  +---------------------+   +---------------------+  |
               +--------------------------^--------------------------+
                                          |
                         Reverse Port Forwarding (ADB)
                                          |
                      +-------------------+-------------------+
                      |      Host PC / Dev Machine (Linux)    |
                      |   Vite 8.3 Dev Server (:5173)         |
                      |   Chrome DevTools Remote (:9222)      |
                      |   scrcpy single-eye cast (:1280x972)  |
                      +---------------------------------------+
```

### Key Modules
1. **[VisorHudPage.jsx](file:///home/joe/Development/nasa-space-apps-2026/dalil-mars/GUI/src/components/VisorHudPage.jsx)**:
   - Controls WebXR session initialization (`navigator.xr.requestSession`).
   - Default mode: `immersive-vr` with the 3D Martian terrain, Jezero sky, and atmospheric lighting.
   - Passthrough AR mode: `immersive-ar` activated when `&bg=transparent` is passed in the URL.
   - Syncs telemetry, PLSS vitals, MEDA atmospheric readings, and turn-by-turn guidance with Ground Control via `BroadcastChannel` and `localStorage`.
   - Dispatches continuous thumbstick movement (`moveByStick`) to step the astronaut forward/backward/sideways.

2. **[Visor3DTerrain.jsx](file:///home/joe/Development/nasa-space-apps-2026/dalil-mars/GUI/src/components/Visor3DTerrain.jsx)**:
   - Renders the Jezero Crater first-person terrain mesh using real USGS SIM 3464 DEM elevation data and MRO CTX orbital imagery.
   - Positions `vrRig` at the astronaut's ground vantage (`camY = (groundElev - baseElev) * 1.6 + 28m`).
   - Aligns `vrRig` forward heading (`-Z`) directly with the route start azimuth (`285°`) on session entry.
   - Extracts real-time 6DOF headset yaw from `xrCam.getWorldQuaternion()` to update the compass ribbon and directional reticle.
   - Polls Quest Touch thumbstick axes (`xrSessionActive.inputSources[i].gamepad.axes`) to walk across Mars.
   - Renders the 3D terrain-draped A* ribbon (`routeLine`) end-to-end with glowing waypoint pylons (120m) and destination beacon (320m).
   - Anchors 3D text/icon billboard sprites (`THREE.Sprite`) above Science POIs and Hazard zones so they remain rock-solid in stereo 3D space.

3. **[arHudRenderer.js](file:///home/joe/Development/nasa-space-apps-2026/dalil-mars/GUI/src/utils/arHudRenderer.js)**:
   - High-performance 2D Canvas texture renderer (1280×720) head-locked to the headset camera:
     - **Top-left**: Link status pill (`ARES-EVA AR VISOR • LIVE`).
     - **Top-center**: Compass ribbon with cardinal points (`N`, `NE`, `E`, etc.) and target waypoint diamond.
     - **Top banner**: Turn-by-turn maneuver distance and instruction, or red emergency dust-front banner.
     - **Center**: Precision optical crosshair reticle with dynamic directional arrow callout (`↑ STRAIGHT`, `↖ TURN LEFT 34°`, etc.).
     - **Bottom-left**: PLSS vitals strip (Battery %, O2 %, Heart Rate, Suit Heater Watts).
     - **Bottom-center**: Ground elevation and ETA readout.
     - **Bottom-right**: MEDA environment strip (Martian Sol LST time, ambient temperature °C, atmospheric pressure Pa, radiation rate mGy/hr).

4. **[scripts/quest_ar_demo.sh](file:///home/joe/Development/nasa-space-apps-2026/dalil-mars/scripts/quest_ar_demo.sh)**:
   - One-command automated launch script orchestrating ADB port forwarding, waking the headset, tab reuse, DevTools auto-click to enter WebXR, and `scrcpy` casting.

---

## Hardware & Environment Prerequisites

- **Headset**: Meta Quest 2 (or Quest 3 / Quest Pro) with Developer Mode enabled.
- **Connection**: USB-C data cable connected to the Linux development workstation.
- **Host Dependencies**:
  - `adb` (Android Debug Bridge)
  - `scrcpy` (version 2.0+ recommended)
  - `node` (v18+)
  - `npm`

---

## One-Command Automated Demo

To launch the full demo automatically:

```bash
./scripts/quest_ar_demo.sh
```

### What this script does automatically:
1. **Checks ADB**: Waits for the Quest 2 (`adb wait-for-device`) and verifies connection.
2. **Keeps Headset Awake**: Sets `svc power stayon usb` and triggers `com.oculus.vrpowermanager.prox_close` so the headset screen does not sleep while testing on your desk.
3. **Network & Secure Context Reverse Tunnel**:
   - `adb reverse tcp:5173 tcp:5173`: Maps the workstation's Vite dev server to `http://localhost:5173` on the Quest. This satisfies the WebXR W3C **Secure Context** requirement without needing self-signed SSL certificates or opening firewall ports.
   - `adb forward tcp:9222 localabstract:chrome_devtools_remote`: Exposes Meta Quest Browser's Chromium remote debugging port to the host.
4. **Starts Vite Server**: Starts the local dev server on port 5173 if not already running.
5. **Navigates Quest Browser & Auto-Enters WebXR**:
   - Closes redundant duplicate tabs and opens `http://localhost:5173/?mode=visor-ar`.
   - Sends a synthetic user gesture over the Chrome DevTools WebSocket protocol to click the **Enter Quest 2 VR/AR** button automatically.
6. **Launches Single-Eye PC Cast**:
   - Spawns `scrcpy` cropped specifically for the Quest 2 lens sweet spot (`--crop=5000:3800:300:1900 --max-size=1280 --no-audio`) for smooth, wide-angle viewing on the workstation monitor.

---

## Manual Execution & URL Modes

If you prefer starting each component manually:

### 1. Start the Vite Dev Server
```bash
npm --prefix GUI run dev -- --host
```

### 2. Forward the Port via ADB
```bash
adb reverse tcp:5173 tcp:5173
```

### 3. Open in Meta Quest Browser
Navigate to one of the following URLs in the Oculus Browser:

- **Full 3D Mars VR World (Default)**:
  ```
  http://localhost:5173/?mode=visor-ar
  ```
  Renders the complete Jezero terrain, Mars sky, sunlight, and atmospheric fog with the head-locked HUD.

- **Real-World AR Passthrough Mode**:
  ```
  http://localhost:5173/?mode=visor-ar&bg=transparent
  ```
  Disables the Martian terrain and sky, rendering the holographic HUD and 3D path over your real room via Quest 2 black-and-white passthrough cameras.

- **Standard Desktop Visor Mode**:
  ```
  http://localhost:5173/?mode=visor
  ```
  Standard 2D browser view with interactive on-screen buttons (`Walk`, `1x`, `Env`, `Contours`).

---

## Headset Controls & Navigation

| Control | Action |
|---|---|
| **Head Gyroscope / 6DOF Tracking** | Turn or tilt your head. The compass ribbon, reticle, terrain view, and waypoint pins orient naturally in real time. |
| **Left / Right Thumbstick (Y-Axis)** | Push **Forward** (Up) to walk forward along the route; pull **Back** (Down) to walk backward. |
| **Left / Right Thumbstick (X-Axis)** | Push **Left / Right** to strafe laterally across the corridor. |
| **Gaze Target Lock** | Center the reticle within ±8° of any Science POI or Hazard pin to expand its name and distance readout. |
| **Exit WebXR** | Press the Oculus / Menu button on the controller or click `Exit AR` on the HUD. |

---

## Troubleshooting

### 1. `WARN: Device disconnected` in scrcpy
- Ensure the Quest 2 USB-C cable is firmly seated and supports USB 3.0 data transfer.
- Verify ADB permissions:
  ```bash
  adb devices -l
  ```
  If listed as `unauthorized`, put on the headset and click **Always allow from this computer**.

### 2. WebXR Button Says "AR Transparent" Instead of "Enter Quest 2 AR"
- Make sure you are accessing the page via `http://localhost:5173` rather than a raw LAN IP (`http://192.168.x.x:5173`). WebXR requires a Secure Context (`localhost` or `https://`). Use `adb reverse tcp:5173 tcp:5173`.

### 3. Duplicate Tabs Accumulating in Quest Browser
- Run the cleanup snippet to close extra background tabs:
  ```bash
  adb forward tcp:9222 localabstract:chrome_devtools_remote
  node -e '
  (async () => {
    const res = await fetch("http://localhost:9222/json");
    const tabs = (await res.json()).filter(p => p.type === "page");
    for (let i = 1; i < tabs.length; i++) await fetch("http://localhost:9222/json/close/" + tabs[i].id);
    console.log("Cleaned extra tabs.");
  })();
  '
  ```
