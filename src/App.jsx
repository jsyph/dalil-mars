import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
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
  Download,
  Droplets,
  FileText,
  Gauge,
  Globe,
  Hexagon,
  Info,
  Layers,
  LogOut,
  Map as MapIcon,
  MapPin,
  Minus,
  Navigation,
  Navigation2,
  PackageCheck,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldAlert,
  Sliders,
  Square,
  Sun,
  Tablet,
  Target,
  Terminal,
  Trash2,
  TrendingUp,
  Truck,
  User,
  Wind,
  X,
  Zap,
} from 'lucide-react';
import APP_THEME from './theme';
import JezeroTacticalMap from './components/JezeroTacticalMap';
import MarsPanoramaViewer from './components/MarsPanoramaViewer';
import LandmarkDrawer from './components/LandmarkDrawer';
import waypointsData from './data/jezero_waypoints.json';
import medaWeatherData from './data/meda_weather.json';
import jezeroPanoramas from './data/jezero_panoramas.json';
import scienceHazardsData from './data/jezero_science_hazards.json';
import landmarksData from './data/landmarks.json';
import {
  calculateBearingDegrees,
  computeMarswalkRoute,
  estimateElev,
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

function normalizeKey(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

const BASEMAP_OPTIONS = [
  { id: 'satellite', label: 'CTX SATELLITE', short: 'SAT', desc: 'NASA CTX 6m/px Orbital Imagery' },
  { id: 'terrain', label: 'HRSC TERRAIN', short: 'TER', desc: 'ESA HRSC Shaded Topographic Relief' },
  { id: 'elevation', label: 'ELEVATION DTM', short: 'DTM', desc: 'Hypsometric Altimeter Model' },
  { id: 'themis', label: 'THEMIS NIGHT IR', short: 'IR', desc: 'Mars Odyssey Thermal Inertia' },
  { id: 'default', label: 'VECTOR BASE', short: 'VEC', desc: 'Planetary Coordinate Grid' },
];

const OVERLAY_ITEMS = [
  { key: 'hirise', label: 'NASA HiRISE 25cm (Corridor)' },
  { key: 'ellipse', label: 'USGS Landing Ellipse' },
  { key: 'linear', label: 'Linear Faults & Ridges' },
  { key: 'surface', label: 'Geomorphic Surface Contacts' },
  { key: 'nomenclature', label: 'IAU Nomenclature Labels' },
  { key: 'traverse', label: 'M20 Perseverance Traverse' },
  { key: 'slope', label: 'Sol Waypoints & Slope Grade' },
  { key: 'hazards', label: 'Science & Terrain Hazards' },
  { key: 'science', label: 'ISRU, Relay & Power Nodes' },
  { key: 'landmarks', label: '11 Regional Science Landmarks' },
];

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

  // Terminal Dual-Mode UX ('astronaut' = Glove-first Google Maps Tablet UI | 'developer' = Ground Control Terminal)
  const [uiMode, setUiMode] = useState('astronaut');
  const [navMode, setNavMode] = useState('browse');
  const [followAstronaut, setFollowAstronaut] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showLayersSheet, setShowLayersSheet] = useState(false);
  const [showLegendSheet, setShowLegendSheet] = useState(false);
  const [showRouteOptions, setShowRouteOptions] = useState(false);
  const [bottomSheetExpanded, setBottomSheetExpanded] = useState(false);
  const [showLocationPinTag, setShowLocationPinTag] = useState(false);
  const [compassRotation, setCompassRotation] = useState(0);
  const pinTagTimerRef = useRef(null);

  // Camera & Locating State
  const [locatePulse, setLocatePulse] = useState(null);
  const [flyToTarget, setFlyToTarget] = useState(null);

  // Basemap & Hillshade Blend State
  const [basemap, setBasemap] = useState('satellite');
  const [reliefBlend, setReliefBlend] = useState(0.35);
  const [activeLandmark, setActiveLandmark] = useState(null);
  const [selectedQuickLandmarkId, setSelectedQuickLandmarkId] = useState('landing_site');

  // Cartographic Layer Toggles
  const [layers, setLayers] = useState({
    hirise: false,
    ellipse: true,
    linear: false,
    surface: false,
    nomenclature: true,
    traverse: true,
    slope: true,
    hazards: true,
    science: true,
    landmarks: true,
  });

  // Origin / Destination & Custom Vector State
  const [startId, setStartId] = useState('hab-alpha');
  const [endId, setEndId] = useState('three-forks');
  const [customOriginCoord, setCustomOriginCoord] = useState(null);
  const [customDestCoord, setCustomDestCoord] = useState(null);
  const [originLatInput, setOriginLatInput] = useState('18.4446');
  const [originLonInput, setOriginLonInput] = useState('77.4509');
  const [destLatInput, setDestLatInput] = useState('18.5284');
  const [destLonInput, setDestLonInput] = useState('77.4042');

  // Astronaut Current Field Position & Suit Parameters
  const [astronautLocId, setAstronautLocId] = useState('hab-alpha');
  const [loadoutKey, setLoadoutKey] = useState('light');
  const [weatherKey, setWeatherKey] = useState('nominal');
  const [startBatteryPct, setStartBatteryPct] = useState(85);
  const [startO2Pct, setStartO2Pct] = useState(90);
  const [autoChargingStop, setAutoChargingStop] = useState(true);
  const [showDirectComparison, setShowDirectComparison] = useState(false);

  // Martian Sol & LST Time Engine
  const [selectedMissionSol] = useState(Number(latestMeda.sol) || 1133);
  const [startLstMinutes, setStartLstMinutes] = useState(705);

  // Predictive Dust Squall Alert State
  const [incomingDustAlert, setIncomingDustAlert] = useState(false);
  const [showDustRadarCard, setShowDustRadarCard] = useState(true);

  // Interactive Exclusion Zone Polygon Drawing State
  const [activeDrawMode, setActiveDrawMode] = useState(null);
  const [drawVertices, setDrawVertices] = useState([]);
  const [drawnZones, setDrawnZones] = useState([]);

  // Cursor Live Telemetry Bar State
  const [cursorTelemetry, setCursorTelemetry] = useState({
    lat: 18.4446,
    lon: 77.4509,
    elevM: -2570,
    hazardLabel: 'NOMINAL SECTOR',
    isFault: false,
  });

  // Active Surface Vista / 360 Photosphere Modal State
  const [activePanorama, setActivePanorama] = useState(null);

  // Live Navigation Simulation State
  const [navPlaying, setNavPlaying] = useState(false);
  const [navSpeed, setNavSpeed] = useState(1);
  const [navStepIdx, setNavStepIdx] = useState(0);
  const [rechargeTicksRemaining, setRechargeTicksRemaining] = useState(0);
  const [hasCompletedPitStop, setHasCompletedPitStop] = useState(false);

  // Elevation Canvas Ref
  const elevationCanvasRef = useRef(null);

  // Toast Notification Queue (single non-intrusive bar)
  const [activeToast, setActiveToast] = useState(null);
  const toastTimerRef = useRef(null);

  const showToast = (toast) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    setActiveToast(toast);
    toastTimerRef.current = setTimeout(() => {
      setActiveToast(null);
    }, toast.duration || 5000);
  };

  // Resolve any POI ID or Landmark ID into a standard routing node
  const findPOIOrLandmark = (id) => {
    if (!id) return null;
    if (id === 'custom-origin' && customOriginCoord) {
      return {
        id: 'custom-origin',
        name: 'Custom Origin Vector',
        lat: customOriginCoord[0],
        lon: customOriginCoord[1],
        elev: estimateElev(customOriginCoord[0], customOriginCoord[1]),
        sol: 0,
        type: 'custom',
      };
    }
    if (id === 'custom-dest' && customDestCoord) {
      return {
        id: 'custom-dest',
        name: 'Custom Target Vector',
        lat: customDestCoord[0],
        lon: customDestCoord[1],
        elev: estimateElev(customDestCoord[0], customDestCoord[1]),
        sol: 0,
        type: 'custom',
      };
    }

    let poi = sciencePOIs.find((p) => p.id === id);
    if (!poi) {
      poi = sciencePOIs.find((p) => p.id.replace(/-/g, '_') === id.replace(/-/g, '_'));
    }
    if (!poi && (id === 'landing_site' || id === 'hab-alpha')) {
      poi = sciencePOIs.find((p) => p.id === 'hab-alpha');
    }
    if (!poi) {
      const lm = landmarksData.find(
        (l) => l.id === id || l.id.replace(/_/g, '-') === id.replace(/_/g, '-')
      );
      if (lm) {
        poi = {
          id: lm.id,
          name: lm.name,
          lat: lm.coords[0],
          lon: lm.coords[1],
          elev: lm.elevation_m,
          sol: 0,
          description: lm.brief,
          minerals: lm.soil_regolith?.dominant_type || 'Basaltic Regolith',
          type: 'science',
        };
      }
    }
    return poi;
  };

  const startPOI = useMemo(
    () => findPOIOrLandmark(startId) || sciencePOIs[0],
    [sciencePOIs, startId, customOriginCoord]
  );

  const endPOI = useMemo(
    () => findPOIOrLandmark(endId) || sciencePOIs[3],
    [sciencePOIs, endId, customDestCoord]
  );

  // Sync lat/lon input boxes whenever startPOI/endPOI changes
  useEffect(() => {
    if (startPOI) {
      setOriginLatInput(Number(startPOI.lat).toFixed(4));
      setOriginLonInput(Number(startPOI.lon).toFixed(4));
    }
  }, [startPOI?.lat, startPOI?.lon]);

  useEffect(() => {
    if (endPOI) {
      setDestLatInput(Number(endPOI.lat).toFixed(4));
      setDestLonInput(Number(endPOI.lon).toFixed(4));
    }
  }, [endPOI?.lat, endPOI?.lon]);

  // Consolidated dropdown options (10 Science POIs + extra landmarks without duplicates)
  const allSiteOptions = useMemo(() => {
    const items = [...sciencePOIs];
    landmarksData.forEach((lm) => {
      const lmNorm = normalizeKey(lm.id === 'landing_site' ? 'habalpha' : lm.id);
      const exists = items.some((p) => normalizeKey(p.id) === lmNorm);
      if (!exists) {
        items.push({
          id: lm.id,
          name: `${lm.name} [Landmark]`,
          lat: lm.coords[0],
          lon: lm.coords[1],
          elev: lm.elevation_m,
          type: 'landmark',
        });
      }
    });
    return items;
  }, [sciencePOIs]);

  const weather = WEATHER_CONDITIONS[weatherKey];
  const loadout = LOADOUT_PROFILES[loadoutKey];

  // Unified Panorama & Landmark Vista Archive (adds landmarks that have surface imagery)
  const viewerArchiveList = useMemo(() => {
    const baseList = [...jezeroPanoramas];
    landmarksData.forEach((lm) => {
      const normLm = normalizeKey(lm.id === 'landing_site' ? 'habalpha' : lm.id);
      const mappedPano = baseList.find((p) => {
        const pId = normalizeKey(p.poiId);
        return (
          pId === normLm ||
          (lm.id === 'seitah_dunes' && p.poiId === 'seitah-ridge') ||
          (lm.id === 'wildcat_ridge' && p.id.includes('wildcat'))
        );
      });
      if (!mappedPano && lm.photos?.[0]?.url) {
        baseList.push({
          id: `lm_vista_${lm.id}`,
          poiId: lm.id,
          title: `${lm.name} Surface Imagery`,
          locationName: lm.name,
          sol: lm.sol || null,
          lat: lm.coords[0],
          lon: lm.coords[1],
          elevation: lm.elevation_m,
          is360: false,
          instrument: 'HiRISE / Mastcam-Z Archive',
          caption: lm.photos[0].caption || lm.brief,
          attribution: 'NASA / JPL-Caltech / ASU',
          image: lm.photos[0].url,
        });
      }
    });
    return baseList;
  }, []);

  // Open either 360 photosphere or exact 2D surface image for a POI, landmark ID, panorama object, or Sol
  const openPanoramaModal = (target) => {
    let match = null;

    if (target && typeof target === 'object' && target.image) {
      match = target;
    }

    if (!match && typeof target === 'string') {
      const aliasTarget =
        target === 'landing_site'
          ? 'hab-alpha'
          : target === 'seitah_dunes'
          ? 'seitah-ridge'
          : target;
      const targetNorm = normalizeKey(aliasTarget);

      match =
        viewerArchiveList.find(
          (p) =>
            p.id === target ||
            p.poiId === target ||
            p.poiId === aliasTarget ||
            normalizeKey(p.poiId) === targetNorm ||
            normalizeKey(p.id) === targetNorm ||
            p.title.toLowerCase().includes(target.toLowerCase())
        ) || null;

      if (!match) {
        const lm = landmarksData.find(
          (l) => l.id === target || normalizeKey(l.id) === normalizeKey(target)
        );
        if (lm) {
          const fallbackPhoto = lm.photos?.[0]?.url || lm.photo_url;
          if (fallbackPhoto) {
            match = {
              id: `lm_vista_${lm.id}`,
              poiId: lm.id,
              title: `${lm.name} Surface View`,
              locationName: lm.name,
              lat: lm.coords[0],
              lon: lm.coords[1],
              elevation: lm.elevation_m,
              is360: false,
              instrument: 'NASA HiRISE / Mastcam-Z',
              caption: lm.photos?.[0]?.caption || lm.brief,
              attribution: 'NASA / JPL-Caltech / MRO',
              image: fallbackPhoto,
            };
          }
        }
      }
    }

    if (!match && typeof target === 'number') {
      match =
        jezeroPanoramas.find((p) => p.sol === target) ||
        jezeroPanoramas.reduce((prev, curr) =>
          Math.abs((curr.sol || 0) - target) < Math.abs((prev.sol || 0) - target) ? curr : prev
        );
    }

    if (!match) {
      match =
        viewerArchiveList.find((p) => p.poiId === endId) ||
        viewerArchiveList.find((p) => p.poiId === startId) ||
        viewerArchiveList[0];
    }

    setActivePanorama(match);
    showToast({
      id: `pano-${Date.now()}`,
      type: 'info',
      title: match.is360 ? '360 PHOTOSPHERE LOADED' : 'SURFACE IMAGERY LOADED',
      message: `${match.locationName || match.title}`,
    });
  };

  // Compute A* Safe Route (including custom operator-drawn exclusion polygons)
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
      customExclusionZones: drawnZones,
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
    drawnZones,
  ]);

  // Reset live navigation simulation when traverse parameters change
  useEffect(() => {
    setNavPlaying(false);
    setNavStepIdx(0);
    setRechargeTicksRemaining(0);
    setHasCompletedPitStop(false);
    if (navMode === 'navigating') {
      setNavMode('browse');
    }
  }, [
    startId,
    endId,
    customOriginCoord,
    customDestCoord,
    loadoutKey,
    weatherKey,
    startBatteryPct,
    startO2Pct,
    autoChargingStop,
    drawnZones,
  ]);

  // Live Navigation Simulation Loop
  useEffect(() => {
    if (!navPlaying || !routeResult?.pathCoords?.length) return undefined;

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
              title: 'RECHARGE CYCLE COMPLETE',
              message: 'Suit Battery and O2 restored to 100%. Resuming second leg.',
            });
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
          showToast({
            id: 'docking',
            type: 'charge',
            title: `DOCKED: ${routeResult.chargingStop?.station?.name || 'CHARGING NODE'}`,
            message: 'Inductive power & O2 replenishment initiated.',
          });
          return pitIdx;
        }

        if (prev < Math.round(totalPoints * 0.45) && next >= Math.round(totalPoints * 0.45)) {
          if (routeResult.maxSlopeAlongPath >= 12) {
            showToast({
              id: 'slope-warn',
              type: 'warning',
              title: `HIGH GRADE DETECTED (${routeResult.maxSlopeAlongPath} DEG)`,
              message: 'A* corridor holding optimal contour to limit regolith slip.',
            });
          }
        }

        if (next >= totalPoints - 1) {
          setNavPlaying(false);
          setNavMode('arrived');
          const finalBat = endPOI.isChargingStation
            ? 100
            : Math.max(15, routeResult.finalArrivalBattery);
          const finalO2 = endPOI.isChargingStation ? 100 : Math.max(20, routeResult.finalArrivalO2);
          setAstronautLocId(endPOI.id);
          setStartId(endPOI.id);
          if (endPOI.id === 'custom-dest' && customDestCoord) {
            setCustomOriginCoord([...customDestCoord]);
            setStartId('custom-origin');
          }
          setStartBatteryPct(finalBat);
          setStartO2Pct(finalO2);
          showToast({
            id: 'arrived',
            type: 'success',
            title: `WAYPOINT LOCKED: ${endPOI.name}`,
            message: `Traverse leg (${routeResult.distKm} km) complete. Origin updated for next leg.`,
            duration: 7500,
          });
        }

        return next;
      });
    }, 120);

    return () => clearInterval(timer);
  }, [
    navPlaying,
    navSpeed,
    routeResult,
    rechargeTicksRemaining,
    hasCompletedPitStop,
    endPOI,
    customDestCoord,
  ]);

  // Live Astronaut Telemetry & Azimuth Calculation
  const liveNavState = useMemo(() => {
    const coords = routeResult?.pathCoords || [];
    if (!coords.length) return null;

    const idx = Math.min(navStepIdx, coords.length - 1);
    const currentLatLon = coords[idx];
    const isRecharging = rechargeTicksRemaining > 0;
    const pitIdx = routeResult.pitStopIndex;

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
      speedKmh: isRecharging ? 0 : Number(effectiveSpeed.toFixed(1)),
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

  // Martian Sol Daylight & Thermal Engine
  const martianEnv = useMemo(() => {
    const elapsedMin = Math.round(
      ((liveNavState?.progressPct || 0) / 100) * (routeResult?.durationMin || 0)
    );
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

  // Predictive Dust Squall Front Radar
  const dustFrontState = useMemo(() => {
    const active = incomingDustAlert || weatherKey === 'dust_storm';
    if (!active) return { active: false };

    const progress = (liveNavState?.progressPct || 0) / 100;
    const distanceAheadKm = Number(Math.max(0.2, 2.4 - progress * 1.9).toFixed(2));
    const etaMin = Math.max(2, Math.round(distanceAheadKm * 7.5));
    const pressureDropPa = Number(
      (Number(latestMeda.pressure || 778.9) - (14 + progress * 12)).toFixed(1)
    );

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

  // Nearest Pressurized Shelter
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

  // Elevation Transect HTML5 Canvas Renderer (matches Ground Control monochrome profile chart)
  useEffect(() => {
    const canvas = elevationCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth || 320;
    const h = canvas.clientHeight || 96;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = APP_THEME.chart.background;
    ctx.fillRect(0, 0, w, h);

    const elevs = routeResult?.elevProfile || [];
    if (elevs.length < 2) {
      ctx.fillStyle = APP_THEME.colors.textMuted;
      ctx.font = '10px "JetBrains Mono", monospace';
      ctx.fillText('NO TRAVERSE PROFILE COMPUTED', 10, h / 2);
      return;
    }

    const minE = Math.min(...elevs) - 20;
    const maxE = Math.max(...elevs) + 20;
    const range = Math.max(1, maxE - minE);
    const padX = 8;
    const padY = 14;
    const plotW = w - padX * 2;
    const plotH = h - padY * 2;

    // Horizontal grid lines
    ctx.strokeStyle = APP_THEME.chart.gridLines;
    ctx.lineWidth = 1;
    for (let i = 0; i <= 2; i += 1) {
      const y = padY + (i / 2) * plotH;
      ctx.beginPath();
      ctx.moveTo(padX, y);
      ctx.lineTo(w - padX, y);
      ctx.stroke();
    }

    // Area fill under profile
    const grad = ctx.createLinearGradient(0, padY, 0, h - padY);
    grad.addColorStop(0, APP_THEME.chart.fillStart);
    grad.addColorStop(1, APP_THEME.chart.fillEnd);

    ctx.beginPath();
    elevs.forEach((el, idx) => {
      const x = padX + (idx / (elevs.length - 1)) * plotW;
      const y = padY + (1 - (el - minE) / range) * plotH;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.lineTo(padX + plotW, h - padY);
    ctx.lineTo(padX, h - padY);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();

    // Crisp monochrome profile line
    ctx.beginPath();
    elevs.forEach((el, idx) => {
      const x = padX + (idx / (elevs.length - 1)) * plotW;
      const y = padY + (1 - (el - minE) / range) * plotH;
      if (idx === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = APP_THEME.chart.profileLine;
    ctx.lineWidth = 1.6;
    ctx.stroke();

    // Live EVA progress cursor marker on elevation transect
    if (liveNavState?.progressPct > 0) {
      const cx = padX + (liveNavState.progressPct / 100) * plotW;
      ctx.strokeStyle = APP_THEME.colors.ok;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(cx, padY);
      ctx.lineTo(cx, h - padY);
      ctx.stroke();
    }

    ctx.fillStyle = APP_THEME.chart.text;
    ctx.font = '9px "JetBrains Mono", monospace';
    ctx.fillText(`MAX ${Math.round(maxE - 20)}m`, padX + 2, 10);
    ctx.fillText(`MIN ${Math.round(minE + 20)}m`, padX + 2, h - 3);
  }, [routeResult, liveNavState?.progressPct, sidebarOpen]);

  // Current maneuver summary for Turn-by-Turn HUD
  const currentManeuver = useMemo(() => {
    const steps = routeResult?.navigationSteps || [];
    if (!steps.length) return null;

    if (liveNavState?.isRecharging) {
      return {
        distanceText: '0 m',
        instruction: `DOCKED: ${routeResult.chargingStop?.station?.name || 'CHARGING NODE'}`,
        subtitle: 'RECHARGING BATTERY TO 100% AND REFILLING O2',
      };
    }
    if (liveNavState?.arrived) {
      return {
        distanceText: '0 m',
        instruction: `ARRIVED: ${endPOI.name.toUpperCase()}`,
        subtitle: 'WAYPOINT LOCKED // READY FOR NEXT LEG',
      };
    }
    if (hasCompletedPitStop && steps.length > 3) {
      return {
        distanceText: `${liveNavState?.distRemainingKm} km`,
        instruction: steps[3]?.instruction || `PROCEED TO ${endPOI.name}`,
        subtitle: steps[4]?.instruction || 'A* TRAVERSABILITY CORRIDOR ACTIVE',
      };
    }

    return {
      distanceText: `${Math.round((liveNavState?.distRemainingKm ?? routeResult.distKm) * 1000)} m`,
      instruction: steps[0]?.instruction || `PROCEED TO ${endPOI.name}`,
      subtitle: steps[1]?.instruction || 'OPTIMAL SLOPE CONTOUR LOCKED',
    };
  }, [routeResult, liveNavState, hasCompletedPitStop, endPOI]);

  // Keep compass icon synchronized with active heading
  useEffect(() => {
    setCompassRotation(liveNavState?.heading || 0);
  }, [liveNavState?.heading]);

  // Actions
  const triggerLocateAstronaut = (zoomLevel = 14.5) => {
    setFollowAstronaut(true);
    setLocatePulse({
      timestamp: Date.now(),
      zoom: zoomLevel,
      showWave: true,
    });
    if (pinTagTimerRef.current) clearTimeout(pinTagTimerRef.current);
    setShowLocationPinTag(true);
    pinTagTimerRef.current = setTimeout(() => {
      setShowLocationPinTag(false);
    }, 4200);

    const lat = liveNavState?.currentLatLon ? liveNavState.currentLatLon[0] : startPOI.lat;
    const lon = liveNavState?.currentLatLon ? liveNavState.currentLatLon[1] : startPOI.lon;
    const elev = estimateElev(lat, lon);
    showToast({
      id: 'gps-lock',
      type: 'info',
      title: 'GPS FIX LOCKED',
      message: `${lat.toFixed(4)} N, ${lon.toFixed(4)} E // ELEV ${elev} m`,
    });
  };

  const handleCompassReset = () => {
    setCompassRotation((r) => r + 360);
    triggerLocateAstronaut(13.5);
  };

  const handleCompassClick = () => {
    setCompassRotation((r) => r + 360);
    triggerLocateAstronaut(14.5);
  };

  const switchUiMode = (nextMode) => {
    setUiMode(nextMode);
    setShowLayersSheet(false);
    setShowRouteOptions(false);
  };

  const startNavigation = () => {
    if (startId === endId && startId !== 'custom-origin') {
      showToast({
        id: 'select-destination',
        type: 'warning',
        title: 'ORIGIN EQUALS TARGET',
        message: `Select a different target waypoint from ${startPOI.name}.`,
      });
      return;
    }
    if (routeResult?.rangeStatus === 'out_of_range') {
      showToast({
        id: 'range-fault',
        type: 'warning',
        title: 'RESERVE FAULT WARNING',
        message: 'Projected reserves below safe threshold. Starting monitored EVA walk.',
      });
    } else {
      showToast({
        id: 'nav-started',
        type: 'info',
        title: 'EVA TRAVERSE INITIATED',
        message: `${startPOI.name} -> ${endPOI.name} (${routeResult.distKm} km) // HDG ${liveNavState?.heading || 0} deg`,
      });
    }
    setNavMode('navigating');
    setNavPlaying(true);
    setFollowAstronaut(true);
    triggerLocateAstronaut(14.5);
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
    setCustomOriginCoord(null);
    setCustomDestCoord(null);
    if (astronautLocId === shelterId) {
      showToast({
        id: 'at-shelter',
        type: 'success',
        title: 'SHELTER OCCUPANCY CONFIRMED',
        message: `Already stationed at pressurized habitat ${nearestShelter.station.name}.`,
      });
      return;
    }
    setStartId(astronautLocId);
    setEndId(shelterId);
    setLoadoutKey('light');
    setAutoChargingStop(true);
    setNavMode('browse');
    setNavStepIdx(0);
    setNavPlaying(false);
    showToast({
      id: 'shelter-divert',
      type: 'warning',
      title: 'DIVERT PLOTTED TO SHELTER',
      message: `Course laid to ${nearestShelter.station.name} (${nearestShelter.distKm} km).`,
    });
  };

  const applyPreset = (sId, eId, lKey, wKey, batPct, o2Pct, lstMin = 705) => {
    setCustomOriginCoord(null);
    setCustomDestCoord(null);
    setAstronautLocId(sId);
    setStartId(sId);
    setEndId(eId);
    setLoadoutKey(lKey);
    setWeatherKey(wKey);
    setStartBatteryPct(batPct);
    setStartO2Pct(o2Pct);
    setAutoChargingStop(true);
    setStartLstMinutes(lstMin);
    setNavStepIdx(0);
    setNavPlaying(false);
    setNavMode('browse');
    setIncomingDustAlert(wKey === 'dust_storm');
    setShowDustRadarCard(true);
    showToast({
      id: 'preset-applied',
      type: wKey === 'nominal' ? 'info' : 'warning',
      title: `SCENARIO: ${WEATHER_CONDITIONS[wKey].label.toUpperCase()}`,
      message: `BAT ${batPct}% // O2 ${o2Pct}% // ${LOADOUT_PROFILES[lKey].name.toUpperCase()}`,
    });
  };

  const handleNavigateToPOI = (targetId) => {
    const targetPOI = findPOIOrLandmark(targetId);
    if (!targetPOI) return;

    if (
      targetPOI.id === astronautLocId ||
      (astronautLocId === 'hab-alpha' && targetPOI.id === 'landing_site')
    ) {
      showToast({
        id: 'already-here',
        type: 'info',
        title: `CURRENT SITE: ${targetPOI.name.toUpperCase()}`,
        message: 'Select a different waypoint to plot next leg.',
      });
      return;
    }

    setCustomOriginCoord(null);
    setCustomDestCoord(null);
    setStartId(astronautLocId);
    setEndId(targetPOI.id);
    setNavMode('browse');
    setNavStepIdx(0);
    setNavPlaying(false);
    setFlyToTarget({ latLon: [targetPOI.lat, targetPOI.lon], zoom: 13.5, timestamp: Date.now() });
    showToast({
      id: 'route-set',
      type: 'info',
      title: 'TRAVERSE LEG PLOTTED',
      message: `${findPOIOrLandmark(astronautLocId)?.name || 'Origin'} -> ${targetPOI.name}`,
    });
  };

  const handleSetOrigin = (poiId) => {
    const target = findPOIOrLandmark(poiId);
    const resolvedId = target?.id || poiId;
    setCustomOriginCoord(null);
    setAstronautLocId(resolvedId);
    setStartId(resolvedId);
    setNavStepIdx(0);
    setNavPlaying(false);
    setNavMode('browse');
    if (target) {
      setFlyToTarget({ latLon: [target.lat, target.lon], zoom: 13.8, timestamp: Date.now() });
    }
    showToast({
      id: 'origin-updated',
      type: 'info',
      title: 'ORIGIN BASE UPDATED',
      message: `Origin locked to ${target?.name || resolvedId}.`,
    });
  };

  const handleSwapEndpoints = () => {
    const prevStart = startId;
    const prevEnd = endId;
    const prevOrigCoord = customOriginCoord;
    const prevDestCoord = customDestCoord;

    setCustomOriginCoord(prevDestCoord);
    setCustomDestCoord(prevOrigCoord);
    setStartId(prevEnd === 'custom-dest' ? 'custom-origin' : prevEnd);
    setEndId(prevStart === 'custom-origin' ? 'custom-dest' : prevStart);
    setAstronautLocId(prevEnd);
    setNavStepIdx(0);
    setNavPlaying(false);
    setNavMode('browse');

    const startLabel = findPOIOrLandmark(prevEnd)?.name || 'Origin';
    const endLabel = findPOIOrLandmark(prevStart)?.name || 'Target';
    showToast({
      id: 'endpoints-swapped',
      type: 'info',
      title: 'VECTORS INVERTED',
      message: `${startLabel} -> ${endLabel}`,
    });
  };

  const handleApplyCoordinateVectors = () => {
    const oLat = parseFloat(originLatInput);
    const oLon = parseFloat(originLonInput);
    const dLat = parseFloat(destLatInput);
    const dLon = parseFloat(destLonInput);
    if ([oLat, oLon, dLat, dLon].some((n) => Number.isNaN(n))) {
      showToast({
        id: 'coord-err',
        type: 'warning',
        title: 'COORDINATE PARSE FAULT',
        message: 'Enter valid decimal degrees for origin and target.',
      });
      return;
    }
    setCustomOriginCoord([oLat, oLon]);
    setCustomDestCoord([dLat, dLon]);
    setStartId('custom-origin');
    setEndId('custom-dest');
    setAstronautLocId('custom-origin');
    setFlyToTarget({ latLon: [(oLat + dLat) / 2, (oLon + dLon) / 2], zoom: 12.5, timestamp: Date.now() });
    showToast({
      id: 'coord-applied',
      type: 'info',
      title: 'CUSTOM COORDINATE TRAVERSE',
      message: `${oLat.toFixed(4)}, ${oLon.toFixed(4)} -> ${dLat.toFixed(4)}, ${dLon.toFixed(4)}`,
    });
  };

  const handleQuickLandmarkClick = (lm) => {
    setSelectedQuickLandmarkId(lm.id);
    setFlyToTarget({ latLon: lm.coords, zoom: 14, timestamp: Date.now() });
    showToast({
      id: `lm-${lm.id}`,
      type: 'info',
      title: `SECTOR FOCUS: ${lm.name.toUpperCase()}`,
      message: `${lm.coords[0].toFixed(4)} N, ${lm.coords[1].toFixed(4)} E // ELEV ${lm.elevation_m} m`,
    });
  };

  // Polygon Exclusion Draw Actions
  const activateDrawMode = (type) => {
    setActiveDrawMode((prev) => {
      const next = prev === type ? null : type;
      setDrawVertices([]);
      if (next) {
        showToast({
          id: 'draw-start',
          type: 'info',
          title: `DRAW MODE: ${APP_THEME.hazards[next].label}`,
          message: 'Click map to place 3 or more polygon vertices, then press FINISH ZONE.',
        });
      }
      return next;
    });
  };

  const handleAddDrawVertex = (latlng) => {
    setDrawVertices((prev) => [...prev, latlng]);
  };

  const handleFinishPolygon = () => {
    if (!activeDrawMode || drawVertices.length < 3) {
      showToast({
        id: 'draw-min',
        type: 'warning',
        title: 'INSUFFICIENT VERTICES',
        message: 'Place at least 3 vertices on the map before closing the polygon.',
      });
      return;
    }
    const newZone = {
      id: `ZONE-${String(drawnZones.length + 1).padStart(2, '0')}-${Date.now().toString().slice(-3)}`,
      type: activeDrawMode,
      latlngs: drawVertices,
    };
    setDrawnZones((prev) => [...prev, newZone]);
    setDrawVertices([]);
    setActiveDrawMode(null);
    showToast({
      id: 'draw-done',
      type: newZone.type === 'safe' ? 'success' : 'warning',
      title: `${APP_THEME.hazards[newZone.type].label} COMMITTED`,
      message: 'A* cost grid recalculated around updated geometry.',
    });
  };

  const handleCancelPolygon = () => {
    setActiveDrawMode(null);
    setDrawVertices([]);
  };

  const handleDeleteZone = (zoneId) => {
    setDrawnZones((prev) => prev.filter((z) => z.id !== zoneId));
    showToast({
      id: 'zone-removed',
      type: 'info',
      title: 'EXCLUSION ZONE REMOVED',
      message: `Zone ${zoneId} purged from cost grid.`,
    });
  };

  const handleClearAllZones = () => {
    setDrawnZones([]);
    setDrawVertices([]);
    setActiveDrawMode(null);
    showToast({
      id: 'zones-cleared',
      type: 'info',
      title: 'ALL EXCLUSION ZONES PURGED',
      message: 'Cost grid restored to baseline orbital hazard layers.',
    });
  };

  // Mission Exports (GeoJSON + TXT Telemetry Report)
  const exportTraverseGeoJSON = () => {
    const features = [];
    if (routeResult?.pathCoords?.length) {
      features.push({
        type: 'Feature',
        properties: {
          name: `${startPOI.name} -> ${endPOI.name}`,
          distance_km: routeResult.distKm,
          eta_min: routeResult.durationMin,
          loadout: loadout.name,
          weather: weather.label,
          viability: routeResult.viabilityScore,
        },
        geometry: {
          type: 'LineString',
          coordinates: routeResult.pathCoords.map(([lat, lon]) => [lon, lat]),
        },
      });
    }
    drawnZones.forEach((z) => {
      features.push({
        type: 'Feature',
        properties: { id: z.id, zoneType: z.type, label: APP_THEME.hazards[z.type]?.label },
        geometry: {
          type: 'Polygon',
          coordinates: [[...z.latlngs, z.latlngs[0]].map(([lat, lon]) => [lon, lat])],
        },
      });
    });

    const blob = new Blob([JSON.stringify({ type: 'FeatureCollection', features }, null, 2)], {
      type: 'application/geo+json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jezero_traverse_sol${selectedMissionSol}.geojson`;
    a.click();
    URL.revokeObjectURL(url);
    showToast({
      id: 'export-geojson',
      type: 'success',
      title: 'GEOJSON EXPORTED',
      message: `Exported traverse and ${drawnZones.length} custom zone(s).`,
    });
  };

  const exportMissionReport = () => {
    const lines = [
      '============================================================',
      'DALIL MARS // JEZERO-NILI SURFACE NAVIGATION TELEMETRY REPORT',
      '============================================================',
      `MISSION SOL       : ${selectedMissionSol}`,
      `LOCAL SOLAR TIME  : ${martianEnv.lstText}`,
      `ORIGIN            : ${startPOI.name} (${startPOI.lat.toFixed(5)} N, ${startPOI.lon.toFixed(5)} E)`,
      `TARGET            : ${endPOI.name} (${endPOI.lat.toFixed(5)} N, ${endPOI.lon.toFixed(5)} E)`,
      `LOADOUT PROFILE   : ${loadout.name} (${loadout.speedKmh} km/h)`,
      `WEATHER STATE     : ${weather.label}`,
      `TRAVERSE DISTANCE : ${routeResult.distKm} km`,
      `ESTIMATED ETA     : ${routeResult.durationMin} min`,
      `ELEVATION RANGE   : ${routeResult.minElevationM} m to ${routeResult.maxElevationM} m (+${routeResult.elevGainM} m gain)`,
      `MAX GRADE SLOPE   : ${routeResult.maxSlopeAlongPath} deg`,
      `HAZARD CROSSINGS  : ${routeResult.hazardCrossings}`,
      `VIABILITY INDEX   : ${routeResult.viabilityScore}%`,
      `PROJECTED BAT END : ${routeResult.finalArrivalBattery}%`,
      `PROJECTED O2 END  : ${routeResult.finalArrivalO2}%`,
      `CUSTOM ZONES      : ${drawnZones.length}`,
      '============================================================',
    ].join('\n');

    const blob = new Blob([lines], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `jezero_telemetry_sol${selectedMissionSol}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showToast({
      id: 'export-txt',
      type: 'success',
      title: 'TELEMETRY LOG EXPORTED',
      message: `Saved jezero_telemetry_sol${selectedMissionSol}.txt.`,
    });
  };

  // Derived Telemetry Readouts for Bottom Bar
  const curBat = Math.round(liveNavState?.currentBattery ?? startBatteryPct);
  const curO2 = Math.round(liveNavState?.currentO2 ?? startO2Pct);
  const curSlope = routeResult?.maxSlopeAlongPath ?? 0;
  const gcrFlux = weatherKey === 'solar_storm' ? '2.40 mSv/d' : '0.67 mSv/d';
  const clo4Pct = cursorTelemetry.hazardLabel.includes('CHEMICAL') ? '0.84 wt%' : '0.21 wt%';
  const isNavFault = routeResult?.rangeStatus === 'out_of_range' || weatherKey !== 'nominal';

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#0b0d11] text-[#edf0f5] font-sans select-none">
      {/* 1. DEVELOPER TERMINAL SYSTEM STATUS & COMMAND BAR */}
      {uiMode === 'developer' && (
        <header className="shrink-0 min-h-[46px] bg-[#13161c] border-b border-[#242933] px-3 py-1.5 flex flex-wrap items-center justify-between gap-2 z-30">
        {/* System Identity & Solid Status Indicators */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2 font-mono text-xs font-bold tracking-wider text-[#edf0f5]">
            <span className="w-2 h-2 rounded-full bg-[#22c55e] shrink-0" />
            <span>DALIL MARS // JEZERO TERMINAL</span>
          </div>

          <div className="hidden lg:flex items-center gap-3 pl-3 border-l border-[#242933] font-mono text-[11px] text-[#9da5b4]">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
              <span>SYS: NOMINAL</span>
            </span>
            <span className="inline-flex items-center gap-1.5">
              <span className={`w-1.5 h-1.5 rounded-full ${isNavFault ? 'bg-[#ef4444]' : 'bg-[#22c55e]'}`} />
              <span>NAV: {navPlaying ? 'EVA ACTIVE' : isNavFault ? 'ALERT' : 'FIX 3D'}</span>
            </span>
            <span>SOL {selectedMissionSol}</span>
            <span>{martianEnv.lstText}</span>
            <span className={curBat < 25 ? 'text-[#ef4444] font-bold' : 'text-[#22c55e] font-bold'}>
              BAT {curBat}%
            </span>
            <span className={curO2 < 25 ? 'text-[#ef4444] font-bold' : 'text-[#edf0f5] font-bold'}>
              O2 {curO2}%
            </span>
          </div>
        </div>

        {/* Weather Simulation Modes & Global Quick Tools */}
        <div className="flex items-center gap-1.5 flex-wrap">
          <div className="flex items-center bg-[#0b0d11] border border-[#242933] rounded-[4px] p-0.5 gap-0.5">
            {[
              { key: 'nominal', label: 'NOMINAL SOL', icon: Sun },
              { key: 'dust_storm', label: 'DUST SQUALL', icon: Wind },
              { key: 'solar_storm', label: 'SOLAR SPE', icon: ShieldAlert },
            ].map((item) => {
              const Icon = item.icon;
              const isSelected = weatherKey === item.key;
              return (
                <button
                  type="button"
                  key={item.key}
                  onClick={() => {
                    setWeatherKey(item.key);
                    setIncomingDustAlert(item.key === 'dust_storm');
                    if (item.key === 'dust_storm') setShowDustRadarCard(true);
                  }}
                  className={`min-h-[34px] px-2.5 py-1 rounded-[4px] font-mono text-[10px] font-bold flex items-center gap-1.5 cursor-pointer border ${
                    isSelected
                      ? item.key === 'nominal'
                        ? 'bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]'
                        : 'bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]'
                      : 'bg-transparent text-[#9da5b4] hover:text-[#edf0f5] hover:bg-[#191d24] border-transparent'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span className="hidden sm:inline">{item.label}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => triggerLocateAstronaut(15)}
            className="glove-btn min-h-[36px] px-2.5 rounded-[4px] bg-[#191d24] hover:bg-[#222731] text-[#edf0f5] border border-[#353c4a] font-mono text-[10px] font-bold flex items-center gap-1.5 cursor-pointer"
            title="Lock GPS and Zoom to EVA Position"
          >
            <Crosshair className="h-3.5 w-3.5 text-[#22c55e]" />
            <span>LOCATE EVA</span>
          </button>

          <button
            type="button"
            onClick={handleCompassReset}
            className="glove-btn min-h-[36px] px-2.5 rounded-[4px] bg-[#191d24] hover:bg-[#222731] text-[#edf0f5] border border-[#353c4a] font-mono text-[10px] font-bold flex items-center gap-1.5 cursor-pointer"
            title="Align North & Re-Center Map"
          >
            <Compass className="h-3.5 w-3.5" />
            <span className="hidden md:inline">NORTH 000</span>
          </button>

          <button
            type="button"
            onClick={() => openPanoramaModal(selectedQuickLandmarkId || endId)}
            className="glove-btn min-h-[36px] px-2.5 rounded-[4px] bg-[#191d24] hover:bg-[#222731] text-[#edf0f5] border border-[#353c4a] font-mono text-[10px] font-bold flex items-center gap-1.5 cursor-pointer"
            title="Open 360 Photosphere / Surface Imagery"
          >
            <Camera className="h-3.5 w-3.5" />
            <span>VISTA / 360</span>
          </button>

          <button
            type="button"
            onClick={() => setShowLegendSheet(true)}
            className="glove-btn min-h-[36px] px-2.5 rounded-[4px] bg-[#191d24] hover:bg-[#222731] text-[#9da5b4] hover:text-[#edf0f5] border border-[#353c4a] font-mono text-[10px] font-bold flex items-center gap-1.5 cursor-pointer"
            title="Map Symbology Legend"
          >
            <MapIcon className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">LEGEND</span>
          </button>

          <button
            type="button"
            onClick={() => switchUiMode('astronaut')}
            className="glove-btn min-h-[36px] px-2.5 rounded-[4px] bg-[#16a34a] hover:bg-[#22c55e] text-[#0b0d11] border border-[#22c55e] font-mono text-[10px] font-bold flex items-center gap-1.5 cursor-pointer"
            title="Switch to Simplified Astronaut Tablet GUI"
          >
            <Tablet className="h-3.5 w-3.5" />
            <span>EVA TABLET GUI</span>
          </button>

          <button
            type="button"
            onClick={() => setSidebarOpen((v) => !v)}
            className="glove-btn min-h-[36px] px-2.5 rounded-[4px] bg-[#222731] hover:bg-[#2c323f] text-[#edf0f5] border border-[#4f5767] font-mono text-[10px] font-bold flex items-center gap-1 cursor-pointer"
            title="Toggle Control Side Panel"
          >
            {sidebarOpen ? (
              <>
                <ChevronRight className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">HIDE PANEL</span>
              </>
            ) : (
              <>
                <ChevronLeft className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">CONSOLE</span>
              </>
            )}
          </button>
        </div>
        </header>
      )}

      {/* 2. MAIN WORKSPACE (TACTICAL MAP + COLLAPSIBLE INSTRUMENT SIDEBAR) */}
      <div className="flex-1 flex flex-col lg:flex-row relative overflow-hidden">
        {/* LEFT/CENTER: PRIMARY PERSISTENT MAP VIEWPORT */}
        <main className="relative flex-1 min-h-[340px] bg-[#0b0d11] overflow-hidden">
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
            flyToTarget={flyToTarget}
            dustFrontState={dustFrontState}
            solarPhase={martianEnv.solarPhase}
            astronautLocId={astronautLocId}
            basemap={basemap}
            reliefBlend={reliefBlend}
            landmarks={landmarksData}
            activeDrawMode={uiMode === 'developer' ? activeDrawMode : null}
            drawVertices={uiMode === 'developer' ? drawVertices : []}
            drawnZones={drawnZones}
            cleanTabletMode={uiMode === 'astronaut'}
            onOpenPanorama={(sol) => openPanoramaModal(sol)}
            onOpenLandmarkVista={(id) => openPanoramaModal(id)}
            onNavigateToPOI={(id) => handleNavigateToPOI(id)}
            onSetOrigin={(id) => handleSetOrigin(id)}
            onSelectLandmark={(lm) => {
              if (typeof lm === 'string') {
                const found = landmarksData.find((l) => l.id === lm);
                if (found) setActiveLandmark(found);
              } else {
                setActiveLandmark(lm);
              }
            }}
            onAddDrawVertex={handleAddDrawVertex}
            onDeleteZone={handleDeleteZone}
            onCursorMove={setCursorTelemetry}
          />

          {uiMode === 'developer' && (
            <>

          {/* HUD TOP-LEFT: QUICK 11-SITE LANDMARK SELECTOR */}
          <div className="absolute top-2.5 left-2.5 z-[450] max-w-[260px] sm:max-w-[360px] bg-[#13161c]/95 border border-[#242933] rounded-[4px] p-1.5">
            <div className="flex items-center justify-between px-1 pb-1 mb-1 border-b border-[#242933] font-mono text-[9.5px] font-bold text-[#656d7d] tracking-wider uppercase">
              <span>QUICK SECTOR JUMP [11]</span>
              {selectedQuickLandmarkId && (
                <button
                  type="button"
                  onClick={() => {
                    const found = landmarksData.find((l) => l.id === selectedQuickLandmarkId);
                    if (found) setActiveLandmark(found);
                  }}
                  className="text-[#22c55e] hover:underline cursor-pointer"
                >
                  DOSSIER
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-1 max-h-[82px] overflow-y-auto aerospace-scroll">
              {landmarksData.map((lm) => {
                const isSel = selectedQuickLandmarkId === lm.id;
                return (
                  <button
                    type="button"
                    key={lm.id}
                    onClick={() => handleQuickLandmarkClick(lm)}
                    className={`min-h-[30px] px-2 py-0.5 rounded-[4px] border font-mono text-[10px] font-semibold cursor-pointer truncate max-w-[130px] ${
                      isSel
                        ? 'bg-[#2c323f] text-[#edf0f5] border-[#4f5767]'
                        : 'bg-[#191d24] hover:bg-[#222731] text-[#9da5b4] hover:text-[#edf0f5] border-[#242933]'
                    }`}
                    title={`${lm.name} (${lm.coords[0].toFixed(3)}N, ${lm.coords[1].toFixed(3)}E)`}
                  >
                    {lm.name.toUpperCase()}
                  </button>
                );
              })}
            </div>
          </div>

          {/* HUD TOP-RIGHT: EXCLUSION POLYGON DRAWING TOOLSET */}
          <div className="absolute top-2.5 right-2.5 z-[450] w-[195px] bg-[#13161c]/95 border border-[#242933] rounded-[4px] p-1.5 flex flex-col gap-1">
            <div className="px-1 pb-1 border-b border-[#242933] font-mono text-[9.5px] font-bold text-[#656d7d] tracking-wider uppercase">
              EXCLUSION DRAW TOOLS
            </div>
            {Object.entries(APP_THEME.hazards).map(([zoneKey, cfg]) => {
              const isDrawingThis = activeDrawMode === zoneKey;
              const isSafe = zoneKey === 'safe';
              return (
                <button
                  type="button"
                  key={zoneKey}
                  onClick={() => activateDrawMode(zoneKey)}
                  className={`min-h-[32px] px-2 py-1 rounded-[4px] border font-mono text-[10px] font-bold flex items-center gap-2 cursor-pointer text-left ${
                    isDrawingThis
                      ? 'bg-[#2c323f] text-[#edf0f5] border-[#edf0f5]'
                      : 'bg-[#191d24] hover:bg-[#222731] text-[#9da5b4] hover:text-[#edf0f5] border-[#242933]'
                  }`}
                >
                  <span
                    className={`w-2 h-2 rounded-full shrink-0 ${
                      isSafe ? 'bg-[#22c55e]' : 'bg-[#ef4444]'
                    }`}
                  />
                  <span className="truncate">{cfg.label}</span>
                </button>
              );
            })}

            {activeDrawMode && (
              <div className="mt-1 pt-1 border-t border-[#242933] space-y-1">
                <div className="font-mono text-[9.5px] text-[#edf0f5] px-1">
                  VERTICES PLACED: {drawVertices.length}
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={handleFinishPolygon}
                    disabled={drawVertices.length < 3}
                    className="min-h-[32px] rounded-[4px] bg-[#16a34a] hover:bg-[#22c55e] disabled:bg-[#222731] disabled:text-[#656d7d] text-[#0b0d11] font-mono text-[10px] font-bold cursor-pointer border border-[#22c55e] disabled:border-[#353c4a]"
                  >
                    FINISH
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelPolygon}
                    className="min-h-[32px] rounded-[4px] bg-[#191d24] hover:bg-[#222731] text-[#ef4444] font-mono text-[10px] font-bold cursor-pointer border border-[#353c4a]"
                  >
                    CANCEL
                  </button>
                </div>
              </div>
            )}

            {drawnZones.length > 0 && (
              <button
                type="button"
                onClick={handleClearAllZones}
                className="min-h-[30px] px-2 rounded-[4px] bg-[#191d24] hover:bg-[#dc2626]/20 text-[#ef4444] border border-[#353c4a] font-mono text-[10px] font-bold cursor-pointer flex items-center justify-center gap-1"
              >
                <Trash2 className="h-3 w-3" />
                <span>CLEAR ZONES ({drawnZones.length})</span>
              </button>
            )}
          </div>

          {/* ACTIVE TURN-BY-TURN EVA NAVIGATION BANNER */}
          {(navMode === 'navigating' || liveNavState?.active) && currentManeuver && (
            <div className="absolute top-[115px] sm:top-2.5 left-1/2 -translate-x-1/2 z-[460] w-[92%] max-w-md bg-[#13161c]/95 border border-[#353c4a] rounded-[4px] p-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-mono text-[10px] font-bold uppercase text-[#22c55e]">
                    <Navigation className="h-3.5 w-3.5 shrink-0" />
                    <span>{currentManeuver.distanceText} REMAINING // HDG {liveNavState?.heading || 0} DEG</span>
                  </div>
                  <div className="text-xs font-bold text-[#edf0f5] truncate mt-0.5 uppercase">
                    {currentManeuver.instruction}
                  </div>
                  <div className="text-[10px] font-mono text-[#9da5b4] truncate">
                    {currentManeuver.subtitle}
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => setNavPlaying((p) => !p)}
                    className="glove-btn min-h-[38px] min-w-[38px] rounded-[4px] bg-[#222731] hover:bg-[#2c323f] text-[#edf0f5] border border-[#353c4a] flex items-center justify-center cursor-pointer"
                    title={navPlaying ? 'Pause EVA Sim' : 'Resume EVA Sim'}
                  >
                    {navPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => setNavSpeed((s) => (s === 1 ? 3 : 1))}
                    className="glove-btn min-h-[38px] px-2 rounded-[4px] bg-[#191d24] hover:bg-[#222731] text-[#edf0f5] border border-[#353c4a] font-mono text-[10px] font-bold cursor-pointer"
                  >
                    {navSpeed}X
                  </button>
                  <button
                    type="button"
                    onClick={stopNavigation}
                    className="glove-btn min-h-[38px] min-w-[38px] rounded-[4px] bg-[#191d24] hover:bg-[#dc2626]/20 text-[#ef4444] border border-[#353c4a] flex items-center justify-center cursor-pointer"
                    title="Exit Active Navigation"
                  >
                    <Square className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              <div className="mt-2 pt-1.5 border-t border-[#242933] grid grid-cols-4 gap-2 font-mono text-[10px] text-[#9da5b4]">
                <div>SPD {liveNavState?.speedKmh} KM/H</div>
                <div>ETA {liveNavState?.estTimeRemainingMin} MIN</div>
                <div className={curBat < 25 ? 'text-[#ef4444]' : 'text-[#22c55e]'}>
                  BAT {curBat}%
                </div>
                <div>HR {liveNavState?.heartRateBpm} BPM</div>
              </div>
            </div>
          )}

          {/* PREDICTIVE DUST SQUALL RADAR ALERT HUD (CRIMSON FAULT ONLY) */}
          {dustFrontState.active && showDustRadarCard && (
            <div className="absolute bottom-24 right-2.5 z-[460] w-[280px] sm:w-[310px] bg-[#13161c]/95 border border-[#ef4444] rounded-[4px] p-2.5">
              <div className="flex items-center justify-between border-b border-[#242933] pb-1.5 mb-2">
                <div className="flex items-center gap-1.5 font-mono text-[10.5px] font-bold text-[#ef4444] uppercase">
                  <Wind className="h-3.5 w-3.5" />
                  <span>SQUALL INTERCEPT ALERT</span>
                </div>
                <button
                  type="button"
                  onClick={() => setShowDustRadarCard(false)}
                  className="text-[#9da5b4] hover:text-[#edf0f5] p-0.5 cursor-pointer"
                  aria-label="Dismiss Storm Card"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="grid grid-cols-3 gap-1.5 font-mono text-[10px] mb-2">
                <div className="bg-[#191d24] border border-[#242933] rounded-[4px] p-1.5">
                  <div className="text-[#656d7d] text-[9px]">RANGE</div>
                  <div className="text-[#edf0f5] font-bold">{dustFrontState.distanceAheadKm} KM</div>
                </div>
                <div className="bg-[#191d24] border border-[#242933] rounded-[4px] p-1.5">
                  <div className="text-[#656d7d] text-[9px]">IMPACT</div>
                  <div className="text-[#ef4444] font-bold">T-{dustFrontState.etaMin} MIN</div>
                </div>
                <div className="bg-[#191d24] border border-[#242933] rounded-[4px] p-1.5">
                  <div className="text-[#656d7d] text-[9px]">BARO</div>
                  <div className="text-[#edf0f5] font-bold">{dustFrontState.pressureDropPa} Pa</div>
                </div>
              </div>
              <button
                type="button"
                onClick={triggerShelterDivert}
                className="glove-btn w-full min-h-[38px] px-2.5 rounded-[4px] bg-[#dc2626] hover:bg-[#ef4444] text-[#edf0f5] font-mono text-[10px] font-bold uppercase cursor-pointer flex items-center justify-center gap-1.5"
              >
                <ShieldAlert className="h-3.5 w-3.5" />
                <span>DIVERT TO {nearestShelter.station?.name.toUpperCase()} ({nearestShelter.distKm} KM)</span>
              </button>
            </div>
          )}

          {/* GOOGLE MAPS-STYLE BOTTOM-LEFT BASEMAP THUMBNAIL + MAP LAYERS POPOVER */}
          <div className="absolute bottom-3 left-2.5 z-[460] flex items-end gap-2">
            {/* 1-Tap Quick Switch Card (Satellite <-> Terrain) */}
            <button
              type="button"
              onClick={() => setBasemap((b) => (b === 'satellite' ? 'terrain' : 'satellite'))}
              className="glove-btn min-h-[54px] min-w-[116px] bg-[#13161c]/95 hover:bg-[#191d24] border border-[#353c4a] rounded-[4px] p-2 flex items-center gap-2 cursor-pointer text-left"
              title="Toggle Satellite vs Terrain Basemap"
            >
              <div className="h-9 w-9 rounded-[4px] border border-[#4f5767] bg-[#191d24] flex items-center justify-center shrink-0">
                <MapIcon className="h-4 w-4 text-[#edf0f5]" />
              </div>
              <div className="font-mono leading-tight">
                <div className="text-[9px] text-[#656d7d] uppercase">BASEMAP</div>
                <div className="text-[11px] font-bold text-[#edf0f5] uppercase">
                  {BASEMAP_OPTIONS.find((m) => m.id === basemap)?.short || 'SAT'}
                </div>
              </div>
            </button>

            {/* Map Types & Layers Popover Trigger */}
            <button
              type="button"
              onClick={() => setShowLayersSheet((s) => !s)}
              className={`glove-btn min-h-[54px] px-3 rounded-[4px] border font-mono text-[10px] font-bold flex items-center gap-1.5 cursor-pointer ${
                showLayersSheet
                  ? 'bg-[#2c323f] text-[#edf0f5] border-[#edf0f5]'
                  : 'bg-[#13161c]/95 hover:bg-[#191d24] text-[#9da5b4] hover:text-[#edf0f5] border-[#353c4a]'
              }`}
            >
              <Layers className="h-4 w-4" />
              <span>MAP LAYERS</span>
            </button>

            {/* Google Maps-Style Expanded Map Type & Relief Sheet */}
            {showLayersSheet && (
              <div className="absolute bottom-[62px] left-0 w-[300px] sm:w-[340px] bg-[#13161c] border border-[#353c4a] rounded-[4px] p-3 space-y-3 z-[500]">
                <div className="flex items-center justify-between border-b border-[#242933] pb-2">
                  <span className="font-mono text-[11px] font-bold text-[#edf0f5] uppercase">
                    MAP TYPES & OVERLAYS
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowLayersSheet(false)}
                    className="text-[#9da5b4] hover:text-[#edf0f5] p-1 cursor-pointer"
                    aria-label="Close Map Layers"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div>
                  <div className="font-mono text-[9.5px] font-bold text-[#656d7d] uppercase mb-1.5">
                    MAP TYPE
                  </div>
                  <div className="grid grid-cols-3 gap-1.5">
                    {BASEMAP_OPTIONS.map((opt) => {
                      const active = basemap === opt.id;
                      return (
                        <button
                          type="button"
                          key={opt.id}
                          onClick={() => setBasemap(opt.id)}
                          className={`glove-btn min-h-[42px] px-2 py-1.5 rounded-[4px] border font-mono text-[10px] font-bold cursor-pointer ${
                            active
                              ? 'bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]'
                              : 'bg-[#191d24] hover:bg-[#222731] text-[#9da5b4] border-[#242933]'
                          }`}
                        >
                          {opt.short}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between font-mono text-[10px] text-[#9da5b4] mb-1">
                    <span>RELIEF HILLSHADE BLEND</span>
                    <span className="text-[#edf0f5] font-bold">{Math.round(reliefBlend * 100)}%</span>
                  </div>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(reliefBlend * 100)}
                    onChange={(e) => setReliefBlend(Number(e.target.value) / 100)}
                    className="glove-slider"
                  />
                </div>

                <div className="pt-1 border-t border-[#242933] grid grid-cols-2 gap-1.5 max-h-[160px] overflow-y-auto aerospace-scroll">
                  {OVERLAY_ITEMS.map((ov) => (
                    <label
                      key={ov.key}
                      className="flex items-center justify-between gap-2 px-2 py-1.5 bg-[#191d24] border border-[#242933] rounded-[4px] font-mono text-[10px] text-[#9da5b4] cursor-pointer hover:border-[#353c4a]"
                    >
                      <span className="truncate">{ov.label.split(' ')[0]} {ov.label.split(' ')[1] || ''}</span>
                      <input
                        type="checkbox"
                        checked={Boolean(layers[ov.key])}
                        onChange={(e) =>
                          setLayers((prev) => ({ ...prev, [ov.key]: e.target.checked }))
                        }
                        className="accent-[#22c55e] h-3.5 w-3.5 cursor-pointer"
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* LIVE NON-INTRUSIVE TELEMETRY TOAST */}
          {activeToast && (
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[490] w-[92%] max-w-md bg-[#13161c]/95 border border-[#353c4a] rounded-[4px] px-3 py-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2.5 min-w-0">
                <span
                  className={`w-2 h-2 rounded-full shrink-0 ${
                    activeToast.type === 'warning' ? 'bg-[#ef4444]' : 'bg-[#22c55e]'
                  }`}
                />
                <div className="min-w-0 font-mono">
                  <div className="text-[10.5px] font-bold text-[#edf0f5] uppercase truncate">
                    {activeToast.title}
                  </div>
                  <div className="text-[10px] text-[#9da5b4] truncate">{activeToast.message}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveToast(null)}
                className="text-[#9da5b4] hover:text-[#edf0f5] p-1 cursor-pointer shrink-0"
                aria-label="Dismiss Notification"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
            </>
          )}

          {/* SIMPLIFIED ASTRONAUT TABLET GUI (DEFAULT GLOVE-FIRST VIEW) */}
          {uiMode === 'astronaut' && (
            <>
              {/* A1. TOP-CENTER HEADS-UP NOTIFICATION POPUP */}
              {activeToast && (
                <div className="android-toast-slide absolute top-3.5 left-1/2 z-[1000] w-[92%] max-w-md -translate-x-1/2">
                  <div
                    className={`flex items-start justify-between gap-3 rounded-[6px] border p-3 bg-[#13161c]/95 ${
                      activeToast.type === 'warning'
                        ? 'border-[#ef4444] text-[#edf0f5]'
                        : activeToast.type === 'charge' || activeToast.type === 'success'
                        ? 'border-[#22c55e] text-[#edf0f5]'
                        : 'border-[#353c4a] text-[#edf0f5]'
                    }`}
                  >
                    <div className="flex items-start gap-2.5">
                      <div className="mt-0.5 rounded-[4px] bg-[#191d24] border border-[#242933] p-2 shrink-0">
                        {activeToast.type === 'warning' ? (
                          <AlertTriangle className="h-4 w-4 text-[#ef4444]" />
                        ) : activeToast.type === 'charge' ? (
                          <Zap className="h-4 w-4 text-[#22c55e]" />
                        ) : (
                          <CheckCircle2 className="h-4 w-4 text-[#22c55e]" />
                        )}
                      </div>
                      <div className="min-w-0">
                        <div className="font-mono text-[11px] font-bold uppercase tracking-wider text-[#edf0f5]">
                          {activeToast.title}
                        </div>
                        <div className="text-[11px] text-[#9da5b4] leading-snug mt-0.5">
                          {activeToast.message}
                        </div>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setActiveToast(null)}
                      className="p-1.5 rounded-[4px] hover:bg-[#222731] text-[#9da5b4] hover:text-[#edf0f5] cursor-pointer shrink-0"
                      aria-label="Dismiss Notification"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              )}

              {/* A2. FLOATING GPS LOCK TAG */}
              {showLocationPinTag && (
                <div className="location-tag-popup absolute bottom-[270px] sm:bottom-[230px] left-1/2 -translate-x-1/2 z-[490] flex items-center gap-2 rounded-[4px] bg-[#13161c]/95 border border-[#22c55e] px-3.5 py-2 text-[11px] font-mono font-bold text-[#edf0f5]">
                  <span className="h-2 w-2 rounded-full bg-[#22c55e]" />
                  <MapPin className="h-3.5 w-3.5 text-[#22c55e]" />
                  <span>
                    GPS LOCKED:{' '}
                    {liveNavState?.currentLatLon
                      ? `${liveNavState.currentLatLon[0].toFixed(4)} N, ${liveNavState.currentLatLon[1].toFixed(4)} E`
                      : `${startPOI.lat.toFixed(4)} N, ${startPOI.lon.toFixed(4)} E`}
                  </span>
                  <span className="text-[#656d7d]">|</span>
                  <span className="text-[#22c55e]">ZOOM 15X</span>
                </div>
              )}

              {/* A3. PREDICTIVE SQUALL RADAR CARD */}
              {dustFrontState.active && showDustRadarCard && (
                <div className="squall-card-slide absolute top-36 left-3 z-[460] w-[290px] sm:w-[320px] rounded-[6px] bg-[#13161c]/95 border border-[#ef4444] p-3 space-y-2.5">
                  <div className="flex items-center justify-between border-b border-[#242933] pb-2">
                    <span className="text-[11px] font-bold uppercase text-[#ef4444] flex items-center gap-1.5 font-mono">
                      <Wind className="h-4 w-4 text-[#ef4444]" /> PREDICTIVE SQUALL RADAR
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowDustRadarCard(false)}
                      className="p-1 rounded-[4px] text-[#9da5b4] hover:text-[#edf0f5] cursor-pointer"
                      aria-label="Close Squall Card"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="flex items-baseline justify-between bg-[#191d24] p-2.5 rounded-[4px] border border-[#242933]">
                    <div>
                      <div className="text-[9.5px] text-[#9da5b4] uppercase font-mono font-bold">
                        SQUALL IMPACT IN
                      </div>
                      <div className="text-2xl font-bold text-[#ef4444] font-mono flex items-baseline gap-1 mt-0.5">
                        <span>~{dustFrontState.etaMin}</span>
                        <span className="text-xs text-[#9da5b4]">min</span>
                      </div>
                    </div>
                    <div className="text-right font-mono">
                      <div className="text-[9.5px] text-[#9da5b4] uppercase">CLOSING RANGE</div>
                      <div className="text-lg font-bold text-[#edf0f5] mt-0.5">
                        {dustFrontState.distanceAheadKm} km
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-[10px] font-mono">
                    <div className="p-2 rounded-[4px] bg-[#191d24] border border-[#242933]">
                      <span className="text-[#656d7d] block font-bold">BARO RATE</span>
                      <span className="text-[#ef4444] font-bold">-2.8 Pa/min</span>
                    </div>
                    <div className="p-2 rounded-[4px] bg-[#191d24] border border-[#242933]">
                      <span className="text-[#656d7d] block font-bold">EVAC WINDOW</span>
                      <span className="text-[#22c55e] font-bold">
                        {Math.max(2, dustFrontState.etaMin - 5)} min safe
                      </span>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={triggerShelterDivert}
                    className="glove-btn w-full min-h-[46px] px-3 rounded-[4px] bg-[#dc2626] hover:bg-[#ef4444] text-[#edf0f5] font-mono font-bold text-xs uppercase flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <ShieldAlert className="h-4 w-4 shrink-0" />
                    <span className="truncate">
                      DIVERT TO {nearestShelter.station.name.split(' ')[0].toUpperCase()} ({nearestShelter.distKm} KM)
                    </span>
                  </button>
                </div>
              )}

              {/* A4. TOP FLOATING NAVIGATION / EXPLORE HEADER */}
              <div className="absolute top-3 left-3 right-3 z-[460] flex flex-col items-center pointer-events-none">
                {navMode === 'navigating' ? (
                  /* ACTIVE TURN-BY-TURN MANEUVER BANNER */
                  <div className="pointer-events-auto w-full max-w-xl rounded-[6px] bg-[#13161c]/95 border border-[#22c55e] p-3 text-[#edf0f5]">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[4px] bg-[#191d24] border border-[#22c55e]">
                          {liveNavState?.isRecharging ? (
                            <Zap className="h-6 w-6 text-[#22c55e]" />
                          ) : liveNavState?.arrived ? (
                            <CheckCircle2 className="h-6 w-6 text-[#22c55e]" />
                          ) : (
                            <Navigation2
                              className="h-6 w-6 text-[#edf0f5]"
                              style={{ transform: `rotate(${liveNavState?.heading || 0}deg)` }}
                            />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="text-lg font-bold tracking-tight text-[#edf0f5] flex items-center gap-2 font-mono">
                            <span>{currentManeuver?.distanceText}</span>
                            <span className="text-[10.5px] font-semibold text-[#22c55e] bg-[#191d24] px-2 py-0.5 rounded-[4px] border border-[#353c4a]">
                              {liveNavState?.heading || 0} DEG | {martianEnv.lstText}
                            </span>
                          </div>
                          <div className="text-xs font-semibold text-[#edf0f5] truncate uppercase">
                            {currentManeuver?.instruction}
                          </div>
                        </div>
                      </div>

                      <div className="text-right font-mono shrink-0">
                        <div className="text-sm font-bold text-[#edf0f5]">
                          {liveNavState?.speedKmh} <span className="text-[10px] text-[#9da5b4]">km/h</span>
                        </div>
                        <div className="text-[10px] text-[#9da5b4]">{martianEnv.ambientTempC} C</div>
                      </div>
                    </div>

                    <div className="mt-2 pt-2 border-t border-[#242933] text-[11px] font-mono text-[#9da5b4] flex items-center justify-between gap-2">
                      <span className="truncate">{currentManeuver?.subtitle}</span>
                      <div className="flex items-center gap-3 shrink-0 font-bold">
                        <span className={`flex items-center gap-1 ${curBat < 25 ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
                          <Battery className="h-3.5 w-3.5" /> {curBat}%
                        </span>
                        <span className="flex items-center gap-1 text-[#edf0f5]">
                          <Droplets className="h-3.5 w-3.5 text-[#22c55e]" /> {curO2}%
                        </span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* SIMPLE EXPLORE BAR + WEATHER MODES + SCENARIO PRESETS */
                  <div className="pointer-events-auto w-full max-w-2xl space-y-2">
                    <div className="flex items-center justify-between gap-2 rounded-[6px] bg-[#13161c]/95 border border-[#353c4a] px-3 py-2">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] bg-[#191d24] border border-[#353c4a] text-[#edf0f5]">
                          <Compass className="h-5 w-5" />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-bold tracking-wider uppercase text-[#edf0f5] truncate">
                              Dalil Mars
                            </span>
                            <span className="rounded-[4px] bg-[#191d24] px-1.5 py-0.5 text-[9px] font-mono font-bold text-[#22c55e] border border-[#22c55e]/50">
                              JEZERO
                            </span>
                          </div>
                          <div className="text-[10px] font-mono text-[#9da5b4] flex items-center gap-1.5">
                            <span>SOL {selectedMissionSol}</span>
                            <span>|</span>
                            <span className="text-[#edf0f5] font-semibold">{martianEnv.lstText}</span>
                            <span>|</span>
                            <span>{martianEnv.ambientTempC} C</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => setShowRouteOptions((v) => !v)}
                          className={`glove-btn min-h-[42px] px-3 py-1.5 rounded-[4px] border text-xs font-mono font-bold uppercase flex items-center gap-1.5 cursor-pointer ${
                            showRouteOptions
                              ? 'bg-[#22c55e] text-[#0b0d11] border-[#22c55e]'
                              : 'bg-[#191d24] hover:bg-[#222731] text-[#edf0f5] border-[#353c4a]'
                          }`}
                        >
                          <Sliders className="h-4 w-4" />
                          <span>Route Setup</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => switchUiMode('developer')}
                          className="glove-btn min-h-[42px] px-2.5 py-1.5 rounded-[4px] bg-[#191d24] hover:bg-[#222731] text-[#9da5b4] hover:text-[#edf0f5] border border-[#353c4a] font-mono text-[10.5px] font-bold uppercase flex items-center gap-1.5 cursor-pointer"
                          title="Switch to Developer Ground Control Terminal GUI"
                        >
                          <Terminal className="h-4 w-4" />
                          <span className="hidden sm:inline">DEV GUI</span>
                        </button>
                      </div>
                    </div>

                    {/* 3-Button Weather Mode Selector */}
                    <div className="flex items-center gap-1 bg-[#13161c]/95 p-1 rounded-[6px] border border-[#242933]">
                      <button
                        type="button"
                        onClick={() => {
                          setWeatherKey('nominal');
                          setIncomingDustAlert(false);
                        }}
                        className={`glove-btn flex-1 min-h-[38px] px-2.5 py-1 rounded-[4px] border text-xs font-mono font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                          weatherKey === 'nominal'
                            ? 'bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]'
                            : 'bg-transparent border-transparent text-[#9da5b4] hover:text-[#edf0f5] hover:bg-[#191d24]'
                        }`}
                      >
                        <Sun className="h-4 w-4" />
                        <span>Nominal Sol</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setWeatherKey('dust_storm');
                          setIncomingDustAlert(true);
                          setShowDustRadarCard(true);
                        }}
                        className={`glove-btn flex-1 min-h-[38px] px-2.5 py-1 rounded-[4px] border text-xs font-mono font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                          weatherKey === 'dust_storm'
                            ? 'bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]'
                            : 'bg-transparent border-transparent text-[#9da5b4] hover:text-[#edf0f5] hover:bg-[#191d24]'
                        }`}
                      >
                        <Wind className="h-4 w-4" />
                        <span>Dust Storm</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setWeatherKey('solar_storm');
                          setIncomingDustAlert(false);
                        }}
                        className={`glove-btn flex-1 min-h-[38px] px-2.5 py-1 rounded-[4px] border text-xs font-mono font-bold flex items-center justify-center gap-1.5 cursor-pointer ${
                          weatherKey === 'solar_storm'
                            ? 'bg-[#ef4444]/15 text-[#ef4444] border-[#ef4444]'
                            : 'bg-transparent border-transparent text-[#9da5b4] hover:text-[#edf0f5] hover:bg-[#191d24]'
                        }`}
                      >
                        <Zap className="h-4 w-4" />
                        <span>Solar Flare</span>
                      </button>
                    </div>

                    {/* 4-Button Quick Scenario Presets */}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 py-0.5">
                      <button
                        type="button"
                        onClick={() => applyPreset('hab-alpha', 'three-forks', 'light', 'nominal', 85, 90, 705)}
                        className="glove-btn whitespace-nowrap min-h-[36px] px-2 py-1 rounded-[4px] text-[11px] font-mono font-semibold bg-[#13161c]/95 hover:bg-[#222731] text-[#edf0f5] border border-[#353c4a] flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Target className="h-3.5 w-3.5 shrink-0 text-[#22c55e]" />
                        <span className="truncate">1. Direct Sample</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => applyPreset('hab-alpha', 'hawksbill-gap', 'heavy', 'nominal', 24, 34, 760)}
                        className="glove-btn whitespace-nowrap min-h-[36px] px-2 py-1 rounded-[4px] text-[11px] font-mono font-semibold bg-[#13161c]/95 hover:bg-[#222731] text-[#edf0f5] border border-[#353c4a] flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <BatteryCharging className="h-3.5 w-3.5 shrink-0 text-[#22c55e]" />
                        <span className="truncate">2. Recharge Pit-Stop</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => applyPreset('kodiak-butte', 'belva-crater', 'light', 'dust_storm', 62, 70, 955)}
                        className="glove-btn whitespace-nowrap min-h-[36px] px-2 py-1 rounded-[4px] text-[11px] font-mono font-semibold bg-[#13161c]/95 hover:bg-[#222731] text-[#edf0f5] border border-[#ef4444]/60 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <Wind className="h-3.5 w-3.5 shrink-0 text-[#ef4444]" />
                        <span className="truncate">3. Dusk & Dust Front</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => applyPreset('seitah-ridge', 'western-rim', 'rover', 'solar_storm', 90, 95, 840)}
                        className="glove-btn whitespace-nowrap min-h-[36px] px-2 py-1 rounded-[4px] text-[11px] font-mono font-semibold bg-[#13161c]/95 hover:bg-[#222731] text-[#edf0f5] border border-[#ef4444]/60 flex items-center justify-center gap-1.5 cursor-pointer"
                      >
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-[#ef4444]" />
                        <span className="truncate">4. Solar Flare Abort</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* A5. RIGHT-SIDE FLOATING ACTION BUTTONS (GLOVE-COMPATIBLE 48x48PX) */}
              <div className="absolute right-3 top-36 z-[460] flex flex-col items-center gap-2">
                <button
                  type="button"
                  onClick={handleCompassClick}
                  title="Compass: Re-align North & Zoom to EVA Position"
                  className="glove-btn flex h-12 w-12 items-center justify-center rounded-[6px] bg-[#13161c]/95 hover:bg-[#222731] border border-[#353c4a] text-[#edf0f5] cursor-pointer"
                  aria-label="Compass"
                >
                  <Compass
                    className="h-6 w-6 transition-transform duration-500"
                    style={{ transform: `rotate(${compassRotation}deg)` }}
                  />
                </button>

                <button
                  type="button"
                  onClick={() => triggerLocateAstronaut(15)}
                  title="Locate EVA: Smooth GPS Zoom & Radar Wave"
                  className={`glove-btn flex h-12 w-12 items-center justify-center rounded-[6px] border cursor-pointer ${
                    followAstronaut
                      ? 'bg-[#16a34a] text-[#0b0d11] border-[#22c55e]'
                      : 'bg-[#13161c]/95 hover:bg-[#222731] text-[#edf0f5] border-[#353c4a]'
                  }`}
                  aria-label="Locate EVA Position"
                >
                  <Crosshair className="h-6 w-6" />
                </button>

                <button
                  type="button"
                  onClick={() => openPanoramaModal(endId || startId)}
                  title="Open 360 Photosphere / Surface Photo"
                  className="glove-btn relative flex h-12 w-12 items-center justify-center rounded-[6px] bg-[#13161c]/95 hover:bg-[#222731] text-[#edf0f5] border border-[#353c4a] cursor-pointer"
                  aria-label="Open Surface Vista or 360 View"
                >
                  <Camera className="h-6 w-6" />
                  <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-[#22c55e] border border-[#0b0d11]" />
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setIncomingDustAlert((v) => !v);
                    setShowDustRadarCard(true);
                  }}
                  title="Toggle Predictive Squall Radar Card"
                  className={`glove-btn flex h-12 w-12 items-center justify-center rounded-[6px] border cursor-pointer ${
                    incomingDustAlert || weatherKey === 'dust_storm'
                      ? 'bg-[#dc2626] text-[#edf0f5] border-[#ef4444]'
                      : 'bg-[#13161c]/95 hover:bg-[#222731] text-[#edf0f5] border-[#353c4a]'
                  }`}
                  aria-label="Toggle Storm Radar"
                >
                  <Wind className="h-6 w-6" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowLayersSheet((v) => !v)}
                  title="Map Types & Layers"
                  className={`glove-btn flex h-12 w-12 items-center justify-center rounded-[6px] border cursor-pointer ${
                    showLayersSheet
                      ? 'bg-[#2c323f] text-[#edf0f5] border-[#edf0f5]'
                      : 'bg-[#13161c]/95 hover:bg-[#222731] text-[#edf0f5] border-[#353c4a]'
                  }`}
                  aria-label="Map Layers"
                >
                  <Layers className="h-6 w-6" />
                </button>

                <button
                  type="button"
                  onClick={() => setShowLegendSheet(true)}
                  title="Map Symbology Legend"
                  className="glove-btn flex h-12 w-12 items-center justify-center rounded-[6px] bg-[#13161c]/95 hover:bg-[#222731] text-[#edf0f5] border border-[#353c4a] cursor-pointer"
                  aria-label="Map Legend"
                >
                  <Info className="h-6 w-6" />
                </button>
              </div>

              {/* A6. BOTTOM-LEFT GOOGLE MAPS BASEMAP QUICK TOGGLE + LAYERS POPOVER */}
              <div className="hidden md:flex absolute bottom-3 left-3 z-[460] items-end gap-2">
                <button
                  type="button"
                  onClick={() => setBasemap((b) => (b === 'satellite' ? 'terrain' : 'satellite'))}
                  className="glove-btn min-h-[56px] min-w-[116px] bg-[#13161c]/95 hover:bg-[#191d24] border border-[#353c4a] rounded-[6px] p-2 flex items-center gap-2 cursor-pointer text-left"
                  title="Quick Switch Satellite <-> Terrain"
                >
                  <div className="h-9 w-9 rounded-[4px] border border-[#4f5767] bg-[#191d24] flex items-center justify-center shrink-0">
                    <MapIcon className="h-4 w-4 text-[#edf0f5]" />
                  </div>
                  <div className="font-mono leading-tight">
                    <div className="text-[9px] text-[#656d7d] uppercase">BASEMAP</div>
                    <div className="text-[11px] font-bold text-[#edf0f5] uppercase">
                      {BASEMAP_OPTIONS.find((m) => m.id === basemap)?.short || 'SAT'}
                    </div>
                  </div>
                </button>
              </div>

              {showLayersSheet && (
                <div className="absolute bottom-[76px] left-3 z-[520] w-[290px] sm:w-[320px] rounded-[6px] bg-[#13161c]/95 border border-[#353c4a] p-3 space-y-3">
                  <div className="flex items-center justify-between border-b border-[#242933] pb-2">
                    <span className="font-mono text-xs font-bold uppercase text-[#edf0f5] flex items-center gap-1.5">
                      <Layers className="h-4 w-4 text-[#22c55e]" /> Map Types & Layers
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowLayersSheet(false)}
                      className="text-[#9da5b4] hover:text-[#edf0f5] p-1 cursor-pointer"
                      aria-label="Close Layers"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-3 gap-1.5">
                    {BASEMAP_OPTIONS.map((opt) => (
                      <button
                        type="button"
                        key={`astro-bm-${opt.id}`}
                        onClick={() => setBasemap(opt.id)}
                        className={`glove-btn min-h-[42px] px-2 rounded-[4px] border font-mono text-[10px] font-bold cursor-pointer ${
                          basemap === opt.id
                            ? 'bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]'
                            : 'bg-[#191d24] hover:bg-[#222731] text-[#9da5b4] border-[#242933]'
                        }`}
                      >
                        {opt.short}
                      </button>
                    ))}
                  </div>

                  <div>
                    <div className="flex justify-between font-mono text-[10px] text-[#9da5b4] mb-1">
                      <span>RELIEF HILLSHADE BLEND</span>
                      <span className="text-[#edf0f5] font-bold">{Math.round(reliefBlend * 100)}%</span>
                    </div>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(reliefBlend * 100)}
                      onChange={(e) => setReliefBlend(Number(e.target.value) / 100)}
                      className="glove-slider"
                    />
                  </div>

                  <div className="space-y-1 border-t border-[#242933] pt-2">
                    {[
                      { key: 'slope', label: 'Slope Safety Heatmap', icon: TrendingUp },
                      { key: 'hazards', label: 'Terrain & Science Hazards', icon: AlertTriangle },
                      { key: 'science', label: 'Charging, ISRU & Science POIs', icon: Zap },
                      { key: 'traverse', label: 'Perseverance Traverse Track', icon: Navigation },
                      { key: 'landmarks', label: '11 Regional Landmarks', icon: Target },
                      { key: 'hirise', label: 'NASA HiRISE 25cm Mosaic', icon: Globe },
                    ].map((ov) => {
                      const Icon = ov.icon;
                      return (
                        <label
                          key={`astro-ov-${ov.key}`}
                          className="flex items-center justify-between min-h-[38px] px-2 rounded-[4px] bg-[#191d24] border border-[#242933] hover:border-[#353c4a] cursor-pointer text-xs text-[#edf0f5]"
                        >
                          <span className="flex items-center gap-2 font-mono text-[10.5px]">
                            <Icon className="h-3.5 w-3.5 text-[#9da5b4]" />
                            <span>{ov.label}</span>
                          </span>
                          <input
                            type="checkbox"
                            checked={Boolean(layers[ov.key])}
                            onChange={(e) =>
                              setLayers((prev) => ({ ...prev, [ov.key]: e.target.checked }))
                            }
                            className="accent-[#22c55e] h-4 w-4 cursor-pointer"
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* A7. EXPANDABLE ROUTE SETUP MODAL */}
              {showRouteOptions && (
                <div className="absolute top-20 left-1/2 -translate-x-1/2 z-[750] w-[94%] max-w-lg rounded-[6px] bg-[#13161c] border border-[#353c4a] p-4 space-y-3.5">
                  <div className="flex items-center justify-between pb-2 border-b border-[#242933]">
                    <div className="text-xs font-mono font-bold uppercase text-[#edf0f5] flex items-center gap-2">
                      <Sliders className="h-4 w-4 text-[#22c55e]" />
                      <span>Route & EVA Suit Settings</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowRouteOptions(false)}
                      className="p-1.5 rounded-[4px] hover:bg-[#222731] text-[#9da5b4] hover:text-[#edf0f5] cursor-pointer"
                      aria-label="Close Route Settings"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    <div>
                      <label className="block text-[10px] font-mono text-[#9da5b4] uppercase mb-1">
                        Starting Location
                      </label>
                      <select
                        value={startId === 'custom-origin' ? '' : startId}
                        onChange={(e) => e.target.value && handleSetOrigin(e.target.value)}
                        className="w-full min-h-[44px] rounded-[4px] bg-[#0b0d11] border border-[#353c4a] px-3 py-2 font-mono text-xs text-[#edf0f5]"
                      >
                        {allSiteOptions.map((s) => (
                          <option key={`modal-orig-${s.id}`} value={s.id}>
                            {s.isChargingStation ? '[CHG] ' : ''}{s.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-[10px] font-mono text-[#9da5b4] uppercase mb-1">
                        Destination Target
                      </label>
                      <select
                        value={endId === 'custom-dest' ? '' : endId}
                        onChange={(e) => e.target.value && handleNavigateToPOI(e.target.value)}
                        className="w-full min-h-[44px] rounded-[4px] bg-[#0b0d11] border border-[#353c4a] px-3 py-2 font-mono text-xs text-[#edf0f5]"
                      >
                        {allSiteOptions.map((s) => (
                          <option key={`modal-dest-${s.id}`} value={s.id}>
                            {s.isChargingStation ? '[CHG] ' : ''}{s.name}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-[10px] font-mono text-[#9da5b4] uppercase mb-1.5">
                      Astronaut Mobility Mode
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {Object.values(LOADOUT_PROFILES).map((prof) => (
                        <button
                          type="button"
                          key={`modal-prof-${prof.id}`}
                          onClick={() => setLoadoutKey(prof.id)}
                          className={`glove-btn min-h-[46px] px-2 py-1.5 rounded-[4px] border text-xs font-mono font-semibold flex items-center justify-center gap-1.5 cursor-pointer ${
                            loadoutKey === prof.id
                              ? 'bg-[#22c55e] text-[#0b0d11] border-[#22c55e] font-bold'
                              : 'bg-[#191d24] hover:bg-[#222731] border-[#353c4a] text-[#edf0f5]'
                          }`}
                        >
                          {prof.id === 'light' ? (
                            <User className="h-4 w-4" />
                          ) : prof.id === 'heavy' ? (
                            <PackageCheck className="h-4 w-4" />
                          ) : (
                            <Truck className="h-4 w-4" />
                          )}
                          <span>
                            {prof.id === 'light' ? 'Solo Suit' : prof.id === 'heavy' ? 'Heavy Kit' : 'Rover Mule'}
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-[4px] bg-[#191d24] border border-[#242933] p-3 space-y-2.5">
                    <div className="flex justify-between text-xs font-mono text-[#9da5b4]">
                      <span className="flex items-center gap-1.5">
                        <BatteryCharging className="h-4 w-4 text-[#22c55e]" /> Starting Battery
                      </span>
                      <span className="font-bold text-[#edf0f5]">{startBatteryPct}%</span>
                    </div>
                    <input
                      type="range"
                      min={15}
                      max={100}
                      value={startBatteryPct}
                      onChange={(e) => setStartBatteryPct(Number(e.target.value))}
                      className="glove-slider w-full"
                    />

                    <div className="flex justify-between text-xs font-mono text-[#9da5b4] pt-1">
                      <span className="flex items-center gap-1.5">
                        <Droplets className="h-4 w-4 text-[#22c55e]" /> Starting PLSS Tank
                      </span>
                      <span className="font-bold text-[#edf0f5]">{startO2Pct}%</span>
                    </div>
                    <input
                      type="range"
                      min={15}
                      max={100}
                      value={startO2Pct}
                      onChange={(e) => setStartO2Pct(Number(e.target.value))}
                      className="glove-slider w-full"
                    />

                    <div className="flex justify-between text-xs font-mono text-[#9da5b4] pt-1">
                      <span className="flex items-center gap-1.5">
                        <Clock className="h-4 w-4 text-[#edf0f5]" /> Martian Departure Time
                      </span>
                      <span className="font-bold text-[#edf0f5]">{formatLst(startLstMinutes)}</span>
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
                    type="button"
                    onClick={() => setShowRouteOptions(false)}
                    className="glove-btn w-full min-h-[48px] rounded-[4px] bg-[#16a34a] hover:bg-[#22c55e] text-[#0b0d11] font-mono font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 border border-[#22c55e] cursor-pointer"
                  >
                    <Check className="h-4 w-4" />
                    <span>Apply Route Settings</span>
                  </button>
                </div>
              )}

              {/* A8. BOTTOM-CENTER GOOGLE MAPS NAVIGATION & TRIP SHEET */}
              <div className="absolute bottom-3 left-3 right-3 z-[450] flex flex-col items-center pointer-events-none">
                <div className="pointer-events-auto w-full max-w-xl rounded-[6px] bg-[#13161c]/95 border border-[#353c4a] overflow-hidden">
                  {navMode === 'navigating' ? (
                    /* STATE 1: ACTIVE EVA WALK CONTROLS */
                    <div className="p-3.5 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <div className="text-2xl font-bold text-[#edf0f5] font-mono flex items-baseline gap-1.5">
                            <span>{liveNavState?.estTimeRemainingMin}</span>
                            <span className="text-xs font-sans text-[#9da5b4]">min</span>
                          </div>
                          <div className="text-xs text-[#9da5b4] font-mono flex items-center gap-2">
                            <span>{liveNavState?.distRemainingKm} km remaining</span>
                            <span>|</span>
                            <span className="text-[#22c55e] font-bold">Sol {selectedMissionSol}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5">
                          <div className="rounded-[4px] bg-[#191d24] p-2 border border-[#242933] text-right min-w-[92px]">
                            <div className="flex items-center justify-end gap-1 text-[9.5px] text-[#9da5b4] font-mono">
                              <Battery className={`h-3.5 w-3.5 ${curBat < 25 ? 'text-[#ef4444]' : 'text-[#22c55e]'}`} />
                              <span>BATTERY</span>
                            </div>
                            <div className={`text-sm font-bold font-mono ${curBat < 25 ? 'text-[#ef4444]' : 'text-[#edf0f5]'}`}>
                              {liveNavState?.currentBattery}%
                            </div>
                            <div className="w-full h-1.5 bg-[#0b0d11] rounded-[2px] overflow-hidden mt-1">
                              <div
                                className={`h-full ${curBat < 25 ? 'bg-[#ef4444]' : 'bg-[#22c55e]'}`}
                                style={{ width: `${liveNavState?.currentBattery || 0}%` }}
                              />
                            </div>
                          </div>

                          <div className="rounded-[4px] bg-[#191d24] p-2 border border-[#242933] text-right min-w-[92px]">
                            <div className="flex items-center justify-end gap-1 text-[9.5px] text-[#9da5b4] font-mono">
                              <Droplets className="h-3.5 w-3.5 text-[#22c55e]" />
                              <span>PLSS TANK</span>
                            </div>
                            <div className="text-sm font-bold font-mono text-[#edf0f5]">
                              {liveNavState?.currentO2}%
                            </div>
                            <div className="w-full h-1.5 bg-[#0b0d11] rounded-[2px] overflow-hidden mt-1">
                              <div
                                className="h-full bg-[#22c55e]"
                                style={{ width: `${liveNavState?.currentO2 || 0}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-4 gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => setNavPlaying((p) => !p)}
                          className={`glove-btn col-span-2 min-h-[52px] rounded-[4px] font-mono font-bold text-xs uppercase flex items-center justify-center gap-2 border cursor-pointer ${
                            navPlaying
                              ? 'bg-[#2c323f] hover:bg-[#353c4a] text-[#edf0f5] border-[#4f5767]'
                              : 'bg-[#16a34a] hover:bg-[#22c55e] text-[#0b0d11] border-[#22c55e]'
                          }`}
                        >
                          {navPlaying ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                          <span>{navPlaying ? 'Pause Walk' : 'Resume Walk'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setNavSpeed((s) => (s === 1 ? 3 : 1))}
                          className="glove-btn min-h-[52px] rounded-[4px] bg-[#191d24] hover:bg-[#222731] text-[#edf0f5] font-mono font-bold text-xs border border-[#353c4a] flex flex-col items-center justify-center cursor-pointer"
                        >
                          <Gauge className="h-4 w-4 mb-0.5 text-[#22c55e]" />
                          <span>{navSpeed}x Speed</span>
                        </button>

                        <button
                          type="button"
                          onClick={stopNavigation}
                          className="glove-btn min-h-[52px] rounded-[4px] bg-[#191d24] hover:bg-[#dc2626]/20 border border-[#ef4444]/60 text-[#ef4444] font-mono font-bold text-xs flex flex-col items-center justify-center cursor-pointer"
                        >
                          <LogOut className="h-4 w-4 mb-0.5" />
                          <span>Exit</span>
                        </button>
                      </div>

                      {(incomingDustAlert || weatherKey === 'dust_storm' || curBat < 25) && (
                        <button
                          type="button"
                          onClick={triggerShelterDivert}
                          className="glove-btn w-full min-h-[46px] rounded-[4px] bg-[#dc2626] hover:bg-[#ef4444] text-[#edf0f5] font-mono font-bold text-xs uppercase flex items-center justify-center gap-2 cursor-pointer"
                        >
                          <ShieldAlert className="h-4 w-4" />
                          <span>
                            Divert to {nearestShelter.station.name} ({nearestShelter.distKm} km)
                          </span>
                        </button>
                      )}
                    </div>
                  ) : navMode === 'arrived' || (startId === endId && startId !== 'custom-origin') ? (
                    /* STATE 2: ARRIVED AT WAYPOINT — 1-TAP NEXT LEG SELECTOR */
                    <div className="p-3.5 space-y-3">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] bg-[#191d24] text-[#22c55e] border border-[#22c55e]/60">
                            <CheckCircle2 className="h-5 w-5" />
                          </span>
                          <div className="min-w-0">
                            <div className="text-[10px] font-mono uppercase text-[#22c55e] font-bold tracking-wider">
                              Traverse Leg Complete
                            </div>
                            <div className="text-sm font-bold text-[#edf0f5] flex items-center gap-1.5 flex-wrap">
                              <span className="truncate">{startPOI.name}</span>
                              {startPOI.isChargingStation && (
                                <span className="rounded-[4px] bg-[#191d24] text-[#22c55e] border border-[#22c55e]/50 px-1.5 py-0.5 text-[9.5px] font-mono font-bold inline-flex items-center gap-1">
                                  <Zap className="h-3 w-3" /> 100%
                                </span>
                              )}
                              <button
                                type="button"
                                onClick={() => openPanoramaModal(startPOI.id)}
                                className="glove-btn px-2 py-0.5 rounded-[4px] bg-[#191d24] hover:bg-[#222731] border border-[#353c4a] text-[#edf0f5] font-mono text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Camera className="h-3 w-3 text-[#22c55e]" />
                                <span>
                                  {startPOI.id === 'hab-alpha' || startPOI.id === 'seitah-ridge'
                                    ? '360'
                                    : 'Photo'}
                                </span>
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="text-right font-mono shrink-0">
                          <div className="text-[9.5px] text-[#656d7d]">ELEV</div>
                          <div className="text-xs font-bold text-[#edf0f5]">{startPOI.elev} m</div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 bg-[#191d24] p-2.5 rounded-[4px] border border-[#242933] font-mono text-xs">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-[#9da5b4]">
                            <Battery className="h-3.5 w-3.5 text-[#22c55e]" /> Battery
                          </span>
                          <span className="font-bold text-[#edf0f5]">{startBatteryPct}%</span>
                        </div>
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-[#9da5b4]">
                            <Droplets className="h-3.5 w-3.5 text-[#22c55e]" /> PLSS O2
                          </span>
                          <span className="font-bold text-[#edf0f5]">{startO2Pct}%</span>
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <div className="text-[10px] font-mono text-[#9da5b4] uppercase flex items-center justify-between">
                          <span>Select Next Waypoint:</span>
                          <span className="text-[#22c55e]">From {startPOI.name.split(' ')[0]}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto aerospace-scroll pr-0.5">
                          {allSiteOptions
                            .filter(
                              (p) =>
                                normalizeKey(p.id) !== normalizeKey(astronautLocId) &&
                                !(astronautLocId === 'hab-alpha' && p.id === 'landing_site')
                            )
                            .map((dest) => {
                              const dist = Number(
                                (
                                  marsDistanceMeters(startPOI.lat, startPOI.lon, dest.lat, dest.lon) /
                                  1000
                                ).toFixed(1)
                              );
                              return (
                                <button
                                  type="button"
                                  key={`next-${dest.id}`}
                                  onClick={() => handleNavigateToPOI(dest.id)}
                                  className="glove-btn min-h-[50px] p-2 rounded-[4px] bg-[#191d24] hover:bg-[#222731] border border-[#353c4a] hover:border-[#22c55e] text-left cursor-pointer flex flex-col justify-between"
                                >
                                  <div className="flex items-center justify-between gap-1.5 w-full">
                                    <span className="flex items-center gap-1.5 text-xs font-bold text-[#edf0f5] truncate">
                                      {dest.isChargingStation ? (
                                        <Zap className="h-3.5 w-3.5 text-[#22c55e] shrink-0" />
                                      ) : (
                                        <MapPin className="h-3.5 w-3.5 text-[#9da5b4] shrink-0" />
                                      )}
                                      <span className="truncate">{dest.name.replace(' [Landmark]', '')}</span>
                                    </span>
                                    <span className="text-[10px] font-mono text-[#22c55e] font-bold shrink-0">
                                      {dist} km
                                    </span>
                                  </div>
                                </button>
                              );
                            })}
                        </div>
                      </div>
                    </div>
                  ) : (
                    /* STATE 3: EXPLORE & ROUTE PLANNING TRIP SHEET */
                    <div className="p-3.5 space-y-3">
                      <div className="flex items-center justify-between gap-2 bg-[#191d24] p-2.5 rounded-[4px] border border-[#242933]">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-1.5 text-[9.5px] font-mono text-[#9da5b4] uppercase">
                            <span className="h-2 w-2 rounded-full bg-[#edf0f5]" />
                            <span>Origin {startId === astronautLocId ? '(Field)' : ''}</span>
                          </div>
                          <div className="text-xs font-bold text-[#edf0f5] truncate">{startPOI.name}</div>
                        </div>

                        <button
                          type="button"
                          onClick={handleSwapEndpoints}
                          title="Swap Origin and Destination"
                          className="glove-btn h-10 w-10 rounded-[4px] bg-[#222731] hover:bg-[#2c323f] border border-[#353c4a] text-[#edf0f5] flex items-center justify-center shrink-0 cursor-pointer"
                          aria-label="Swap Origin and Destination"
                        >
                          <ArrowLeftRight className="h-4 w-4" />
                        </button>

                        <div className="flex-1 min-w-0 text-right">
                          <div className="flex items-center justify-end gap-1.5 text-[9.5px] font-mono text-[#9da5b4] uppercase">
                            <span>Destination</span>
                            <span className="h-2 w-2 rounded-full bg-[#22c55e]" />
                          </div>
                          <div className="text-xs font-bold text-[#edf0f5] truncate">{endPOI.name}</div>
                        </div>
                      </div>

                      <div className="flex items-start justify-between gap-2 flex-wrap">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-bold text-[#edf0f5] truncate">
                              {endPOI.name}
                            </span>
                            {endPOI.isChargingStation && (
                              <span className="rounded-[4px] bg-[#191d24] text-[#22c55e] border border-[#22c55e]/50 px-1.5 py-0.5 text-[10px] font-mono font-bold inline-flex items-center gap-1">
                                <Zap className="h-3 w-3" /> Base
                              </span>
                            )}
                            <button
                              type="button"
                              onClick={() => openPanoramaModal(endPOI.id)}
                              className="glove-btn px-2.5 py-1 rounded-[4px] bg-[#191d24] hover:bg-[#222731] border border-[#353c4a] text-[#edf0f5] font-mono text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer"
                            >
                              <Camera className="h-3.5 w-3.5 text-[#22c55e]" />
                              <span>
                                {endPOI.id === 'hab-alpha' || endPOI.id === 'seitah-ridge'
                                  ? '360 Sphere'
                                  : 'Photo'}
                              </span>
                            </button>
                          </div>
                          <div className="text-xs font-mono text-[#9da5b4] mt-0.5 flex items-center gap-2">
                            <span className="text-[#edf0f5] font-bold">{routeResult.distKm} km</span>
                            <span>|</span>
                            <span>{routeResult.durationMin} min walk</span>
                            <span>|</span>
                            <span>Elev {endPOI.elev} m</span>
                          </div>
                        </div>

                        <div className="shrink-0 text-right font-mono">
                          {routeResult.rangeStatus === 'direct_clear' && (
                            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#22c55e]/15 border border-[#22c55e]/50 px-2.5 py-1 text-[10.5px] font-bold text-[#22c55e]">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Can Reach Direct
                            </span>
                          )}
                          {routeResult.rangeStatus === 'recharged_ok' && (
                            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#22c55e]/15 border border-[#22c55e]/50 px-2.5 py-1 text-[10.5px] font-bold text-[#22c55e]">
                              <Zap className="h-3.5 w-3.5" /> +15m Pit-Stop
                            </span>
                          )}
                          {routeResult.rangeStatus === 'out_of_range' && (
                            <span className="inline-flex items-center gap-1 rounded-[4px] bg-[#ef4444]/15 border border-[#ef4444]/60 px-2.5 py-1 text-[10.5px] font-bold text-[#ef4444]">
                              <AlertTriangle className="h-3.5 w-3.5" /> Low Reserve
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Prominent Battery & PLSS O2 Tank Simulation Cards */}
                      <div className="grid grid-cols-2 gap-2 bg-[#191d24] p-2.5 rounded-[4px] border border-[#242933]">
                        <div>
                          <div className="flex items-center justify-between text-[11px] font-mono text-[#9da5b4] mb-1">
                            <span className="flex items-center gap-1 font-bold text-[#edf0f5]">
                              <BatteryCharging className="h-3.5 w-3.5 text-[#22c55e]" /> Battery
                            </span>
                            <span className="font-bold text-[#edf0f5]">
                              {startBatteryPct}% <span className="text-[10px] text-[#656d7d]">-&gt; {routeResult.finalArrivalBattery}%</span>
                            </span>
                          </div>
                          <div className="w-full h-2 bg-[#0b0d11] rounded-[2px] overflow-hidden">
                            <div
                              className={`h-full ${startBatteryPct < 30 ? 'bg-[#ef4444]' : 'bg-[#22c55e]'}`}
                              style={{ width: `${startBatteryPct}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between mt-1.5 text-[10px] font-mono">
                            <button
                              type="button"
                              onClick={() => setStartBatteryPct((b) => Math.max(15, b - 15))}
                              className="glove-btn min-h-[30px] px-2 rounded-[4px] bg-[#222731] hover:bg-[#2c323f] border border-[#353c4a] text-[#edf0f5] flex items-center gap-0.5 cursor-pointer"
                            >
                              <Minus className="h-3 w-3" /> 15%
                            </button>
                            <span className="text-[#656d7d]">SIM</span>
                            <button
                              type="button"
                              onClick={() => setStartBatteryPct((b) => Math.min(100, b + 15))}
                              className="glove-btn min-h-[30px] px-2 rounded-[4px] bg-[#222731] hover:bg-[#2c323f] border border-[#353c4a] text-[#edf0f5] flex items-center gap-0.5 cursor-pointer"
                            >
                              <Plus className="h-3 w-3" /> 15%
                            </button>
                          </div>
                        </div>

                        <div>
                          <div className="flex items-center justify-between text-[11px] font-mono text-[#9da5b4] mb-1">
                            <span className="flex items-center gap-1 font-bold text-[#edf0f5]">
                              <Droplets className="h-3.5 w-3.5 text-[#22c55e]" /> PLSS O2
                            </span>
                            <span className="font-bold text-[#edf0f5]">
                              {startO2Pct}% <span className="text-[10px] text-[#656d7d]">-&gt; {routeResult.finalArrivalO2}%</span>
                            </span>
                          </div>
                          <div className="w-full h-2 bg-[#0b0d11] rounded-[2px] overflow-hidden">
                            <div
                              className={`h-full ${startO2Pct < 30 ? 'bg-[#ef4444]' : 'bg-[#22c55e]'}`}
                              style={{ width: `${startO2Pct}%` }}
                            />
                          </div>
                          <div className="flex items-center justify-between mt-1.5 text-[10px] font-mono">
                            <button
                              type="button"
                              onClick={() => setStartO2Pct((o) => Math.max(15, o - 15))}
                              className="glove-btn min-h-[30px] px-2 rounded-[4px] bg-[#222731] hover:bg-[#2c323f] border border-[#353c4a] text-[#edf0f5] flex items-center gap-0.5 cursor-pointer"
                            >
                              <Minus className="h-3 w-3" /> 15%
                            </button>
                            <span className="text-[#656d7d]">SIM</span>
                            <button
                              type="button"
                              onClick={() => setStartO2Pct((o) => Math.min(100, o + 15))}
                              className="glove-btn min-h-[30px] px-2 rounded-[4px] bg-[#222731] hover:bg-[#2c323f] border border-[#353c4a] text-[#edf0f5] flex items-center gap-0.5 cursor-pointer"
                            >
                              <Plus className="h-3 w-3" /> 15%
                            </button>
                          </div>
                        </div>
                      </div>

                      {/* Primary 56px Glove START NAVIGATION Button */}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={startNavigation}
                          className="glove-btn flex-1 min-h-[56px] rounded-[4px] bg-[#16a34a] hover:bg-[#22c55e] text-[#0b0d11] font-mono font-bold text-sm uppercase tracking-wider flex items-center justify-center gap-2.5 border border-[#22c55e] cursor-pointer"
                        >
                          <Navigation className="h-5 w-5" />
                          <span>Start Navigation</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => setBottomSheetExpanded((v) => !v)}
                          title="Expand Route Details"
                          className="glove-btn flex h-[56px] w-[56px] items-center justify-center rounded-[4px] bg-[#191d24] hover:bg-[#222731] text-[#edf0f5] border border-[#353c4a] cursor-pointer shrink-0"
                          aria-label="Toggle Route Details"
                        >
                          {bottomSheetExpanded ? (
                            <ChevronDown className="h-5 w-5" />
                          ) : (
                            <ChevronUp className="h-5 w-5" />
                          )}
                        </button>
                      </div>

                      {bottomSheetExpanded && (
                        <div className="pt-2 border-t border-[#242933] space-y-2 text-xs max-h-44 overflow-y-auto aerospace-scroll">
                          <div className="grid grid-cols-3 gap-2 text-center font-mono text-[10.5px]">
                            <div className="p-2 rounded-[4px] bg-[#191d24] border border-[#242933]">
                              <div className="text-[9px] text-[#656d7d]">ARRIVAL BAT</div>
                              <div className="font-bold text-[#22c55e]">
                                {routeResult.finalArrivalBattery}%
                              </div>
                            </div>
                            <div className="p-2 rounded-[4px] bg-[#191d24] border border-[#242933]">
                              <div className="text-[9px] text-[#656d7d]">PEAK GRADE</div>
                              <div className="font-bold text-[#edf0f5]">
                                {routeResult.maxSlopeAlongPath} deg
                              </div>
                            </div>
                            <div className="p-2 rounded-[4px] bg-[#191d24] border border-[#242933]">
                              <div className="text-[9px] text-[#656d7d]">HAZARDS BYPASSED</div>
                              <div className="font-bold text-[#22c55e]">
                                {routeResult.hazardsAvoided} zones
                              </div>
                            </div>
                          </div>

                          <div className="space-y-1">
                            <div className="text-[10px] font-mono uppercase text-[#656d7d]">
                              Turn-by-Turn Preview
                            </div>
                            {routeResult.navigationSteps?.slice(0, 4).map((step, idx) => (
                              <div
                                key={step.id || idx}
                                className="p-2 rounded-[4px] bg-[#191d24] border border-[#242933] text-[11px] font-mono text-[#edf0f5]"
                              >
                                <span className="font-bold">
                                  {idx + 1}. {step.instruction}
                                </span>
                                {step.detail && (
                                  <div className="text-[10px] text-[#9da5b4] font-sans mt-0.5">
                                    {step.detail}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}

          {/* SLIDE-IN SCIENTIFIC LANDMARK DOSSIER DRAWER */}
          {activeLandmark && (
            <LandmarkDrawer
              landmark={activeLandmark}
              isCurrentLocation={
                activeLandmark.id === astronautLocId ||
                (astronautLocId === 'hab-alpha' && activeLandmark.id === 'landing_site')
              }
              onClose={() => setActiveLandmark(null)}
              onNavigateToLandmark={(lm) => handleNavigateToPOI(lm.id)}
              onSetOriginLandmark={(lm) => handleSetOrigin(lm.id)}
              onSetTargetLandmark={(lm) => handleNavigateToPOI(lm.id)}
              onOpenPanorama={(lm) => openPanoramaModal(lm.id)}
            />
          )}
        </main>

        {/* RIGHT: COLLAPSIBLE DEVELOPER INSTRUMENT CONSOLE */}
        {uiMode === 'developer' && sidebarOpen && (
          <aside className="w-full lg:w-[390px] xl:w-[410px] shrink-0 bg-[#13161c] border-t lg:border-t-0 lg:border-l border-[#242933] flex flex-col max-h-[48vh] lg:max-h-full overflow-y-auto aerospace-scroll z-20">
            {/* PANEL 1: NAVIGATION VECTORS & SIMULATION */}
            <section className="p-3 border-b border-[#242933] space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-[10px] font-bold tracking-wider uppercase text-[#656d7d]">
                  NAVIGATION VECTORS & EVA DRIVE
                </h3>
                <button
                  type="button"
                  onClick={handleSwapEndpoints}
                  className="px-2 py-1 rounded-[4px] bg-[#191d24] hover:bg-[#222731] border border-[#353c4a] font-mono text-[10px] font-bold text-[#9da5b4] hover:text-[#edf0f5] flex items-center gap-1 cursor-pointer"
                >
                  <ArrowLeftRight className="h-3 w-3" />
                  <span>SWAP</span>
                </button>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-1 gap-2">
                <div>
                  <label className="block font-mono text-[9.5px] text-[#9da5b4] uppercase mb-1">
                    ORIGIN BASE
                  </label>
                  <select
                    value={startId === 'custom-origin' ? '' : startId}
                    onChange={(e) => e.target.value && handleSetOrigin(e.target.value)}
                    className="w-full min-h-[38px] bg-[#0b0d11] border border-[#353c4a] rounded-[4px] px-2 font-mono text-xs text-[#edf0f5] outline-none focus:border-[#edf0f5]"
                  >
                    {startId === 'custom-origin' && <option value="">CUSTOM VECTOR</option>}
                    {allSiteOptions.map((s) => (
                      <option key={`orig-${s.id}`} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block font-mono text-[9.5px] text-[#9da5b4] uppercase mb-1">
                    TARGET WAYPOINT
                  </label>
                  <select
                    value={endId === 'custom-dest' ? '' : endId}
                    onChange={(e) => e.target.value && handleNavigateToPOI(e.target.value)}
                    className="w-full min-h-[38px] bg-[#0b0d11] border border-[#353c4a] rounded-[4px] px-2 font-mono text-xs text-[#edf0f5] outline-none focus:border-[#edf0f5]"
                  >
                    {endId === 'custom-dest' && <option value="">CUSTOM VECTOR</option>}
                    {allSiteOptions.map((s) => (
                      <option key={`dest-${s.id}`} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Raw Coordinate Input Vector Solver (Ground Control Feature) */}
              <div className="bg-[#191d24] border border-[#242933] rounded-[4px] p-2 space-y-1.5">
                <div className="font-mono text-[9.5px] text-[#656d7d] uppercase">
                  COORDINATE VECTOR INPUTS (LAT / LON DEG)
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <input
                    type="text"
                    value={originLatInput}
                    onChange={(e) => setOriginLatInput(e.target.value)}
                    className="min-h-[34px] bg-[#0b0d11] border border-[#353c4a] rounded-[4px] px-2 font-mono text-[11px] text-[#edf0f5]"
                    aria-label="Origin Latitude"
                  />
                  <input
                    type="text"
                    value={originLonInput}
                    onChange={(e) => setOriginLonInput(e.target.value)}
                    className="min-h-[34px] bg-[#0b0d11] border border-[#353c4a] rounded-[4px] px-2 font-mono text-[11px] text-[#edf0f5]"
                    aria-label="Origin Longitude"
                  />
                  <input
                    type="text"
                    value={destLatInput}
                    onChange={(e) => setDestLatInput(e.target.value)}
                    className="min-h-[34px] bg-[#0b0d11] border border-[#353c4a] rounded-[4px] px-2 font-mono text-[11px] text-[#edf0f5]"
                    aria-label="Target Latitude"
                  />
                  <input
                    type="text"
                    value={destLonInput}
                    onChange={(e) => setDestLonInput(e.target.value)}
                    className="min-h-[34px] bg-[#0b0d11] border border-[#353c4a] rounded-[4px] px-2 font-mono text-[11px] text-[#edf0f5]"
                    aria-label="Target Longitude"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleApplyCoordinateVectors}
                  className="w-full min-h-[36px] rounded-[4px] bg-[#222731] hover:bg-[#2c323f] border border-[#4f5767] font-mono text-[10.5px] font-bold text-[#edf0f5] uppercase cursor-pointer"
                >
                  CALC VECTOR TRAVERSE
                </button>
              </div>

              {/* Mobility Profile Selector */}
              <div>
                <div className="font-mono text-[9.5px] text-[#656d7d] uppercase mb-1">
                  MOBILITY PROFILE
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {Object.values(LOADOUT_PROFILES).map((prof) => {
                    const active = loadoutKey === prof.id;
                    return (
                      <button
                        type="button"
                        key={prof.id}
                        onClick={() => setLoadoutKey(prof.id)}
                        className={`min-h-[42px] px-1.5 py-1 rounded-[4px] border font-mono text-[10px] leading-tight cursor-pointer ${
                          active
                            ? 'bg-[#2c323f] text-[#edf0f5] border-[#edf0f5]'
                            : 'bg-[#191d24] hover:bg-[#222731] text-[#9da5b4] border-[#242933]'
                        }`}
                      >
                        <div className="font-bold truncate">{prof.id.toUpperCase()}</div>
                        <div className="text-[9px] text-[#9da5b4]">{prof.speedKmh} KM/H</div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Scenario Presets */}
              <div>
                <div className="font-mono text-[9.5px] text-[#656d7d] uppercase mb-1">
                  MISSION SCENARIO PRESETS
                </div>
                <div className="grid grid-cols-2 gap-1">
                  <button
                    type="button"
                    onClick={() => applyPreset('hab-alpha', 'three-forks', 'light', 'nominal', 85, 90, 705)}
                    className="min-h-[36px] px-2 rounded-[4px] bg-[#191d24] hover:bg-[#222731] border border-[#353c4a] font-mono text-[10px] font-bold text-[#edf0f5] cursor-pointer"
                  >
                    NOMINAL EVA
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('hab-alpha', 'hawksbill-gap', 'heavy', 'nominal', 24, 34, 760)}
                    className="min-h-[36px] px-2 rounded-[4px] bg-[#191d24] hover:bg-[#222731] border border-[#353c4a] font-mono text-[10px] font-bold text-[#edf0f5] cursor-pointer"
                  >
                    LOW BAT + PIT STOP
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('kodiak-butte', 'belva-crater', 'light', 'dust_storm', 62, 70, 955)}
                    className="min-h-[36px] px-2 rounded-[4px] bg-[#191d24] hover:bg-[#222731] border border-[#ef4444]/60 font-mono text-[10px] font-bold text-[#ef4444] cursor-pointer"
                  >
                    DUST SQUALL ALERT
                  </button>
                  <button
                    type="button"
                    onClick={() => applyPreset('seitah-ridge', 'western-rim', 'rover', 'solar_storm', 90, 95, 840)}
                    className="min-h-[36px] px-2 rounded-[4px] bg-[#191d24] hover:bg-[#222731] border border-[#ef4444]/60 font-mono text-[10px] font-bold text-[#ef4444] cursor-pointer"
                  >
                    SOLAR SPE STORM
                  </button>
                </div>
              </div>

              {/* Primary EVA Simulation Drive Controls (Glove-Sized >= 44px) */}
              <div className="flex items-center gap-1.5 pt-1">
                {!navPlaying ? (
                  <button
                    type="button"
                    onClick={startNavigation}
                    className="glove-btn flex-1 min-h-[44px] px-3 rounded-[4px] bg-[#16a34a] hover:bg-[#22c55e] text-[#0b0d11] font-mono text-xs font-bold uppercase flex items-center justify-center gap-2 border border-[#22c55e] cursor-pointer"
                  >
                    <Play className="h-4 w-4" />
                    <span>{liveNavState?.idx > 0 && !liveNavState?.arrived ? 'RESUME EVA' : 'START EVA WALK'}</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setNavPlaying(false)}
                    className="glove-btn flex-1 min-h-[44px] px-3 rounded-[4px] bg-[#2c323f] hover:bg-[#353c4a] text-[#edf0f5] font-mono text-xs font-bold uppercase flex items-center justify-center gap-2 border border-[#4f5767] cursor-pointer"
                  >
                    <Pause className="h-4 w-4" />
                    <span>PAUSE EVA</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setNavSpeed((s) => (s === 1 ? 3 : 1))}
                  className="glove-btn min-h-[44px] px-3 rounded-[4px] bg-[#191d24] hover:bg-[#222731] text-[#edf0f5] font-mono text-xs font-bold border border-[#353c4a] cursor-pointer"
                  title="Toggle Simulation Rate (1x / 3x)"
                >
                  {navSpeed}X
                </button>

                <button
                  type="button"
                  onClick={stopNavigation}
                  className="glove-btn min-h-[44px] px-3 rounded-[4px] bg-[#191d24] hover:bg-[#222731] text-[#9da5b4] hover:text-[#edf0f5] font-mono text-xs font-bold border border-[#353c4a] cursor-pointer"
                  title="Reset Navigation Leg"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
              </div>

              <div className="flex items-center justify-between gap-2 pt-1 font-mono text-[10px] text-[#9da5b4]">
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={autoChargingStop}
                    onChange={(e) => setAutoChargingStop(e.target.checked)}
                    className="accent-[#22c55e] h-3.5 w-3.5"
                  />
                  <span>AUTO RECHARGE STOP</span>
                </label>
                <label className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showDirectComparison}
                    onChange={(e) => setShowDirectComparison(e.target.checked)}
                    className="accent-[#22c55e] h-3.5 w-3.5"
                  />
                  <span>DIRECT COMPARE</span>
                </label>
              </div>
            </section>

            {/* PANEL 2: LIFE SUPPORT RESERVES & LST SOLAR TIME */}
            <section className="p-3 border-b border-[#242933] space-y-2.5">
              <h3 className="font-mono text-[10px] font-bold tracking-wider uppercase text-[#656d7d]">
                LIFE SUPPORT RESERVES & SOL TIME
              </h3>

              <div className="space-y-2 font-mono text-[10.5px]">
                <div>
                  <div className="flex justify-between text-[#9da5b4] mb-1">
                    <span>BATTERY RESERVE</span>
                    <span className={startBatteryPct < 25 ? 'text-[#ef4444] font-bold' : 'text-[#22c55e] font-bold'}>
                      {startBatteryPct}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="10"
                    max="100"
                    value={startBatteryPct}
                    onChange={(e) => setStartBatteryPct(Number(e.target.value))}
                    className="glove-slider"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[#9da5b4] mb-1">
                    <span>O2 TANK PRESSURE</span>
                    <span className={startO2Pct < 25 ? 'text-[#ef4444] font-bold' : 'text-[#edf0f5] font-bold'}>
                      {startO2Pct}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min="15"
                    max="100"
                    value={startO2Pct}
                    onChange={(e) => setStartO2Pct(Number(e.target.value))}
                    className="glove-slider"
                  />
                </div>

                <div>
                  <div className="flex justify-between text-[#9da5b4] mb-1">
                    <span>MARTIAN LST / TEMP</span>
                    <span className="text-[#edf0f5]">
                      {martianEnv.lstText} ({martianEnv.ambientTempC} C)
                    </span>
                  </div>
                  <input
                    type="range"
                    min="360"
                    max="1200"
                    value={startLstMinutes}
                    onChange={(e) => setStartLstMinutes(Number(e.target.value))}
                    className="glove-slider"
                  />
                </div>
              </div>
            </section>

            {/* PANEL 3: ROUTE METRICS & ELEVATION TRANSECT CANVAS */}
            <section className="p-3 border-b border-[#242933] space-y-2.5">
              <div className="flex items-center justify-between">
                <h3 className="font-mono text-[10px] font-bold tracking-wider uppercase text-[#656d7d]">
                  TRAVERSE METRICS & PROFILE
                </h3>
                <span
                  className={`px-2 py-0.5 rounded-[4px] border font-mono text-[9.5px] font-bold uppercase ${
                    routeResult.rangeStatus === 'out_of_range'
                      ? 'bg-[#ef4444]/10 text-[#ef4444] border-[#ef4444]/40'
                      : 'bg-[#22c55e]/10 text-[#22c55e] border-[#22c55e]/40'
                  }`}
                >
                  {routeResult.rangeStatus === 'out_of_range'
                    ? 'RANGE FAULT'
                    : routeResult.chargingStop
                    ? 'PIT-STOP REQ'
                    : 'VIABLE'}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-1.5 font-mono text-[10.5px]">
                <div className="bg-[#191d24] border border-[#242933] rounded-[4px] p-2">
                  <div className="text-[#656d7d] text-[9px]">DISTANCE / ETA</div>
                  <div className="text-[#edf0f5] font-bold">
                    {routeResult.distKm} KM // {routeResult.durationMin} MIN
                  </div>
                </div>
                <div className="bg-[#191d24] border border-[#242933] rounded-[4px] p-2">
                  <div className="text-[#656d7d] text-[9px]">PEAK GRADE / VIABILITY</div>
                  <div className="text-[#edf0f5] font-bold">
                    {routeResult.maxSlopeAlongPath} DEG // {routeResult.viabilityScore}%
                  </div>
                </div>
                <div className="bg-[#191d24] border border-[#242933] rounded-[4px] p-2">
                  <div className="text-[#656d7d] text-[9px]">ELEV GAIN / HAZ CROSS</div>
                  <div className="text-[#edf0f5] font-bold">
                    +{routeResult.elevGainM} M // {routeResult.hazardCrossings}
                  </div>
                </div>
                <div className="bg-[#191d24] border border-[#242933] rounded-[4px] p-2">
                  <div className="text-[#656d7d] text-[9px]">EST END BAT / O2</div>
                  <div
                    className={`font-bold ${
                      routeResult.finalArrivalBattery < 15 ? 'text-[#ef4444]' : 'text-[#22c55e]'
                    }`}
                  >
                    {routeResult.finalArrivalBattery}% // {routeResult.finalArrivalO2}%
                  </div>
                </div>
              </div>

              <div className="border border-[#242933] rounded-[4px] overflow-hidden bg-[#0b0d11]">
                <div className="px-2 py-1 border-b border-[#242933] font-mono text-[9.5px] text-[#656d7d] uppercase flex justify-between">
                  <span>HRSC ELEVATION TRANSECT</span>
                  <span className="text-[#9da5b4]">
                    {routeResult.minElevationM}m .. {routeResult.maxElevationM}m
                  </span>
                </div>
                <canvas ref={elevationCanvasRef} className="w-full h-[96px] block" />
              </div>

              {routeResult.navigationSteps?.length > 0 && (
                <div className="bg-[#191d24] border border-[#242933] rounded-[4px] p-2 space-y-1 max-h-[110px] overflow-y-auto aerospace-scroll font-mono text-[10px]">
                  {routeResult.navigationSteps.slice(0, 5).map((st, idx) => (
                    <div key={idx} className="flex items-start gap-2 text-[#9da5b4]">
                      <span className="text-[#656d7d] shrink-0">[{idx + 1}]</span>
                      <span className="text-[#edf0f5] leading-snug">{st.instruction}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* PANEL 4: BASEMAP & CARTOGRAPHIC OVERLAYS */}
            <section className="p-3 border-b border-[#242933] space-y-2.5">
              <h3 className="font-mono text-[10px] font-bold tracking-wider uppercase text-[#656d7d]">
                BASEMAP & CARTOGRAPHIC OVERLAYS
              </h3>

              <div className="grid grid-cols-5 gap-1">
                {BASEMAP_OPTIONS.map((opt) => (
                  <button
                    type="button"
                    key={`sb-${opt.id}`}
                    onClick={() => setBasemap(opt.id)}
                    className={`min-h-[34px] rounded-[4px] border font-mono text-[10px] font-bold cursor-pointer ${
                      basemap === opt.id
                        ? 'bg-[#22c55e]/15 text-[#22c55e] border-[#22c55e]'
                        : 'bg-[#191d24] hover:bg-[#222731] text-[#9da5b4] border-[#242933]'
                    }`}
                  >
                    {opt.short}
                  </button>
                ))}
              </div>

              <div className="space-y-1">
                {OVERLAY_ITEMS.map((ov) => (
                  <label
                    key={`sb-ov-${ov.key}`}
                    className="flex items-center justify-between px-2 py-1.5 bg-[#191d24] border border-[#242933] hover:border-[#353c4a] rounded-[4px] font-mono text-[10.5px] text-[#9da5b4] cursor-pointer"
                  >
                    <span>{ov.label}</span>
                    <input
                      type="checkbox"
                      checked={Boolean(layers[ov.key])}
                      onChange={(e) =>
                        setLayers((prev) => ({ ...prev, [ov.key]: e.target.checked }))
                      }
                      className="accent-[#22c55e] h-3.5 w-3.5 cursor-pointer"
                    />
                  </label>
                ))}
              </div>
            </section>

            {/* PANEL 5: 11 REGIONAL LANDMARKS DIRECTORY */}
            <section className="p-3 border-b border-[#242933] space-y-2">
              <h3 className="font-mono text-[10px] font-bold tracking-wider uppercase text-[#656d7d]">
                JEZERO-NILI LANDMARK DIRECTORY [11]
              </h3>
              <div className="space-y-1 max-h-[175px] overflow-y-auto aerospace-scroll">
                {landmarksData.map((lm) => (
                  <div
                    key={`dir-${lm.id}`}
                    className="flex items-center justify-between gap-2 px-2 py-1.5 bg-[#191d24] border border-[#242933] rounded-[4px]"
                  >
                    <button
                      type="button"
                      onClick={() => handleQuickLandmarkClick(lm)}
                      className="text-left min-w-0 flex-1 cursor-pointer"
                    >
                      <div className="text-[11px] font-semibold text-[#edf0f5] truncate">
                        {lm.name}
                      </div>
                      <div className="font-mono text-[9.5px] text-[#656d7d]">
                        {lm.coords[0].toFixed(3)}N, {lm.coords[1].toFixed(3)}E // {lm.elevation_m}m
                      </div>
                    </button>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setActiveLandmark(lm)}
                        className="px-2 py-1 rounded-[4px] bg-[#222731] hover:bg-[#2c323f] border border-[#353c4a] font-mono text-[9.5px] font-bold text-[#edf0f5] cursor-pointer"
                      >
                        DOSSIER
                      </button>
                      <button
                        type="button"
                        onClick={() => handleNavigateToPOI(lm.id)}
                        className="px-2 py-1 rounded-[4px] bg-[#16a34a] hover:bg-[#22c55e] border border-[#22c55e] font-mono text-[9.5px] font-bold text-[#0b0d11] cursor-pointer"
                      >
                        GO
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* PANEL 6: ACTIVE EXCLUSION ZONES & MISSION EXPORT */}
            <section className="p-3 space-y-2.5">
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <h3 className="font-mono text-[10px] font-bold tracking-wider uppercase text-[#656d7d]">
                    CUSTOM EXCLUSION ZONES [{drawnZones.length}]
                  </h3>
                </div>
                {drawnZones.length === 0 ? (
                  <div className="p-2 bg-[#191d24] border border-[#242933] rounded-[4px] font-mono text-[10px] text-[#656d7d]">
                    NO CUSTOM POLYGONS DEFINED. USE TOP-RIGHT DRAW TOOLS.
                  </div>
                ) : (
                  <div className="space-y-1">
                    {drawnZones.map((z) => (
                      <div
                        key={z.id}
                        className="flex items-center justify-between px-2 py-1.5 bg-[#191d24] border border-[#242933] rounded-[4px] font-mono text-[10px]"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              z.type === 'safe' ? 'bg-[#22c55e]' : 'bg-[#ef4444]'
                            }`}
                          />
                          <span className="text-[#edf0f5] truncate">
                            {APP_THEME.hazards[z.type]?.label || z.type}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleDeleteZone(z.id)}
                          className="text-[#ef4444] hover:underline font-bold cursor-pointer shrink-0 ml-2"
                        >
                          DEL
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-[#242933] space-y-1.5">
                <h3 className="font-mono text-[10px] font-bold tracking-wider uppercase text-[#656d7d]">
                  MISSION TELEMETRY EXPORT
                </h3>
                <button
                  type="button"
                  onClick={exportTraverseGeoJSON}
                  className="glove-btn w-full min-h-[38px] px-3 rounded-[4px] bg-[#191d24] hover:bg-[#222731] border border-[#353c4a] font-mono text-[10.5px] font-bold text-[#edf0f5] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Download className="h-3.5 w-3.5" />
                  <span>EXPORT TRAVERSE GEOJSON</span>
                </button>
                <button
                  type="button"
                  onClick={exportMissionReport}
                  className="glove-btn w-full min-h-[38px] px-3 rounded-[4px] bg-[#191d24] hover:bg-[#222731] border border-[#353c4a] font-mono text-[10.5px] font-bold text-[#9da5b4] hover:text-[#edf0f5] flex items-center justify-center gap-2 cursor-pointer"
                >
                  <FileText className="h-3.5 w-3.5" />
                  <span>EXPORT TELEMETRY REPORT</span>
                </button>
              </div>
            </section>
          </aside>
        )}
      </div>

      {/* 3. DEVELOPER BOTTOM LIVE TELEMETRY & SENSOR BAR (8 CELLS) */}
      {uiMode === 'developer' && (
        <footer className="shrink-0 bg-[#13161c] border-t border-[#242933] grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 divide-x divide-y lg:divide-y-0 divide-[#242933] font-mono text-[10px] z-30">
          <div className="px-2.5 py-1.5">
            <div className="text-[9px] text-[#656d7d]">CURSOR COORD</div>
            <div className="text-[#edf0f5] font-semibold truncate">
              {cursorTelemetry.lat.toFixed(4)} N, {cursorTelemetry.lon.toFixed(4)} E
            </div>
          </div>
          <div className="px-2.5 py-1.5">
            <div className="text-[9px] text-[#656d7d]">ELEV (HRSC DTM)</div>
            <div className="text-[#edf0f5] font-semibold">{cursorTelemetry.elevM} m</div>
          </div>
          <div className="px-2.5 py-1.5">
            <div className="text-[9px] text-[#656d7d]">MAX ROUTE GRADE</div>
            <div className="text-[#edf0f5] font-semibold">{curSlope} deg</div>
          </div>
          <div className="px-2.5 py-1.5">
            <div className="text-[9px] text-[#656d7d]">SURF TEMP (MEDA)</div>
            <div className="text-[#edf0f5] font-semibold">{martianEnv.ambientTempC} C</div>
          </div>
          <div className="px-2.5 py-1.5">
            <div className="text-[9px] text-[#656d7d]">GCR RAD FLUX</div>
            <div className={weatherKey === 'solar_storm' ? 'text-[#ef4444] font-bold' : 'text-[#edf0f5] font-semibold'}>
              {gcrFlux}
            </div>
          </div>
          <div className="px-2.5 py-1.5">
            <div className="text-[9px] text-[#656d7d]">CLO4 SOIL CONC</div>
            <div className="text-[#edf0f5] font-semibold">{clo4Pct}</div>
          </div>
          <div className="px-2.5 py-1.5">
            <div className="text-[9px] text-[#656d7d]">SECTOR STATUS</div>
            <div className={`font-bold truncate ${cursorTelemetry.isFault ? 'text-[#ef4444]' : 'text-[#22c55e]'}`}>
              {cursorTelemetry.hazardLabel}
            </div>
          </div>
          <div className="px-2.5 py-1.5">
            <div className="text-[9px] text-[#656d7d]">DATA FEED</div>
            <div className="text-[#9da5b4] font-semibold">NASA M20 // USGS</div>
          </div>
        </footer>
      )}

      {/* VISUAL MAP SYMBOLOGY LEGEND MODAL (MONOCHROME + GREEN/CRIMSON ONLY) */}
      {showLegendSheet && (
        <div className="fixed inset-0 z-[1400] flex items-center justify-center bg-[#0b0d11]/85 p-4">
          <div className="w-full max-w-xl bg-[#13161c] border border-[#353c4a] rounded-[6px] overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-[#191d24] border-b border-[#242933]">
              <div className="font-mono text-xs font-bold text-[#edf0f5] uppercase flex items-center gap-2">
                <Info className="h-4 w-4 text-[#22c55e]" />
                <span>Tactical Map Symbology & Legend</span>
              </div>
              <button
                type="button"
                onClick={() => setShowLegendSheet(false)}
                className="text-[#9da5b4] hover:text-[#edf0f5] p-1.5 rounded-[4px] hover:bg-[#222731] cursor-pointer"
                aria-label="Close Legend"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 text-xs font-mono text-[#9da5b4] max-h-[80vh] overflow-y-auto aerospace-scroll">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <div className="p-3 bg-[#191d24] border border-[#242933] rounded-[4px] space-y-2">
                  <div className="text-[10px] font-bold text-[#edf0f5] uppercase border-b border-[#242933] pb-1">
                    STATION & LANDMARK PINS
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="h-7 w-7 rounded-[4px] border border-[#22c55e] bg-[#13161c] flex items-center justify-center shrink-0">
                      <Zap className="h-4 w-4 text-[#22c55e]" />
                    </span>
                    <span>Charging & Shelter Habitat</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="h-7 w-7 rounded-[4px] border border-[#22c55e] bg-[#13161c] flex items-center justify-center shrink-0">
                      <Droplets className="h-4 w-4 text-[#22c55e]" />
                    </span>
                    <span>ISRU Water Extraction Site</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="h-7 w-7 rounded-[4px] border border-[#4f5767] bg-[#13161c] flex items-center justify-center shrink-0">
                      <Hexagon className="h-4 w-4 text-[#edf0f5]" />
                    </span>
                    <span>Sample Depot / Mineral Cache</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="h-7 w-7 rounded-[4px] border border-[#edf0f5] bg-[#13161c] flex items-center justify-center shrink-0">
                      <Crosshair className="h-4 w-4 text-[#edf0f5]" />
                    </span>
                    <span>Regional Science Landmark</span>
                  </div>
                </div>

                <div className="p-3 bg-[#191d24] border border-[#242933] rounded-[4px] space-y-2">
                  <div className="text-[10px] font-bold text-[#edf0f5] uppercase border-b border-[#242933] pb-1">
                    NAVIGATION PUCK & VECTORS
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="h-7 w-7 rounded-[4px] border border-[#353c4a] bg-[#13161c] flex items-center justify-center shrink-0">
                      <Navigation2 className="h-4 w-4 text-[#edf0f5]" />
                    </span>
                    <span>EVA Astronaut Heading & Beam</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-1 bg-[#edf0f5] rounded-full inline-block shrink-0" />
                    <span>A* Primary Safe Path (Leg 1)</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-1 bg-[#22c55e] rounded-full inline-block shrink-0" />
                    <span>Post-Recharge Leg 2 Vector</span>
                  </div>
                  <div className="flex items-center gap-2.5">
                    <span className="w-7 h-1 bg-[#ef4444] rounded-full inline-block shrink-0" />
                    <span>Out-of-Range / Hazard Fault</span>
                  </div>
                </div>
              </div>

              <div className="p-3 bg-[#191d24] border border-[#242933] rounded-[4px] space-y-2">
                <div className="text-[10px] font-bold text-[#edf0f5] uppercase border-b border-[#242933] pb-1">
                  SLOPE GRADE DOTS & HAZARD ZONES
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-[10.5px]">
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#22c55e]" />
                    <span>&lt; 7 deg Nominal</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#9da5b4]" />
                    <span>7-13 deg Caution</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-[#ef4444]" />
                    <span>&gt;= 14 deg Critical</span>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowLegendSheet(false)}
                className="glove-btn w-full min-h-[46px] rounded-[4px] bg-[#222731] hover:bg-[#2c323f] border border-[#4f5767] text-[#edf0f5] font-bold uppercase cursor-pointer"
              >
                CLOSE LEGEND
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 360 PHOTOSPHERE / HIGH-RES 2D IMAGERY VIEWER */}
      {activePanorama && (
        <MarsPanoramaViewer
          panorama={activePanorama}
          allPanoramas={viewerArchiveList}
          onSelectPanorama={(p) => setActivePanorama(p)}
          onClose={() => setActivePanorama(null)}
          onNavigateToLocation={(p) => handleNavigateToPOI(p.poiId || p.id)}
        />
      )}
    </div>
  );
}
