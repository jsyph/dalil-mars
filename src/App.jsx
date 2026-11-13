import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  Battery,
  BatteryCharging,
  Camera,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Clock,
  Compass,
  Crosshair,
  Droplets,
  Eye,
  EyeOff,
  Flame,
  Gauge,
  Layers,
  LogOut,
  Map as MapIcon,
  MapPin,
  Microscope,
  Minus,
  Navigation,
  Navigation2,
  PackageCheck,
  Pause,
  Play,
  Plus,
  Radio,
  RotateCcw,
  Shield,
  ShieldAlert,
  Sliders,
  Sun,
  Target,
  Thermometer,
  TrendingUp,
  Truck,
  User,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import JezeroTacticalMap from './components/JezeroTacticalMap';
import MarsPanoramaViewer from './components/MarsPanoramaViewer';
import waypointsData from './data/jezero_waypoints.json';
import medaWeatherData from './data/meda_weather.json';
import povImagesData from './data/pov_images.json';
import jezeroPanoramas from './data/jezero_panoramas.json';
import scienceHazardsData from './data/jezero_science_hazards.json';
import {
  calculateBearingDegrees,
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

  // App Navigation Modes: 'browse' (exploring/planning) vs 'navigating' (active turn-by-turn walking)
  const [navMode, setNavMode] = useState('browse');
  const [followAstronaut, setFollowAstronaut] = useState(true);
  const [showLayersSheet, setShowLayersSheet] = useState(false);
  const [showStreetViewPIP, setShowStreetViewPIP] = useState(false);
  const [bottomSheetExpanded, setBottomSheetExpanded] = useState(false);
  const [showRouteOptions, setShowRouteOptions] = useState(false);

  // Animated Camera Fly-To Zoom & Locating Wave state
  const [locatePulse, setLocatePulse] = useState(null);
  const [showLocationPinTag, setShowLocationPinTag] = useState(false);
  const [compassRotation, setCompassRotation] = useState(0);

  // Layer visibility toggles
  const [layers, setLayers] = useState({
    slope: true,
    hazards: true,
    science: true,
    traverse: true,
  });

  // Route endpoints & mobility
  const [startId, setStartId] = useState('hab-alpha');
  const [endId, setEndId] = useState('three-forks');
  // Astronaut's verified field position (starts at Hab Alpha, updates continuously upon reaching waypoints)
  const [astronautLocId, setAstronautLocId] = useState('hab-alpha');
  const [loadoutKey, setLoadoutKey] = useState('light');
  const [weatherKey, setWeatherKey] = useState('nominal');
  const [startBatteryPct, setStartBatteryPct] = useState(85);
  const [startO2Pct, setStartO2Pct] = useState(90);
  const [autoChargingStop, setAutoChargingStop] = useState(true);
  const [showDirectComparison, setShowDirectComparison] = useState(false);

  // Martian Time-of-Day & Sol State
  const [selectedMissionSol] = useState(Number(latestMeda.sol) || 1133);
  const [startLstMinutes, setStartLstMinutes] = useState(705); // 11:45 LST

  // Incoming Dust Storm Radar State
  const [incomingDustAlert, setIncomingDustAlert] = useState(false);
  const [showDustRadarCard, setShowDustRadarCard] = useState(true);

  // Selected Sol for Astronaut POV image
  const [selectedSol, setSelectedSol] = useState(3);

  // Active Interactive 360° Panorama Viewer State
  const [activePanorama, setActivePanorama] = useState(null);

  const handleOpenPanorama = (target, coords, poi) => {
    let match = null;

    // 1. If explicit poi object passed
    const candidatePOI = poi || (target && typeof target === 'object' && target.id ? target : null);
    if (candidatePOI) {
      match = jezeroPanoramas.find(
        (p) =>
          p.poiId === candidatePOI.id ||
          p.associatedPOI === candidatePOI.name ||
          p.id.includes(candidatePOI.id)
      );
    }

    // 2. If target is a string (e.g., 'hawksbill-gap', 'three-forks', 'belva-crater', etc.)
    if (!match && typeof target === 'string') {
      match = jezeroPanoramas.find(
        (p) =>
          p.poiId === target ||
          p.id === target ||
          p.associatedPOI === target ||
          p.title.toLowerCase().includes(target.toLowerCase())
      );
      if (!match) {
        const matchingScience = sciencePOIs.find(
          (s) => s.id === target || s.name.toLowerCase().includes(target.toLowerCase())
        );
        if (matchingScience) {
          match = jezeroPanoramas.find(
            (p) => p.poiId === matchingScience.id || p.associatedPOI === matchingScience.name
          );
        }
      }
    }

    // 3. If target is a number (Sol)
    if (!match && typeof target === 'number') {
      match = jezeroPanoramas.find((p) => p.sol === target);
      if (!match) {
        match = jezeroPanoramas.reduce((prev, curr) =>
          Math.abs(curr.sol - target) < Math.abs(prev.sol - target) ? curr : prev
        );
      }
    }

    // 4. Fallback to active destination or origin POI
    if (!match) {
      match =
        jezeroPanoramas.find((p) => p.poiId === endId) ||
        jezeroPanoramas.find((p) => p.poiId === startId) ||
        jezeroPanoramas[0];
    }

    setActivePanorama(match);
    showToast({
      id: `pano-${Date.now()}`,
      title: match.is360
        ? `🌐 360° Photosphere: ${match.locationName || match.title.split(' ')[0]}`
        : `📷 Surface Photo: ${match.locationName || match.title.split(' ')[0]}`,
      message: `${match.locationName} • Sol ${match.sol} (${match.is360 ? 'Interactive 360° Sphere' : 'High-Res Surface Photo'})`,
      type: 'info',
      icon: 'camera',
    });
  };

  // Live Navigation Simulation State
  const [navPlaying, setNavPlaying] = useState(false);
  const [navSpeed, setNavSpeed] = useState(1);
  const [navStepIdx, setNavStepIdx] = useState(0);
  const [rechargeTicksRemaining, setRechargeTicksRemaining] = useState(0);
  const [hasCompletedPitStop, setHasCompletedPitStop] = useState(false);

  // Live Android Toast Notification Popups
  const [activeToast, setActiveToast] = useState(null);
  const toastTimerRef = useRef(null);

  const showToast = (toast) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setActiveToast(toast);
    toastTimerRef.current = setTimeout(() => {
      setActiveToast(null);
    }, toast.duration || 5500);
  };

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

  // Reset live navigation state on origin/dest change
  useEffect(() => {
    setNavPlaying(false);
    setNavStepIdx(0);
    setRechargeTicksRemaining(0);
    setHasCompletedPitStop(false);
    if (navMode === 'navigating') {
      setNavMode('browse');
    }
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
            showToast({
              id: 'recharge-done',
              type: 'charge',
              title: '⚡ Fast-Charge Complete',
              message: 'Suit/Rover Battery & Oxygen restored to 100% capacity.',
            });
            return 0;
          }
          return t - 1;
        });
        return;
      }

      setNavStepIdx((prev) => {
        const next = Math.min(totalPoints - 1, prev + navSpeed);

        // Approaching Virtual Base Station Pit-Stop
        if (pitIdx !== null && !hasCompletedPitStop && prev < pitIdx && next >= pitIdx) {
          setRechargeTicksRemaining(12);
          showToast({
            id: 'docking',
            type: 'charge',
            title: `⚡ Docked at ${routeResult.chargingStop?.station?.name || 'Base'}`,
            message: 'Initiating 25 kW inductive fast-charge & high-pressure O2 refill...',
          });
          return pitIdx;
        }

        // Mid-route slope hazard notifications
        if (prev < Math.round(totalPoints * 0.45) && next >= Math.round(totalPoints * 0.45)) {
          if (routeResult.maxSlopeAlongPath >= 12) {
            showToast({
              id: 'slope-warn',
              type: 'warning',
              title: `⚠ Steep Incline Ahead (${routeResult.maxSlopeAlongPath}°)`,
              message: 'A* corridor holding optimal ridge contour to minimize slip risk.',
            });
          }
        }

        // Arrival at destination waypoint
        if (next >= totalPoints - 1) {
          setNavPlaying(false);
          setNavMode('arrived');
          const finalBat = endPOI.isChargingStation ? 100 : Math.max(15, routeResult.finalArrivalBattery);
          const finalO2 = endPOI.isChargingStation ? 100 : Math.max(20, routeResult.finalArrivalO2);
          setAstronautLocId(endPOI.id);
          setStartId(endPOI.id);
          setStartBatteryPct(finalBat);
          setStartO2Pct(finalO2);
          showToast({
            id: 'arrived',
            type: 'success',
            title: `🏁 Arrived at ${endPOI.name}`,
            message: `Traverse complete (${routeResult.distKm} km). Position locked at ${endPOI.name}. Ready for next leg!`,
            duration: 9000,
          });
        }

        return next;
      });
    }, 120);

    return () => clearInterval(timer);
  }, [navPlaying, navSpeed, routeResult, rechargeTicksRemaining, hasCompletedPitStop, endPOI]);

  // Compute live astronaut telemetry & exact heading azimuth
  const liveNavState = useMemo(() => {
    const coords = routeResult?.pathCoords || [];
    if (!coords.length) return null;

    const idx = Math.min(navStepIdx, coords.length - 1);
    const currentLatLon = coords[idx];
    const isRecharging = rechargeTicksRemaining > 0;
    const pitIdx = routeResult.pitStopIndex;

    // Calculate heading azimuth in degrees (0° = North, 90° = East, etc.)
    let heading = 0;
    if (idx < coords.length - 1) {
      heading = calculateBearingDegrees(
        coords[idx][0],
        coords[idx][1],
        coords[idx + 1][0],
        coords[idx + 1][1]
      );
    } else if (idx > 0) {
      heading = calculateBearingDegrees(
        coords[idx - 1][0],
        coords[idx - 1][1],
        coords[idx][0],
        coords[idx][1]
      );
    }

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

    const effectiveSpeed =
      weatherKey === 'dust_storm' ? loadout.speedKmh * 0.65 : loadout.speedKmh;
    const estTimeRemainingMin = Math.round((distRemainingKm / effectiveSpeed) * 60);

    return {
      active: navMode === 'navigating' || navPlaying || idx > 0,
      idx,
      progressPct,
      currentLatLon,
      heading: Math.round(heading),
      currentBattery: clampedBat,
      currentO2: clampedO2,
      distCoveredKm: Number(distCoveredKm.toFixed(2)),
      distRemainingKm,
      estTimeRemainingMin,
      isRecharging,
      arrived,
      speedKmh: isRecharging ? 0 : effectiveSpeed,
      heartRateBpm: isRecharging ? 72 : loadoutKey === 'heavy' ? 120 : 96,
    };
  }, [
    routeResult,
    navStepIdx,
    navPlaying,
    navMode,
    rechargeTicksRemaining,
    hasCompletedPitStop,
    startBatteryPct,
    startO2Pct,
    loadoutKey,
    weatherKey,
    loadout.speedKmh,
  ]);

  // Keep compass rotation aligned with heading unless manually reoriented
  useEffect(() => {
    setCompassRotation(liveNavState?.heading || 0);
  }, [liveNavState?.heading]);

  // Martian Time-of-Day Engine
  const martianEnv = useMemo(() => {
    const elapsedMin = Math.round(((liveNavState?.progressPct || 0) / 100) * (routeResult?.durationMin || 0));
    const currentLstMin = startLstMinutes + elapsedMin;
    const lstText = formatLst(currentLstMin);

    const maxT = Number(latestMeda.max_temp ?? -24.7);
    const minT = Number(latestMeda.min_temp ?? -79.3);
    const hourOfDay = (currentLstMin % 1440) / 60;
    const solarCurve = Math.max(0, Math.sin(((hourOfDay - 6.3) / 11.2) * Math.PI));
    const dustCooling = weatherKey === 'dust_storm' || incomingDustAlert ? -13.5 : 0;
    const ambientTempC = Number((minT + (maxT - minT) * solarCurve + dustCooling).toFixed(1));

    const suitHeaterWatts = Math.round(45 + Math.max(0, (-25 - ambientTempC) * 2.4));
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

  // Predictive Dust Front Radar
  const dustFrontState = useMemo(() => {
    const active = incomingDustAlert || weatherKey === 'dust_storm';
    if (!active) return { active: false };

    const progress = (liveNavState?.progressPct || 0) / 100;
    const distanceAheadKm = Number(Math.max(0.2, 2.4 - progress * 1.9).toFixed(2));
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

  // Nearest pressurized shelter
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

  // Sync closest NASA Mastcam ground POV
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

  const activePOV = useMemo(() => {
    if (!jezeroPanoramas.length) return null;
    const targetPOI = endId || startId;
    const matchByPOI = jezeroPanoramas.find((p) => p.poiId === targetPOI);
    if (matchByPOI) return matchByPOI;
    return jezeroPanoramas.reduce((prev, curr) =>
      Math.abs(curr.sol - selectedSol) < Math.abs(prev.sol - selectedSol) ? curr : prev
    );
  }, [selectedSol, endId, startId]);

  // Active navigation maneuver for Google Maps turn banner
  const currentManeuver = useMemo(() => {
    const steps = routeResult?.navigationSteps || [];
    if (!steps.length) return null;

    if (liveNavState?.isRecharging) {
      return {
        icon: 'charge',
        distanceText: '0 m',
        instruction: `Docked at ${routeResult.chargingStop?.station?.name}`,
        subtitle: '⚡ Recharging battery to 100% & refilling O2...',
      };
    }
    if (liveNavState?.arrived) {
      return {
        icon: 'arrive',
        distanceText: '0 m',
        instruction: `Arrived at ${endPOI.name}`,
        subtitle: 'Marswalk objective accomplished.',
      };
    }
    if (hasCompletedPitStop && steps.length > 3) {
      return {
        icon: 'turn',
        distanceText: `${liveNavState?.distRemainingKm} km`,
        instruction: steps[3]?.instruction || `Proceed toward ${endPOI.name}`,
        subtitle: steps[4]?.instruction || 'Following A* traversability corridor',
      };
    }

    return {
      icon: 'straight',
      distanceText: `${Math.round((liveNavState?.distRemainingKm || routeResult.distKm) * 1000)} m`,
      instruction: steps[0]?.instruction || `Head toward ${endPOI.name}`,
      subtitle: steps[1]?.instruction || 'Safe slope gradient route active',
    };
  }, [routeResult, liveNavState, hasCompletedPitStop, endPOI]);

  // Start Navigation Button Click (Transitions to Android Google Maps Mode!)
  const startNavigation = () => {
    if (startId === endId) {
      showToast({
        id: 'select-destination',
        type: 'warning',
        title: '📍 Already At Destination',
        message: `You are currently at ${startPOI.name}. Please select a different waypoint on the map to begin your next leg!`,
      });
      return;
    }
    setNavMode('navigating');
    setNavPlaying(true);
    setFollowAstronaut(true);
    triggerLocateAstronaut(14.5);
    showToast({
      id: 'nav-started',
      type: 'info',
      title: '🚀 Marswalk Navigation Started',
      message: `Navigating from ${startPOI.name} to ${endPOI.name} (${routeResult.distKm} km). Heading ${liveNavState?.heading || 0}°.`,
    });
  };

  const stopNavigation = () => {
    setNavPlaying(false);
    setNavMode('browse');
    setNavStepIdx(0);
    setRechargeTicksRemaining(0);
    setHasCompletedPitStop(false);
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
    showToast({
      id: 'shelter-divert',
      type: 'warning',
      title: '⚡ Route Diverted to Shelter',
      message: `Emergency evacuation plotted to ${nearestShelter.station.name} (${nearestShelter.distKm} km).`,
    });
  };

  // Quick Preset Simulator Mode Applier
  const applyPreset = (sId, eId, lKey, wKey, batPct, o2Pct, solPreview, lstMin = 705) => {
    setAstronautLocId(sId);
    setStartId(sId);
    setEndId(eId);
    setLoadoutKey(lKey);
    setWeatherKey(wKey);
    setStartBatteryPct(batPct);
    setStartO2Pct(o2Pct);
    setAutoChargingStop(true);
    setSelectedSol(solPreview);
    setStartLstMinutes(lstMin);
    setNavStepIdx(0);
    setNavPlaying(false);
    setNavMode('browse');
    setIncomingDustAlert(wKey === 'dust_storm');
    setShowDustRadarCard(true);
    showToast({
      id: 'preset-applied',
      type: 'info',
      title: `Scenario Applied`,
      message: `${wKey === 'dust_storm' ? '🌪 Regional Dust Storm' : wKey === 'solar_storm' ? '⚡ Solar Flare' : '☀️ Nominal Sol'} • ${batPct}% Battery.`,
    });
  };

  // Navigate directly to a target POI starting from current astronaut position!
  const handleNavigateToPOI = (targetId) => {
    const targetPOI = sciencePOIs.find((p) => p.id === targetId);
    if (!targetPOI) return;

    if (targetId === astronautLocId) {
      showToast({
        id: 'already-here',
        type: 'info',
        title: `📍 Current Position: ${targetPOI.name}`,
        message: `You are already here. Tap another waypoint on the map to navigate from ${targetPOI.name}.`,
      });
      return;
    }

    // Always start from where the astronaut currently is!
    setStartId(astronautLocId);
    setEndId(targetId);
    setSelectedSol(targetPOI.sol);
    setNavMode('browse');
    setNavStepIdx(0);
    setNavPlaying(false);
    showToast({
      id: 'route-set',
      type: 'info',
      title: `🧭 Route Plotted: Next Leg`,
      message: `Starting from ${sciencePOIs.find((p) => p.id === astronautLocId)?.name || 'Current Position'} ➔ ${targetPOI.name}`,
    });
  };

  // Set any POI as the new starting origin / current location
  const handleSetOrigin = (poiId) => {
    setAstronautLocId(poiId);
    setStartId(poiId);
    setNavStepIdx(0);
    setNavPlaying(false);
    setNavMode('browse');
    const p = sciencePOIs.find((item) => item.id === poiId);
    showToast({
      id: 'origin-updated',
      type: 'info',
      title: `📍 Origin Updated`,
      message: `Current location set to ${p?.name || poiId}.`,
    });
  };

  // Swap starting origin and destination
  const handleSwapEndpoints = () => {
    const prevStart = startId;
    const prevEnd = endId;
    setStartId(prevEnd);
    setEndId(prevStart);
    setAstronautLocId(prevEnd);
    setNavStepIdx(0);
    setNavPlaying(false);
    setNavMode('browse');
    showToast({
      id: 'endpoints-swapped',
      type: 'info',
      title: `⇄ Direction Inverted`,
      message: `Routing from ${sciencePOIs.find((p) => p.id === prevEnd)?.name} to ${sciencePOIs.find((p) => p.id === prevStart)?.name}.`,
    });
  };

  // High-Impact Animated Locate & Fly-To Zoom Action!
  const triggerLocateAstronaut = (zoomLevel = 15) => {
    setFollowAstronaut(true);
    setLocatePulse({
      timestamp: Date.now(),
      zoom: zoomLevel,
      showWave: true,
    });
    setShowLocationPinTag(true);
    setTimeout(() => setShowLocationPinTag(false), 4200);

    const lat = liveNavState?.currentLatLon ? liveNavState.currentLatLon[0] : startPOI.lat;
    const lon = liveNavState?.currentLatLon ? liveNavState.currentLatLon[1] : startPOI.lon;

    showToast({
      id: 'gps-lock',
      type: 'info',
      title: '🎯 GPS Location Locked & Zoomed In',
      message: `Astronaut position: ${lat.toFixed(4)}°N, ${lon.toFixed(4)}°E (Elev ${endPOI.elev}m).`,
    });
  };

  // Interactive Compass Button Click (Re-aligns North + Centers Camera + Locates)
  const handleCompassClick = () => {
    setCompassRotation((r) => r + 360);
    triggerLocateAstronaut(14.5);
    showToast({
      id: 'compass-realign',
      type: 'info',
      title: '🧭 Compass Re-aligned to North',
      message: `Camera locked to true Martian North (0° azimuth).`,
    });
  };

  const toggleLayer = (key) => {
    setLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-slate-950 font-sans text-slate-100 select-none">
      {/* 1. FULL-BLEED MARTIAN LEAFLET MAP CANVAS */}
      <div className="absolute inset-0 z-0">
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
          locatePulse={locatePulse}
          dustFrontState={dustFrontState}
          solarPhase={martianEnv.solarPhase}
          astronautLocId={astronautLocId}
          onSelectPOI={(poi) => {
            handleNavigateToPOI(poi.id);
            handleOpenPanorama(poi.id);
          }}
          onSelectWaypointSol={(sol) => {
            setSelectedSol(sol);
          }}
          onOpenPanorama={handleOpenPanorama}
          onNavigateToPOI={handleNavigateToPOI}
          onSetOrigin={handleSetOrigin}
        />
      </div>

      {/* 2. LIVE ANDROID HEADS-UP NOTIFICATION POPUP */}
      {activeToast && (
        <div className="android-toast-slide absolute top-4 left-1/2 z-[1000] w-[92%] max-w-md -translate-x-1/2">
          <div
            className={`flex items-start justify-between gap-3 rounded-2xl border p-3.5 shadow-2xl backdrop-blur-xl ${
              activeToast.type === 'warning'
                ? 'bg-amber-950/95 border-amber-400 text-amber-100 shadow-amber-900/50'
                : activeToast.type === 'charge'
                ? 'bg-emerald-950/95 border-emerald-400 text-emerald-100 shadow-emerald-900/50'
                : activeToast.type === 'success'
                ? 'bg-cyan-950/95 border-cyan-400 text-cyan-100 shadow-cyan-900/50'
                : 'bg-slate-900/95 border-slate-700 text-slate-100 shadow-black/60'
            }`}
          >
            <div className="flex items-start gap-3">
              <div className="mt-0.5 rounded-xl bg-white/10 p-2">
                {activeToast.type === 'warning' ? (
                  <AlertTriangle className="h-5 w-5 text-amber-400 animate-pulse" />
                ) : activeToast.type === 'charge' ? (
                  <Zap className="h-5 w-5 text-yellow-400 animate-bounce" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-cyan-400" />
                )}
              </div>
              <div>
                <div className="text-xs font-bold uppercase tracking-wider">{activeToast.title}</div>
                <div className="text-[11px] leading-relaxed opacity-90 mt-0.5">{activeToast.message}</div>
              </div>
            </div>
            <button
              onClick={() => setActiveToast(null)}
              className="p-1 rounded-lg hover:bg-white/10 text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {/* 3. FLOATING ANIMATED "YOU ARE HERE" LOCATION TAG POPUP (Triggered on Pin/Compass Click) */}
      {showLocationPinTag && (
        <div className="location-tag-popup absolute bottom-32 left-1/2 -translate-x-1/2 z-40 flex items-center gap-2.5 rounded-2xl bg-cyan-950/95 border-2 border-cyan-400 px-4 py-2.5 text-xs font-mono font-bold text-cyan-200 shadow-2xl backdrop-blur-xl">
          <div className="h-3 w-3 rounded-full bg-cyan-400 animate-ping" />
          <MapPin className="h-4 w-4 text-cyan-300" />
          <span>
            📍 ASTRONAUT GPS LOCKED: {liveNavState?.currentLatLon ? `${liveNavState.currentLatLon[0].toFixed(4)}°N, ${liveNavState.currentLatLon[1].toFixed(4)}°E` : '18.4446°N, 77.4509°E'}
          </span>
          <span className="text-slate-400">•</span>
          <span className="text-emerald-300 font-extrabold">ZOOM 15X</span>
        </div>
      )}

      {/* 4. PREDICTIVE DUST STORM RADAR & CLOSING METRIC CARD */}
      {dustFrontState.active && showDustRadarCard && (
        <div className="squall-card-slide absolute top-36 left-3.5 z-30 w-84 sm:w-92 rounded-2xl bg-slate-900/95 border-2 border-orange-500/80 p-3.5 shadow-2xl backdrop-blur-xl space-y-2.5">
          <div className="flex items-center justify-between border-b border-orange-500/40 pb-2">
            <span className="text-xs font-black uppercase text-orange-400 flex items-center gap-1.5 font-mono">
              <Wind className="h-4 w-4 animate-spin text-orange-400" /> PREDICTIVE SQUALL RADAR
            </span>
            <button
              onClick={() => setShowDustRadarCard(false)}
              className="p-1 rounded-md text-orange-400 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="flex items-baseline justify-between bg-gradient-to-r from-orange-950/80 to-amber-950/80 p-3 rounded-xl border border-orange-500/40">
            <div>
              <div className="text-[10px] text-orange-300 uppercase font-mono font-bold">Squall Front Impact In</div>
              <div className="text-3xl font-black text-amber-300 font-mono flex items-baseline gap-1 mt-0.5">
                <span>~{dustFrontState.etaMin}</span>
                <span className="text-xs font-sans font-bold text-orange-200">min</span>
              </div>
            </div>
            <div className="text-right">
              <div className="text-[10px] text-orange-300 uppercase font-mono">Closing Distance</div>
              <div className="text-xl font-black text-white font-mono mt-0.5">{dustFrontState.distanceAheadKm} km</div>
              <div className="text-[9px] text-orange-300 font-mono">ahead on route</div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
            <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800">
              <span className="text-slate-400 block font-bold">BAROMETER RATE</span>
              <span className="text-red-400 font-bold text-[11px]">▼ -2.8 Pa/min (Falling)</span>
            </div>
            <div className="p-2 rounded-xl bg-slate-950/80 border border-slate-800">
              <span className="text-slate-400 block font-bold">SAFE EVAC WINDOW</span>
              <span className="text-emerald-400 font-bold text-[11px]">{Math.max(2, dustFrontState.etaMin - 5)} min remaining</span>
            </div>
          </div>

          <button
            onClick={triggerShelterDivert}
            className="glove-btn w-full min-h-[46px] rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 hover:from-amber-300 hover:to-orange-400 text-slate-950 font-black text-xs uppercase flex items-center justify-center gap-1.5 shadow-lg cursor-pointer"
          >
            <Zap className="h-4 w-4" />
            <span>DIVERT TO SHELTER ({nearestShelter.station.name.split(' ')[0]} • {nearestShelter.distKm} km)</span>
          </button>
        </div>
      )}

      {/* 5. TOP NAVIGATION HEADER (Google Maps Android Turn Card or Search Header) */}
      <div className="absolute top-3 left-3 right-3 z-30 flex flex-col items-center pointer-events-none">
        {navMode === 'navigating' ? (
          /* GOOGLE MAPS ACTIVE NAVIGATION MANEUVER BANNER */
          <div className="pointer-events-auto w-full max-w-xl rounded-2xl bg-emerald-900/95 border-2 border-emerald-400/80 p-3.5 shadow-2xl backdrop-blur-md text-slate-100 transition-all">
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-950 border border-emerald-400/60 shadow-inner">
                  {currentManeuver?.icon === 'charge' ? (
                    <Zap className="h-7 w-7 text-yellow-400 animate-pulse" />
                  ) : currentManeuver?.icon === 'arrive' ? (
                    <MapPin className="h-7 w-7 text-emerald-400" />
                  ) : (
                    <Navigation2
                      className="h-7 w-7 text-emerald-300"
                      style={{ transform: `rotate(${liveNavState?.heading || 0}deg)` }}
                    />
                  )}
                </div>
                <div>
                  <div className="text-xl font-extrabold tracking-tight text-white flex items-center gap-2">
                    <span>{currentManeuver?.distanceText}</span>
                    <span className="text-xs font-mono font-normal text-emerald-200 uppercase bg-emerald-950/70 px-2 py-0.5 rounded-full border border-emerald-700/50">
                      {liveNavState?.heading}° {martianEnv.lstText}
                    </span>
                  </div>
                  <div className="text-xs font-semibold text-emerald-100 leading-snug line-clamp-1">
                    {currentManeuver?.instruction}
                  </div>
                </div>
              </div>

              {/* Speedometer & Live Elevation */}
              <div className="text-right font-mono shrink-0">
                <div className="text-sm font-black text-cyan-300">
                  {liveNavState?.speedKmh} <span className="text-[10px] font-normal text-slate-300">km/h</span>
                </div>
                <div className="text-[10px] text-emerald-200">{martianEnv.ambientTempC}°C</div>
              </div>
            </div>

            {/* Next maneuver preview subtitle & Live Battery/O2 status */}
            <div className="mt-2 pt-2 border-t border-emerald-800/80 text-[11px] text-emerald-200/90 flex items-center justify-between">
              <span className="truncate">{currentManeuver?.subtitle}</span>
              <div className="flex items-center gap-3 ml-2 shrink-0 font-mono text-[11px] font-bold">
                <span className="flex items-center gap-1 text-cyan-300">
                  <Battery className="h-3.5 w-3.5" /> {liveNavState?.currentBattery}%
                </span>
                <span className="flex items-center gap-1 text-emerald-300">
                  <Droplets className="h-3.5 w-3.5" /> {liveNavState?.currentO2}%
                </span>
              </div>
            </div>
          </div>
        ) : (
          /* GOOGLE MAPS EXPLORE & SEARCH BAR */
          <div className="pointer-events-auto w-full max-w-xl space-y-2">
            <div className="flex items-center justify-between gap-2 rounded-2xl bg-slate-900/95 border border-slate-700/80 px-3 py-2 shadow-2xl backdrop-blur-md">
              <div className="flex items-center gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-400 font-bold">
                  <Compass className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black tracking-wider uppercase text-slate-100">
                      Dalil Mars
                    </span>
                    <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-mono text-emerald-400 border border-emerald-500/30">
                      JEZERO
                    </span>
                  </div>
                  <div className="text-[10px] font-mono text-slate-400 flex items-center gap-1.5">
                    <span>SOL {selectedMissionSol}</span>
                    <span>•</span>
                    <span className="text-emerald-400 font-bold">{martianEnv.lstText}</span>
                    <span>•</span>
                    <span>{martianEnv.ambientTempC}°C</span>
                  </div>
                </div>
              </div>

              {/* Quick Trip Selector & Settings toggle */}
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setShowRouteOptions((v) => !v)}
                  className={`glove-btn min-h-[40px] px-3 py-1.5 rounded-xl border text-xs font-semibold flex items-center gap-1.5 cursor-pointer ${
                    showRouteOptions
                      ? 'bg-cyan-500 text-slate-950 border-cyan-400'
                      : 'bg-slate-800 text-slate-200 border-slate-700 hover:bg-slate-700'
                  }`}
                >
                  <Sliders className="h-3.5 w-3.5" />
                  <span>Route Setup</span>
                </button>
              </div>
            </div>

            {/* Simulation Environment Mode Selector (☀️ Nominal | 🌪 Dust Storm | ⚡ Solar Flare) */}
            <div className="flex items-center gap-1 bg-slate-950/85 p-1 rounded-2xl border border-slate-800 backdrop-blur-md">
              <button
                onClick={() => {
                  setWeatherKey('nominal');
                  setIncomingDustAlert(false);
                }}
                className={`glove-btn flex-1 min-h-[34px] px-2.5 py-1 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                  weatherKey === 'nominal'
                    ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/50'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Sun className="h-3.5 w-3.5 text-amber-400" />
                <span>Nominal Sol</span>
              </button>

              <button
                onClick={() => {
                  setWeatherKey('dust_storm');
                  setIncomingDustAlert(true);
                  setShowDustRadarCard(true);
                }}
                className={`glove-btn flex-1 min-h-[34px] px-2.5 py-1 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                  weatherKey === 'dust_storm'
                    ? 'bg-orange-500/25 text-orange-300 border border-orange-500/50'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Wind className="h-3.5 w-3.5 text-orange-400" />
                <span>Dust Storm</span>
              </button>

              <button
                onClick={() => {
                  setWeatherKey('solar_storm');
                  setIncomingDustAlert(false);
                }}
                className={`glove-btn flex-1 min-h-[34px] px-2.5 py-1 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                  weatherKey === 'solar_storm'
                    ? 'bg-red-500/25 text-red-300 border border-red-500/50'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <Zap className="h-3.5 w-3.5 text-red-400" />
                <span>Solar Flare</span>
              </button>
            </div>

            {/* Quick Demo Scenario Presets (All with Icons) */}
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
              <button
                onClick={() => applyPreset('hab-alpha', 'three-forks', 'light', 'nominal', 85, 90, 680, 705)}
                className="glove-btn whitespace-nowrap min-h-[34px] px-3 py-1 rounded-full text-xs font-semibold bg-slate-900/90 hover:bg-slate-800 text-cyan-300 border border-cyan-500/40 flex items-center gap-1.5 cursor-pointer"
              >
                <Target className="h-3.5 w-3.5" />
                <span>1. Direct Sample</span>
              </button>

              <button
                onClick={() => applyPreset('hab-alpha', 'belva-crater', 'light', 'nominal', 45, 75, 900, 720)}
                className="glove-btn whitespace-nowrap min-h-[34px] px-3 py-1 rounded-full text-xs font-semibold bg-slate-900/90 hover:bg-slate-800 text-emerald-300 border border-emerald-500/40 flex items-center gap-1.5 cursor-pointer"
              >
                <BatteryCharging className="h-3.5 w-3.5" />
                <span>2. Recharge Pit-Stop</span>
              </button>

              <button
                onClick={() => applyPreset('belva-crater', 'western-rim', 'light', 'dust_storm', 85, 90, 2000, 940)}
                className="glove-btn whitespace-nowrap min-h-[34px] px-3 py-1 rounded-full text-xs font-semibold bg-slate-900/90 hover:bg-slate-800 text-orange-300 border border-orange-500/40 flex items-center gap-1.5 cursor-pointer"
              >
                <Wind className="h-3.5 w-3.5" />
                <span>3. Dusk & Dust Front</span>
              </button>

              <button
                onClick={() => applyPreset('belva-crater', 'hab-alpha', 'light', 'solar_storm', 85, 90, 2022, 705)}
                className="glove-btn whitespace-nowrap min-h-[34px] px-3 py-1 rounded-full text-xs font-semibold bg-slate-900/90 hover:bg-slate-800 text-red-300 border border-red-500/40 flex items-center gap-1.5 cursor-pointer"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>4. Solar Flare Abort</span>
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 6. EXPANDABLE ROUTE OPTIONS MODAL */}
      {showRouteOptions && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-40 w-[94%] max-w-lg rounded-2xl bg-slate-900/95 border-2 border-slate-700 p-4 shadow-2xl backdrop-blur-xl space-y-3.5">
          <div className="flex items-center justify-between pb-2 border-b border-slate-800">
            <span className="text-xs font-bold uppercase tracking-wider text-cyan-400 flex items-center gap-2">
              <Sliders className="h-4 w-4" /> Trip Settings & Mobility
            </span>
            <button
              onClick={() => setShowRouteOptions(false)}
              className="p-1 rounded-lg text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          <div className="flex items-center gap-2 text-xs">
            <div className="flex-1">
              <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">
                Origin {startId === astronautLocId ? '📍 (Field Pos)' : ''}
              </label>
              <select
                value={startId}
                onChange={(e) => {
                  setStartId(e.target.value);
                  setAstronautLocId(e.target.value);
                }}
                className="w-full min-h-[44px] rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-100"
              >
                {sciencePOIs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.id === astronautLocId ? '📍 ' : ''}{p.isChargingStation ? '⚡ ' : ''}{p.name}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleSwapEndpoints}
              title="Swap Origin and Destination"
              className="glove-btn mt-4 h-11 w-11 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 flex items-center justify-center shrink-0 cursor-pointer active:scale-95 transition-transform"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>

            <div className="flex-1">
              <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1">Destination</label>
              <select
                value={endId}
                onChange={(e) => {
                  setEndId(e.target.value);
                  const p = sciencePOIs.find((item) => item.id === e.target.value);
                  if (p) setSelectedSol(p.sol);
                }}
                className="w-full min-h-[44px] rounded-xl bg-slate-950 border border-slate-700 px-3 py-2 text-xs text-slate-100"
              >
                {sciencePOIs.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.isChargingStation ? '⚡ ' : ''}{p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-[10px] font-mono text-slate-400 uppercase mb-1.5">Astronaut Mobility Mode</label>
            <div className="grid grid-cols-3 gap-1.5">
              {Object.values(LOADOUT_PROFILES).map((prof) => (
                <button
                  key={prof.id}
                  onClick={() => setLoadoutKey(prof.id)}
                  className={`glove-btn min-h-[44px] px-2 py-1.5 rounded-xl border text-xs font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                    loadoutKey === prof.id
                      ? 'bg-cyan-500 text-slate-950 border-cyan-300 font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-300'
                  }`}
                >
                  {prof.id === 'light' ? (
                    <User className="h-4 w-4" />
                  ) : prof.id === 'heavy' ? (
                    <PackageCheck className="h-4 w-4" />
                  ) : (
                    <Truck className="h-4 w-4" />
                  )}
                  <span>{prof.id === 'light' ? 'Solo Suit' : prof.id === 'heavy' ? 'Heavy Kit' : 'Rover Mule'}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl bg-slate-950/80 border border-slate-800 p-3 space-y-2.5">
            <div className="flex justify-between text-xs text-slate-300">
              <span className="flex items-center gap-1.5">
                <BatteryCharging className="h-4 w-4 text-cyan-400" /> Starting Battery
              </span>
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

            <div className="flex justify-between text-xs text-slate-300 pt-1">
              <span className="flex items-center gap-1.5">
                <Droplets className="h-4 w-4 text-emerald-400" /> Starting PLSS Tank
              </span>
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

            <div className="flex justify-between text-xs text-slate-300 pt-1">
              <span className="flex items-center gap-1.5">
                <Clock className="h-4 w-4 text-amber-400" /> Martian Departure Time
              </span>
              <span className="font-mono font-bold text-amber-300">{formatLst(startLstMinutes)}</span>
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
          </div>

          <button
            onClick={() => setShowRouteOptions(false)}
            className="glove-btn w-full min-h-[46px] rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
          >
            <Check className="h-4 w-4" />
            <span>Apply Route Settings</span>
          </button>
        </div>
      )}

      {/* 7. FLOATING ACTION BUTTONS (ANDROID GOOGLE MAPS FABs ON RIGHT) */}
      <div className="absolute right-3.5 top-36 z-20 flex flex-col items-center gap-2.5">
        {/* Interactive Functional Compass Button (Re-aligns North + Centers + Zooms!) */}
        <button
          onClick={handleCompassClick}
          title="Compass: Tap to Re-align North & Zoom in to Location"
          className="glove-btn flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900/95 hover:bg-slate-800 border-2 border-cyan-500/60 hover:border-cyan-400 shadow-xl backdrop-blur-md text-cyan-400 font-mono text-[11px] font-bold cursor-pointer transition-all active:scale-90"
        >
          <Compass
            className="h-6 w-6 transition-transform duration-500"
            style={{ transform: `rotate(${compassRotation}deg)` }}
          />
        </button>

        {/* Recenter & Animated GPS Zoom-In FAB */}
        <button
          onClick={() => triggerLocateAstronaut(15)}
          title="Find My Location: Smooth Zoom-In with Radar Wave"
          className={`glove-btn flex h-12 w-12 items-center justify-center rounded-2xl border-2 shadow-xl backdrop-blur-md cursor-pointer transition-all active:scale-90 ${
            followAstronaut
              ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-cyan-500/50'
              : 'bg-slate-900/95 text-slate-300 border-slate-700 hover:bg-slate-800'
          }`}
        >
          <Crosshair className="h-6 w-6" />
        </button>

        {/* Martian "Street View" 360° POV Panorama Launcher FAB */}
        <button
          onClick={() => handleOpenPanorama(endId || startId)}
          title="Open Location Photo / 360° Panorama"
          className="glove-btn relative flex h-12 w-12 items-center justify-center rounded-2xl border shadow-xl backdrop-blur-md cursor-pointer transition-all bg-slate-900/90 text-cyan-400 hover:text-white border-cyan-500/60 hover:border-cyan-400 hover:bg-cyan-950 active:scale-90"
        >
          <Camera className="h-6 w-6" />
          <span className="absolute -top-1 -right-1 h-3.5 w-3.5 rounded-full bg-cyan-400 border-2 border-slate-950 animate-pulse" />
        </button>

        {/* Storm Radar Alert FAB (Toggles Predictive Metric Card) */}
        <button
          onClick={() => {
            setIncomingDustAlert((v) => !v);
            setShowDustRadarCard(true);
          }}
          title="Toggle Predictive Storm Radar Card"
          className={`glove-btn flex h-12 w-12 items-center justify-center rounded-2xl border shadow-xl backdrop-blur-md cursor-pointer transition-all ${
            incomingDustAlert || weatherKey === 'dust_storm'
              ? 'bg-orange-500 text-slate-950 border-orange-300 animate-pulse shadow-orange-500/40'
              : 'bg-slate-900/90 text-slate-300 border-slate-700 hover:bg-slate-800'
          }`}
        >
          <Wind className="h-6 w-6" />
        </button>

        {/* Map Layers Switcher FAB */}
        <button
          onClick={() => setShowLayersSheet((v) => !v)}
          title="Map Layers"
          className="glove-btn flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-900/90 border border-slate-700 text-slate-300 hover:bg-slate-800 shadow-xl backdrop-blur-md cursor-pointer"
        >
          <Layers className="h-6 w-6 text-orange-400" />
        </button>
      </div>

      {/* 8. FLOATING MARTIAN "STREET VIEW" PICTURE-IN-PICTURE (PIP) CARD */}
      {showStreetViewPIP && activePOV && (
        <div className="absolute top-28 left-4 z-40 w-72 sm:w-84 overflow-hidden rounded-2xl bg-slate-950/95 border-2 border-cyan-500/70 shadow-2xl backdrop-blur-xl transition-all">
          <div className="flex items-center justify-between p-2.5 bg-slate-900/90 border-b border-slate-800">
            <span className="text-xs font-bold text-cyan-400 flex items-center gap-1.5 uppercase font-mono">
              <Camera className="h-4 w-4" /> Sol {activePOV.sol} • {activePOV.is360 ? '360° POV' : 'Vista'}
            </span>
            <button
              onClick={() => setShowStreetViewPIP(false)}
              className="p-1 rounded-md text-slate-400 hover:text-white cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div
            onClick={() => handleOpenPanorama(activePOV.poiId || activePOV.id)}
            className="relative cursor-pointer group"
          >
            <img
              src={activePOV.image || activePOV.url}
              alt={activePOV.title}
              className="w-full h-44 object-cover transition-transform group-hover:scale-105"
              loading="lazy"
            />
            <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-transparent to-transparent flex items-end p-2.5">
              <span className="text-[11px] font-mono font-bold text-white bg-cyan-600/90 px-2 py-1 rounded-lg border border-cyan-400/50 shadow flex items-center gap-1">
                {activePOV.is360 ? '🌐 TAP TO OPEN 360° SPHERE' : '📷 TAP TO VIEW HIGH-RES PHOTO'}
              </span>
            </div>
          </div>
          <div className="p-2.5 text-[11px] bg-slate-950 space-y-1.5">
            <div className="font-semibold text-slate-200 line-clamp-1">{activePOV.locationName || activePOV.title}</div>
            <div className="text-[10px] font-mono text-cyan-400 uppercase">{activePOV.instrument || `Camera: ${activePOV.camera}`}</div>
            <button
              onClick={() => handleOpenPanorama(activePOV.poiId || activePOV.id)}
              className="glove-btn w-full py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-black text-[11px] uppercase tracking-wider flex items-center justify-center gap-1.5 cursor-pointer shadow-md"
            >
              <Eye className="h-3.5 w-3.5" />
              <span>{activePOV.is360 ? 'Launch 360° Photosphere' : 'View High-Res Surface Photo'}</span>
            </button>
          </div>
        </div>
      )}

      {/* 9. FLOATING LAYERS SHEET (When FAB is Tapped) */}
      {showLayersSheet && (
        <div className="absolute right-16 top-52 z-40 w-64 rounded-2xl bg-slate-900/95 border-2 border-slate-700 p-3 shadow-2xl backdrop-blur-xl space-y-2">
          <div className="flex items-center justify-between pb-1.5 border-b border-slate-800 text-xs font-bold uppercase text-orange-400">
            <span className="flex items-center gap-1.5">
              <Layers className="h-4 w-4" /> Map Layers
            </span>
            <button onClick={() => setShowLayersSheet(false)} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-1 text-xs">
            {[
              { key: 'slope', label: 'Slope Safety Heatmap', icon: <TrendingUp className="h-3.5 w-3.5 text-emerald-400" /> },
              { key: 'hazards', label: 'Terrain Hazards (Sand/Cliffs)', icon: <AlertTriangle className="h-3.5 w-3.5 text-red-400" /> },
              { key: 'science', label: 'Bases & Science POIs', icon: <Zap className="h-3.5 w-3.5 text-amber-400" /> },
              { key: 'traverse', label: 'Perseverance Rover Track', icon: <Navigation className="h-3.5 w-3.5 text-orange-400" /> },
            ].map((item) => (
              <label
                key={item.key}
                className="flex items-center justify-between min-h-[38px] px-2 rounded-lg hover:bg-slate-800 cursor-pointer"
              >
                <span className="flex items-center gap-2">
                  {item.icon}
                  <span>{item.label}</span>
                </span>
                <input
                  type="checkbox"
                  checked={layers[item.key]}
                  onChange={() => toggleLayer(item.key)}
                  className="w-4 h-4 accent-orange-500"
                />
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 10. BOTTOM GOOGLE MAPS NAVIGATION & TRIP BAR */}
      <div className="absolute bottom-3 left-3 right-3 z-30 flex flex-col items-center">
        <div className="w-full max-w-xl rounded-2xl bg-slate-900/95 border border-slate-700/80 shadow-2xl backdrop-blur-xl overflow-hidden transition-all">
          {navMode === 'navigating' ? (
            /* ACTIVE NAVIGATION CONTROLS (Google Maps Android Drive Bar) */
            <div className="p-3.5 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-2xl font-black text-cyan-300 font-mono flex items-baseline gap-1.5">
                    <span>{liveNavState?.estTimeRemainingMin}</span>
                    <span className="text-xs font-sans font-bold text-slate-300">min</span>
                  </div>
                  <div className="text-xs text-slate-400 flex items-center gap-2">
                    <span>{liveNavState?.distRemainingKm} km remaining</span>
                    <span>•</span>
                    <span className="text-emerald-400 font-bold">Sol {selectedMissionSol}</span>
                  </div>
                </div>

                {/* Big Live Suit/Rover Battery & O2 Status Gauges */}
                <div className="flex items-center gap-3">
                  <div className="rounded-xl bg-slate-950 p-2 border border-slate-800 text-right min-w-[90px]">
                    <div className="flex items-center justify-end gap-1 text-[10px] text-slate-400 font-mono">
                      <Battery className={`h-3.5 w-3.5 ${liveNavState?.currentBattery < 25 ? 'text-red-400' : 'text-cyan-400'}`} />
                      <span>BATTERY</span>
                    </div>
                    <div className={`text-sm font-black font-mono ${liveNavState?.currentBattery < 25 ? 'text-red-400' : 'text-cyan-300'}`}>
                      {liveNavState?.currentBattery}%
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-0.5">
                      <div
                        className={`h-full ${liveNavState?.currentBattery < 25 ? 'bg-red-500' : 'bg-cyan-400'}`}
                        style={{ width: `${liveNavState?.currentBattery}%` }}
                      />
                    </div>
                  </div>

                  <div className="rounded-xl bg-slate-950 p-2 border border-slate-800 text-right min-w-[90px]">
                    <div className="flex items-center justify-end gap-1 text-[10px] text-slate-400 font-mono">
                      <Droplets className="h-3.5 w-3.5 text-emerald-400" />
                      <span>PLSS TANK</span>
                    </div>
                    <div className="text-sm font-black font-mono text-emerald-300">
                      {liveNavState?.currentO2}%
                    </div>
                    <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden mt-0.5">
                      <div
                        className="h-full bg-emerald-400"
                        style={{ width: `${liveNavState?.currentO2}%` }}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Big Glove-Friendly Android Action Buttons (All with Icons) */}
              <div className="grid grid-cols-4 gap-2 pt-1">
                <button
                  onClick={() => setNavPlaying((p) => !p)}
                  className={`glove-btn col-span-2 min-h-[52px] rounded-xl text-slate-950 font-black text-sm uppercase flex items-center justify-center gap-2 cursor-pointer shadow-lg ${
                    navPlaying ? 'bg-amber-400 hover:bg-amber-300' : 'bg-emerald-400 hover:bg-emerald-300'
                  }`}
                >
                  {navPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                  <span>{navPlaying ? 'Pause Walk' : 'Resume Walk'}</span>
                </button>

                <button
                  onClick={() => setNavSpeed((s) => (s === 1 ? 3 : 1))}
                  className="glove-btn min-h-[52px] rounded-xl bg-slate-800 hover:bg-slate-700 text-cyan-300 font-mono font-bold text-xs border border-slate-700 flex flex-col items-center justify-center cursor-pointer"
                >
                  <Gauge className="h-4 w-4 mb-0.5 text-cyan-400" />
                  <span>{navSpeed}x Speed</span>
                </button>

                <button
                  onClick={stopNavigation}
                  className="glove-btn min-h-[52px] rounded-xl bg-rose-950/80 hover:bg-rose-900 border border-rose-500/50 text-rose-200 font-bold text-xs flex flex-col items-center justify-center cursor-pointer"
                >
                  <LogOut className="h-4 w-4 mb-0.5 text-rose-400" />
                  <span>Exit</span>
                </button>
              </div>

              {/* Emergency Divert to Nearest Shelter Option */}
              {(incomingDustAlert || weatherKey === 'dust_storm' || liveNavState?.currentBattery < 25) && (
                <button
                  onClick={triggerShelterDivert}
                  className="glove-btn w-full min-h-[46px] rounded-xl bg-gradient-to-r from-red-600 to-amber-600 text-white font-extrabold text-xs uppercase flex items-center justify-center gap-2 shadow-lg cursor-pointer animate-pulse"
                >
                  <ShieldAlert className="h-4 w-4" />
                  <span>Divert to {nearestShelter.station.name} ({nearestShelter.distKm} km)</span>
                </button>
              )}
            </div>
          ) : (navMode === 'arrived' || startId === endId) ? (
            /* TRAVERSE LEG COMPLETE / SELECT NEXT WAYPOINT */
            <div className="p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-10 w-10 items-center justify-center rounded-2xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/40">
                    <CheckCircle2 className="h-6 w-6" />
                  </span>
                  <div>
                    <div className="text-[10px] font-mono uppercase text-emerald-400 font-bold tracking-wider">
                      Traverse Leg Complete
                    </div>
                    <div className="text-base font-black text-white flex items-center gap-1.5">
                      <span>{startPOI.name}</span>
                      {startPOI.isChargingStation && (
                        <span className="rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold flex items-center gap-1">
                          <Zap className="h-3 w-3" /> Recharged 100%
                        </span>
                      )}
                      <button
                        onClick={() => handleOpenPanorama(startPOI.id)}
                        title="View Photo / 360° Panorama of this Location"
                        className="glove-btn px-2 py-0.5 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer shrink-0 ml-1"
                      >
                        <Camera className="h-3 w-3 text-cyan-400" />
                        <span>{startPOI.id === 'hab-alpha' || startPOI.id === 'seitah-ridge' ? '360°' : 'Photo'}</span>
                      </button>
                    </div>
                  </div>
                </div>

                <div className="text-right font-mono">
                  <div className="text-[10px] text-slate-400">ELEVATION</div>
                  <div className="text-xs font-bold text-slate-200">{startPOI.elev} m</div>
                </div>
              </div>

              {/* Current Field Telemetry Reserve */}
              <div className="grid grid-cols-2 gap-2 bg-slate-950/90 p-2.5 rounded-xl border border-slate-800 text-xs">
                <div className="flex items-center justify-between font-mono">
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <Battery className="h-3.5 w-3.5 text-cyan-400" /> Suit Battery
                  </span>
                  <span className="font-bold text-cyan-300">{startBatteryPct}%</span>
                </div>
                <div className="flex items-center justify-between font-mono">
                  <span className="flex items-center gap-1.5 text-slate-400">
                    <Droplets className="h-3.5 w-3.5 text-emerald-400" /> PLSS O2 Tank
                  </span>
                  <span className="font-bold text-emerald-300">{startO2Pct}%</span>
                </div>
              </div>

              {/* One-Tap Next Waypoint Selector */}
              <div className="space-y-1.5">
                <div className="text-[11px] font-mono text-slate-400 uppercase tracking-wide flex items-center justify-between">
                  <span>Select Next Waypoint to Continue:</span>
                  <span className="text-[10px] text-cyan-400">Routes from {startPOI.name.split(' ')[0]}</span>
                </div>
                <div className="grid grid-cols-2 gap-2 max-h-44 overflow-y-auto pr-0.5">
                  {sciencePOIs
                    .filter((p) => p.id !== astronautLocId)
                    .map((dest) => {
                      const dist = Number(
                        (marsDistanceMeters(startPOI.lat, startPOI.lon, dest.lat, dest.lon) / 1000).toFixed(1)
                      );
                      return (
                        <button
                          key={dest.id}
                          onClick={() => {
                            handleNavigateToPOI(dest.id);
                            handleOpenPanorama(dest.id);
                          }}
                          className="glove-btn p-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700/80 hover:border-cyan-500/60 text-left transition-all cursor-pointer flex flex-col justify-between group active:scale-95"
                        >
                          <div className="flex items-start justify-between gap-1">
                            <span className="text-xs font-bold text-slate-100 group-hover:text-cyan-300 line-clamp-1">
                              {dest.isChargingStation ? '⚡ ' : ''}{dest.name}
                            </span>
                            <span className="text-[10px] font-mono text-cyan-400 shrink-0 font-semibold">{dist} km</span>
                          </div>
                          <div className="mt-1 flex items-center justify-between text-[10px] text-slate-400">
                            <span className="line-clamp-1">{dest.minerals || 'Scientific Site'}</span>
                            <span className="text-emerald-400 font-bold group-hover:translate-x-0.5 transition-transform">➔</span>
                          </div>
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>
          ) : (
            /* EXPLORE & ROUTE PLANNING TRIP SHEET */
            <div className="p-3.5 space-y-3">
              {/* Origin and Destination header with Swap button */}
              <div className="flex items-center justify-between gap-2 bg-slate-950/70 p-2.5 rounded-xl border border-slate-800/80">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px] font-mono text-slate-400 uppercase">
                    <span className="h-2 w-2 rounded-full bg-cyan-400"></span>
                    <span>Origin {startId === astronautLocId ? '(Field Pos)' : ''}</span>
                  </div>
                  <div className="text-xs font-bold text-slate-200 truncate">{startPOI.name}</div>
                </div>

                <button
                  onClick={handleSwapEndpoints}
                  title="Swap Origin and Destination"
                  className="glove-btn h-9 w-9 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-cyan-300 flex items-center justify-center shrink-0 cursor-pointer active:scale-90 transition-transform"
                >
                  <ArrowLeftRight className="h-4 w-4" />
                </button>

                <div className="flex-1 min-w-0 text-right">
                  <div className="flex items-center justify-end gap-1.5 text-[10px] font-mono text-slate-400 uppercase">
                    <span>Destination</span>
                    <span className="h-2 w-2 rounded-full bg-emerald-400"></span>
                  </div>
                  <div className="text-xs font-bold text-slate-200 truncate">{endPOI.name}</div>
                </div>
              </div>

              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-white line-clamp-1">{endPOI.name}</span>
                    {endPOI.isChargingStation && (
                      <span className="rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold flex items-center gap-1">
                        <Zap className="h-3 w-3" /> Virtual Base
                      </span>
                    )}
                    <button
                      onClick={() => handleOpenPanorama(endPOI.id)}
                      title="View Photo / 360° Panorama of this Location"
                      className="glove-btn px-2.5 py-1 rounded-xl bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-300 text-[10px] font-bold flex items-center gap-1 cursor-pointer shrink-0 ml-auto"
                    >
                      <Camera className="h-3.5 w-3.5 text-cyan-400" />
                      <span>{endPOI.id === 'hab-alpha' || endPOI.id === 'seitah-ridge' ? '360° Sphere' : 'Photo'}</span>
                    </button>
                  </div>
                  <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-2">
                    <span className="font-mono text-cyan-300 font-bold">{routeResult.distKm} km</span>
                    <span>•</span>
                    <span>{routeResult.durationMin} min walk</span>
                    <span>•</span>
                    <span>Elev {endPOI.elev}m</span>
                  </div>
                </div>

                {/* Range Status Pill */}
                <div className="shrink-0 text-right">
                  {routeResult.rangeStatus === 'direct_clear' && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-[11px] font-bold text-emerald-300">
                      <CheckCircle2 className="h-3.5 w-3.5" /> Can Reach Direct
                    </span>
                  )}
                  {routeResult.rangeStatus === 'recharged_ok' && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-amber-500/15 border border-amber-500/30 px-2.5 py-1 text-[11px] font-bold text-amber-300">
                      <Zap className="h-3.5 w-3.5" /> +15m Recharge Pit-Stop
                    </span>
                  )}
                  {routeResult.rangeStatus === 'out_of_range' && (
                    <span className="inline-flex items-center gap-1 rounded-lg bg-red-500/15 border border-red-500/30 px-2.5 py-1 text-[11px] font-bold text-red-400">
                      <AlertTriangle className="h-3.5 w-3.5" /> Low Reserve Warning
                    </span>
                  )}
                </div>
              </div>

              {/* Prominent Starting Battery & Tank Percentage Gauge Cards */}
              <div className="grid grid-cols-2 gap-2 bg-slate-950/80 p-2.5 rounded-xl border border-slate-800">
                <div>
                  <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <BatteryCharging className="h-4 w-4 text-cyan-400" /> Battery
                    </span>
                    <span className="font-mono font-bold text-cyan-300">
                      {startBatteryPct}% <span className="text-[10px] text-slate-500 font-normal">➔ {routeResult.finalArrivalBattery}%</span>
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full ${startBatteryPct < 30 ? 'bg-amber-400' : 'bg-cyan-400'}`}
                      style={{ width: `${startBatteryPct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[10px]">
                    <button
                      onClick={() => setStartBatteryPct((b) => Math.max(15, b - 15))}
                      className="glove-btn px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-0.5 cursor-pointer"
                    >
                      <Minus className="h-3 w-3" /> 15%
                    </button>
                    <span className="text-slate-500 font-mono">Simulate</span>
                    <button
                      onClick={() => setStartBatteryPct((b) => Math.min(100, b + 15))}
                      className="glove-btn px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="h-3 w-3" /> 15%
                    </button>
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between text-xs text-slate-300 mb-1">
                    <span className="flex items-center gap-1.5 font-semibold">
                      <Droplets className="h-4 w-4 text-emerald-400" /> PLSS O2 Tank
                    </span>
                    <span className="font-mono font-bold text-emerald-300">
                      {startO2Pct}% <span className="text-[10px] text-slate-500 font-normal">➔ {routeResult.finalArrivalO2}%</span>
                    </span>
                  </div>
                  <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-emerald-400"
                      style={{ width: `${startO2Pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1 text-[10px]">
                    <button
                      onClick={() => setStartO2Pct((o) => Math.max(15, o - 15))}
                      className="glove-btn px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-0.5 cursor-pointer"
                    >
                      <Minus className="h-3 w-3" /> 15%
                    </button>
                    <span className="text-slate-500 font-mono">Simulate</span>
                    <button
                      onClick={() => setStartO2Pct((o) => Math.min(100, o + 15))}
                      className="glove-btn px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center gap-0.5 cursor-pointer"
                    >
                      <Plus className="h-3 w-3" /> 15%
                    </button>
                  </div>
                </div>
              </div>

              {/* Big Google Maps Emerald "START NAVIGATION" Button */}
              <div className="flex items-center gap-2">
                <button
                  onClick={startNavigation}
                  className="glove-btn flex-1 min-h-[56px] rounded-2xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black text-base uppercase tracking-wider flex items-center justify-center gap-2.5 shadow-xl shadow-emerald-500/25 cursor-pointer"
                >
                  <Navigation className="h-6 w-6 fill-slate-950" />
                  <span>Start Navigation</span>
                </button>

                <button
                  onClick={() => setBottomSheetExpanded((v) => !v)}
                  title="Expand Route Details"
                  className="glove-btn flex h-[56px] w-[56px] items-center justify-center rounded-2xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 cursor-pointer shrink-0"
                >
                  {bottomSheetExpanded ? <ChevronDown className="h-6 w-6" /> : <ChevronUp className="h-6 w-6" />}
                </button>
              </div>

              {/* Expandable Route Details & Step list */}
              {bottomSheetExpanded && (
                <div className="pt-2 border-t border-slate-800 space-y-2.5 text-xs max-h-48 overflow-y-auto pr-1">
                  <div className="grid grid-cols-3 gap-2 text-center text-[11px] font-mono">
                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[9px] text-slate-400">ARRIVAL BATTERY</div>
                      <div className="font-bold text-cyan-300">{routeResult.finalArrivalBattery}%</div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[9px] text-slate-400">PEAK INCLINE</div>
                      <div className="font-bold text-amber-300">{routeResult.maxSlopeAlongPath}°</div>
                    </div>
                    <div className="p-2 rounded-xl bg-slate-950 border border-slate-800">
                      <div className="text-[9px] text-slate-400">HAZARDS BYPASSED</div>
                      <div className="font-bold text-emerald-300">{routeResult.hazardsAvoided} zones</div>
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <div className="text-[10px] font-mono uppercase text-slate-400">Turn-by-Turn Preview</div>
                    {routeResult.navigationSteps?.slice(0, 4).map((step, idx) => (
                      <div key={step.id} className="p-2 rounded-lg bg-slate-950 border border-slate-800 text-[11px]">
                        <span className="font-bold text-slate-200">{idx + 1}. {step.instruction}</span>
                        {step.detail && <div className="text-[10px] text-slate-400">{step.detail}</div>}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 11. INTERACTIVE 360° MARS PANORAMA & ULTRA-HD VISTA VIEWER MODAL */}
      {activePanorama && (
        <MarsPanoramaViewer
          panorama={activePanorama}
          allPanoramas={jezeroPanoramas}
          onSelectPanorama={(p) => setActivePanorama(p)}
          onClose={() => setActivePanorama(null)}
          onNavigateToLocation={(p) => {
            const matchingPOI = sciencePOIs.find(
              (poi) => poi.name === p.associatedPOI || poi.sol === p.sol
            );
            if (matchingPOI) {
              handleNavigateToPOI(matchingPOI.id);
              setActivePanorama(null);
            }
          }}
        />
      )}
    </div>
  );
}
