/**
 * Jezero A* Terrain Pathfinder, Range Analyzer & Charging Pit-Stop Engine
 * Computes obstacle-avoiding Marswalk routes over Jezero Crater / Nili Planum using
 * elevation/tilt data, hazard zones, custom exclusion polygons, battery/O2 limits,
 * and intermediate charging stations.
 */

export const SAFE_RESERVE_PCT = 15;
export const SUIT_O2_CAPACITY_LITERS = 480;

export const LOADOUT_PROFILES = {
  light: {
    id: 'light',
    name: 'SOLO SUIT (XEMU)',
    speedKmh: 2.0,
    speedKmH: 2.0,
    maxSlopeDeg: 18,
    o2RateLpm: 0.85,
    o2Rate: 0.85,
    batteryDrainPerKm: 11.5,
    suitMassKg: 115,
    description: 'Standard xEMU EVA configuration. High mobility, 18 deg slope limit.',
  },
  heavy: {
    id: 'heavy',
    name: 'HEAVY SAMPLE KIT',
    speedKmh: 1.3,
    speedKmH: 1.3,
    maxSlopeDeg: 12,
    o2RateLpm: 1.25,
    o2Rate: 1.25,
    batteryDrainPerKm: 16.5,
    suitMassKg: 155,
    description: 'Core drill and sample payload. Avoids slopes > 12 deg and high-slip sand.',
  },
  rover: {
    id: 'rover',
    name: 'ROVER MULE ASSIST',
    speedKmh: 2.6,
    speedKmH: 2.6,
    maxSlopeDeg: 21,
    o2RateLpm: 0.70,
    o2Rate: 0.70,
    batteryDrainPerKm: 9.0,
    suitMassKg: 115,
    description: 'Uncrewed mule payload carrier. Tether assist up to 21 deg.',
  },
};

export const WEATHER_CONDITIONS = {
  nominal: {
    id: 'nominal',
    label: 'NOMINAL SOL',
    solarFlux: 590,
    radiationDoseRate: 0.011,
    radRateMgyHr: 0.011,
    tempMultiplier: 1.0,
    visibilityKm: 25,
    tau: 0.45,
    dustTau: 0.45,
    evaAllowed: true,
    alert: null,
  },
  dust_storm: {
    id: 'dust_storm',
    label: 'REGIONAL DUST SQUALL',
    solarFlux: 140,
    radiationDoseRate: 0.009,
    radRateMgyHr: 0.009,
    tempMultiplier: 1.35,
    visibilityKm: 0.4,
    tau: 3.8,
    dustTau: 3.8,
    evaAllowed: false,
    alert: 'DUST SQUALL WARNING: Visibility < 400 m. Return to pressurized shelter.',
  },
  solar_storm: {
    id: 'solar_storm',
    label: 'SOLAR PARTICLE EVENT (SPE)',
    solarFlux: 680,
    radiationDoseRate: 0.85,
    radRateMgyHr: 0.85,
    tempMultiplier: 1.0,
    visibilityKm: 25,
    tau: 0.45,
    dustTau: 0.45,
    evaAllowed: false,
    alert: 'RADIATION FAULT: SPE flux spike detected. Seek shelter within 45 min.',
  },
};

const GRID_ROWS = 52;
const GRID_COLS = 92;

