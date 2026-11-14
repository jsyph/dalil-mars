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
  marsDistanceMeters,
  SAFE_RESERVE_PCT,
} from '../utils/pathfinder';
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
const WALK_SPEED_MPS = 42;

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

export default function VisorHudPage() {
  const [snapshot, setSnapshot] = useState(() => readCachedVisorState() || FALLBACK_SNAPSHOT);
  const [linkLive, setLinkLive] = useState(() => Boolean(readCachedVisorState()));
  const [lastSyncTs, setLastSyncTs] = useState(null);
  const [showContours, setShowContours] = useState(true);

  // Interactive Head-Look (Yaw & Pitch offsets)
  const [lookYawOffset, setLookYawOffset] = useState(0);
  const [lookPitchDeg, setLookPitchDeg] = useState(0);
  const [groundElevM, setGroundElevM] = useState(null);
  const [screenMarkerCoords, setScreenMarkerCoords] = useState({});
  const dragRef = useRef({ active: false, x: 0, y: 0, yaw: 0, pitch: 0 });

  const isTransparentBg = useMemo(
    () => new URLSearchParams(window.location.search).get('bg') === 'transparent',
    []
  );

  useEffect(() => {
    const unsubscribe = subscribeVisorState((nextSnapshot, ts) => {
      setSnapshot(nextSnapshot);
      setLinkLive(true);
      setLastSyncTs(ts || Date.now());
    });
    return unsubscribe;
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
  } = snapshot;

  const bodyHeading = liveNavState?.heading ?? 0;
  const viewHeading = normalizeHeading(bodyHeading + lookYawOffset);
  const [curLat, curLon] = liveNavState?.currentLatLon ?? [18.444627, 77.450886];
  const deviation = liveNavState?.routeDeviation;
  const isOffRoute = Boolean(deviation?.isOffRoute);

  const isDusty = weatherCondition?.id === 'dust_storm' || Boolean(dustFrontState?.active);
  const isLowLight = martianEnv?.solarPhase === 'night' || martianEnv?.solarPhase === 'dusk';
  const isEmergency = weatherCondition?.id !== 'nominal' || Boolean(dustFrontState?.active);
  const lowReserve =
    (liveNavState?.currentBattery ?? 100) <= SAFE_RESERVE_PCT ||
    (liveNavState?.currentO2 ?? 100) <= SAFE_RESERVE_PCT;

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
      setSnapshot((prev) => ({
        ...prev,
        navPlaying: false,
        liveNavState: {
          ...prev.liveNavState,
          active: true,
          currentLatLon: [nextLat, nextLon],
          heading: bodyHeading,
        },
      }));
      sendVisorCommand('MANUAL_MOVE', {
        lat: nextLat,
        lon: nextLon,
        heading: bodyHeading,
      });
    },
    [curLat, curLon, viewHeading, bodyHeading]
  );

  const keysPressedRef = useRef(new Set());
  const moveStateRef = useRef({ curLat, curLon, viewHeading, bodyHeading });
  moveStateRef.current = { curLat, curLon, viewHeading, bodyHeading };

  // Smooth continuous WASD movement via requestAnimationFrame + Arrow keys for head look
  useEffect(() => {
    let animId = 0;
    let lastTime = performance.now();
    let lastSyncTs = 0;

    const flushSync = (lat, lon, heading) => {
      sendVisorCommand('MANUAL_MOVE', { lat, lon, heading });
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

          setSnapshot((prev) => ({
            ...prev,
            navPlaying: false,
            liveNavState: {
              ...prev.liveNavState,
              active: true,
              currentLatLon: [nextLat, nextLon],
              heading: bh,
            },
          }));

          if (now - lastSyncTs >= 60) {
            flushSync(nextLat, nextLon, bh);
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
        const { curLat: lat, curLon: lon, bodyHeading: bh } = moveStateRef.current;
        flushSync(lat, lon, bh);
      }
    };

    const onBlur = () => {
      if (keysPressedRef.current.size > 0) {
        keysPressedRef.current.clear();
        const { curLat: lat, curLon: lon, bodyHeading: bh } = moveStateRef.current;
        flushSync(lat, lon, bh);
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
    if (!endPOI) return null;
    const bearing = calculateBearingDegrees(curLat, curLon, endPOI.lat, endPOI.lon);
    const distM = marsDistanceMeters(curLat, curLon, endPOI.lat, endPOI.lon);
    const delta = normalizeSignedAngle(bearing - viewHeading);
    return { name: endPOI.name, bearing: Math.round(bearing), distM, delta };
  }, [curLat, curLon, endPOI, viewHeading]);

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

  // Gaze-target lock when a marker is within ±7° of center reticle
  const gazeLockedMarker = useMemo(() => {
    const candidates = projectedMarkers.filter((m) => m.absDelta <= 7);
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
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
      className={`relative h-screen w-screen overflow-hidden select-none font-sans text-cyan-50 cursor-grab active:cursor-grabbing ${
        isTransparentBg ? 'bg-transparent' : isLowLight ? 'bg-slate-950' : 'bg-slate-950'
      }`}
    >
      {/* DEDICATED 3D TERRAIN MOUNT SLOT (USGS SIM 3464 Three.js First-Person Terrain) */}
      <div id="visor-3d-terrain-slot" className="pointer-events-none absolute inset-0 z-0">
        {!isTransparentBg && (
          <Visor3DTerrain
            currentLatLon={[curLat, curLon]}
            viewHeading={viewHeading}
            lookPitchDeg={lookPitchDeg}
            routePathCoords={routePathCoords}
            isOffRoute={isOffRoute}
            isDusty={isDusty}
            isLowLight={isLowLight}
            showContours={showContours}
            onGroundElevation={setGroundElevM}
            onProjectedScreenMarkers={setScreenMarkerCoords}
          />
        )}
      </div>

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
        <div
          className="absolute inset-0"
          style={{
            background: isTransparentBg
              ? 'radial-gradient(ellipse at center, transparent 58%, rgba(2, 6, 23, 0.55) 100%)'
              : 'radial-gradient(ellipse at center, rgba(8, 47, 73, 0.14) 0%, rgba(2, 6, 23, 0.85) 100%)',
          }}
        />

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
                onClick={() => sendVisorCommand('TOGGLE_PLAY')}
                className="flex items-center gap-1 rounded-full border border-emerald-500/50 bg-emerald-950/80 px-2.5 py-1 text-[11px] font-bold text-emerald-200 hover:bg-emerald-900/80 cursor-pointer backdrop-blur-md"
              >
                {navPlaying ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                {navPlaying ? 'Pause' : 'Walk'}
              </button>
              <button
                onClick={() =>
                  sendVisorCommand('SET_SPEED', { speed: navSpeed === 1 ? 3 : 1 })
                }
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
                      Turn to {deviation.returnBearing}° to rejoin safe path
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => sendVisorCommand('SNAP_TO_ROUTE')}
                  className="shrink-0 rounded-lg border border-red-300/70 bg-red-500/25 px-2.5 py-1 text-[11px] font-bold uppercase hover:bg-red-500/40 cursor-pointer"
                >
                  Snap to Route
                </button>
              </div>
            ) : (
              <div className="pointer-events-auto flex items-center gap-2.5 rounded-full border border-amber-400/45 bg-slate-950/75 px-3 py-1 text-[11px] font-mono text-amber-200 backdrop-blur-md">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-300" />
                <span>
                  Off-path {deviation.distMeters}m • {deviation.returnBearing}°
                </span>
                <button
                  onClick={() => sendVisorCommand('SNAP_TO_ROUTE')}
                  className="rounded-full border border-amber-400/50 bg-amber-500/20 px-2 py-0.5 text-[10px] font-bold uppercase hover:bg-amber-500/35 cursor-pointer"
                >
                  Snap
                </button>
              </div>
            ))}

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
          <div className="flex items-center gap-3 rounded-full border border-cyan-500/30 bg-slate-950/60 px-3.5 py-1.5 font-mono text-[11px] backdrop-blur-md">
            <span className={`flex items-center gap-1 font-bold ${liveNavState?.isRecharging ? 'text-amber-300' : lowReserve ? 'text-red-400' : 'text-cyan-200'}`}>
              {liveNavState?.isRecharging ? (
                <BatteryCharging className="h-3.5 w-3.5 text-amber-300 animate-pulse" />
              ) : (
                <Battery className="h-3.5 w-3.5 text-cyan-300" />
              )}
              {liveNavState?.currentBattery ?? 0}%
            </span>
            <span className={`flex items-center gap-1 font-bold ${liveNavState?.isRecharging ? 'text-amber-300' : lowReserve ? 'text-red-400' : 'text-emerald-300'}`}>
              <Droplets className="h-3.5 w-3.5" />
              {liveNavState?.currentO2 ?? 0}%
            </span>
            {liveNavState?.isRecharging && (
              <span className="rounded-full bg-amber-500/20 border border-amber-400/40 px-2 py-0.5 text-[9px] font-bold text-amber-200 animate-pulse">
                CHARGING
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
