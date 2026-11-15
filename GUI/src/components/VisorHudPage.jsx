import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Battery,
  BatteryCharging,
  ChevronLeft,
  ChevronRight,
  Compass,
  Crosshair,
  Droplets,
  Eye,
  Flame,
  Gauge,
  MapPin,
  Navigation2,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldAlert,
  Thermometer,
  Wind,
  Zap,
} from 'lucide-react';
import scienceHazardsData from '../data/jezero_science_hazards.json';
import {
  calculateBearingDegrees,
  computeMarswalkRoute,
  LOADOUT_PROFILES,
  marsDistanceMeters,
  SAFE_RESERVE_PCT,
  SUIT_O2_CAPACITY_LITERS,
} from '../utils/pathfinder';
import { adaptEngineRouteToGui, planRouteApi } from '../utils/engineApi';
import {
  readCachedVisorState,
  sendVisorCommand,
  subscribeVisorState,
} from '../utils/visorSync';
import Visor3DTerrain, { VISOR_VERTICAL_FOV } from './Visor3DTerrain';

const VISOR_FOV_DEG = 110; // ±55° horizontal field of view
const HALF_FOV = VISOR_FOV_DEG / 2;
const MARS_RADIUS_M = 3389500;
const STEP_DISTANCE_M = 20;
const WALK_SPEED_MPS = 68;

const CARDINALS = [
  { deg: 0, label: 'N' },
  { deg: 45, label: 'NE' },
  { deg: 90, label: 'E' },
  { deg: 135, label: 'SE' },
  { deg: 180, label: 'S' },
  { deg: 225, label: 'SW' },
  { deg: 270, label: 'W' },
  { deg: 315, label: 'NW' },
];

function normalizeSignedAngle(deg) {
  return ((deg + 540) % 360) - 180;
}

function normalizeHeading(deg) {
  return ((Math.round(deg) % 360) + 360) % 360;
}

function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

function stepMarsCoordinates(lat, lon, bearingDeg, distanceMeters) {
  const angDist = distanceMeters / MARS_RADIUS_M;
  const brng = (bearingDeg * Math.PI) / 180;
  const lat1 = (lat * Math.PI) / 180;
  const lon1 = (lon * Math.PI) / 180;

  const lat2 = Math.asin(
    Math.sin(lat1) * Math.cos(angDist) +
      Math.cos(lat1) * Math.sin(angDist) * Math.cos(brng)
  );
  const lon2 =
    lon1 +
    Math.atan2(
      Math.sin(brng) * Math.sin(angDist) * Math.cos(lat1),
      Math.cos(angDist) - Math.sin(lat1) * Math.sin(lat2)
    );

  return [
    Number(((lat2 * 180) / Math.PI).toFixed(6)),
    Number(((lon2 * 180) / Math.PI).toFixed(6)),
  ];
}

function applyLocalResourceStep(prevSnapshot, prevLat, prevLon, nextLat, nextLon) {
  const prevNav = prevSnapshot?.liveNavState || {};
  const stepKm = marsDistanceMeters(prevLat, prevLon, nextLat, nextLon) / 1000;
  const loadoutId = prevSnapshot?.loadout?.id || 'light';
  const loadout = LOADOUT_PROFILES[loadoutId] || LOADOUT_PROFILES.light;
  const dustFactor = prevSnapshot?.weatherKey === 'dust_storm' ? 1.25 : 1.0;

  const prevBat = Number.isFinite(prevNav.currentBattery) ? prevNav.currentBattery : 85;
  const prevO2 = Number.isFinite(prevNav.currentO2) ? prevNav.currentO2 : 90;
  const prevDist = Number.isFinite(prevNav.distCoveredKm) ? prevNav.distCoveredKm : 0;

  const stations = (scienceHazardsData.sciencePOIs || []).filter((p) => p.isChargingStation);
  const docked = stations.some((st) => marsDistanceMeters(nextLat, nextLon, st.lat, st.lon) <= 120);
  if (docked) {
    return {
      currentBattery: 100,
      currentO2: 100,
      isRecharging: true,
      distCoveredKm: Number((prevDist + stepKm).toFixed(2)),
    };
  }

  const batDrain = stepKm * loadout.batteryDrainPerKm * dustFactor;
  const stepMinutes = (stepKm / Math.max(0.5, loadout.speedKmh)) * 60;
  const o2DrainPct = ((stepMinutes * loadout.o2RateLpm) / SUIT_O2_CAPACITY_LITERS) * 100;

  return {
    currentBattery: Math.max(0, Number((prevBat - batDrain).toFixed(4))),
    currentO2: Math.max(0, Number((prevO2 - o2DrainPct).toFixed(4))),
    isRecharging: false,
    distCoveredKm: Number((prevDist + stepKm).toFixed(3)),
  };
}

const FALLBACK_SNAPSHOT = {
  navMode: 'browse',
  navPlaying: false,
  navSpeed: 1,
  weatherKey: 'nominal',
  liveNavState: {
    active: false,
    idx: 0,
    progressPct: 0,
    currentLatLon: [18.444627, 77.450886],
    heading: 285,
    currentBattery: 85,
    currentO2: 90,
    distCoveredKm: 0,
    distRemainingKm: 2.8,
    estTimeRemainingMin: 84,
    isRecharging: false,
    arrived: false,
    speedKmh: 0,
    heartRateBpm: 76,
    routeDeviation: {
      isOffRoute: false,
      severity: 'nominal',
      distMeters: 0,
      returnBearing: 285,
      isManual: false,
    },
  },
  martianEnv: {
    lstText: '11:45 LST',
    ambientTempC: -32.4,
    suitHeaterWatts: 63,
    daylightRemainingMin: 329,
    solarPhase: 'day',
  },
  currentManeuver: {
    icon: 'straight',
    distanceText: '2800 m',
    instruction: 'Awaiting navigation link from EVA Tablet',
    subtitle: 'Drag to look around • WASD to walk • Arrow keys to pan',
  },
  weatherCondition: {
    id: 'nominal',
    label: 'Nominal Sol',
    radRateMgyHr: 0.011,
    visibilityKm: 25,
    dustTau: 0.45,
    evaAllowed: true,
    alert: null,
  },
  dustFrontState: { active: false },
  nearestShelter: {
    station: {
      id: 'hab-alpha',
      name: 'Hab Alpha (Octavia E. Butler Landing)',
      lat: 18.444627,
      lon: 77.450886,
    },
    distKm: 0,
  },
  endPOI: {
    id: 'three-forks',
    name: 'Three Forks Sample Depot',
    lat: 18.4565,
    lon: 77.4035,
  },
  loadout: {
    id: 'light',
    name: 'Light Recon (Solo)',
    suitMassKg: 115,
  },
  latestMeda: {
    sol: '1133',
    pressure: 778.9,
  },
  routePathCoords: [],
};

const QUEST_FALLBACK_ROUTE = [
  [18.444627, 77.450886],
  [18.4472, 77.4415],
  [18.4501, 77.4310],
  [18.4534, 77.4178],
  [18.4565, 77.4035],
];