// Haversine distance on Mars (Mean radius = 3389.5 km)
export function marsDistanceMeters(lat1, lon1, lat2, lon2) {
  const R = 3389500;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// Consolidated 20m DTM cache (loaded from /terrain/jezero_dem.json)
let _loadedDem = null;
let _demFetchPromise = null;

export function setLoadedDemData(dem) {
  if (dem && Array.isArray(dem.elevations) && dem.ncols && dem.nrows) {
    _loadedDem = dem;
  }
}

export function getLoadedDemData() {
  return _loadedDem;
}

export function ensureDemLoaded() {
  if (_loadedDem) return Promise.resolve(_loadedDem);
  if (!_demFetchPromise && typeof window !== 'undefined' && typeof fetch === 'function') {
    _demFetchPromise = fetch('/terrain/jezero_dem.json')
      .then((res) => (res.ok ? res.json() : null))
      .then((dem) => {
        if (dem) setLoadedDemData(dem);
        return _loadedDem;
      })
      .catch(() => null);
  }
  return _demFetchPromise || Promise.resolve(null);
}

if (typeof window !== 'undefined') {
  ensureDemLoaded();
}

function sampleDemGrid(dem, lat, lon) {
  const latMin = dem.latMin ?? 17.084077;
  const latMax = dem.latMax ?? 19.319730;
  const lonMin = dem.lonMin ?? 76.795971;
  const lonMax = dem.lonMax ?? 77.801146;

  const u = Math.max(0, Math.min(1, (lon - lonMin) / (lonMax - lonMin)));
  const v = Math.max(0, Math.min(1, (latMax - lat) / (latMax - latMin))); // row 0 is north (latMax)

  const fx = u * (dem.ncols - 1);
  const fy = v * (dem.nrows - 1);
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fy);
  const c1 = Math.min(dem.ncols - 1, c0 + 1);
  const r1 = Math.min(dem.nrows - 1, r0 + 1);
  const tx = fx - c0;
  const ty = fy - r0;

  const idx00 = r0 * dem.ncols + c0;
  const idx10 = r0 * dem.ncols + c1;
  const idx01 = r1 * dem.ncols + c0;
  const idx11 = r1 * dem.ncols + c1;

  const bilerp = (arr, fallback = 0) => {
    const v00 = arr[idx00] ?? fallback;
    const v10 = arr[idx10] ?? fallback;
    const v01 = arr[idx01] ?? fallback;
    const v11 = arr[idx11] ?? fallback;
    const a = v00 * (1 - tx) + v10 * tx;
    const b = v01 * (1 - tx) + v11 * tx;
    return a * (1 - ty) + b * ty;
  };

  const elev = bilerp(dem.elevations, dem.minElev ?? -2500);
  const slope = Array.isArray(dem.slopes) ? bilerp(dem.slopes, 0) : 0;
  const nr = Math.round(fy);
  const nc = Math.round(fx);
  const hazardStatus = Array.isArray(dem.hazardStatus)
    ? dem.hazardStatus[nr * dem.ncols + nc]
    : 0;

  return { elev, slope, hazardStatus };
}

// Consolidated 20.2m DTM elevation estimator (meters)
export function estimateElev(lat, lon) {
  if (_loadedDem) {
    const { elev } = sampleDemGrid(_loadedDem, lat, lon);
    return Math.round(elev * 10) / 10;
  }
  const dLat = (lat - 18.44) * 111320;
  const dLon = (lon - 77.45) * 111320 * Math.cos((18.44 * Math.PI) / 180);
  const dist = Math.sqrt(dLat * dLat + dLon * dLon);

  let e;
  if (dist > 29400) {
    e = -1200 - (dist - 29400) * 0.005;
  } else if (dist > 20800) {
    const t = (dist - 20800) / 8600;
    e = -2600 + 1100 * Math.sin(t * Math.PI);
  } else {
    const t = dist / 20800;
    e = -2600 + 330 * t * t;
  }
  return Math.round(e * 10) / 10;
}

export function estimateSlope(lat, lon) {
  if (_loadedDem && Array.isArray(_loadedDem.slopes)) {
    const { slope } = sampleDemGrid(_loadedDem, lat, lon);
    return Math.round(slope * 10) / 10;
  }
  return 0;
}

let _depthHazardGeoJson = null;
let _depthHazardPolygons = [];
let _depthHazardLoadPromise = null;

export function getDepthHazardRegions() {
  return _depthHazardGeoJson;
}

export function setDepthHazardRegions(geojson) {
  _depthHazardGeoJson = geojson || null;
  const polys = [];
  for (const feat of geojson?.features || []) {
    const ring = feat?.geometry?.coordinates?.[0];
    if (!Array.isArray(ring) || ring.length < 3) continue;
    let minLat = Infinity;
    let maxLat = -Infinity;
    let minLon = Infinity;
    let maxLon = -Infinity;
    const coords = ring.map(([lon, lat]) => {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lon < minLon) minLon = lon;
      if (lon > maxLon) maxLon = lon;
      return [lat, lon];
    });
    polys.push({
      severity: feat?.properties?.severity || 'high',
      label: feat?.properties?.label || 'STEEP DEPTH-GRADIENT REGION',
      peakSlopeDeg: Number(feat?.properties?.peakSlopeDeg ?? 18),
      minLat,
      maxLat,
      minLon,
      maxLon,
      coords,
    });
  }
  _depthHazardPolygons = polys;
  legCache.clear();
}

export function loadDepthHazardRegions() {
  if (_depthHazardGeoJson) return Promise.resolve(_depthHazardGeoJson);
  if (_depthHazardLoadPromise) return _depthHazardLoadPromise;
  _depthHazardLoadPromise = fetch('/data/depth_hazard_regions.geojson')
    .then((res) => (res.ok ? res.json() : null))
    .then((geojson) => {
      if (geojson) setDepthHazardRegions(geojson);
      return geojson;
    })
    .catch(() => null);
  return _depthHazardLoadPromise;
}

