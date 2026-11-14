import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
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
  Radio,
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

const VISOR_FOV_DEG = 110; // ±55° horizontal field of view
const HALF_FOV = VISOR_FOV_DEG / 2;

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

function formatDistance(meters) {
  if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
  return `${Math.round(meters)} m`;
}

const FALLBACK_SNAPSHOT = {
  navMode: 'browse',
  liveNavState: {
    active: false,
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
  },
  martianEnv: {
    lstText: '09:30 LST',
    ambientTempC: -38.4,
    suitHeaterWatts: 77,
    daylightRemainingMin: 464,
    solarPhase: 'day',
  },
  currentManeuver: {
    icon: 'straight',
    distanceText: '2800 m',
    instruction: 'Awaiting navigation link from EVA Tablet',
    subtitle: 'Open main tablet window to stream live telemetry',
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
};

export default function VisorHudPage() {
  const [snapshot, setSnapshot] = useState(() => readCachedVisorState() || FALLBACK_SNAPSHOT);
  const [linkLive, setLinkLive] = useState(() => Boolean(readCachedVisorState()));
  const [lastSyncTs, setLastSyncTs] = useState(null);
  const [showContours, setShowContours] = useState(true);

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
    liveNavState = FALLBACK_SNAPSHOT.liveNavState,
    martianEnv = FALLBACK_SNAPSHOT.martianEnv,
    currentManeuver = FALLBACK_SNAPSHOT.currentManeuver,
    weatherCondition = FALLBACK_SNAPSHOT.weatherCondition,
    dustFrontState = FALLBACK_SNAPSHOT.dustFrontState,
    nearestShelter = FALLBACK_SNAPSHOT.nearestShelter,
    endPOI = FALLBACK_SNAPSHOT.endPOI,
    loadout = FALLBACK_SNAPSHOT.loadout,
    latestMeda = FALLBACK_SNAPSHOT.latestMeda,
  } = snapshot;

  const heading = liveNavState?.heading ?? 0;
  const [curLat, curLon] = liveNavState?.currentLatLon ?? [18.444627, 77.450886];

  const isEmergency =
    weatherCondition?.id !== 'nominal' || Boolean(dustFrontState?.active);
  const lowReserve =
    (liveNavState?.currentBattery ?? 100) <= SAFE_RESERVE_PCT ||
    (liveNavState?.currentO2 ?? 100) <= SAFE_RESERVE_PCT;

  // Target & shelter bearings for compass + edge indicators
  const targetGuidance = useMemo(() => {
    if (!endPOI) return null;
    const bearing = calculateBearingDegrees(curLat, curLon, endPOI.lat, endPOI.lon);
    const distM = marsDistanceMeters(curLat, curLon, endPOI.lat, endPOI.lon);
    const delta = normalizeSignedAngle(bearing - heading);
    return { name: endPOI.name, bearing: Math.round(bearing), distM, delta };
  }, [curLat, curLon, endPOI, heading]);

  const shelterVector = useMemo(() => {
    const st = nearestShelter?.station;
    if (!st) return null;
    const bearing = calculateBearingDegrees(curLat, curLon, st.lat, st.lon);
    const distM = marsDistanceMeters(curLat, curLon, st.lat, st.lon);
    const delta = normalizeSignedAngle(bearing - heading);
    return { name: st.name, bearing: Math.round(bearing), distM, delta };
  }, [curLat, curLon, nearestShelter, heading]);

  // Project POIs and Hazard Zones into the horizontal visor FOV (±55°)
  const projectedMarkers = useMemo(() => {
    const { sciencePOIs = [], hazardZones = [] } = scienceHazardsData;
    const items = [];

    for (const poi of sciencePOIs) {
      const distM = marsDistanceMeters(curLat, curLon, poi.lat, poi.lon);
      if (distM < 15 || distM > 6000) continue;
      const bearing = calculateBearingDegrees(curLat, curLon, poi.lat, poi.lon);
      const delta = normalizeSignedAngle(bearing - heading);
      if (Math.abs(delta) <= HALF_FOV) {
        const xPct = 50 + (delta / HALF_FOV) * 44;
        const yPct = Math.max(24, Math.min(62, 58 - Math.min(distM, 4500) / 140));
        items.push({
          id: `poi-${poi.id}`,
          kind: poi.isChargingStation ? 'charging' : 'poi',
          isTarget: endPOI?.id === poi.id,
          label: poi.name,
          tag: poi.minerals,
          distM,
          xPct,
          yPct,
        });
      }
    }

    for (const hz of hazardZones) {
      const distM = marsDistanceMeters(curLat, curLon, hz.lat, hz.lon);
      if (distM > 4000) continue;
      const bearing = calculateBearingDegrees(curLat, curLon, hz.lat, hz.lon);
      const delta = normalizeSignedAngle(bearing - heading);
      if (Math.abs(delta) <= HALF_FOV) {
        const xPct = 50 + (delta / HALF_FOV) * 44;
        const yPct = Math.max(28, Math.min(66, 62 - Math.min(distM, 3500) / 110));
        items.push({
          id: `hz-${hz.id}`,
          kind: 'hazard',
          severity: hz.severity,
          label: hz.name,
          tag: hz.type === 'steep_slope' ? 'SLOPE >15°' : 'SAND TRAP (Aeb)',
          distM,
          xPct,
          yPct,
        });
      }
    }

    return items.sort((a, b) => b.distM - a.distM).slice(0, 8);
  }, [curLat, curLon, heading, endPOI?.id]);

  // Compass ribbon ticks within ±60° of current heading
  const compassTicks = useMemo(() => {
    const ticks = [];
    for (let offset = -60; offset <= 60; offset += 15) {
      const deg = ((Math.round(heading / 15) * 15 + offset) % 360 + 360) % 360;
      const exactOffset = normalizeSignedAngle(deg - heading);
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
  }, [heading]);

  return (
    <div
      className={`relative h-screen w-screen overflow-hidden select-none font-sans text-cyan-50 ${
        isTransparentBg ? 'bg-transparent' : 'bg-slate-950'
      }`}
    >
      {/* DEDICATED 3D TERRAIN MOUNT SLOT (Teammate's Three.js / WebGL canvas renders here) */}
      <div id="visor-3d-terrain-slot" className="absolute inset-0 z-0" />

      {/* SYNTHETIC WIREFRAME CONTOUR & HELMET VISOR LAYER */}
      <div className="pointer-events-none absolute inset-0 z-10">
        {/* Subtle curved helmet vignette */}
        <div
          className="absolute inset-0"
          style={{
            background: isTransparentBg
              ? 'radial-gradient(ellipse at center, transparent 58%, rgba(2, 6, 23, 0.55) 100%)'
              : 'radial-gradient(ellipse at center, rgba(8, 47, 73, 0.14) 0%, rgba(2, 6, 23, 0.85) 100%)',
          }}
        />

        {showContours && (
          <svg
            viewBox="0 0 1200 720"
            preserveAspectRatio="none"
            className="absolute inset-0 h-full w-full opacity-45"
          >
            <defs>
              <linearGradient id="contourGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#22d3ee" stopOpacity="0.1" />
                <stop offset="55%" stopColor="#06b6d4" stopOpacity="0.35" />
                <stop offset="100%" stopColor="#f97316" stopOpacity="0.45" />
              </linearGradient>
            </defs>
            {/* Horizon line & pitch ladder */}
            <line x1="80" y1="350" x2="1120" y2="350" stroke="#22d3ee" strokeOpacity="0.22" strokeDasharray="8 8" />
            <line x1="565" y1="315" x2="635" y2="315" stroke="#22d3ee" strokeOpacity="0.35" />
            <line x1="565" y1="385" x2="635" y2="385" stroke="#22d3ee" strokeOpacity="0.35" />
            {/* Synthetic topographic wireframe isolines */}
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const yBase = 410 + i * 48;
              const shift = ((heading * 2.5 + i * 35) % 180) - 90;
              return (
                <path
                  key={i}
                  d={`M -40 ${yBase} Q ${260 + shift} ${yBase - 32 - i * 4}, 600 ${yBase - 6} T 1240 ${yBase + 10}`}
                  fill="none"
                  stroke="url(#contourGrad)"
                  strokeWidth={i === 2 ? '1.6' : '1'}
                />
              );
            })}
          </svg>
        )}

        {/* Center optical reticle */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-50">
          <Crosshair className="h-7 w-7 text-cyan-300" strokeWidth={1.25} />
        </div>
      </div>

      {/* BEARING-PROJECTED AR POI & HAZARD MARKERS */}
      <div className="pointer-events-none absolute inset-0 z-20">
        {projectedMarkers.map((m) => (
          <div
            key={m.id}
            style={{ left: `${m.xPct}%`, top: `${m.yPct}%` }}
            className="absolute -translate-x-1/2 -translate-y-1/2 transition-all duration-200"
          >
            {m.kind === 'hazard' ? (
              <div className="flex flex-col items-center">
                <div className="rounded border border-red-400/80 bg-red-950/75 px-2 py-0.5 text-[10px] font-mono text-red-200 shadow-lg backdrop-blur-sm">
                  <div className="flex items-center gap-1 font-bold uppercase">
                    <AlertTriangle className="h-3 w-3 text-red-400" />
                    {m.tag}
                  </div>
                  <div className="text-[9px] text-red-300/90">
                    {m.label} • {formatDistance(m.distM)}
                  </div>
                </div>
                <div className="h-3 w-px bg-red-400/70" />
                <div className="h-2 w-2 rotate-45 border border-red-400 bg-red-500/40" />
              </div>
            ) : (
              <div className="flex flex-col items-center">
                <div
                  className={`rounded border px-2 py-0.5 text-[10px] font-mono shadow-lg backdrop-blur-sm ${
                    m.isTarget
                      ? 'border-emerald-400 bg-emerald-950/80 text-emerald-100'
                      : m.kind === 'charging'
                        ? 'border-amber-400/80 bg-amber-950/75 text-amber-100'
                        : 'border-cyan-400/60 bg-slate-950/75 text-cyan-100'
                  }`}
                >
                  <div className="flex items-center gap-1 font-bold">
                    {m.kind === 'charging' ? (
                      <Zap className="h-3 w-3 text-amber-300" />
                    ) : (
                      <MapPin className="h-3 w-3 text-cyan-300" />
                    )}
                    <span className="max-w-[140px] truncate">{m.label}</span>
                  </div>
                  <div className="text-[9px] opacity-85">
                    {formatDistance(m.distM)} • {m.tag}
                  </div>
                </div>
                <div className="h-3 w-px bg-cyan-400/60" />
                <div className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
              </div>
            )}
          </div>
        ))}

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
        {/* TOP ROW: COMPASS RIBBON + ACTIVE MANEUVER + LINK STATUS */}
        <div className="flex flex-col items-center gap-2.5">
          {/* Status bar */}
          <div className="flex w-full items-center justify-between text-[11px] font-mono">
            <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-cyan-500/30 bg-slate-950/75 px-3 py-1 backdrop-blur-md">
              <Radio
                className={`h-3.5 w-3.5 ${
                  linkLive ? 'text-emerald-400 animate-pulse' : 'text-amber-400'
                }`}
              />
              <span className="font-bold tracking-wider">
                ARES-EVA VISOR HUD {linkLive ? '• LINK ACTIVE' : '• STANDBY'}
              </span>
              {lastSyncTs && (
                <span className="text-slate-400">
                  {new Date(lastSyncTs).toLocaleTimeString()}
                </span>
              )}
            </div>

            <div className="pointer-events-auto flex items-center gap-2">
              <button
                onClick={() => setShowContours((v) => !v)}
                className="rounded-full border border-cyan-500/40 bg-slate-950/75 px-3 py-1 text-[11px] font-semibold text-cyan-200 hover:bg-cyan-950/70 cursor-pointer backdrop-blur-md"
              >
                Contours: {showContours ? 'ON' : 'OFF'}
              </button>
            </div>
          </div>

          {/* Heading Compass Ribbon */}
          <div className="relative h-10 w-full max-w-2xl overflow-hidden rounded-xl border border-cyan-500/35 bg-slate-950/70 backdrop-blur-md">
            <div className="absolute left-1/2 top-0 h-2.5 w-0.5 -translate-x-1/2 bg-cyan-300" />
            <div className="absolute bottom-0.5 left-1/2 -translate-x-1/2 text-[10px] font-mono font-bold text-cyan-300">
              {heading}°
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

          {/* Turn-by-Turn / Pit-Stop / Emergency Banner */}
          <div
            className={`w-full max-w-xl rounded-xl border px-4 py-2.5 backdrop-blur-md transition-colors ${
              isEmergency
                ? 'border-red-400/80 bg-red-950/85 text-red-100'
                : 'border-emerald-400/50 bg-slate-950/75 text-cyan-50'
            }`}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-cyan-400/40 bg-slate-900/80">
                  {isEmergency ? (
                    <ShieldAlert className="h-6 w-6 text-red-400 animate-pulse" />
                  ) : currentManeuver?.icon === 'charge' ? (
                    <Zap className="h-6 w-6 text-amber-300 animate-pulse" />
                  ) : currentManeuver?.icon === 'arrive' ? (
                    <MapPin className="h-6 w-6 text-emerald-400" />
                  ) : (
                    <Navigation2
                      className="h-6 w-6 text-emerald-300"
                      style={{ transform: `rotate(${heading}deg)` }}
                    />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-base font-extrabold">
                    <span>{currentManeuver?.distanceText}</span>
                    <span className="truncate text-xs font-semibold text-cyan-200">
                      {currentManeuver?.instruction}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-slate-300">
                    {isEmergency
                      ? weatherCondition?.alert ||
                        `DUST FRONT ${dustFrontState?.distanceAheadKm} km • ETA ${dustFrontState?.etaMin} min`
                      : currentManeuver?.subtitle}
                  </div>
                </div>
              </div>

              {isEmergency && (
                <button
                  onClick={() => sendVisorCommand('SHELTER_DIVERT')}
                  className="pointer-events-auto shrink-0 rounded-lg border border-red-300/70 bg-red-600/90 px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white hover:bg-red-500 cursor-pointer"
                >
                  Divert to Shelter
                </button>
              )}
            </div>
          </div>
        </div>

        {/* BOTTOM ROW: LEFT PLSS WING | WALK-BACK VECTOR | RIGHT ENV WING */}
        <div className="flex items-end justify-between gap-4">
          {/* LEFT WING: PLSS LIFE SUPPORT */}
          <div className="w-64 rounded-xl border border-cyan-500/35 bg-slate-950/75 p-3 font-mono text-xs backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between border-b border-cyan-500/20 pb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300">
              <span>PLSS Telemetry</span>
              <span className="text-slate-400">{loadout?.name}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-900/70 p-2">
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  {liveNavState?.isRecharging ? (
                    <BatteryCharging className="h-3.5 w-3.5 text-amber-300 animate-pulse" />
                  ) : (
                    <Battery className="h-3.5 w-3.5 text-cyan-300" />
                  )}
                  BATTERY
                </div>
                <div
                  className={`text-base font-extrabold ${
                    lowReserve ? 'text-red-400' : 'text-cyan-200'
                  }`}
                >
                  {liveNavState?.currentBattery ?? 0}%
                </div>
              </div>
              <div className="rounded-lg bg-slate-900/70 p-2">
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  <Droplets className="h-3.5 w-3.5 text-emerald-300" />
                  PLSS O₂
                </div>
                <div
                  className={`text-base font-extrabold ${
                    lowReserve ? 'text-red-400' : 'text-emerald-300'
                  }`}
                >
                  {liveNavState?.currentO2 ?? 0}%
                </div>
              </div>
              <div className="rounded-lg bg-slate-900/70 p-2">
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  <Activity className="h-3.5 w-3.5 text-rose-300" />
                  HEART RATE
                </div>
                <div className="text-sm font-bold text-rose-200">
                  {liveNavState?.heartRateBpm ?? 76} bpm
                </div>
              </div>
              <div className="rounded-lg bg-slate-900/70 p-2">
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  <Flame className="h-3.5 w-3.5 text-orange-300" />
                  SUIT HEATER
                </div>
                <div className="text-sm font-bold text-orange-200">
                  {martianEnv?.suitHeaterWatts ?? 75} W
                </div>
              </div>
            </div>
          </div>

          {/* CENTER: WALK-BACK & PROGRESS BAR */}
          <div className="hidden md:flex flex-col items-center gap-1.5 rounded-xl border border-cyan-500/30 bg-slate-950/75 px-4 py-2.5 font-mono text-xs backdrop-blur-md">
            <div className="flex items-center gap-4">
              <span className="flex items-center gap-1 text-cyan-200">
                <Gauge className="h-3.5 w-3.5 text-cyan-400" />
                {liveNavState?.speedKmh ?? 0} km/h
              </span>
              <span className="text-slate-400">|</span>
              <span className="text-emerald-300">
                ETA {liveNavState?.estTimeRemainingMin ?? 0} min ({liveNavState?.progressPct ?? 0}%)
              </span>
            </div>
            {shelterVector && (
              <div
                className={`flex items-center gap-1.5 text-[11px] ${
                  isEmergency ? 'font-bold text-red-300' : 'text-slate-300'
                }`}
              >
                <Compass className="h-3.5 w-3.5 text-amber-300" />
                Walk-Back Shelter: {shelterVector.name} ({formatDistance(shelterVector.distM)} @{' '}
                {shelterVector.bearing}°)
              </div>
            )}
          </div>

          {/* RIGHT WING: MEDA ENVIRONMENT */}
          <div className="w-64 rounded-xl border border-cyan-500/35 bg-slate-950/75 p-3 font-mono text-xs backdrop-blur-md">
            <div className="mb-2 flex items-center justify-between border-b border-cyan-500/20 pb-1 text-[10px] font-bold uppercase tracking-widest text-cyan-300">
              <span>Jezero MEDA</span>
              <span className="text-amber-300">{martianEnv?.lstText}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-lg bg-slate-900/70 p-2">
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  <Thermometer className="h-3.5 w-3.5 text-cyan-300" />
                  AMBIENT
                </div>
                <div className="text-sm font-bold text-cyan-100">
                  {martianEnv?.ambientTempC ?? -40}°C
                </div>
              </div>
              <div className="rounded-lg bg-slate-900/70 p-2">
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  <Wind className="h-3.5 w-3.5 text-amber-300" />
                  PRESSURE
                </div>
                <div className="text-sm font-bold text-amber-100">
                  {dustFrontState?.active
                    ? dustFrontState.pressureDropPa
                    : latestMeda?.pressure ?? 778.9}{' '}
                  Pa
                </div>
              </div>
              <div className="rounded-lg bg-slate-900/70 p-2">
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  <Eye className="h-3.5 w-3.5 text-emerald-300" />
                  VISIBILITY
                </div>
                <div className="text-sm font-bold text-emerald-100">
                  {weatherCondition?.visibilityKm ?? 25} km (τ {weatherCondition?.dustTau ?? 0.45})
                </div>
              </div>
              <div className="rounded-lg bg-slate-900/70 p-2">
                <div className="flex items-center gap-1 text-[10px] text-slate-400">
                  <ShieldAlert className="h-3.5 w-3.5 text-purple-300" />
                  RADIATION
                </div>
                <div
                  className={`text-sm font-bold ${
                    (weatherCondition?.radRateMgyHr ?? 0) > 0.1
                      ? 'text-red-400'
                      : 'text-purple-200'
                  }`}
                >
                  {weatherCondition?.radRateMgyHr ?? 0.011} mGy/h
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
