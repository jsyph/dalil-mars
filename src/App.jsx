import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  BatteryCharging,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Crosshair,
  Droplets,
  Eye,
  Flag,
  Flame,
  Layers,
  Map as MapIcon,
  MapPin,
  Navigation,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldAlert,
  Sun,
  Thermometer,
  Wind,
  Zap,
} from 'lucide-react';
import JezeroTacticalMap from './components/JezeroTacticalMap';
import waypointsData from './data/jezero_waypoints.json';
import medaWeatherData from './data/meda_weather.json';
import povImagesData from './data/pov_images.json';
import scienceHazardsData from './data/jezero_science_hazards.json';
import {
  computeMarswalkRoute,
  LOADOUT_PROFILES,
  marsDistanceMeters,
  WEATHER_CONDITIONS,
} from './utils/pathfinder';

function formatLst(totalMinutes) {
  const wrapped = ((Math.round(totalMinutes) % 1440) + 1440) % 1440;
  const hh = String(Math.floor(wrapped / 60)).padStart(2, '0');
  const mm = String(wrapped % 60).padStart(2, '0');
  return `${hh}:${mm} LST`;
}

export default function App() {
  const { sciencePOIs, hazardZones } = scienceHazardsData;
  const latestMeda = medaWeatherData[medaWeatherData.length - 1] || {
    sol: '1133',
    min_temp: -79.3,
    max_temp: -24.7,
    pressure: 778.9,
    sunrise: '06:18:07',
    sunset: '17:13:51',
    season: 'late autumn',
  };

  // Tablet UX Mode: Route Planner vs. Live EVA Field Mode
  const [isLiveEvaMode, setIsLiveEvaMode] = useState(false);
  const [followAstronaut, setFollowAstronaut] = useState(true);

  // Layer visibility toggles
  const [layers, setLayers] = useState({
    slope: true,
    hazards: true,
    science: true,
    traverse: true,
  });

  // Route planner & suit/rover starting state
  const [startId, setStartId] = useState('hab-alpha');
  const [endId, setEndId] = useState('three-forks');
  const [loadoutKey, setLoadoutKey] = useState('light');
  const [weatherKey, setWeatherKey] = useState('nominal');
  const [startBatteryPct, setStartBatteryPct] = useState(85);
  const [startO2Pct, setStartO2Pct] = useState(90);
  const [autoChargingStop, setAutoChargingStop] = useState(true);
  const [showDirectComparison, setShowDirectComparison] = useState(true);

  // Martian Time-of-Day & Sol State (06:00 = 360m to 19:00 = 1140m)
  const [selectedMissionSol, setSelectedMissionSol] = useState(Number(latestMeda.sol) || 1133);
  const [startLstMinutes, setStartLstMinutes] = useState(705); // 11:45 LST

  // Predictive Incoming Dust Storm Radar State
  const [incomingDustAlert, setIncomingDustAlert] = useState(false);

  // Selected Sol for Astronaut POV image
  const [selectedSol, setSelectedSol] = useState(680);

  // Live Navigation Simulation State
  const [navPlaying, setNavPlaying] = useState(false);
  const [navSpeed, setNavSpeed] = useState(1);
  const [navStepIdx, setNavStepIdx] = useState(0);
  const [rechargeTicksRemaining, setRechargeTicksRemaining] = useState(0);
  const [hasCompletedPitStop, setHasCompletedPitStop] = useState(false);

  const startPOI = useMemo(
    () => sciencePOIs.find((p) => p.id === startId) || sciencePOIs[0],
    [sciencePOIs, startId]
  );
  const endPOI = useMemo(
    () => sciencePOIs.find((p) => p.id === endId) || sciencePOIs[3],
    [sciencePOIs, endId]
  );

  const weather = WEATHER_CONDITIONS[weatherKey];
  const loadout = LOADOUT_PROFILES[loadoutKey];

  // Compute A* obstacle-avoiding route + charging pit-stop logic
  const routeResult = useMemo(() => {
    return computeMarswalkRoute({
      start: startPOI,
      end: endPOI,
      hazardZones,
      waypoints: waypointsData,
      sciencePOIs,
      loadoutKey,
      weatherKey,
      startBatteryPct,
      startO2Pct,
      useChargingStop: autoChargingStop ? 'auto' : false,
    });
  }, [
    startPOI,
    endPOI,
    hazardZones,
    sciencePOIs,
    loadoutKey,
    weatherKey,
    startBatteryPct,
    startO2Pct,
    autoChargingStop,
  ]);

  // Reset live navigation whenever route inputs change
  useEffect(() => {
    setNavPlaying(false);
    setNavStepIdx(0);
    setRechargeTicksRemaining(0);
    setHasCompletedPitStop(false);
  }, [startId, endId, loadoutKey, weatherKey, startBatteryPct, startO2Pct, autoChargingStop]);

  // Live Navigation Simulation Loop
  useEffect(() => {
    if (!navPlaying || !routeResult?.pathCoords?.length) return;

    const totalPoints = routeResult.pathCoords.length;
    const pitIdx = routeResult.pitStopIndex;

    const timer = setInterval(() => {
      if (rechargeTicksRemaining > 0) {
        setRechargeTicksRemaining((t) => {
          if (t <= 1) {
            setHasCompletedPitStop(true);
            return 0;
          }
          return t - 1;
        });
        return;
      }

      setNavStepIdx((prev) => {
        const next = Math.min(totalPoints - 1, prev + navSpeed);
        if (pitIdx !== null && !hasCompletedPitStop && prev < pitIdx && next >= pitIdx) {
          setRechargeTicksRemaining(12);
          return pitIdx;
        }
        if (next >= totalPoints - 1) {
          setNavPlaying(false);
        }
        return next;
      });
    }, 120);

    return () => clearInterval(timer);
  }, [navPlaying, navSpeed, routeResult, rechargeTicksRemaining, hasCompletedPitStop]);

  // Manual Glove-Friendly Step Controls (-100m / +100m)
  const stepAlongRoute = (deltaSteps) => {
    const totalPoints = routeResult?.pathCoords?.length || 1;
    setNavPlaying(false);
    setRechargeTicksRemaining(0);
    setNavStepIdx((prev) => {
      const next = Math.max(0, Math.min(totalPoints - 1, prev + deltaSteps));
      if (routeResult?.pitStopIndex !== null && next >= routeResult.pitStopIndex) {
        setHasCompletedPitStop(true);
      } else {
        setHasCompletedPitStop(false);
      }
      return next;
    });
  };

  // Compute live astronaut telemetry along the route
  const liveNavState = useMemo(() => {
    const coords = routeResult?.pathCoords || [];
    if (!coords.length) return null;

    const idx = Math.min(navStepIdx, coords.length - 1);
    const currentLatLon = coords[idx];
    const isRecharging = rechargeTicksRemaining > 0;
    const pitIdx = routeResult.pitStopIndex;

    let currentBattery = startBatteryPct;
    let currentO2 = startO2Pct;
    let distCoveredKm = 0;

    if (routeResult.chargingStop && pitIdx !== null) {
      const { leg1Stats, leg2Stats } = routeResult.chargingStop;
      if (idx <= pitIdx && !hasCompletedPitStop && !isRecharging) {
        const leg1Progress = pitIdx > 0 ? idx / pitIdx : 1;
        currentBattery = startBatteryPct - leg1Stats.batteryPercentUsed * leg1Progress;
        currentO2 = startO2Pct - leg1Stats.o2PercentUsed * leg1Progress;
        distCoveredKm = leg1Stats.distKm * leg1Progress;
      } else if (isRecharging) {
        currentBattery = 100;
        currentO2 = 100;
        distCoveredKm = leg1Stats.distKm;
      } else {
        const leg2Total = coords.length - 1 - pitIdx;
        const leg2Progress = leg2Total > 0 ? (idx - pitIdx) / leg2Total : 1;
        currentBattery = 100 - leg2Stats.batteryPercentUsed * leg2Progress;
        currentO2 = 100 - leg2Stats.o2PercentUsed * leg2Progress;
        distCoveredKm = leg1Stats.distKm + leg2Stats.distKm * leg2Progress;
      }
    } else {
      const progress = coords.length > 1 ? idx / (coords.length - 1) : 1;
      currentBattery = startBatteryPct - routeResult.batteryUsedTotalPct * progress;
      currentO2 = startO2Pct - (routeResult.suitO2TankPercent || 0) * progress;
      distCoveredKm = routeResult.distKm * progress;
    }

    const clampedBat = Math.max(0, Math.min(100, Number(currentBattery.toFixed(1))));
    const clampedO2 = Math.max(0, Math.min(100, Number(currentO2.toFixed(1))));
    const distRemainingKm = Math.max(0, Number((routeResult.distKm - distCoveredKm).toFixed(2)));
    const arrived = idx >= coords.length - 1 && !isRecharging;
    const progressPct = coords.length > 1 ? Math.round((idx / (coords.length - 1)) * 100) : 0;

    return {
      active: navPlaying || idx > 0 || isLiveEvaMode,
      idx,
      progressPct,
      currentLatLon,
      currentBattery: clampedBat,
      currentO2: clampedO2,
      distCoveredKm: Number(distCoveredKm.toFixed(2)),
      distRemainingKm,
      isRecharging,
      arrived,
      heartRateBpm: isRecharging ? 74 : loadoutKey === 'heavy' ? 118 : 96,
    };
  }, [
    routeResult,
    navStepIdx,
    navPlaying,
    isLiveEvaMode,
    rechargeTicksRemaining,
    hasCompletedPitStop,
    startBatteryPct,
    startO2Pct,
    loadoutKey,
  ]);

  // Martian Time-of-Day Engine (advances live during Marswalk!)
  const martianEnv = useMemo(() => {
    const elapsedMin = Math.round(((liveNavState?.progressPct || 0) / 100) * (routeResult?.durationMin || 0));
    const currentLstMin = startLstMinutes + elapsedMin;
    const lstText = formatLst(currentLstMin);

    // Diurnal temperature curve: peaks around 13:00 LST (780m) at max_temp, troughs near dawn/night at min_temp
    const maxT = Number(latestMeda.max_temp ?? -24.7);
    const minT = Number(latestMeda.min_temp ?? -79.3);
    const hourOfDay = (currentLstMin % 1440) / 60;
    const solarCurve = Math.max(0, Math.sin(((hourOfDay - 6.3) / 11.2) * Math.PI));
    const dustCooling = weatherKey === 'dust_storm' || incomingDustAlert ? -13.5 : 0;
    const ambientTempC = Number((minT + (maxT - minT) * solarCurve + dustCooling).toFixed(1));

    // Suit thermal heater wattage increases dramatically below -50°C
    const suitHeaterWatts = Math.round(45 + Math.max(0, (-25 - ambientTempC) * 2.4));

    // Sunset at 17:14 LST (1034 min)
    const sunsetMin = 17 * 60 + 14;
    const daylightRemainingMin = Math.max(0, sunsetMin - (currentLstMin % 1440));

    let solarPhase = 'day';
    if (hourOfDay >= 17.4 || hourOfDay < 6.0) solarPhase = 'night';
    else if (hourOfDay >= 16.25 || hourOfDay < 6.6) solarPhase = 'dusk';

    return {
      currentLstMin,
      lstText,
      ambientTempC,
      suitHeaterWatts,
      daylightRemainingMin,
      solarPhase,
    };
  }, [
    startLstMinutes,
    liveNavState?.progressPct,
    routeResult?.durationMin,
    latestMeda.max_temp,
    latestMeda.min_temp,
    weatherKey,
    incomingDustAlert,
  ]);

  // Predictive Incoming Dust Storm Ahead Radar State
  const dustFrontState = useMemo(() => {
    const active = incomingDustAlert || weatherKey === 'dust_storm';
    if (!active) return { active: false };

    const progress = (liveNavState?.progressPct || 0) / 100;
    // Storm approaches from NW toward route midpoint as astronaut walks
    const distanceAheadKm = Number(Math.max(0.25, 2.4 - progress * 1.9).toFixed(2));
    const etaMin = Math.max(2, Math.round(distanceAheadKm * 7.5));
    const pressureDropPa = Number((Number(latestMeda.pressure || 778.9) - (14 + progress * 12)).toFixed(1));

    const anchorLat = endPOI?.lat ?? 18.46;
    const anchorLon = endPOI?.lon ?? 77.38;
    const lat = Number((anchorLat + 0.012 * (1 - progress * 0.55)).toFixed(5));
    const lon = Number((anchorLon - 0.014 * (1 - progress * 0.55)).toFixed(5));

    return {
      active: true,
      lat,
      lon,
      radiusMeters: 1150,
      distanceAheadKm,
      etaMin,
      pressureDropPa,
    };
  }, [incomingDustAlert, weatherKey, liveNavState?.progressPct, latestMeda.pressure, endPOI]);

  // Nearest pressurized shelter to current astronaut position
  const nearestShelter = useMemo(() => {
    const curLat = liveNavState?.currentLatLon?.[0] ?? startPOI.lat;
    const curLon = liveNavState?.currentLatLon?.[1] ?? startPOI.lon;
    const shelters = sciencePOIs.filter((p) => p.isShelter);
    let best = shelters[0];
    let bestD = Infinity;
    for (const s of shelters) {
      const d = marsDistanceMeters(curLat, curLon, s.lat, s.lon);
      if (d < bestD) {
        bestD = d;
        best = s;
      }
    }
    return {
      station: best,
      distKm: Number((bestD / 1000).toFixed(2)),
    };
  }, [liveNavState?.currentLatLon, startPOI, sciencePOIs]);

  // Active turn-by-turn instruction for Visor HUD
  const currentTurnStep = useMemo(() => {
    const steps = routeResult?.navigationSteps || [];
    if (!steps.length) return null;
    if (liveNavState?.isRecharging) {
      return steps.find((s) => s.icon === 'charge') || steps[0];
    }
    if (liveNavState?.arrived) {
      return steps[steps.length - 1];
    }
    if (hasCompletedPitStop) {
      return steps.find((s) => s.icon === 'nav') || steps[0];
    }
    return steps[0];
  }, [routeResult?.navigationSteps, liveNavState?.isRecharging, liveNavState?.arrived, hasCompletedPitStop]);

  // Auto-sync POV Sol to live moving marker
  useEffect(() => {
    if (!liveNavState?.active || !liveNavState.currentLatLon || !waypointsData.length) return;
    const [curLat, curLon] = liveNavState.currentLatLon;
    let closestWp = waypointsData[0];
    let bestDist = Infinity;
    for (let i = 0; i < waypointsData.length; i += 5) {
      const wp = waypointsData[i];
      const d = marsDistanceMeters(curLat, curLon, wp.lat, wp.lon);
      if (d < bestDist) {
        bestDist = d;
        closestWp = wp;
      }
    }
    if (closestWp?.sol !== undefined) {
      setSelectedSol(closestWp.sol);
    }
  }, [liveNavState?.idx, liveNavState?.active, liveNavState?.currentLatLon]);

  // Closest NASA POV image to selectedSol
  const activePOV = useMemo(() => {
    if (!povImagesData.length) return null;
    return povImagesData.reduce((prev, curr) =>
      Math.abs(curr.sol - selectedSol) < Math.abs(prev.sol - selectedSol) ? curr : prev
    );
  }, [selectedSol]);

  const toggleLayer = (key) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const applyPreset = (sId, eId, lKey, wKey, batPct, o2Pct, solPreview, lstMin = 705) => {
    setStartId(sId);
    setEndId(eId);
    setLoadoutKey(lKey);
    setWeatherKey(wKey);
    setStartBatteryPct(batPct);
    setStartO2Pct(o2Pct);
    setAutoChargingStop(true);
    setSelectedSol(solPreview);
    setStartLstMinutes(lstMin);
  };

  const triggerShelterDivert = () => {
    const shelterId = nearestShelter?.station?.id || 'hab-alpha';
    if (endId === shelterId) {
      setStartId(startId === shelterId ? 'three-forks' : startId);
    } else {
      setStartId(endId);
      setEndId(shelterId);
    }
    setLoadoutKey('light');
    setAutoChargingStop(true);
  };

  const resetNavigation = () => {
    setNavPlaying(false);
    setNavStepIdx(0);
    setRechargeTicksRemaining(0);
    setHasCompletedPitStop(false);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* TOP ASTRONAUT TABLET HUD BAR */}
      <header className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-slate-900/95 border-b border-slate-800 backdrop-blur-md z-20">
        <div className="flex items-center gap-2.5">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-400">
            <Compass className="h-5 w-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-wider uppercase text-slate-100">
                MARS MAPS // EVA TABLET
              </h1>
              <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-mono text-emerald-400 border border-emerald-500/30">
                JEZERO
              </span>
            </div>
            <p className="text-[11px] text-slate-400 hidden sm:block">
              Glove-Ready UI • Live Martian Clock • Predictive Dust Radar
            </p>
          </div>
        </div>

        {/* Live Martian Clock & Environmental Metrics */}
        <div className="flex flex-wrap items-center gap-2.5 text-xs font-mono">
          <div className="flex items-center gap-1.5 rounded-lg bg-slate-950/90 px-2.5 py-1.5 border border-slate-800 text-slate-200">
            <Clock className="h-3.5 w-3.5 text-amber-400" />
            <span>SOL {selectedMissionSol}</span>
            <span className="text-slate-600">|</span>
            <span className="text-emerald-400 font-bold">{martianEnv.lstText}</span>
          </div>

          <div className="hidden md:flex items-center gap-1.5 rounded-lg bg-slate-950/90 px-2.5 py-1.5 border border-slate-800 text-slate-200">
            <Thermometer className="h-3.5 w-3.5 text-cyan-400" />
            <span>{martianEnv.ambientTempC}°C</span>
            <span className="text-slate-600">•</span>
            <Flame className="h-3.5 w-3.5 text-orange-400" />
            <span>{martianEnv.suitHeaterWatts}W</span>
          </div>

          {/* Incoming Dust Storm Radar Toggle (Glove Target >=44px height) */}
          <button
            onClick={() => setIncomingDustAlert((v) => !v)}
            className={`glove-btn min-h-[40px] px-3 py-1.5 rounded-xl border text-xs font-sans font-bold flex items-center gap-1.5 cursor-pointer ${
              incomingDustAlert || weatherKey === 'dust_storm'
                ? 'bg-orange-500/25 border-orange-400 text-orange-200 shadow-[0_0_12px_rgba(249,115,22,0.35)]'
                : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-slate-500'
            }`}
          >
            <Wind className="h-4 w-4 text-orange-400" />
            <span>{incomingDustAlert ? 'Storm Radar: ON' : 'Storm Radar'}</span>
          </button>

          {/* Tablet Mode Switcher: Route Planner vs. Live EVA Field Mode */}
          <button
            onClick={() => {
              setIsLiveEvaMode((m) => !m);
              if (!isLiveEvaMode) setFollowAstronaut(true);
            }}
            className={`glove-btn min-h-[40px] px-3.5 py-1.5 rounded-xl border text-xs font-sans font-bold flex items-center gap-1.5 cursor-pointer ${
              isLiveEvaMode
                ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-[0_0_16px_rgba(34,211,238,0.45)]'
                : 'bg-slate-800 hover:bg-slate-700 text-cyan-300 border-cyan-500/40'
            }`}
          >
            {isLiveEvaMode ? <MapIcon className="h-4 w-4" /> : <Navigation className="h-4 w-4" />}
            <span>{isLiveEvaMode ? 'Route Planner' : 'Live EVA Mode'}</span>
          </button>
        </div>
      </header>

      {/* PREDICTIVE INCOMING DUST STORM AHEAD BANNER */}
      {dustFrontState.active && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-gradient-to-r from-orange-950 via-red-950 to-orange-950 border-b border-orange-500/60 text-orange-100 text-xs z-20">
          <div className="flex items-center gap-2.5 font-semibold">
            <AlertTriangle className="h-5 w-5 text-orange-400 animate-pulse shrink-0" />
            <div>
              <span className="text-orange-300 font-bold uppercase tracking-wide">
                INCOMING DUST STORM AHEAD:
              </span>{' '}
              <span>
                Squall front <b>{dustFrontState.distanceAheadKm} km</b> NW • Closing ETA{' '}
                <b>{dustFrontState.etaMin} min</b> • Barometer dropping ({dustFrontState.pressureDropPa} Pa)
              </span>
            </div>
          </div>
          <button
            onClick={triggerShelterDivert}
            className="glove-btn min-h-[42px] px-4 py-1.5 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs flex items-center gap-1.5 cursor-pointer shrink-0 shadow-lg"
          >
            <Zap className="h-4 w-4" />
            <span>DIVERT TO NEAREST SHELTER ({nearestShelter.station?.name.split(' ')[0]} • {nearestShelter.distKm} km)</span>
          </button>
        </div>
      )}

      {/* SOLAR FLARE RADIATION ALERT BANNER */}
      {weatherKey === 'solar_storm' && (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2 bg-red-950/95 border-b border-red-500/60 text-red-100 text-xs z-20">
          <div className="flex items-center gap-2 font-semibold">
            <ShieldAlert className="h-5 w-5 text-red-400 animate-pulse shrink-0" />
            <span>{weather.alert}</span>
          </div>
          <button
            onClick={triggerShelterDivert}
            className="glove-btn min-h-[42px] px-4 py-1.5 rounded-xl bg-red-500 hover:bg-red-400 text-slate-950 font-extrabold text-xs cursor-pointer shrink-0"
          >
            Plot Abort to Nearest Shelter
          </button>
        </div>
      )}

      {/* MAIN WORKSPACE */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* LEFT SIDEBAR: GLOVE-FRIENDLY TRIP PLANNER (Hidden in Full-Screen Live EVA Mode) */}
        {!isLiveEvaMode && (
          <aside className="w-80 lg:w-96 flex flex-col bg-slate-900/85 border-r border-slate-800 overflow-y-auto z-10">
            {/* Quick Demo Scenarios (Glove Tap Height >= 48px) */}
            <div className="p-3 border-b border-slate-800">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-2">
                Quick EVA Presets (Glove Tap)
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  onClick={() => applyPreset('hab-alpha', 'three-forks', 'light', 'nominal', 85, 90, 680, 705)}
                  className="glove-btn min-h-[48px] px-2 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-[11px] text-left border border-slate-700 cursor-pointer"
                >
                  <div className="font-bold text-cyan-300">1. Direct</div>
                  <div className="text-[10px] text-slate-400 truncate">Three Forks</div>
                </button>
                <button
                  onClick={() => applyPreset('hab-alpha', 'belva-crater', 'light', 'nominal', 45, 75, 900, 720)}
                  className="glove-btn min-h-[48px] px-2 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-[11px] text-left border border-emerald-500/40 cursor-pointer"
                >
                  <div className="font-bold text-emerald-300">2. Recharge</div>
                  <div className="text-[10px] text-slate-400 truncate">45% Pit-Stop</div>
                </button>
                <button
                  onClick={() => {
                    applyPreset('belva-crater', 'western-rim', 'light', 'nominal', 85, 90, 2000, 940);
                    setIncomingDustAlert(true);
                  }}
                  className="glove-btn min-h-[48px] px-2 py-2 rounded-xl bg-slate-800/90 hover:bg-slate-700 text-[11px] text-left border border-orange-500/40 cursor-pointer"
                >
                  <div className="font-bold text-orange-300">3. Dusk/Dust</div>
                  <div className="text-[10px] text-slate-400 truncate">15:40 LST</div>
                </button>
              </div>
            </div>

            {/* Martian Time-of-Day & Space Weather Selector */}
            <div className="p-3 border-b border-slate-800 space-y-2.5 text-xs">
              <div className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-slate-300">
                  <Sun className="h-3.5 w-3.5 text-amber-400" />
                  Martian Time & Conditions
                </span>
                <span className="text-[11px] font-mono text-amber-300 font-bold">
                  {martianEnv.lstText}
                </span>
              </div>

              <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-2.5 space-y-2">
                <div className="flex justify-between text-[10px] text-slate-400">
                  <span>06:00 Dawn</span>
                  <span className="text-cyan-300 font-mono">
                    {martianEnv.ambientTempC}°C • {martianEnv.daylightRemainingMin}m daylight left
                  </span>
                  <span>19:00 Night</span>
                </div>
                <input
                  type="range"
                  min={360}
                  max={1140}
                  step={15}
                  value={startLstMinutes}
                  onChange={(e) => setStartLstMinutes(Number(e.target.value))}
                  className="glove-slider w-full"
                />
                <div className="grid grid-cols-3 gap-1.5 pt-1">
                  {Object.values(WEATHER_CONDITIONS).map((wc) => (
                    <button
                      key={wc.id}
                      onClick={() => setWeatherKey(wc.id)}
                      className={`glove-btn min-h-[40px] px-2 py-1.5 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                        weatherKey === wc.id
                          ? wc.id === 'nominal'
                            ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/50'
                            : 'bg-red-500/25 text-red-300 border-red-500/50'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {wc.id === 'nominal' ? 'Nominal' : wc.id === 'dust_storm' ? 'Dust Storm' : 'Solar Flare'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Route Origin, Destination & Mobility */}
            <div className="p-3 border-b border-slate-800 space-y-2.5 text-xs">
              <span className="flex items-center gap-1.5 font-semibold uppercase tracking-wider text-slate-300">
                <Navigation className="h-3.5 w-3.5 text-cyan-400" />
                Destination & Suit Charge
              </span>

              <div className="space-y-2">
                <select
                  value={startId}
                  onChange={(e) => setStartId(e.target.value)}
                  className="w-full min-h-[44px] rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:border-cyan-400 focus:outline-none"
                >
                  {sciencePOIs.map((p) => (
                    <option key={p.id} value={p.id}>
                      Start: {p.isChargingStation ? '⚡ ' : ''}{p.name}
                    </option>
                  ))}
                </select>

                <select
                  value={endId}
                  onChange={(e) => {
                    setEndId(e.target.value);
                    const target = sciencePOIs.find((p) => p.id === e.target.value);
                    if (target) setSelectedSol(target.sol);
                  }}
                  className="w-full min-h-[44px] rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-100 focus:border-emerald-400 focus:outline-none"
                >
                  {sciencePOIs.map((p) => (
                    <option key={p.id} value={p.id}>
                      Goal: {p.isChargingStation ? '⚡ ' : ''}{p.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-1.5">
                {Object.values(LOADOUT_PROFILES).map((prof) => (
                  <button
                    key={prof.id}
                    onClick={() => setLoadoutKey(prof.id)}
                    className={`glove-btn min-h-[44px] px-2 py-1.5 rounded-xl border text-[11px] font-semibold cursor-pointer ${
                      loadoutKey === prof.id
                        ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                        : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                    }`}
                  >
                    {prof.id === 'light' ? 'Solo Suit' : prof.id === 'heavy' ? 'Heavy Kit' : 'Rover Mule'}
                  </button>
                ))}
              </div>

              {/* Glove-Sized Battery & O2 Sliders */}
              <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 space-y-3">
                <div className="flex items-center justify-between text-[10px] font-mono uppercase">
                  <span className="flex items-center gap-1 text-emerald-300">
                    <BatteryCharging className="h-3.5 w-3.5" />
                    Suit / Rover Reserves
                  </span>
                  <span className="text-slate-200 font-bold">{startBatteryPct}% Bat • {startO2Pct}% O₂</span>
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                    <span>Battery Level</span>
                    <span className="font-mono font-bold text-cyan-300">{startBatteryPct}%</span>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={100}
                    value={startBatteryPct}
                    onChange={(e) => setStartBatteryPct(Number(e.target.value))}
                    className="glove-slider w-full"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[11px] text-slate-300 mb-1">
                    <span>PLSS Oxygen Tank</span>
                    <span className="font-mono font-bold text-emerald-300">{startO2Pct}%</span>
                  </div>
                  <input
                    type="range"
                    min={15}
                    max={100}
                    value={startO2Pct}
                    onChange={(e) => setStartO2Pct(Number(e.target.value))}
                    className="glove-slider w-full"
                  />
                </div>

                <label className="flex items-center justify-between min-h-[36px] text-xs text-slate-200 cursor-pointer">
                  <span>Auto-route via Virtual Base</span>
                  <input
                    type="checkbox"
                    checked={autoChargingStop}
                    onChange={(e) => setAutoChargingStop(e.target.checked)}
                    className="w-5 h-5 accent-emerald-500 cursor-pointer"
                  />
                </label>
              </div>
            </div>

            {/* "CAN I MAKE IT?" RANGE STATUS */}
            <div className="p-3 border-b border-slate-800 space-y-2.5">
              {routeResult.rangeStatus === 'direct_clear' && (
                <div className="rounded-xl bg-emerald-950/50 border border-emerald-500/40 p-2.5 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-emerald-300">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>CAN MAKE IT DIRECTLY</span>
                  </div>
                  <p className="text-[11px] text-emerald-100/80 mt-1">
                    Arrive with <b>{routeResult.finalArrivalBattery}%</b> Battery &{' '}
                    <b>{routeResult.finalArrivalO2}%</b> O₂.
                  </p>
                </div>
              )}

              {routeResult.rangeStatus === 'recharged_ok' && routeResult.chargingStop && (
                <div className="rounded-xl bg-amber-950/45 border border-amber-400/50 p-2.5 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-amber-300">
                    <Zap className="h-4 w-4 shrink-0 text-yellow-400" />
                    <span>RECHARGE PIT-STOP ADDED</span>
                  </div>
                  <p className="text-[11px] text-amber-100/90 mt-1 leading-relaxed">
                    Direct trip drops battery to <b>{routeResult.directArrivalBattery}%</b>. Routed via{' '}
                    <b className="text-emerald-300">{routeResult.chargingStop.station.name}</b> (+15m charge to 100%).
                  </p>
                </div>
              )}

              {routeResult.rangeStatus === 'out_of_range' && (
                <div className="rounded-xl bg-red-950/60 border border-red-500/50 p-2.5 text-xs">
                  <div className="flex items-center gap-1.5 font-bold text-red-300">
                    <AlertTriangle className="h-4 w-4 shrink-0" />
                    <span>CRITICAL: OUT OF RANGE</span>
                  </div>
                  <p className="text-[11px] text-red-100/85 mt-1">
                    Insufficient reserve ({routeResult.directArrivalBattery}% arrival). Switch to{' '}
                    <b>Rover Mule</b> or recharge first.
                  </p>
                </div>
              )}
            </div>

            {/* Turn-by-Turn Martian Directions */}
            <div className="p-3 border-b border-slate-800">
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-400 mb-2">
                Turn-by-Turn Martian Directions
              </div>
              <div className="space-y-1.5">
                {routeResult.navigationSteps?.map((step, i) => (
                  <div
                    key={step.id}
                    className={`p-2.5 rounded-xl border text-[11px] ${
                      step.icon === 'charge'
                        ? 'bg-emerald-950/40 border-emerald-500/40 text-emerald-100'
                        : step.icon === 'hazard'
                        ? 'bg-amber-950/30 border-amber-500/30 text-amber-100'
                        : 'bg-slate-950/60 border-slate-800 text-slate-200'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2 font-semibold">
                      <span>{i + 1}. {step.instruction}</span>
                      {step.distanceKm > 0 && (
                        <span className="font-mono text-[10px] text-cyan-300 shrink-0">
                          {step.distanceKm} km
                        </span>
                      )}
                    </div>
                    <div className="text-[10px] text-slate-400 mt-0.5">{step.detail}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Map Layer Toggles */}
            <div className="p-3">
              <div className="flex items-center justify-between mb-2">
                <span className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                  <Layers className="h-3.5 w-3.5 text-orange-400" />
                  Map Layers
                </span>
                <label className="flex items-center gap-1.5 text-[11px] text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showDirectComparison}
                    onChange={(e) => setShowDirectComparison(e.target.checked)}
                    className="w-4 h-4 accent-rose-500"
                  />
                  Direct Line
                </label>
              </div>
              <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                {[
                  { key: 'slope', label: 'Slope Heatmap' },
                  { key: 'hazards', label: 'Hazard Zones' },
                  { key: 'science', label: 'Bases & POIs' },
                  { key: 'traverse', label: 'M20 Track' },
                ].map((item) => (
                  <label
                    key={item.key}
                    className="flex items-center gap-2 min-h-[38px] p-2 rounded-lg bg-slate-950/60 border border-slate-800 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={layers[item.key]}
                      onChange={() => toggleLayer(item.key)}
                      className="w-4 h-4 accent-orange-500"
                    />
                    <span className="truncate">{item.label}</span>
                  </label>
                ))}
              </div>
            </div>
          </aside>
        )}

        {/* CENTER: INTERACTIVE JEZERO MAP + VISOR HUD + GLOVE BOTTOM DOCK */}
        <main className="flex-1 relative min-w-0">
          <JezeroTacticalMap
            waypoints={waypointsData}
            sciencePOIs={sciencePOIs}
            hazardZones={hazardZones}
            layers={layers}
            routeResult={routeResult}
            startPOI={startPOI}
            endPOI={endPOI}
            showDirectComparison={showDirectComparison}
            weatherCondition={weatherKey}
            liveNavState={liveNavState}
            followAstronaut={followAstronaut}
            dustFrontState={dustFrontState}
            solarPhase={martianEnv.solarPhase}
            onSelectPOI={(poi) => setEndId(poi.id)}
            onSelectWaypointSol={(sol) => setSelectedSol(sol)}
          />

          {/* FLOATING ASTRONAUT VISOR HUD (Top-Left of Map) */}
          <div className="absolute top-3 left-3 z-[450] max-w-sm rounded-2xl bg-slate-950/90 border border-slate-700/90 p-3 backdrop-blur-md shadow-2xl">
            <div className="flex items-center justify-between gap-3 mb-2">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-400 animate-pulse" />
                <span className="text-[11px] font-mono font-bold text-cyan-300 uppercase">
                  {isLiveEvaMode ? 'LIVE EVA VISOR HUD' : 'NEXT WAYPOINT'}
                </span>
              </div>
              <span className="text-[11px] font-mono text-amber-300 font-bold">
                {martianEnv.lstText} • {martianEnv.ambientTempC}°C
              </span>
            </div>

            {currentTurnStep && (
              <div className="text-xs font-semibold text-slate-100 leading-snug mb-2.5">
                {liveNavState?.isRecharging
                  ? '⚡ Docking at Virtual Base... Fast-charging to 100%!'
                  : liveNavState?.arrived
                  ? `🏁 Arrived at ${endPOI.name}`
                  : currentTurnStep.instruction}
              </div>
            )}

            {/* Live Visor Biometrics & Suit Bars */}
            {liveNavState && (
              <div className="grid grid-cols-3 gap-2 text-[11px] font-mono">
                <div className="rounded-lg bg-slate-900/90 px-2 py-1.5 border border-slate-800">
                  <div className="text-[9px] text-slate-400">BATTERY</div>
                  <div
                    className={`font-bold ${
                      liveNavState.currentBattery < 20 ? 'text-red-400' : 'text-cyan-300'
                    }`}
                  >
                    {liveNavState.currentBattery}%
                  </div>
                </div>
                <div className="rounded-lg bg-slate-900/90 px-2 py-1.5 border border-slate-800">
                  <div className="text-[9px] text-slate-400">PLSS O₂</div>
                  <div
                    className={`font-bold ${
                      liveNavState.currentO2 < 20 ? 'text-red-400' : 'text-emerald-300'
                    }`}
                  >
                    {liveNavState.currentO2}%
                  </div>
                </div>
                <div className="rounded-lg bg-slate-900/90 px-2 py-1.5 border border-slate-800">
                  <div className="text-[9px] text-slate-400">DIST LEFT</div>
                  <div className="font-bold text-slate-100">{liveNavState.distRemainingKm} km</div>
                </div>
              </div>
            )}
          </div>

          {/* BOTTOM GLOVE-COMPATIBLE NAVIGATION DOCK */}
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[450] flex flex-wrap items-center justify-center gap-2 rounded-2xl bg-slate-950/92 border border-slate-700/90 px-3 py-2.5 backdrop-blur-md shadow-2xl max-w-[95%]">
            <button
              onClick={() => stepAlongRoute(-3)}
              title="Step Back ~100m"
              className="glove-btn min-h-[48px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1 border border-slate-700 cursor-pointer"
            >
              <ChevronLeft className="h-4 w-4" />
              <span>-100m</span>
            </button>

            <button
              onClick={() => {
                if (liveNavState?.arrived) resetNavigation();
                setNavPlaying((p) => !p);
              }}
              className={`glove-btn min-h-[48px] px-5 rounded-xl font-extrabold text-xs flex items-center gap-2 cursor-pointer shadow-lg ${
                navPlaying
                  ? 'bg-amber-400 hover:bg-amber-300 text-slate-950'
                  : 'bg-emerald-400 hover:bg-emerald-300 text-slate-950'
              }`}
            >
              {navPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              <span>
                {navPlaying ? 'PAUSE WALK' : liveNavState?.arrived ? 'REPLAY WALK' : 'START MARSWALK'}
              </span>
            </button>

            <button
              onClick={() => stepAlongRoute(3)}
              title="Step Forward ~100m"
              className="glove-btn min-h-[48px] px-3 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 font-bold text-xs flex items-center gap-1 border border-slate-700 cursor-pointer"
            >
              <span>+100m</span>
              <ChevronRight className="h-4 w-4" />
            </button>

            <button
              onClick={() => setNavSpeed((s) => (s === 1 ? 3 : 1))}
              className="glove-btn min-h-[48px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 font-mono font-bold text-xs border border-slate-700 cursor-pointer"
            >
              {navSpeed}x
            </button>

            <button
              onClick={() => setFollowAstronaut((f) => !f)}
              className={`glove-btn min-h-[48px] px-3 rounded-xl font-bold text-xs flex items-center gap-1.5 border cursor-pointer ${
                followAstronaut
                  ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}
            >
              <Crosshair className="h-4 w-4" />
              <span className="hidden sm:inline">Follow</span>
            </button>

            <button
              onClick={resetNavigation}
              title="Reset Marswalk"
              className="glove-btn min-h-[48px] px-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" />
            </button>
          </div>
        </main>

        {/* RIGHT PANEL: MARTIAN "STREET VIEW" POV & LIVE BIOMETRICS */}
        <aside className="hidden lg:flex w-80 flex-col bg-slate-900/80 border-l border-slate-800 overflow-y-auto z-10">
          <div className="p-3.5 border-b border-slate-800">
            <div className="flex items-center justify-between mb-1">
              <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-slate-300">
                <Eye className="h-3.5 w-3.5 text-emerald-400" />
                Martian "Street View" POV
              </span>
              <span className="text-[10px] font-mono text-orange-400">
                SOL {activePOV?.sol ?? selectedSol}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Live ground perspective synced to your helmet position.
            </p>
          </div>

          {activePOV && (
            <div className="p-3.5 space-y-3">
              <div className="overflow-hidden rounded-xl border border-slate-700 bg-slate-950">
                <img
                  src={activePOV.url}
                  alt={activePOV.title}
                  className="w-full h-48 object-cover"
                  loading="lazy"
                />
                <div className="p-2.5 bg-slate-950/90 border-t border-slate-800">
                  <div className="text-[10px] font-mono text-cyan-400 uppercase">
                    Camera: {activePOV.camera}
                  </div>
                  <div className="text-xs font-semibold text-slate-100 mt-0.5">
                    {activePOV.title}
                  </div>
                </div>
              </div>

              {/* Live Astronaut Suit Biometrics Card */}
              {liveNavState && (
                <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 text-xs space-y-2">
                  <div className="flex items-center justify-between font-semibold text-slate-200">
                    <span className="flex items-center gap-1.5">
                      <Activity className="h-3.5 w-3.5 text-rose-400" />
                      Suit Life Support
                    </span>
                    <span className="font-mono text-[11px] text-rose-300">
                      {liveNavState.heartRateBpm} BPM
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px] font-mono">
                    <div className="rounded bg-slate-900 p-2">
                      <div className="text-[9px] text-slate-400">SUIT HEATER</div>
                      <div className="text-orange-300 font-bold">{martianEnv.suitHeaterWatts} W</div>
                    </div>
                    <div className="rounded bg-slate-900 p-2">
                      <div className="text-[9px] text-slate-400">DAYLIGHT LEFT</div>
                      <div className="text-amber-300 font-bold">{martianEnv.daylightRemainingMin} min</div>
                    </div>
                  </div>
                </div>
              )}

              <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 text-xs space-y-2">
                <div className="flex items-center gap-1.5 text-amber-300 font-semibold">
                  <MapPin className="h-3.5 w-3.5" />
                  <span>Destination: {endPOI.name}</span>
                </div>
                <div className="text-[11px] text-slate-300 leading-relaxed">
                  {endPOI.description}
                </div>
                <div className="pt-1 flex items-center gap-1.5 text-[11px] text-emerald-400 font-mono">
                  <Droplets className="h-3.5 w-3.5" />
                  <span>Minerals: {endPOI.minerals}</span>
                </div>
              </div>

              {/* Comms Relay Card */}
              <div className="rounded-xl bg-slate-950/60 border border-slate-800 p-3 text-xs space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <Radio className="h-3.5 w-3.5 text-cyan-400" />
                    Orbital Relay Window
                  </span>
                  <span className="text-[10px] font-mono text-emerald-400">LOCKED</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  MRO UHF Pass: <span className="text-slate-200 font-mono">Active (14m rem)</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  Earth One-Way Light Time: <span className="text-slate-200 font-mono">12m 18s</span>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