function findDepthHazardAtPoint(lat, lon) {
  let hit = null;
  for (let i = 0; i < _depthHazardPolygons.length; i++) {
    const p = _depthHazardPolygons[i];
    if (lat < p.minLat || lat > p.maxLat || lon < p.minLon || lon > p.maxLon) continue;
    if (pointInPolygon(lat, lon, p.coords)) {
      if (!hit || p.severity === 'critical') {
        hit = p;
        if (hit.severity === 'critical') return hit;
      }
    }
  }
  return hit;
}

export function checkCursorHazards(lat, lon, hazardZones = [], customExclusionZones = []) {
  for (const hz of hazardZones) {
    const dist = marsDistanceMeters(lat, lon, hz.lat, hz.lon);
    if (dist <= hz.radiusMeters) {
      return { label: `HAZARD: ${hz.name.toUpperCase()}`, isFault: true };
    }
  }
  for (const zone of customExclusionZones) {
    if (zone.coords?.length >= 3 && pointInPolygon(lat, lon, zone.coords)) {
      if (zone.type === 'safe') {
        return { label: 'SAFE CORRIDOR (DESIGNATED)', isFault: false };
      }
      return { label: `EXCLUSION: ${zone.type.toUpperCase()}`, isFault: true };
    }
  }
  const depthHit = findDepthHazardAtPoint(lat, lon);
  if (depthHit) {
    return {
      label: `${depthHit.label} (${depthHit.peakSlopeDeg}°)`,
      isFault: true,
    };
  }
  if (_loadedDem) {
    const { slope, hazardStatus } = sampleDemGrid(_loadedDem, lat, lon);
    if (hazardStatus >= 2 || slope >= 22) {
      return { label: `CLIFF / BARRIER (${slope.toFixed(1)}°)`, isFault: true };
    }
    if (hazardStatus === 1 || slope >= 12) {
      return { label: `STEEP GRADE (${slope.toFixed(1)}°)`, isFault: true };
    }
  }
  return { label: 'CLEAR / PASSABLE', isFault: false };
}