export default function VisorHudPage() {
  const [snapshot, setSnapshot] = useState(() => readCachedVisorState() || FALLBACK_SNAPSHOT);
  const [linkLive, setLinkLive] = useState(false);
  const lastHeartbeatRef = useRef(0);
  const [offlineRescueRoute, setOfflineRescueRoute] = useState(null);
  const offlineOriginRef = useRef(null);
  const [lastSyncTs, setLastSyncTs] = useState(null);
  const [showContours, setShowContours] = useState(true);

  // Interactive Head-Look (Yaw & Pitch offsets)
  const [lookYawOffset, setLookYawOffset] = useState(0);
  const [lookPitchDeg, setLookPitchDeg] = useState(0);
  const [groundElevM, setGroundElevM] = useState(null);
  const [screenMarkerCoords, setScreenMarkerCoords] = useState({});
  const dragRef = useRef({ active: false, x: 0, y: 0, yaw: 0, pitch: 0 });

  const rootRef = useRef(null);
  const [xrSession, setXrSession] = useState(null);
  const [xrSupported, setXrSupported] = useState(false);

  const isArMode = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('mode') === 'visor-ar';
  }, []);
  const isTransparentBg = useMemo(
    () => new URLSearchParams(window.location.search).get('bg') === 'transparent',
    []
  );

  useEffect(() => {
    if (!isArMode || !navigator.xr) return;
    const xrMode = isTransparentBg ? 'immersive-ar' : 'immersive-vr';
    navigator.xr.isSessionSupported(xrMode).then(setXrSupported).catch(() => {});
  }, [isArMode, isTransparentBg]);

  const startArSession = useCallback(async () => {
    if (!navigator.xr || xrSession) return;
    try {
      const mode = isTransparentBg ? 'immersive-ar' : 'immersive-vr';
      const session = await navigator.xr.requestSession(mode, {
        requiredFeatures: ['local-floor'],
      });
      session.addEventListener('end', () => setXrSession(null));
      setXrSession(session);
    } catch (err) {
      console.warn('WebXR session start:', err?.message || err);
    }
  }, [xrSession, isTransparentBg]);

  useEffect(() => {
    if (isArMode && xrSupported && !xrSession) {
      startArSession();
    }
  }, [isArMode, xrSupported, xrSession, startArSession]);

  useEffect(() => {
    const unsubscribe = subscribeVisorState(
      (nextSnapshot, ts) => {
        setSnapshot(nextSnapshot);
        lastHeartbeatRef.current = Date.now();
        setLinkLive(true);
        setLastSyncTs(ts || Date.now());
      },
      (isOnline, ts) => {
        if (isOnline) {
          lastHeartbeatRef.current = Date.now();
          setLinkLive(true);
          if (ts) setLastSyncTs(ts);
        } else {
          lastHeartbeatRef.current = 0;
          setLinkLive(false);
        }
      }
    );
    sendVisorCommand('VISOR_PING');
    const watchdog = setInterval(() => {
      if (lastHeartbeatRef.current === 0 || Date.now() - lastHeartbeatRef.current > 5000) {
        setLinkLive(false);
      }
    }, 1000);
    return () => {
      clearInterval(watchdog);
      unsubscribe();
    };
  }, []);

  const {
    navPlaying = false,
    navSpeed = 1,
    weatherKey = 'nominal',
    liveNavState = FALLBACK_SNAPSHOT.liveNavState,
    martianEnv = FALLBACK_SNAPSHOT.martianEnv,
    currentManeuver = FALLBACK_SNAPSHOT.currentManeuver,
    weatherCondition = FALLBACK_SNAPSHOT.weatherCondition,
    dustFrontState = FALLBACK_SNAPSHOT.dustFrontState,
    nearestShelter = FALLBACK_SNAPSHOT.nearestShelter,
    endPOI = FALLBACK_SNAPSHOT.endPOI,
    loadout = FALLBACK_SNAPSHOT.loadout,
    latestMeda = FALLBACK_SNAPSHOT.latestMeda,
    routePathCoords = [],
    livePrediction = null,
    rfComms = null,
    walkbackHorizon = null,
    engineLoading = false,
  } = snapshot;
  const activeRoutePathCoords =
    routePathCoords?.length >= 2
      ? routePathCoords
      : isArMode
        ? QUEST_FALLBACK_ROUTE
        : routePathCoords;

  const bodyHeading = liveNavState?.heading ?? 0;
  const viewHeading = normalizeHeading(bodyHeading + lookYawOffset);

  // Auto-center head-look yaw when automatic Walk mode starts so camera faces direction of travel
  const prevNavPlayingRef = useRef(false);
  useEffect(() => {
    if (navPlaying && !prevNavPlayingRef.current) {
      setLookYawOffset(0);
    }
    prevNavPlayingRef.current = navPlaying;
  }, [navPlaying]);

  // Sync camera gaze orientation to the 2D tactical map heading beam while in manual mode
  const lastLookSyncRef = useRef(0);
  useEffect(() => {
    if (navPlaying) return;
    const now = performance.now();
    if (now - lastLookSyncRef.current >= 50) {
      lastLookSyncRef.current = now;
      sendVisorCommand('MANUAL_LOOK', { viewHeading });
    } else {
      const timer = setTimeout(() => {
        lastLookSyncRef.current = performance.now();
        sendVisorCommand('MANUAL_LOOK', { viewHeading });
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [viewHeading, navPlaying]);
  const [curLat, curLon] = liveNavState?.currentLatLon ?? [18.444627, 77.450886];

  // Auto-route to nearest charging station when EVA Tablet is offline (desktop AR Visor mode)
  const nearestChargingStation = useMemo(() => {
    const stations = (scienceHazardsData.sciencePOIs || []).filter((p) => p.isChargingStation);
    let best = null;
    let bestDist = Infinity;
    for (const st of stations) {
      const d = marsDistanceMeters(curLat, curLon, st.lat, st.lon);
      if (d < bestDist) {
        bestDist = d;
        best = st;
      }
    }
    return best ? { station: best, distKm: Number((bestDist / 1000).toFixed(2)) } : null;
  }, [curLat, curLon]);

  useEffect(() => {
    if (linkLive || isArMode || !nearestChargingStation?.station) {
      if (linkLive) {
        setOfflineRescueRoute(null);
        offlineOriginRef.current = null;
      }
      return;
    }

    const st = nearestChargingStation.station;
    if (nearestChargingStation.distKm * 1000 < 50) {
      offlineOriginRef.current = { lat: curLat, lon: curLon, stationId: st.id, docked: true };
      setOfflineRescueRoute({ station: st, pathCoords: [], distKm: 0, docked: true });
      return;
    }

    const prev = offlineOriginRef.current;
    if (
      prev &&
      !prev.docked &&
      prev.stationId === st.id &&
      marsDistanceMeters(curLat, curLon, prev.lat, prev.lon) < 150
    ) {
      return;
    }

    offlineOriginRef.current = { lat: curLat, lon: curLon, stationId: st.id, docked: false };

    // Compute immediate local A* rescue path synchronously so the 3D ribbon appears with 0ms latency
    const fallback = computeMarswalkRoute({
      start: { id: 'visor-pos', name: 'Current Position', lat: curLat, lon: curLon },
      end: st,
      hazardZones: scienceHazardsData.hazardZones || [],
      waypoints: [],
      sciencePOIs: scienceHazardsData.sciencePOIs || [],
      loadoutKey: loadout?.id || 'light',
      weatherKey,
      useChargingStop: false,
    });
    const immediatePath =
      fallback.pathCoords?.length >= 2
        ? fallback.pathCoords
        : [
            [curLat, curLon],
            [st.lat, st.lon],
          ];
    offlineWalkIdxRef.current = 0;
    setOfflineRescueRoute({
      station: st,
      pathCoords: immediatePath,
      distKm: fallback.distKm ?? nearestChargingStation.distKm,
      docked: false,
    });

    // Optionally upgrade with backend DEM A* engine if reachable (without aborting on 16ms movement ticks)
    let cancelled = false;
    planRouteApi({
      start: [curLat, curLon],
      destination: [st.lat, st.lon],
      mode: 'balanced',
      loadout_key: loadout?.id || 'light',
      weather: weatherKey,
      initial_battery_pct: liveNavState?.currentBattery ?? 85,
      initial_o2_pct: liveNavState?.currentO2 ?? 90,
      allow_charging_pitstop: false,
    })
      .then((res) => {
        if (cancelled || linkLive) return;
        const adapted = adaptEngineRouteToGui(res, {
          start: { id: 'visor-pos', name: 'Current Position', lat: curLat, lon: curLon },
          end: st,
          loadoutKey: loadout?.id || 'light',
          weatherKey,
        });
        if (adapted.pathCoords?.length >= 2) {
          offlineWalkIdxRef.current = 0;
          setOfflineRescueRoute({
            station: st,
            pathCoords: adapted.pathCoords,
            distKm: adapted.distKm,
            docked: false,
          });
        }
      })
      .catch(() => {
        // Local computeMarswalkRoute path is already active
      });

    return () => {
      cancelled = true;
    };
  }, [linkLive, isArMode, nearestChargingStation, curLat, curLon, loadout?.id, weatherKey]);

  const effectiveEndPOI =
    !linkLive && !isArMode && offlineRescueRoute?.station ? offlineRescueRoute.station : endPOI;
  const effectiveRoutePathCoords =
    !linkLive && !isArMode && offlineRescueRoute?.pathCoords?.length >= 2
      ? offlineRescueRoute.pathCoords
      : activeRoutePathCoords;

  // Standalone Auto-Walk along the offline charging-station route when EVA Tablet is offline
  const offlineWalkIdxRef = useRef(0);
  useEffect(() => {
    if (linkLive || isArMode || !navPlaying || effectiveRoutePathCoords.length < 2) {
      if (!navPlaying) offlineWalkIdxRef.current = 0;
      return;
    }
    const path = effectiveRoutePathCoords;
    const timer = setInterval(() => {
      const totalPoints = path.length;
      const idxFloor = Math.min(totalPoints - 2, Math.max(0, Math.floor(offlineWalkIdxRef.current)));
      const segLenM = Math.max(
        2,
        marsDistanceMeters(path[idxFloor][0], path[idxFloor][1], path[idxFloor + 1][0], path[idxFloor + 1][1])
      );
      const nextIdx = Math.min(totalPoints - 1, offlineWalkIdxRef.current + (10.5 * navSpeed) / segLenM);
      offlineWalkIdxRef.current = nextIdx;

      const fIdx = Math.floor(nextIdx);
      const cIdx = Math.min(totalPoints - 1, fIdx + 1);
      const frac = nextIdx - fIdx;
      const nextPos =
        fIdx === cIdx
          ? path[fIdx]
          : [
              path[fIdx][0] + (path[cIdx][0] - path[fIdx][0]) * frac,
              path[fIdx][1] + (path[cIdx][1] - path[fIdx][1]) * frac,
            ];
      const lookIdx = Math.min(totalPoints - 1, fIdx + 2);
      const hdg =
        fIdx < totalPoints - 1
          ? Math.round(calculateBearingDegrees(nextPos[0], nextPos[1], path[lookIdx][0], path[lookIdx][1]))
          : Math.round(calculateBearingDegrees(path[Math.max(0, fIdx - 1)][0], path[Math.max(0, fIdx - 1)][1], nextPos[0], nextPos[1]));

      setSnapshot((prev) => {
        const [pLat, pLon] = prev.liveNavState?.currentLatLon ?? nextPos;
        const resUpdate = applyLocalResourceStep(prev, pLat, pLon, nextPos[0], nextPos[1]);
        return {
          ...prev,
          navPlaying: nextIdx < totalPoints - 1,
          liveNavState: {
            ...prev.liveNavState,
            ...resUpdate,
            active: true,
            currentLatLon: nextPos,
            heading: hdg,
          },
        };
      });
    }, 150);
    return () => clearInterval(timer);
  }, [linkLive, isArMode, navPlaying, navSpeed, effectiveRoutePathCoords]);
  const deviation = liveNavState?.routeDeviation;
  const isOffRoute = Boolean(deviation?.isOffRoute);

  const isDusty = weatherCondition?.id === 'dust_storm' || Boolean(dustFrontState?.active);
  const isLowLight = martianEnv?.solarPhase === 'night' || martianEnv?.solarPhase === 'dusk';
  const isEmergency = weatherCondition?.id !== 'nominal' || Boolean(dustFrontState?.active);
  const lowReserve =
    (liveNavState?.currentBattery ?? 100) <= SAFE_RESERVE_PCT ||
    (liveNavState?.currentO2 ?? 100) <= SAFE_RESERVE_PCT;

  // Direct standalone engine route recalculation when running independent of tablet GUI
  const handleStandaloneRecalculate = useCallback(async () => {
    const lat = moveStateRef.current?.curLat ?? curLat;
    const lon = moveStateRef.current?.curLon ?? curLon;
    const target = endPOI || { lat: 18.4565, lon: 77.4035 };
    try {
      setSnapshot((prev) => ({ ...prev, engineLoading: true }));
      const res = await planRouteApi({
        start: [lat, lon],
        destination: [target.lat, target.lon],
        mode: loadout?.id === 'rover' ? 'rover' : 'on_foot',
        loadout_key: loadout?.id || 'light',
        weather: weatherKey || 'nominal',
      });
      if (res?.path_coords && res.path_coords.length > 0) {
        setSnapshot((prev) => ({
          ...prev,
          routePathCoords: res.path_coords,
          engineLoading: false,
          liveNavState: {
            ...prev.liveNavState,
            distRemainingKm: Number((res.total_dist_km ?? 0).toFixed(2)),
            estTimeRemainingMin: Math.round(res.est_time_minutes ?? 0),
            routeDeviation: {
              isOffRoute: false,
              severity: 'nominal',
              distMeters: 0,
              returnBearing: prev.liveNavState?.heading ?? 0,
              isManual: false,
            },
          },
        }));
      }
    } catch (err) {
      console.warn('Standalone visor recalculate error:', err);
    } finally {
      setSnapshot((prev) => ({ ...prev, engineLoading: false }));
    }
  }, [curLat, curLon, endPOI, loadout, weatherKey]);

  const debouncedRecalcTimerRef = useRef(null);
  const triggerVisorRecalc = useCallback(() => {
    if (debouncedRecalcTimerRef.current) clearTimeout(debouncedRecalcTimerRef.current);
    debouncedRecalcTimerRef.current = setTimeout(() => {
      if (linkLive) {
        sendVisorCommand('RECALCULATE_ROUTE');
      } else {
        handleStandaloneRecalculate();
      }
    }, 450);
  }, [linkLive, handleStandaloneRecalculate]);

  const triggerVisorRecalcRef = useRef(triggerVisorRecalc);
  triggerVisorRecalcRef.current = triggerVisorRecalc;

  // Move astronaut manually & sync to tablet map (preserve bodyHeading so lookYawOffset never compounds)
  const moveAstronaut = useCallback(
    (relativeBearingOffsetDeg) => {
      const moveBearing = normalizeHeading(viewHeading + relativeBearingOffsetDeg);
      const [nextLat, nextLon] = stepMarsCoordinates(
        curLat,
        curLon,
        moveBearing,
        STEP_DISTANCE_M
      );
      setSnapshot((prev) => {
        const [pLat, pLon] = prev.liveNavState?.currentLatLon ?? [curLat, curLon];
        const resUpdate = applyLocalResourceStep(prev, pLat, pLon, nextLat, nextLon);
        return {
          ...prev,
          navPlaying: false,
          liveNavState: {
            ...prev.liveNavState,
            ...resUpdate,
            active: true,
            currentLatLon: [nextLat, nextLon],
            heading: bodyHeading,
          },
        };
      });
      sendVisorCommand('MANUAL_MOVE', {
        lat: nextLat,
        lon: nextLon,
        heading: bodyHeading,
        viewHeading,
      });
    },
    [curLat, curLon, viewHeading, bodyHeading]
  );

  const keysPressedRef = useRef(new Set());
  const moveStateRef = useRef({ curLat, curLon, viewHeading, bodyHeading });
  moveStateRef.current = { curLat, curLon, viewHeading, bodyHeading };

  // Move astronaut smoothly from Quest 2 Touch controller thumbstick (forward, strafe in [-1, 1])
  const moveByStick = useCallback((forward, strafe, dt) => {
    const { curLat: lat, curLon: lon, viewHeading: vh, bodyHeading: bh } = moveStateRef.current;
    const relOffsetDeg = (Math.atan2(strafe, forward) * 180) / Math.PI;
    const moveBearing = normalizeHeading(vh + relOffsetDeg);
    const mag = Math.min(1, Math.hypot(forward, strafe));
    const distM = WALK_SPEED_MPS * mag * dt;
    const [nextLat, nextLon] = stepMarsCoordinates(lat, lon, moveBearing, distM);

    moveStateRef.current.curLat = nextLat;
    moveStateRef.current.curLon = nextLon;

    setSnapshot((prev) => {
      const [pLat, pLon] = prev.liveNavState?.currentLatLon ?? [lat, lon];
      const resUpdate = applyLocalResourceStep(prev, pLat, pLon, nextLat, nextLon);
      return {
        ...prev,
        navPlaying: false,
        liveNavState: {
          ...prev.liveNavState,
          ...resUpdate,
          active: true,
          currentLatLon: [nextLat, nextLon],
          heading: bh,
        },
      };
    });
    sendVisorCommand('MANUAL_MOVE', { lat: nextLat, lon: nextLon, heading: bh });
  }, []);

  // Smooth continuous WASD movement via requestAnimationFrame + Arrow keys for head look
  useEffect(() => {
    let animId = 0;
    let lastTime = performance.now();
    let lastSyncTs = 0;

    const flushSync = (lat, lon, heading, viewHdg) => {
      sendVisorCommand('MANUAL_MOVE', { lat, lon, heading, viewHeading: viewHdg });
      lastSyncTs = performance.now();
    };

    const tick = (now) => {
      const keys = keysPressedRef.current;
      if (keys.size > 0) {
        const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
        const forward = (keys.has('w') ? 1 : 0) - (keys.has('s') ? 1 : 0);
        const strafe = (keys.has('d') ? 1 : 0) - (keys.has('a') ? 1 : 0);

        if (forward !== 0 || strafe !== 0) {
          const { curLat: lat, curLon: lon, viewHeading: vh, bodyHeading: bh } =
            moveStateRef.current;
          const relOffsetDeg = (Math.atan2(strafe, forward) * 180) / Math.PI;
          const moveBearing = normalizeHeading(vh + relOffsetDeg);
          const distM = WALK_SPEED_MPS * dt;
          const [nextLat, nextLon] = stepMarsCoordinates(lat, lon, moveBearing, distM);

          moveStateRef.current.curLat = nextLat;
          moveStateRef.current.curLon = nextLon;

          setSnapshot((prev) => {
            const [pLat, pLon] = prev.liveNavState?.currentLatLon ?? [lat, lon];
            const resUpdate = applyLocalResourceStep(prev, pLat, pLon, nextLat, nextLon);
            return {
              ...prev,
              navPlaying: false,
              liveNavState: {
                ...prev.liveNavState,
                ...resUpdate,
                active: true,
                currentLatLon: [nextLat, nextLon],
                heading: bh,
              },
            };
          });

          if (now - lastSyncTs >= 60) {
            flushSync(nextLat, nextLon, bh, vh);
          }
        }
      }
      lastTime = now;
      animId = requestAnimationFrame(tick);
    };

    animId = requestAnimationFrame(tick);

    const onKeyDown = (e) => {
      const key = e.key.toLowerCase();
      if (key === 'w' || key === 'a' || key === 's' || key === 'd') {
        e.preventDefault();
        if (!e.repeat) {
          keysPressedRef.current.add(key);
        }
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        setLookYawOffset((y) => normalizeSignedAngle(y - 6));
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        setLookYawOffset((y) => normalizeSignedAngle(y + 6));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setLookPitchDeg((p) => Math.max(-28, Math.min(28, p + 3)));
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setLookPitchDeg((p) => Math.max(-28, Math.min(28, p - 3)));
      } else if (key === 'r') {
        setLookYawOffset(0);
        setLookPitchDeg(0);
      }
    };

    const onKeyUp = (e) => {
      const key = e.key.toLowerCase();
      if (keysPressedRef.current.has(key)) {
        keysPressedRef.current.delete(key);
        const { curLat: lat, curLon: lon, bodyHeading: bh, viewHeading: vh } =
          moveStateRef.current;
        flushSync(lat, lon, bh, vh);
      }
    };

    const onBlur = () => {
      if (keysPressedRef.current.size > 0) {
        keysPressedRef.current.clear();
        const { curLat: lat, curLon: lon, bodyHeading: bh, viewHeading: vh } =
          moveStateRef.current;
        flushSync(lat, lon, bh, vh);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Pointer drag for head-look
  const handlePointerDown = (e) => {
    if (e.target.closest('button')) return;
    dragRef.current = {
      active: true,
      x: e.clientX,
      y: e.clientY,
      yaw: lookYawOffset,
      pitch: lookPitchDeg,
    };
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current.active) return;
    const dx = e.clientX - dragRef.current.x;
    const dy = e.clientY - dragRef.current.y;
    setLookYawOffset(normalizeSignedAngle(dragRef.current.yaw - dx * 0.22));
    setLookPitchDeg(Math.max(-28, Math.min(28, dragRef.current.pitch + dy * 0.15)));
  };

  const handlePointerUp = () => {
    dragRef.current.active = false;
  };

  // Horizon vertical offset locked to Three.js camera perspective pitch
  const horizonYPct =
    50 +
    (Math.tan((lookPitchDeg * Math.PI) / 180) /
      Math.tan(((VISOR_VERTICAL_FOV / 2) * Math.PI) / 180)) *
      50;

  // Target & shelter bearings
  const targetGuidance = useMemo(() => {
    if (!effectiveEndPOI) return null;
    const bearing = calculateBearingDegrees(curLat, curLon, effectiveEndPOI.lat, effectiveEndPOI.lon);
    const distM = marsDistanceMeters(curLat, curLon, effectiveEndPOI.lat, effectiveEndPOI.lon);
    const delta = normalizeSignedAngle(bearing - viewHeading);
    return { name: effectiveEndPOI.name, bearing: Math.round(bearing), distM, delta };
  }, [curLat, curLon, effectiveEndPOI, viewHeading]);

  const shelterVector = useMemo(() => {
    const st = nearestShelter?.station;
    if (!st) return null;
    const bearing = calculateBearingDegrees(curLat, curLon, st.lat, st.lon);
    const distM = marsDistanceMeters(curLat, curLon, st.lat, st.lon);
    const delta = normalizeSignedAngle(bearing - viewHeading);
    return { name: st.name, bearing: Math.round(bearing), distM, delta };
  }, [curLat, curLon, nearestShelter, viewHeading]);

  const returnToPathDelta = useMemo(() => {
    if (!isOffRoute || deviation?.returnBearing === undefined) return null;
    return normalizeSignedAngle(deviation.returnBearing - viewHeading);
  }, [isOffRoute, deviation, viewHeading]);

  // Project POIs and Hazard Zones into horizontal visor FOV (±55°)
  const projectedMarkers = useMemo(() => {
    const { sciencePOIs = [], hazardZones = [] } = scienceHazardsData;
    const items = [];

    for (const poi of sciencePOIs) {
      const distM = marsDistanceMeters(curLat, curLon, poi.lat, poi.lon);
      if (distM < 12 || distM > 6000) continue;
      const bearing = calculateBearingDegrees(curLat, curLon, poi.lat, poi.lon);
      const delta = normalizeSignedAngle(bearing - viewHeading);
      const id = `poi-${poi.id}`;
      const projected = screenMarkerCoords[id];
      if (!projected && Math.abs(delta) > HALF_FOV) continue;
      const xPct = projected ? projected.xPct : 50 + (delta / HALF_FOV) * 44;
      const yPct = projected
        ? projected.yPct
        : Math.max(18, Math.min(72, horizonYPct - 2 - Math.min(distM, 4500) / 300));
      if (xPct < 2 || xPct > 98 || yPct < 8 || yPct > 90) continue;
      items.push({
        id,
        kind: poi.isChargingStation ? 'charging' : 'poi',
        isTarget: endPOI?.id === poi.id,
        label: poi.name,
        tag: poi.minerals,
        description: poi.description,
        distM,
        absDelta: Math.abs(delta),
        xPct,
        yPct,
      });
    }

    for (const hz of hazardZones) {
      const distM = marsDistanceMeters(curLat, curLon, hz.lat, hz.lon);
      if (distM > 4000) continue;
      const bearing = calculateBearingDegrees(curLat, curLon, hz.lat, hz.lon);
      const delta = normalizeSignedAngle(bearing - viewHeading);
      const id = `hz-${hz.id}`;
      const projected = screenMarkerCoords[id];
      if (!projected && Math.abs(delta) > HALF_FOV) continue;
      const xPct = projected ? projected.xPct : 50 + (delta / HALF_FOV) * 44;
      const yPct = projected
        ? projected.yPct
        : Math.max(22, Math.min(76, horizonYPct + 3 + (1 - Math.min(distM, 3500) / 3500) * 14));
      if (xPct < 2 || xPct > 98 || yPct < 8 || yPct > 90) continue;
      items.push({
        id,
        kind: 'hazard',
        severity: hz.severity,
        label: hz.name,
        tag: hz.type === 'steep_slope' ? 'SLOPE >15°' : 'SAND TRAP (Aeb)',
        description: hz.description || 'High slip / sinkage terrain hazard.',
        distM,
        absDelta: Math.abs(delta),
        xPct,
        yPct,
      });
    }

    return items.sort((a, b) => b.distM - a.distM).slice(0, 10);
  }, [curLat, curLon, viewHeading, endPOI?.id, horizonYPct, screenMarkerCoords]);

  // Gaze-target lock when a marker is within ±1.2° of center reticle
  const gazeLockedMarker = useMemo(() => {
    const candidates = projectedMarkers.filter((m) => m.absDelta <= 1.2);
    if (!candidates.length) return null;
    return candidates.sort((a, b) => a.absDelta - b.absDelta)[0];
  }, [projectedMarkers]);

  // Compass ribbon ticks within ±60° of viewHeading
  const compassTicks = useMemo(() => {
    const ticks = [];
    for (let offset = -60; offset <= 60; offset += 15) {
      const deg = ((Math.round(viewHeading / 15) * 15 + offset) % 360 + 360) % 360;
      const exactOffset = normalizeSignedAngle(deg - viewHeading);
      if (Math.abs(exactOffset) > 60) continue;
      const cardinal = CARDINALS.find((c) => c.deg === deg);
      ticks.push({
        deg,
        label: cardinal ? cardinal.label : `${deg}°`,
        isCardinal: Boolean(cardinal),
        xPct: 50 + (exactOffset / 60) * 46,
      });
    }
    return ticks;
  }, [viewHeading]);

  return (
    <div
      ref={rootRef}
      onClick={(e) => {
        if (isArMode && xrSupported && !xrSession && !e.target?.closest?.('button,a')) {
          startArSession();
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      className={`relative h-screen w-screen overflow-hidden select-none font-sans text-cyan-50 cursor-grab active:cursor-grabbing ${
        isTransparentBg ? 'bg-transparent' : isLowLight ? 'bg-slate-950' : 'bg-slate-950'
      }`}
    >
      {/* DEDICATED 3D TERRAIN MOUNT SLOT (USGS SIM 3464 Three.js First-Person Terrain; Martian world hidden in desktop transparent AR mode) */}
      <div id="visor-3d-terrain-slot" className="pointer-events-none absolute inset-0 z-0">
        {(!isTransparentBg || isArMode) && (
          <Visor3DTerrain
            currentLatLon={[curLat, curLon]}
            viewHeading={viewHeading}
            lookPitchDeg={lookPitchDeg}
            routePathCoords={effectiveRoutePathCoords}
            projectedMarkers={projectedMarkers}
            isOffRoute={isOffRoute}
            isDusty={isDusty}
            isLowLight={isLowLight}
            showContours={showContours}
            arPassthrough={isTransparentBg}
            xrSession={xrSession}
            hudState={snapshot}
            targetBearingDeg={targetGuidance?.bearing ?? null}
            targetDistM={targetGuidance?.distM ?? null}
            onXrHeadYaw={(yaw) => setLookYawOffset(normalizeSignedAngle(yaw))}
            onXrStickMove={moveByStick}
            onGroundElevation={setGroundElevM}
            onProjectedScreenMarkers={setScreenMarkerCoords}
          />
        )}
      </div>

      {/* Prominent Enter VR/AR Prompt when in AR mode on Quest Browser */}
      {isArMode && !xrSession && (
        <div className="pointer-events-auto fixed inset-x-0 bottom-24 z-40 flex justify-center">
          <button
            onClick={startArSession}
            className="flex items-center gap-2.5 rounded-full border-2 border-emerald-400 bg-emerald-950/90 px-6 py-3 text-sm font-extrabold tracking-wider text-emerald-100 shadow-[0_0_28px_rgba(52,211,153,0.45)] hover:bg-emerald-900 cursor-pointer backdrop-blur-md"
          >
            <Eye className="h-5 w-5 text-emerald-300" />
            ENTER VR / AR PASSTHROUGH
          </button>
        </div>
      )}

      {/* DUST STORM & LOW-LIGHT ATMOSPHERIC VISOR EFFECTS */}
      {isDusty && (
        <div
          className="pointer-events-none absolute inset-0 z-[5]"
          style={{
            background:
              'radial-gradient(circle at 50% 45%, rgba(180, 83, 9, 0.24) 0%, rgba(120, 53, 15, 0.52) 100%)',
            backdropFilter: 'blur(1px)',
          }}
        />
      )}
      {isLowLight && !isDusty && (
        <div
          className="pointer-events-none absolute inset-0 z-[5]"
          style={{
            background: 'rgba(2, 6, 23, 0.42)',
          }}
        />
      )}

      {/* OFF-ROUTE VISOR BORDER PULSE */}
      {isOffRoute && (
        <div
          className={`pointer-events-none absolute inset-0 z-[15] border-4 ${
            deviation?.severity === 'critical'
              ? 'border-red-500/80 animate-pulse'
              : 'border-amber-400/75 animate-pulse'
          }`}
        />
      )}

      {/* SYNTHETIC WIREFRAME CONTOUR, HORIZON & PROJECTED A* GROUND PATH */}
      <div className="pointer-events-none absolute inset-0 z-10">
        {(!isTransparentBg || !isArMode) && (
          <div
            className="absolute inset-0"
            style={{
              background: isTransparentBg
                ? 'radial-gradient(ellipse at center, transparent 58%, rgba(2, 6, 23, 0.55) 100%)'
                : 'radial-gradient(ellipse at center, rgba(8, 47, 73, 0.14) 0%, rgba(2, 6, 23, 0.85) 100%)',
            }}
          />
        )}

        <svg
          viewBox="0 0 1000 600"
          preserveAspectRatio="none"
          className={`absolute inset-0 h-full w-full ${
            isDusty || isLowLight ? 'opacity-80' : 'opacity-50'
          }`}
        >
          <defs>
            <linearGradient id="contourGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.18" />
              <stop offset="55%" stopColor="#06b6d4" stopOpacity="0.48" />
              <stop offset="100%" stopColor="#f97316" stopOpacity="0.55" />
            </linearGradient>
          </defs>

          {/* Dynamic Horizon line & pitch ladder */}
          <line
            x1="60"
            y1={horizonYPct * 6}
            x2="940"
            y2={horizonYPct * 6}
            stroke="#22d3ee"
            strokeOpacity="0.32"
            strokeDasharray="8 8"
          />
          <line
            x1="470"
            y1={(horizonYPct - 5) * 6}
            x2="530"
            y2={(horizonYPct - 5) * 6}
            stroke="#22d3ee"
            strokeOpacity="0.4"
          />
          <line
            x1="470"
            y1={(horizonYPct + 5) * 6}
            x2="530"
            y2={(horizonYPct + 5) * 6}
            stroke="#22d3ee"
            strokeOpacity="0.4"
          />

          {/* Synthetic topographic wireframe isolines */}
          {showContours &&
            [0, 1, 2, 3, 4, 5].map((i) => {
              const yBase = horizonYPct * 6 + 42 + i * 42;
              const shift = ((viewHeading * 2.5 + i * 35) % 180) - 90;
              return (
                <path
                  key={i}
                  d={`M -40 ${yBase} Q ${240 + shift} ${yBase - 28 - i * 4}, 500 ${yBase - 4} T 1040 ${yBase + 8}`}
                  fill="none"
                  stroke="url(#contourGrad)"
                  strokeWidth={isDusty || isLowLight ? '1.8' : i === 2 ? '1.5' : '1'}
                />
              );
            })}
        </svg>

        {/* Center optical reticle */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-65">
          <Crosshair
            className={`h-8 w-8 ${
              gazeLockedMarker ? 'text-emerald-300 scale-110' : 'text-cyan-300'
            } transition-transform`}
            strokeWidth={1.3}
          />
        </div>

        {/* Gaze-Locked Target Inspection Card */}
        {gazeLockedMarker && (
          <div className="absolute left-1/2 top-[56%] -translate-x-1/2 w-72 rounded-xl border border-cyan-400/70 bg-slate-950/85 p-2.5 text-[11px] font-mono shadow-2xl backdrop-blur-md">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase text-emerald-300">
              <span>Gaze Lock • {formatDistance(gazeLockedMarker.distM)}</span>
              <span>{gazeLockedMarker.kind === 'hazard' ? 'HAZARD' : 'TARGET'}</span>
            </div>
            <div className="mt-0.5 font-bold text-white">{gazeLockedMarker.label}</div>
            <div className="text-[10px] text-cyan-200">{gazeLockedMarker.tag}</div>
            {gazeLockedMarker.description && (
              <div className="mt-1 line-clamp-2 text-[10px] text-slate-300">
                {gazeLockedMarker.description}
              </div>
            )}
          </div>
        )}
      </div>

      {/* BEARING-PROJECTED AR POI, HAZARD & RETURN-TO-PATH MARKERS (Minimal pins; details only on Gaze Lock) */}
      <div className="pointer-events-none absolute inset-0 z-20">
        {projectedMarkers.map((m) => {
          const isLocked = gazeLockedMarker?.id === m.id;
          return (
            <div
              key={m.id}
              style={{ left: `${m.xPct}%`, top: `${m.yPct}%` }}
              className={`absolute -translate-x-1/2 -translate-y-1/2 ${
                isLocked ? 'scale-110' : 'opacity-85'
              }`}
            >
              {m.kind === 'hazard' ? (
                <div className="flex flex-col items-center">
                  <span className="flex items-center gap-1 rounded-full bg-red-950/75 border border-red-400/70 px-1.5 py-0.5 text-[9px] font-mono font-bold text-red-200 backdrop-blur-sm">
                    <AlertTriangle className="h-2.5 w-2.5 text-red-400" />
                    {formatDistance(m.distM)}
                  </span>
                  <div className="mt-0.5 h-1.5 w-1.5 rotate-45 bg-red-400" />
                </div>
              ) : (
                <div className="flex flex-col items-center">
                  <span
                    className={`flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-mono font-semibold backdrop-blur-sm ${
                      m.isTarget
                        ? 'border-emerald-400 bg-emerald-950/80 text-emerald-200'
                        : m.kind === 'charging'
                          ? 'border-amber-400/75 bg-amber-950/75 text-amber-200'
                          : 'border-cyan-400/50 bg-slate-950/65 text-cyan-200'
                    }`}
                  >
                    {m.kind === 'charging' ? (
                      <Zap className="h-2.5 w-2.5 text-amber-300" />
                    ) : (
                      <MapPin className="h-2.5 w-2.5 text-cyan-300" />
                    )}
                    {formatDistance(m.distM)}
                  </span>
                  <div
                    className={`mt-0.5 h-1.5 w-1.5 rounded-full ${
                      m.isTarget
                        ? 'bg-emerald-300 shadow-[0_0_6px_#34d399]'
                        : m.kind === 'charging'
                          ? 'bg-amber-300'
                          : 'bg-cyan-300'
                    }`}
                  />
                </div>
              )}
            </div>
          );
        })}

        {/* Return-to-Path AR Marker when off-route */}
        {isOffRoute && returnToPathDelta !== null && Math.abs(returnToPathDelta) <= HALF_FOV && (
          <div
            style={{
              left: `${50 + (returnToPathDelta / HALF_FOV) * 44}%`,
              top: `${Math.min(78, horizonYPct + 14)}%`,
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2"
          >
            <div className="rounded-lg border-2 border-amber-400 bg-amber-950/90 px-2.5 py-1 text-[10px] font-mono font-bold text-amber-200 shadow-xl">
              RETURN TO PATH • {deviation.distMeters} m ({deviation.returnBearing}°)
            </div>
          </div>
        )}

        {/* Off-screen return-to-path edge chevron */}
        {isOffRoute && returnToPathDelta !== null && Math.abs(returnToPathDelta) > HALF_FOV && (
          <div
            className={`absolute top-[42%] -translate-y-1/2 flex items-center gap-1 rounded-lg border-2 border-amber-400 bg-amber-950/90 px-2.5 py-1.5 text-xs font-mono text-amber-200 backdrop-blur-md ${
              returnToPathDelta < 0 ? 'left-4' : 'right-4'
            }`}
          >
            {returnToPathDelta < 0 && <ChevronLeft className="h-4 w-4 text-amber-300" />}
            <div>
              <div className="text-[10px] font-bold uppercase">RETURN TO PATH</div>
              <div>{deviation.distMeters} m</div>
            </div>
            {returnToPathDelta > 0 && <ChevronRight className="h-4 w-4 text-amber-300" />}
          </div>
        )}

        {/* Off-screen target edge chevron */}
        {targetGuidance && Math.abs(targetGuidance.delta) > HALF_FOV && (
          <div
            className={`absolute top-1/2 -translate-y-1/2 flex items-center gap-1 rounded-lg border border-emerald-400/70 bg-emerald-950/80 px-2.5 py-1.5 text-xs font-mono text-emerald-200 backdrop-blur-md ${
              targetGuidance.delta < 0 ? 'left-4' : 'right-4'
            }`}
          >
            {targetGuidance.delta < 0 && <ChevronLeft className="h-4 w-4 text-emerald-300" />}
            <div>
              <div className="text-[10px] font-bold uppercase">TARGET</div>
              <div>{formatDistance(targetGuidance.distM)}</div>
            </div>
            {targetGuidance.delta > 0 && <ChevronRight className="h-4 w-4 text-emerald-300" />}
          </div>
        )}
      </div>

      {/* FOREGROUND HUD CHROME */}
      <div className="pointer-events-none relative z-30 flex h-full flex-col justify-between p-4">
        {/* TOP ROW: STATUS + COMPASS RIBBON + MANEUVER / OFF-ROUTE BANNER */}
        <div className="flex flex-col items-center gap-2">
          <div className="flex w-full flex-wrap items-center justify-between gap-2 text-[11px] font-mono">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-cyan-500/30 bg-slate-950/80 px-3 py-1 backdrop-blur-md">
              <Radio
                className={`h-3.5 w-3.5 ${
                  linkLive ? 'text-emerald-400 animate-pulse' : 'text-amber-400'
                }`}
              />
              <span className="font-bold tracking-wider">
                ARES-EVA VISOR {linkLive ? '• LINK ACTIVE' : '• STANDBY'}
              </span>
              <span className="flex items-center gap-1 text-[10px] text-emerald-300 border-l border-cyan-500/30 pl-2">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                LIVE RE-ROUTE: AUTO
              </span>
              {(isDusty || isLowLight) && (
                <span className="rounded bg-cyan-500/20 px-1.5 py-0.5 text-[9px] text-cyan-200">
                  CONTOUR BOOST
                </span>
              )}
              {lastSyncTs && (
                <span className="text-slate-400 hidden sm:inline">
                  {new Date(lastSyncTs).toLocaleTimeString()}
                </span>
              )}
            </div>

            {/* Two-Way Sim Controls */}
            <div className="pointer-events-auto flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => {
                  if (!linkLive) {
                    setSnapshot((prev) => ({ ...prev, navPlaying: !prev.navPlaying }));
                  }
                  sendVisorCommand('TOGGLE_PLAY');
                }}
                className="flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-950/80 px-2.5 py-1 text-[11px] font-bold text-emerald-200 hover:bg-emerald-900/80 cursor-pointer backdrop-blur-md"
              >
                {navPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {navPlaying ? 'Pause' : (isOffRoute ? 'Re-Route & Walk' : 'Walk')}
              </button>
              <button
                onClick={() => {
                  if (linkLive) {
                    sendVisorCommand('RECALCULATE_ROUTE');
                  } else {
                    handleStandaloneRecalculate();
                  }
                }}
                className="flex items-center gap-1 rounded-full border border-cyan-400/60 bg-cyan-950/90 px-3 py-1 text-[11px] font-bold text-cyan-200 hover:bg-cyan-900 cursor-pointer backdrop-blur-md shadow-[0_0_10px_rgba(6,182,212,0.3)]"
                title="Recalculate A* corridor from current coordinates to target"
              >
                <Compass className="h-3.5 w-3.5 text-cyan-300" />
                <span>RE-ROUTE GPS</span>
              </button>
              <button
                onClick={() => {
                  const nextSpeed = navSpeed === 1 ? 3 : 1;
                  if (!linkLive) {
                    setSnapshot((prev) => ({ ...prev, navSpeed: nextSpeed }));
                  }
                  sendVisorCommand('SET_SPEED', { speed: nextSpeed });
                }}
                className="rounded-full border border-cyan-500/40 bg-slate-950/80 px-2.5 py-1 text-[11px] font-bold text-cyan-200 hover:bg-cyan-950/70 cursor-pointer backdrop-blur-md"
              >
                {navSpeed}x
              </button>
              <button
                onClick={() =>
                  sendVisorCommand('SET_WEATHER', {
                    weatherKey:
                      weatherKey === 'nominal'
                        ? 'dust_storm'
                        : weatherKey === 'dust_storm'
                          ? 'solar_storm'
                          : 'nominal',
                  })
                }
                className="rounded-full border border-amber-500/40 bg-slate-950/80 px-2.5 py-1 text-[11px] font-bold text-amber-200 hover:bg-amber-950/60 cursor-pointer backdrop-blur-md"
              >
                Env: {weatherCondition?.label}
              </button>
              <button
                onClick={() => setShowContours((v) => !v)}
                className="rounded-full border border-cyan-500/40 bg-slate-950/80 px-2.5 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-950/70 cursor-pointer backdrop-blur-md"
              >
                Contours: {showContours ? 'ON' : 'OFF'}
              </button>
              {isArMode ? (
                xrSession ? (
                  <button
                    onClick={() => xrSession.end()}
                    className="rounded-full border border-red-400/70 bg-red-950/80 px-2.5 py-1 text-[11px] font-bold text-red-200 hover:bg-red-900/80 cursor-pointer backdrop-blur-md"
                  >
                    Exit AR
                  </button>
                ) : (
                  <button
                    onClick={startArSession}
                    className="rounded-full border border-emerald-400/70 bg-emerald-950/80 px-2.5 py-1 text-[11px] font-bold text-emerald-200 hover:bg-emerald-900/80 cursor-pointer backdrop-blur-md"
                  >
                    {xrSupported ? 'Enter Quest 2 AR' : 'AR Transparent'}
                  </button>
                )
              ) : (
                <a
                  href="?mode=visor-ar"
                  className="rounded-full border border-emerald-400/50 bg-emerald-950/80 px-2.5 py-1 text-[11px] font-bold text-emerald-200 hover:bg-emerald-900/80 backdrop-blur-md"
                >
                  Quest 2 AR
                </a>
              )}
              {(lookYawOffset !== 0 || lookPitchDeg !== 0) && (
                <button
                  onClick={() => {
                    setLookYawOffset(0);
                    setLookPitchDeg(0);
                  }}
                  className="flex items-center gap-1 rounded-full border border-cyan-400/50 bg-cyan-950/80 px-2.5 py-1 text-[11px] font-semibold text-cyan-100 cursor-pointer backdrop-blur-md"
                >
                  <RotateCcw className="h-3 w-3" />
                  Center Look
                </button>
              )}
            </div>
          </div>

          {/* Heading Compass Ribbon */}
          <div className="relative h-10 w-full max-w-2xl overflow-hidden rounded-xl border border-cyan-500/35 bg-slate-950/75 backdrop-blur-md">
            <div className="absolute left-1/2 top-0 h-2.5 w-0.5 -translate-x-1/2 bg-cyan-300" />
            <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold text-cyan-300">
              {viewHeading}°
            </div>
            {compassTicks.map((t) => (
              <div
                key={t.deg}
                style={{ left: `${t.xPct}%` }}
                className="absolute top-1.5 -translate-x-1/2 flex flex-col items-center"
              >
                <div
                  className={`w-px ${
                    t.isCardinal ? 'h-2.5 bg-cyan-300' : 'h-1.5 bg-cyan-500/50'
                  }`}
                />
                <span
                  className={`text-[10px] font-mono ${
                    t.isCardinal ? 'font-bold text-cyan-200' : 'text-slate-400'
                  }`}
                >
                  {t.label}
                </span>
              </div>
            ))}
            {targetGuidance && Math.abs(targetGuidance.delta) <= 60 && (
              <div
                style={{ left: `${50 + (targetGuidance.delta / 60) * 46}%` }}
                className="absolute bottom-1 -translate-x-1/2"
              >
                <div className="h-2 w-2 rotate-45 bg-emerald-400 shadow-[0_0_8px_#34d399]" />
              </div>
            )}
          </div>

          {/* Active Live Re-Route Computing Overlay */}
          {engineLoading && (
            <div className="pointer-events-none flex items-center gap-2 rounded-full border border-cyan-400/80 bg-slate-950/95 px-4 py-1.5 text-xs font-mono font-bold text-cyan-200 shadow-2xl backdrop-blur-md animate-pulse">
              <Compass className="h-4 w-4 animate-spin text-cyan-400" />
              <span>LIVE RE-ROUTING: COMPUTING A* CORRIDOR...</span>
            </div>
          )}

          {/* Off-Route Deviation Banner (Subtle pill for minor drift, full alert only when critical >180m) */}
          {isOffRoute &&
            (deviation?.severity === 'critical' ? (
              <div className="pointer-events-auto flex w-full max-w-xl items-center justify-between gap-3 rounded-xl border-2 border-red-400/80 bg-red-950/90 px-3.5 py-2 text-red-100 shadow-2xl backdrop-blur-md">
                <div className="flex items-center gap-2 min-w-0">
                  <AlertTriangle className="h-5 w-5 shrink-0 text-red-300 animate-pulse" />
                  <div className="min-w-0">
                    <div className="text-xs font-extrabold uppercase tracking-wider">
                      Off-Route: {deviation.distMeters} m from A* Corridor
                    </div>
                    <div className="text-[11px] text-red-200 truncate">
                      Turn to {deviation.returnBearing}° or re-route directly to target
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (linkLive) {
                      sendVisorCommand('RECALCULATE_ROUTE');
                    } else {
                      handleStandaloneRecalculate();
                    }
                  }}
                  className="shrink-0 rounded-lg border border-red-300/70 bg-red-500/25 px-2.5 py-1 text-[11px] font-bold uppercase hover:bg-red-500/40 cursor-pointer"
                >
                  Re-Route to Target
                </button>
              </div>
            ) : (
              <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-amber-400/45 bg-slate-950/75 px-3 py-1 text-[11px] font-mono text-amber-200 backdrop-blur-md">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                <span>
                  Off-path {deviation.distMeters}m • {deviation.returnBearing}°
                </span>
                <button
                  onClick={() => {
                    if (linkLive) {
                      sendVisorCommand('RECALCULATE_ROUTE');
                    } else {
                      handleStandaloneRecalculate();
                    }
                  }}
                  className="rounded-full border border-amber-400/50 bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase hover:bg-amber-500/35 cursor-pointer"
                >
                  Re-Route
                </button>
              </div>
            ))}

          {/* Rule #1 Walkback Point-of-No-Return Alert Banner */}
          {livePrediction?.alert_level === 'CRITICAL_BREACH_POINT_OF_NO_RETURN' && (
            <div className="pointer-events-auto flex w-full max-w-xl items-center justify-between gap-3 rounded-xl border-2 border-red-500 bg-red-950/95 px-3.5 py-2 text-red-100 shadow-2xl backdrop-blur-md animate-pulse">
              <div className="flex items-center gap-2 min-w-0">
                <ShieldAlert className="h-5 w-5 shrink-0 text-red-400 animate-spin" />
                <div className="min-w-0">
                  <div className="text-xs font-black uppercase tracking-wider text-red-300">
                    RULE #1 ALERT: POINT OF NO RETURN BREACHED
                  </div>
                  <div className="text-[10.5px] text-red-100 truncate">
                    {livePrediction?.tactical_recommendation || 'Immediately retreat to nearest pressurized habitat.'}
                  </div>
                </div>
              </div>
              <button
                onClick={() => sendVisorCommand('SHELTER_DIVERT')}
                className="shrink-0 rounded-lg border border-white bg-red-600 px-3 py-1 text-[11px] font-extrabold uppercase hover:bg-red-500 cursor-pointer text-white"
              >
                ABORT NOW
              </button>
            </div>
          )}

          {/* Slim Turn-by-Turn / Emergency Pill */}
          <div
            className={`flex items-center justify-between gap-3 rounded-full border px-4 py-1.5 backdrop-blur-md transition-colors ${
              isEmergency
                ? 'max-w-xl border-red-400/80 bg-red-950/85 text-red-100'
                : 'max-w-md border-cyan-500/30 bg-slate-950/55 text-cyan-50'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {isEmergency ? (
                <ShieldAlert className="h-4 w-4 shrink-0 text-red-400 animate-pulse" />
              ) : currentManeuver?.icon === 'charge' ? (
                <Zap className="h-4 w-4 shrink-0 text-amber-300 animate-pulse" />
              ) : (
                <Navigation2
                  className="h-4 w-4 shrink-0 text-emerald-300"
                  style={{ transform: `rotate(${viewHeading}deg)` }}
                />
              )}
              <span className="text-xs font-extrabold font-mono text-emerald-300 shrink-0">
                {currentManeuver?.distanceText}
              </span>
              <span className="truncate text-[11px] font-medium text-cyan-100">
                {isEmergency
                  ? weatherCondition?.alert ||
                    `Dust Front ${dustFrontState?.distanceAheadKm} km • ETA ${dustFrontState?.etaMin} min`
                  : !linkLive && !isArMode && offlineRescueRoute?.station
                    ? offlineRescueRoute.docked
                      ? `EVA TABLET OFFLINE — Docked at nearest charging station: ${offlineRescueRoute.station.name}`
                      : `EVA TABLET OFFLINE — Routing to nearest charging station: ${offlineRescueRoute.station.name} (${offlineRescueRoute.distKm} km)`
                    : currentManeuver?.instruction}
              </span>
            </div>

            {isEmergency && (
              <button
                onClick={() => sendVisorCommand('SHELTER_DIVERT')}
                className="pointer-events-auto shrink-0 rounded-full border border-red-300/70 bg-red-600/90 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white hover:bg-red-500 cursor-pointer"
              >
                Divert
              </button>
            )}
          </div>
        </div>

        {/* BOTTOM ROW: MINIMAL PLSS STRIP | STEP PAD | MINIMAL MEDA STRIP */}
        <div className="flex items-end justify-between gap-3">
          {/* LEFT: COMPACT PLSS STRIP */}
          <div className="flex items-center gap-2.5 rounded-full border border-cyan-500/30 bg-slate-950/60 px-3.5 py-1.5 font-mono text-[11px] backdrop-blur-md">
            <span className={`flex items-center gap-1 font-bold ${liveNavState?.isRecharging ? 'text-amber-300' : lowReserve ? 'text-red-400' : 'text-cyan-200'}`}>
              {liveNavState?.isRecharging ? (
                <BatteryCharging className="h-3.5 w-3.5 text-amber-300 animate-pulse" />
              ) : (
                <Battery className="h-3.5 w-3.5 text-cyan-300" />
              )}
              {Number((liveNavState?.currentBattery ?? 0).toFixed(1))}%
            </span>
            <span className={`flex items-center gap-1 font-bold ${liveNavState?.isRecharging ? 'text-amber-300' : lowReserve ? 'text-red-400' : 'text-emerald-300'}`}>
              <Droplets className="h-3.5 w-3.5" />
              {Number((liveNavState?.currentO2 ?? 0).toFixed(1))}%
            </span>
            {liveNavState?.isRecharging && (
              <span className="rounded-full bg-amber-500/20 border border-amber-400/40 px-2 py-0.5 text-[9px] font-bold text-amber-200 animate-pulse">
                CHARGING
              </span>
            )}
            {/* Apollo/Artemis Rule #1 Walkback Horizon Buffer */}
            {livePrediction?.walkback_margin_min !== undefined && (
              <span
                className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-[9.5px] font-bold ${
                  livePrediction.alert_level === 'CRITICAL_BREACH_POINT_OF_NO_RETURN'
                    ? 'bg-red-500/30 text-red-300 border border-red-400/70 animate-pulse'
                    : livePrediction.alert_level === 'WARNING_APPROACHING_WALKBACK_LIMIT'
                      ? 'bg-amber-500/20 text-amber-300 border border-amber-400/50'
                      : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                }`}
                title={`Rule #1 Walkback Point-of-No-Return: ${livePrediction.tactical_recommendation || ''}`}
              >
                WB: {livePrediction.walkback_margin_min}m
              </span>
            )}
            {livePrediction?.dynamic_consumption_rates?.o2_consumption_rate_lpm && (
              <span className="hidden sm:inline text-cyan-300/80 text-[10px]" title="Dynamic PLSS O2 Burn Rate">
                {livePrediction.dynamic_consumption_rates.o2_consumption_rate_lpm.toFixed(2)} L/m
              </span>
            )}
            {livePrediction?.dynamic_consumption_rates?.battery_discharge_rate_watts && (
              <span className="hidden md:inline text-amber-300/80 text-[10px]" title="Dynamic Electrical Load">
                {Math.round(livePrediction.dynamic_consumption_rates.battery_discharge_rate_watts)}W
              </span>
            )}
            <span className="hidden sm:flex items-center gap-1 text-rose-200">
              <Activity className="h-3 w-3 text-rose-300" />
              {liveNavState?.heartRateBpm ?? 76}
            </span>
            <span className="hidden md:flex items-center gap-1 text-orange-200">
              <Flame className="h-3 w-3 text-orange-300" />
              {martianEnv?.suitHeaterWatts ?? 75}W
            </span>
          </div>

          {/* CENTER: MINIMAL EVA STEP PAD + ELEVATION */}
          <div className="pointer-events-auto flex flex-col items-center gap-1 rounded-2xl border border-cyan-500/25 bg-slate-950/60 px-3 py-1.5 font-mono text-[10px] backdrop-blur-md">
            <div className="flex items-center gap-1">
              <button
                onClick={() => moveAstronaut(-90)}
                title="Step Left (A)"
                className="rounded-lg bg-slate-900/80 p-1 hover:bg-cyan-950 cursor-pointer"
              >
                <ArrowLeft className="h-3.5 w-3.5 text-cyan-300" />
              </button>
              <button
                onClick={() => moveAstronaut(0)}
                title="Step Forward (W)"
                className="rounded-lg bg-emerald-950/80 border border-emerald-500/40 px-2 py-1 font-bold text-emerald-200 hover:bg-emerald-900 cursor-pointer flex items-center gap-1"
              >
                <ArrowUp className="h-3 w-3" />
                W
              </button>
              <button
                onClick={() => moveAstronaut(180)}
                title="Step Back (S)"
                className="rounded-lg bg-slate-900/80 p-1 hover:bg-cyan-950 cursor-pointer"
              >
                <ArrowDown className="h-3.5 w-3.5 text-cyan-300" />
              </button>
              <button
                onClick={() => moveAstronaut(90)}
                title="Step Right (D)"
                className="rounded-lg bg-slate-900/80 p-1 hover:bg-cyan-950 cursor-pointer"
              >
                <ArrowRight className="h-3.5 w-3.5 text-cyan-300" />
              </button>
            </div>
            <div className="flex items-center gap-2 text-slate-300">
              {groundElevM !== null && <span className="text-orange-300">{groundElevM}m</span>}
              <span>•</span>
              <span className="text-emerald-300">ETA {liveNavState?.estTimeRemainingMin ?? 0}m</span>
              {shelterVector && (
                <>
                  <span className="hidden sm:inline">•</span>
                  <span className={`hidden sm:inline ${isEmergency ? 'text-red-300 font-bold' : ''}`}>
                    Shelter {formatDistance(shelterVector.distM)}
                  </span>
                </>
              )}
            </div>
          </div>

          {/* RIGHT: COMPACT MEDA STRIP */}
          <div className="flex items-center gap-3 rounded-full border border-cyan-500/30 bg-slate-950/60 px-3.5 py-1.5 font-mono text-[11px] backdrop-blur-md">
            <span className="font-bold text-amber-300">{martianEnv?.lstText}</span>
            <span className="flex items-center gap-1 text-cyan-100">
              <Thermometer className="h-3.5 w-3.5 text-cyan-300" />
              {martianEnv?.ambientTempC ?? -40}°C
            </span>
            <span className="hidden sm:flex items-center gap-1 text-amber-100">
              <Wind className="h-3 w-3 text-amber-300" />
              {dustFrontState?.active ? dustFrontState.pressureDropPa : latestMeda?.pressure ?? 778.9}Pa
            </span>
            <span
              className={`hidden md:flex items-center gap-1 ${
                (weatherCondition?.radRateMgyHr ?? 0) > 0.1 ? 'text-red-400 font-bold' : 'text-purple-200'
              }`}
            >
              <ShieldAlert className="h-3 w-3" />
              {weatherCondition?.radRateMgyHr ?? 0.011}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