function pointInPolygon(lat, lon, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i][0];
    const yi = polygon[i][1];
    const xj = polygon[j][0];
    const yj = polygon[j][1];
    const intersect =
      yi > lon !== yj > lon && lat < ((xj - xi) * (lon - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function computeDynamicBounds(start, end) {
  const padLat = 0.025;
  const padLon = 0.025;
  return {
    minLat: Math.min(18.415, start.lat, end.lat) - padLat,
    maxLat: Math.max(18.502, start.lat, end.lat) + padLat,
    minLon: Math.min(77.215, start.lon, end.lon) - padLon,
    maxLon: Math.max(77.468, start.lon, end.lon) + padLon,
  };
}

function latLonToGrid(lat, lon, bounds) {
  const r = Math.min(
    GRID_ROWS - 1,
    Math.max(0, Math.round(((lat - bounds.minLat) / (bounds.maxLat - bounds.minLat)) * (GRID_ROWS - 1)))
  );
  const c = Math.min(
    GRID_COLS - 1,
    Math.max(0, Math.round(((lon - bounds.minLon) / (bounds.maxLon - bounds.minLon)) * (GRID_COLS - 1)))
  );
  return { r, c };
}

function gridToLatLon(r, c, bounds) {
  const lat = bounds.minLat + (r / (GRID_ROWS - 1)) * (bounds.maxLat - bounds.minLat);
  const lon = bounds.minLon + (c / (GRID_COLS - 1)) * (bounds.maxLon - bounds.minLon);
  return [Number(lat.toFixed(6)), Number(lon.toFixed(6))];
}

export function calculateBearingDegrees(lat1, lon1, lat2, lon2) {
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(rLat2);
  const x =
    Math.cos(rLat1) * Math.sin(rLat2) -
    Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLon);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function getCompassBearing(lat1, lon1, lat2, lon2) {
  const brng = calculateBearingDegrees(lat1, lon1, lat2, lon2);
  const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return `${Math.round(brng)} deg (${dirs[Math.round(brng / 45) % 8]})`;
}

function getCellHazardPenalty(
  lat,
  lon,
  hazardZones,
  loadout,
  waypoints,
  customExclusionZones = []
) {
  let penalty = 1.0;
  let localSlope = _loadedDem ? estimateSlope(lat, lon) : 3.5;

  if (_loadedDem) {
    const { hazardStatus } = sampleDemGrid(_loadedDem, lat, lon);
    if (hazardStatus >= 2 || localSlope > loadout.maxSlopeDeg) {
      return { cost: 9999, slope: Math.max(localSlope, 22), blocked: true };
    }
    if (hazardStatus === 1 || localSlope >= 12) {
      penalty += 2.2;
    }
  }

  for (let i = 0; i < waypoints.length; i += 4) {
    const wp = waypoints[i];
    const d = Math.abs(wp.lat - lat) + Math.abs(wp.lon - lon);
    if (d < 0.004) {
      localSlope = Math.max(localSlope, wp.tilt || 3.5);
    }
  }

  for (const zone of customExclusionZones) {
    if (zone.coords?.length >= 3 && pointInPolygon(lat, lon, zone.coords)) {
      if (zone.type === 'safe') {
        penalty *= 0.65;
      } else {
        return { cost: 9999, slope: 26, blocked: true };
      }
    }
  }

  const depthHit = findDepthHazardAtPoint(lat, lon);
  if (depthHit) {
    const slopeVal = Math.max(localSlope, depthHit.peakSlopeDeg);
    if (depthHit.severity === 'critical' || slopeVal > loadout.maxSlopeDeg) {
      return { cost: 9999, slope: slopeVal, blocked: true };
    }
    return { cost: 45, slope: slopeVal, blocked: false };
  }

  for (const hz of hazardZones) {
    const dist = marsDistanceMeters(lat, lon, hz.lat, hz.lon);
    if (dist <= hz.radiusMeters) {
      localSlope = Math.max(localSlope, hz.maxSlope);
      if (hz.maxSlope > loadout.maxSlopeDeg) {
        return { cost: 9999, slope: hz.maxSlope, blocked: true };
      }
      if (hz.type === 'sand' && loadout.id === 'heavy') {
        penalty += 6.0;
      } else {
        penalty += 2.8;
      }
    }
  }

  if (localSlope > loadout.maxSlopeDeg) {
    return { cost: 9999, slope: localSlope, blocked: true };
  }
  penalty += (localSlope / loadout.maxSlopeDeg) * 1.6;
  return { cost: penalty, slope: localSlope, blocked: false };
}

/**
 * Runs A* search for a single leg from `start` to `end` (with LRU memoization)
 */
const legCache = new Map();
const MAX_LEG_CACHE_SIZE = 120;

export function computeSingleLeg({
  start,
  end,
  hazardZones,
  waypoints,
  loadout,
  weather,
  customExclusionZones = [],
}) {
  if (!start || !end) return null;

  const startKey = `${Number(start.lat).toFixed(4)},${Number(start.lon).toFixed(4)}`;
  const endKey = `${Number(end.lat).toFixed(4)},${Number(end.lon).toFixed(4)}`;
  const lKey = loadout?.id || loadout?.name || 'def';
  const wKey = weather?.id || weather?.name || 'def';
  const zKey = customExclusionZones?.map((z) => `${z.id || ''}:${z.coords?.length || 0}`).join(';') || '';
  const cacheKey = `${startKey}->${endKey}__${lKey}__${wKey}__${zKey}`;

  if (legCache.has(cacheKey)) {
    return legCache.get(cacheKey);
  }

  const bounds = computeDynamicBounds(start, end);
  const startCell = latLonToGrid(start.lat, start.lon, bounds);
  const endCell = latLonToGrid(end.lat, end.lon, bounds);

  const key = (r, c) => `${r},${c}`;
  const openSet = new Set([key(startCell.r, startCell.c)]);
  const cameFrom = new Map();

  const gScore = new Map();
  const fScore = new Map();
  const cellMeta = new Map();

  const startK = key(startCell.r, startCell.c);
  gScore.set(startK, 0);
  fScore.set(startK, marsDistanceMeters(start.lat, start.lon, end.lat, end.lon));

  const dirs = [
    [-1, 0],
    [1, 0],
    [0, -1],
    [0, 1],
    [-1, -1],
    [-1, 1],
    [1, -1],
    [1, 1],
  ];

  let found = false;
  let iterations = 0;

  while (openSet.size > 0 && iterations < 9000) {
    iterations++;
    let currentK = null;
    let lowestF = Infinity;
    for (const k of openSet) {
      const f = fScore.get(k) ?? Infinity;
      if (f < lowestF) {
        lowestF = f;
        currentK = k;
      }
    }

    if (!currentK) break;
    const [cr, cc] = currentK.split(',').map(Number);

    if (cr === endCell.r && cc === endCell.c) {
      found = true;
      break;
    }

    openSet.delete(currentK);
    const [cLat, cLon] = gridToLatLon(cr, cc, bounds);

    for (const [dr, dc] of dirs) {
      const nr = cr + dr;
      const nc = cc + dc;
      if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;

      const nk = key(nr, nc);
      const [nLat, nLon] = gridToLatLon(nr, nc, bounds);
      const stepDist = marsDistanceMeters(cLat, cLon, nLat, nLon);

      let meta = cellMeta.get(nk);
      if (!meta) {
        meta = getCellHazardPenalty(
          nLat,
          nLon,
          hazardZones,
          loadout,
          waypoints,
          customExclusionZones
        );
        cellMeta.set(nk, meta);
      }

      const isEnd = nr === endCell.r && nc === endCell.c;
      const stepCost = isEnd ? stepDist : stepDist * meta.cost;
      const tentativeG = (gScore.get(currentK) ?? Infinity) + stepCost;

      if (tentativeG < (gScore.get(nk) ?? Infinity)) {
        cameFrom.set(nk, currentK);
        gScore.set(nk, tentativeG);
        fScore.set(nk, tentativeG + marsDistanceMeters(nLat, nLon, end.lat, end.lon));
        openSet.add(nk);
      }
    }
  }

  const pathCoords = [];
  let maxSlopeAlongPath = 3.5;

  if (found) {
    let curr = key(endCell.r, endCell.c);
    while (curr) {
      const [r, c] = curr.split(',').map(Number);
      const [lat, lon] = gridToLatLon(r, c, bounds);
      pathCoords.unshift([lat, lon]);
      const m = cellMeta.get(curr);
      if (m && m.slope > maxSlopeAlongPath) {
        maxSlopeAlongPath = m.slope;
      }
      curr = cameFrom.get(curr);
    }
    pathCoords[0] = [start.lat, start.lon];
    pathCoords[pathCoords.length - 1] = [end.lat, end.lon];
  } else {
    pathCoords.push([start.lat, start.lon], [end.lat, end.lon]);
  }

  let totalDistM = 0;
  let hazardCrossings = 0;
  const elevProfile = [{ distKm: 0, elev: estimateElev(pathCoords[0][0], pathCoords[0][1]), lat: pathCoords[0][0], lon: pathCoords[0][1] }];

  for (let i = 1; i < pathCoords.length; i++) {
    const segM = marsDistanceMeters(
      pathCoords[i - 1][0],
      pathCoords[i - 1][1],
      pathCoords[i][0],
      pathCoords[i][1]
    );
    totalDistM += segM;
    const ptLat = pathCoords[i][0];
    const ptLon = pathCoords[i][1];
    elevProfile.push({
      distKm: Number((totalDistM / 1000).toFixed(3)),
      elev: estimateElev(ptLat, ptLon),
      lat: ptLat,
      lon: ptLon,
    });

    for (const zone of customExclusionZones) {
      if (zone.type !== 'safe' && zone.coords?.length >= 3 && pointInPolygon(ptLat, ptLon, zone.coords)) {
        hazardCrossings++;
        break;
      }
    }
  }

  const directDistM = marsDistanceMeters(start.lat, start.lon, end.lat, end.lon);

  const bypassedHazardNames = [];
  for (const hz of hazardZones) {
    for (let t = 0.1; t <= 0.9; t += 0.1) {
      const sLat = start.lat + (end.lat - start.lat) * t;
      const sLon = start.lon + (end.lon - start.lon) * t;
      if (marsDistanceMeters(sLat, sLon, hz.lat, hz.lon) <= hz.radiusMeters) {
        bypassedHazardNames.push(hz.name);
        break;
      }
    }
  }

  const elevValues = elevProfile.map((p) => p.elev);
  const minElevationM = Math.min(...elevValues);
  const maxElevationM = Math.max(...elevValues);
  let elevGainM = 0;
  for (let i = 1; i < elevValues.length; i++) {
    if (elevValues[i] > elevValues[i - 1]) {
      elevGainM += elevValues[i] - elevValues[i - 1];
    }
  }

  const distKm = totalDistM / 1000;
  const effectiveSpeed =
    weather.id === 'dust_storm' ? loadout.speedKmh * 0.65 : loadout.speedKmh;
  const durationHours = distKm / effectiveSpeed;
  const durationMin = Math.round(durationHours * 60);

  const slopeFactor = 1 + maxSlopeAlongPath / 30;
  const o2LitersUsed = Math.round(
    durationMin * loadout.o2RateLpm * slopeFactor * weather.tempMultiplier
  );
  const o2PercentUsed = Number(
    ((o2LitersUsed / SUIT_O2_CAPACITY_LITERS) * 100).toFixed(1)
  );
  const batteryPercentUsed = Number(
    (distKm * loadout.batteryDrainPerKm * slopeFactor * weather.tempMultiplier).toFixed(1)
  );

  const radiationDoseMgy = Number((durationHours * weather.radRateMgyHr).toFixed(3));

  const result = {
    pathCoords,
    elevProfile,
    minElevationM: Number(minElevationM.toFixed(1)),
    maxElevationM: Number(maxElevationM.toFixed(1)),
    elevGainM: Number(elevGainM.toFixed(1)),
    hazardCrossings,
    distKm: Number(distKm.toFixed(2)),
    directDistKm: Number((directDistM / 1000).toFixed(2)),
    durationMin,
    o2LitersUsed,
    o2PercentUsed,
    batteryPercentUsed,
    maxSlopeAlongPath: Number(maxSlopeAlongPath.toFixed(1)),
    hazardsAvoided: bypassedHazardNames.length,
    bypassedHazardNames,
    radiationDoseMgy,
  };

  if (legCache.size >= MAX_LEG_CACHE_SIZE) {
    const oldestKey = legCache.keys().next().value;
    legCache.delete(oldestKey);
  }
  legCache.set(cacheKey, result);

  return result;
}

function buildNavigationSteps({ start, end, leg1, leg2, chargingStation }) {
  const steps = [];
  const bearing1 = getCompassBearing(
    start.lat,
    start.lon,
    chargingStation ? chargingStation.lat : end.lat,
    chargingStation ? chargingStation.lon : end.lon
  );

  const startLabel = (start?.name || `Point (${Number(start.lat).toFixed(4)}, ${Number(start.lon).toFixed(4)})`).toUpperCase();
  const endLabel = (end?.name || `Point (${Number(end.lat).toFixed(4)}, ${Number(end.lon).toFixed(4)})`).toUpperCase();

  steps.push({
    id: 'depart',
    icon: 'start',
    instruction: `DEPART ${startLabel} HDG ${bearing1}`,
    distanceKm: leg1.distKm,
    detail: `PLSS & power check nominal (${leg1.durationMin} min leg).`,
    warning: null,
  });

  if (leg1.bypassedHazardNames.length > 0) {
    steps.push({
      id: 'hazard-1',
      icon: 'hazard',
      instruction: `DETOUR AROUND ${leg1.bypassedHazardNames.join(', ').toUpperCase()}`,
      distanceKm: null,
      detail: `A* corridor holding terrain slope <= ${leg1.maxSlopeAlongPath} deg.`,
      warning: 'HAZARD AVOIDANCE ACTIVE',
    });
  }

  if (chargingStation && leg2) {
    steps.push({
      id: 'charge',
      icon: 'charge',
      instruction: `DOCK AT ${(chargingStation.name || 'CHARGING STATION').toUpperCase()} [CHARGING BASE]`,
      distanceKm: 0,
      detail: `Recharge battery to 100% and refill PLSS O2 (+15 min pit stop).`,
      warning: `${chargingStation.powerOutputKw || 25} kW KILOPOWER PAD`,
    });

    const bearing2 = getCompassBearing(
      chargingStation.lat,
      chargingStation.lon,
      end.lat,
      end.lon
    );

    steps.push({
      id: 'leg2',
      icon: 'nav',
      instruction: `PROCEED HDG ${bearing2} TOWARD ${endLabel}`,
      distanceKm: leg2.distKm,
      detail: `100% reserves restored. ${leg2.durationMin} min trek.`,
      warning: null,
    });

    if (leg2.bypassedHazardNames.length > 0) {
      steps.push({
        id: 'hazard-2',
        icon: 'hazard',
        instruction: `CIRCUMVENT ${leg2.bypassedHazardNames.join(', ').toUpperCase()}`,
        distanceKm: null,
        detail: `Safe corridor holding <= ${leg2.maxSlopeAlongPath} deg slope.`,
        warning: 'HAZARD AVOIDANCE ACTIVE',
      });
    }
  }

  steps.push({
    id: 'arrive',
    icon: 'arrive',
    instruction: `ARRIVE AT ${endLabel}`,
    distanceKm: 0,
    detail: `Elev ${end.elev != null ? end.elev : '--'} m | ${end.minerals || 'Target site'}.`,
    warning: null,
  });

  return steps;
}

export function computeMarswalkRoute({
  start,
  end,
  hazardZones,
  waypoints,
  sciencePOIs = [],
  loadoutKey = 'light',
  weatherKey = 'nominal',
  startBatteryPct = 85,
  startO2Pct = 90,
  useChargingStop = 'auto',
  customExclusionZones = [],
}) {
  const loadout = LOADOUT_PROFILES[loadoutKey] || LOADOUT_PROFILES.light;
  const weather = WEATHER_CONDITIONS[weatherKey] || WEATHER_CONDITIONS.nominal;

  const directLeg = computeSingleLeg({
    start,
    end,
    hazardZones,
    waypoints,
    loadout,
    weather,
    customExclusionZones,
  });

  const directArrivalBattery = Number((startBatteryPct - directLeg.batteryPercentUsed).toFixed(1));
  const directArrivalO2 = Number((startO2Pct - directLeg.o2PercentUsed).toFixed(1));

  const isDifferentPoint =
    (start.id && end.id && start.id !== end.id) ||
    Math.abs(start.lat - end.lat) > 1e-5 ||
    Math.abs(start.lon - end.lon) > 1e-5;

  const needsChargeStop =
    isDifferentPoint &&
    (directArrivalBattery < SAFE_RESERVE_PCT || directArrivalO2 < SAFE_RESERVE_PCT);

  const candidateStations = sciencePOIs.filter(
    (p) =>
      p.isChargingStation &&
      p.id !== start.id &&
      p.id !== end.id &&
      (Math.abs(p.lat - start.lat) > 1e-4 || Math.abs(p.lon - start.lon) > 1e-4) &&
      (Math.abs(p.lat - end.lat) > 1e-4 || Math.abs(p.lon - end.lon) > 1e-4)
  );

  let bestPitStopPlan = null;
  if (isDifferentPoint && candidateStations.length > 0) {
    for (const station of candidateStations) {
      const leg1 = computeSingleLeg({
        start,
        end: station,
        hazardZones,
        waypoints,
        loadout,
        weather,
        customExclusionZones,
      });
      const arrStationBat = Number((startBatteryPct - leg1.batteryPercentUsed).toFixed(1));
      const arrStationO2 = Number((startO2Pct - leg1.o2PercentUsed).toFixed(1));

      if (arrStationBat >= 5 && arrStationO2 >= 5) {
        const leg2 = computeSingleLeg({
          start: station,
          end,
          hazardZones,
          waypoints,
          loadout,
          weather,
          customExclusionZones,
        });
        const arrEndBat = Number((100 - leg2.batteryPercentUsed).toFixed(1));
        const arrEndO2 = Number((100 - leg2.o2PercentUsed).toFixed(1));
        const totalCombinedKm = leg1.distKm + leg2.distKm;

        if (arrEndBat >= 5 && arrEndO2 >= 5) {
          if (!bestPitStopPlan || totalCombinedKm < bestPitStopPlan.totalCombinedKm) {
            bestPitStopPlan = {
              station,
              leg1,
              leg2,
              arrStationBat,
              arrStationO2,
              arrEndBat,
              arrEndO2,
              totalCombinedKm,
            };
          }
        }
      }
    }
  }

  const shouldUseChargingStop =
    bestPitStopPlan !== null &&
    (useChargingStop === true || (useChargingStop === 'auto' && needsChargeStop));

  if (shouldUseChargingStop && bestPitStopPlan) {
    const { station, leg1, leg2, arrStationBat, arrStationO2, arrEndBat, arrEndO2 } = bestPitStopPlan;
    const combinedPath = [...leg1.pathCoords, ...leg2.pathCoords.slice(1)];
    const leg1EndDist = leg1.elevProfile[leg1.elevProfile.length - 1]?.distKm || 0;
    const combinedElevProfile = [
      ...leg1.elevProfile,
      ...leg2.elevProfile.slice(1).map((p) => ({
        ...p,
        distKm: Number((leg1EndDist + p.distKm).toFixed(3)),
      })),
    ];
    const pitStopIndex = leg1.pathCoords.length - 1;
    const chargeDwellMin = 15;

    const totalDistKm = Number((leg1.distKm + leg2.distKm).toFixed(2));
    const totalDurationMin = leg1.durationMin + leg2.durationMin + chargeDwellMin;
    const totalO2Liters = leg1.o2LitersUsed + leg2.o2LitersUsed;
    const maxSlope = Math.max(leg1.maxSlopeAlongPath, leg2.maxSlopeAlongPath);
    const totalRad = Number((leg1.radiationDoseMgy + leg2.radiationDoseMgy).toFixed(3));
    const roundTripMin = totalDurationMin;
    const safeMarginMin = 300 - totalDurationMin;
    const minElevationM = Math.min(leg1.minElevationM, leg2.minElevationM);
    const maxElevationM = Math.max(leg1.maxElevationM, leg2.maxElevationM);
    const elevGainM = Number((leg1.elevGainM + leg2.elevGainM).toFixed(1));
    const hazardCrossings = leg1.hazardCrossings + leg2.hazardCrossings;
    const viabilityScore = Math.max(
      0,
      Math.min(100, Math.round(100 - hazardCrossings * 25 - (maxSlope > loadout.maxSlopeDeg ? 30 : 0)))
    );

    return {
      pathCoords: combinedPath,
      elevProfile: combinedElevProfile,
      minElevationM,
      maxElevationM,
      elevGainM,
      hazardCrossings,
      viabilityScore,
      leg1Coords: leg1.pathCoords,
      leg2Coords: leg2.pathCoords,
      directCoords: [
        [start.lat, start.lon],
        [end.lat, end.lon],
      ],
      distKm: totalDistKm,
      directDistKm: directLeg.directDistKm,
      durationMin: totalDurationMin,
      roundTripMin,
      o2ConsumedLiters: totalO2Liters,
      suitO2TankPercent: Math.round(leg2.o2PercentUsed),
      batteryUsedTotalPct: Number((leg1.batteryPercentUsed + leg2.batteryPercentUsed).toFixed(1)),
      directArrivalBattery,
      directArrivalO2,
      finalArrivalBattery: arrEndBat,
      finalArrivalO2: arrEndO2,
      maxSlopeAlongPath: maxSlope,
      radiationDoseMgy: totalRad,
      hazardsAvoided: leg1.hazardsAvoided + leg2.hazardsAvoided,
      safeMarginMin,
      needsChargeStop,
      rangeStatus: 'recharged_ok',
      chargingStop: {
        station,
        leg1Stats: leg1,
        leg2Stats: leg2,
        arrivalAtStationBattery: arrStationBat,
        arrivalAtStationO2: arrStationO2,
        chargeDwellMin,
        pitStopIndex,
      },
      pitStopIndex,
      isFeasible:
        weather.evaAllowed &&
        arrEndBat >= SAFE_RESERVE_PCT &&
        arrEndO2 >= SAFE_RESERVE_PCT &&
        safeMarginMin > 0,
      navigationSteps: buildNavigationSteps({
        start,
        end,
        leg1,
        leg2,
        chargingStation: station,
      }),
    };
  }

  const canReachDirectly =
    directArrivalBattery >= SAFE_RESERVE_PCT && directArrivalO2 >= SAFE_RESERVE_PCT;
  const roundTripMin = directLeg.durationMin * 2;
  const safeMarginMin = 300 - roundTripMin;

  let rangeStatus = 'direct_clear';
  if (!canReachDirectly) {
    rangeStatus = 'out_of_range';
  }

  const viabilityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (canReachDirectly ? 100 : 45) -
          directLeg.hazardCrossings * 25 -
          (directLeg.maxSlopeAlongPath > loadout.maxSlopeDeg ? 30 : 0)
      )
    )
  );

  return {
    pathCoords: directLeg.pathCoords,
    elevProfile: directLeg.elevProfile,
    minElevationM: directLeg.minElevationM,
    maxElevationM: directLeg.maxElevationM,
    elevGainM: directLeg.elevGainM,
    hazardCrossings: directLeg.hazardCrossings,
    viabilityScore,
    leg1Coords: directLeg.pathCoords,
    leg2Coords: null,
    directCoords: [
      [start.lat, start.lon],
      [end.lat, end.lon],
    ],
    distKm: directLeg.distKm,
    directDistKm: directLeg.directDistKm,
    durationMin: directLeg.durationMin,
    roundTripMin,
    o2ConsumedLiters: directLeg.o2LitersUsed,
    suitO2TankPercent: Math.min(100, Math.round(directLeg.o2PercentUsed)),
    batteryUsedTotalPct: directLeg.batteryPercentUsed,
    directArrivalBattery,
    directArrivalO2,
    finalArrivalBattery: directArrivalBattery,
    finalArrivalO2: directArrivalO2,
    maxSlopeAlongPath: directLeg.maxSlopeAlongPath,
    radiationDoseMgy: directLeg.radiationDoseMgy,
    hazardsAvoided: directLeg.hazardsAvoided,
    safeMarginMin,
    needsChargeStop,
    rangeStatus,
    chargingStop: null,
    pitStopIndex: null,
    canOfferStation: bestPitStopPlan ? bestPitStopPlan.station : null,
    isFeasible: weather.evaAllowed && canReachDirectly && safeMarginMin > 0,
    navigationSteps: buildNavigationSteps({
      start,
      end,
      leg1: directLeg,
      leg2: null,
      chargingStation: null,
    }),
  };
}
