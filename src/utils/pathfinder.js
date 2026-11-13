/**
 * ARES-EVA A* Terrain Pathfinder, Range Analyzer & Charging Pit-Stop Engine
 * Computes obstacle-avoiding Marswalk routes over Jezero Crater using
 * real elevation/tilt data, hazard polygons, battery/O2 limits, and virtual charging stations.
 */

export const SAFE_RESERVE_PCT = 15;
export const SUIT_O2_CAPACITY_LITERS = 480;

export const LOADOUT_PROFILES = {
  light: {
    id: 'light',
    name: 'Light Recon (Solo)',
    speedKmh: 2.0,
    maxSlopeDeg: 18,
    o2RateLpm: 0.85,
    batteryDrainPerKm: 11.5,
    suitMassKg: 115,
    description: 'Standard xEMU suit. High agility, limited sample capacity.',
  },
  heavy: {
    id: 'heavy',
    name: 'Heavy Sample Kit',
    speedKmh: 1.3,
    maxSlopeDeg: 12,
    o2RateLpm: 1.25,
    batteryDrainPerKm: 16.5,
    suitMassKg: 155,
    description: 'Carrying core drill & sample cache. Avoids >12° slopes & loose sand.',
  },
  rover: {
    id: 'rover',
    name: 'Rover-Assisted EVA',
    speedKmh: 2.6,
    maxSlopeDeg: 21,
    o2RateLpm: 0.70,
    batteryDrainPerKm: 9.0,
    suitMassKg: 115,
    description: 'Uncrewed mule carries payload; tether enables steeper ridge climbs.',
  },
};

export const WEATHER_CONDITIONS = {
  nominal: {
    id: 'nominal',
    label: 'Nominal Sol',
    radRateMgyHr: 0.011,
    tempMultiplier: 1.0,
    visibilityKm: 25,
    dustTau: 0.45,
    evaAllowed: true,
    alert: null,
  },
  dust_storm: {
    id: 'dust_storm',
    label: 'Regional Dust Storm',
    radRateMgyHr: 0.009,
    tempMultiplier: 1.35, // colder daytime highs due to blocked sun
    visibilityKm: 0.4,
    dustTau: 3.8,
    evaAllowed: false,
    alert: 'DUST STORM WARNING: Visibility <400m. Return to nearest Hab immediately.',
  },
  solar_storm: {
    id: 'solar_storm',
    label: 'Solar Particle Event (SPE)',
    radRateMgyHr: 0.85, // 75x radiation spike
    tempMultiplier: 1.0,
    visibilityKm: 25,
    dustTau: 0.45,
    evaAllowed: false,
    alert: 'RADIATION ALERT: SPE detected. Seek pressurized shelter within 45 min.',
  },
};

const BOUNDS = {
  minLat: 18.415,
  maxLat: 18.502,
  minLon: 77.215,
  maxLon: 77.468,
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

function latLonToGrid(lat, lon) {
  const r = Math.min(
    GRID_ROWS - 1,
    Math.max(0, Math.round(((lat - BOUNDS.minLat) / (BOUNDS.maxLat - BOUNDS.minLat)) * (GRID_ROWS - 1)))
  );
  const c = Math.min(
    GRID_COLS - 1,
    Math.max(0, Math.round(((lon - BOUNDS.minLon) / (BOUNDS.maxLon - BOUNDS.minLon)) * (GRID_COLS - 1)))
  );
  return { r, c };
}

function gridToLatLon(r, c) {
  const lat = BOUNDS.minLat + (r / (GRID_ROWS - 1)) * (BOUNDS.maxLat - BOUNDS.minLat);
  const lon = BOUNDS.minLon + (c / (GRID_COLS - 1)) * (BOUNDS.maxLon - BOUNDS.minLon);
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
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const rLat1 = (lat1 * Math.PI) / 180;
  const rLat2 = (lat2 * Math.PI) / 180;
  const y = Math.sin(dLon) * Math.cos(rLat2);
  const x =
    Math.cos(rLat1) * Math.sin(rLat2) -
    Math.sin(rLat1) * Math.cos(rLat2) * Math.cos(dLon);
  const brng = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const dirs = ['North', 'Northeast', 'East', 'Southeast', 'South', 'Southwest', 'West', 'Northwest'];
  return dirs[Math.round(brng / 45) % 8];
}

function getCellHazardPenalty(lat, lon, hazardZones, loadout, waypoints) {
  let penalty = 1.0;
  let localSlope = 3.5; // gentle baseline crater floor

  // Check proximity to real Perseverance waypoints to inherit real tilt/slope
  for (let i = 0; i < waypoints.length; i += 4) {
    const wp = waypoints[i];
    const d = Math.abs(wp.lat - lat) + Math.abs(wp.lon - lon);
    if (d < 0.004) {
      localSlope = Math.max(localSlope, wp.tilt || 3.5);
    }
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
 * Runs A* search for a single leg from `start` to `end`
 */
export function computeSingleLeg({
  start,
  end,
  hazardZones,
  waypoints,
  loadout,
  weather,
}) {
  const startCell = latLonToGrid(start.lat, start.lon);
  const endCell = latLonToGrid(end.lat, end.lon);

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
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [-1, 1], [1, -1], [1, 1],
  ];

  let found = false;
  let iterations = 0;

  while (openSet.size > 0 && iterations < 8000) {
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
    const [cLat, cLon] = gridToLatLon(cr, cc);

    for (const [dr, dc] of dirs) {
      const nr = cr + dr;
      const nc = cc + dc;
      if (nr < 0 || nr >= GRID_ROWS || nc < 0 || nc >= GRID_COLS) continue;

      const nk = key(nr, nc);
      const [nLat, nLon] = gridToLatLon(nr, nc);
      const stepDist = marsDistanceMeters(cLat, cLon, nLat, nLon);

      let meta = cellMeta.get(nk);
      if (!meta) {
        meta = getCellHazardPenalty(nLat, nLon, hazardZones, loadout, waypoints);
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
      const [lat, lon] = gridToLatLon(r, c);
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
  for (let i = 1; i < pathCoords.length; i++) {
    totalDistM += marsDistanceMeters(
      pathCoords[i - 1][0],
      pathCoords[i - 1][1],
      pathCoords[i][0],
      pathCoords[i][1]
    );
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

  return {
    pathCoords,
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
}

function buildNavigationSteps({ start, end, leg1, leg2, chargingStation }) {
  const steps = [];
  const bearing1 = getCompassBearing(
    start.lat,
    start.lon,
    chargingStation ? chargingStation.lat : end.lat,
    chargingStation ? chargingStation.lon : end.lon
  );

  steps.push({
    id: 'depart',
    icon: 'start',
    instruction: `Depart ${start.name} heading ${bearing1}`,
    distanceKm: leg1.distKm,
    detail: `PLSS & battery pre-check complete (${leg1.durationMin} min leg).`,
    warning: null,
  });

  if (leg1.bypassedHazardNames.length > 0) {
    steps.push({
      id: 'hazard-1',
      icon: 'hazard',
      instruction: `Detour around ${leg1.bypassedHazardNames.join(', ')}`,
      distanceKm: null,
      detail: `A* corridor keeps terrain slope ≤ ${leg1.maxSlopeAlongPath}°.`,
      warning: 'Hazard Avoidance Active',
    });
  }

  if (chargingStation && leg2) {
    steps.push({
      id: 'charge',
      icon: 'charge',
      instruction: `Dock at ${chargingStation.name} (Virtual Base)`,
      distanceKm: 0,
      detail: `Fast-charge suit/rover battery to 100% & refill O2 (+15 min pit stop).`,
      warning: `${chargingStation.powerOutputKw || 25} kW KILOPOWER Pad`,
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
      instruction: `Resume ${bearing2} toward ${end.name}`,
      distanceKm: leg2.distKm,
      detail: `Fresh 100% reserves • ${leg2.durationMin} min trek.`,
      warning: null,
    });

    if (leg2.bypassedHazardNames.length > 0) {
      steps.push({
        id: 'hazard-2',
        icon: 'hazard',
        instruction: `Circumvent ${leg2.bypassedHazardNames.join(', ')}`,
        distanceKm: null,
        detail: `Safe ridge corridor holding ≤ ${leg2.maxSlopeAlongPath}° slope.`,
        warning: 'Hazard Avoidance Active',
      });
    }
  }

  steps.push({
    id: 'arrive',
    icon: 'arrive',
    instruction: `Arrive at ${end.name}`,
    distanceKm: 0,
    detail: `Elev ${end.elev} m • ${end.minerals || 'Target site'}.`,
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
}) {
  const loadout = LOADOUT_PROFILES[loadoutKey] || LOADOUT_PROFILES.light;
  const weather = WEATHER_CONDITIONS[weatherKey] || WEATHER_CONDITIONS.nominal;

  // 1. Compute direct A* route (start -> end)
  const directLeg = computeSingleLeg({
    start,
    end,
    hazardZones,
    waypoints,
    loadout,
    weather,
  });

  const directArrivalBattery = Number((startBatteryPct - directLeg.batteryPercentUsed).toFixed(1));
  const directArrivalO2 = Number((startO2Pct - directLeg.o2PercentUsed).toFixed(1));

  const needsChargeStop =
    start.id !== end.id &&
    (directArrivalBattery < SAFE_RESERVE_PCT || directArrivalO2 < SAFE_RESERVE_PCT);

  // 2. Evaluate best intermediate Virtual Base Charging Station
  const candidateStations = sciencePOIs.filter(
    (p) => p.isChargingStation && p.id !== start.id && p.id !== end.id
  );

  let bestPitStopPlan = null;
  if (start.id !== end.id && candidateStations.length > 0) {
    for (const station of candidateStations) {
      const leg1 = computeSingleLeg({
        start,
        end: station,
        hazardZones,
        waypoints,
        loadout,
        weather,
      });
      const arrStationBat = Number((startBatteryPct - leg1.batteryPercentUsed).toFixed(1));
      const arrStationO2 = Number((startO2Pct - leg1.o2PercentUsed).toFixed(1));

      // Can the astronaut safely reach this charging station? (Needs >= 5% emergency buffer)
      if (arrStationBat >= 5 && arrStationO2 >= 5) {
        const leg2 = computeSingleLeg({
          start: station,
          end,
          hazardZones,
          waypoints,
          loadout,
          weather,
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
    const pitStopIndex = leg1.pathCoords.length - 1;
    const chargeDwellMin = 15;

    const totalDistKm = Number((leg1.distKm + leg2.distKm).toFixed(2));
    const totalDurationMin = leg1.durationMin + leg2.durationMin + chargeDwellMin;
    const totalO2Liters = leg1.o2LitersUsed + leg2.o2LitersUsed;
    const maxSlope = Math.max(leg1.maxSlopeAlongPath, leg2.maxSlopeAlongPath);
    const totalRad = Number((leg1.radiationDoseMgy + leg2.radiationDoseMgy).toFixed(3));
    const roundTripMin = totalDurationMin; // already includes waypoint recharge
    const safeMarginMin = 300 - totalDurationMin;

    return {
      pathCoords: combinedPath,
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
      isFeasible: weather.evaAllowed && arrEndBat >= SAFE_RESERVE_PCT && arrEndO2 >= SAFE_RESERVE_PCT && safeMarginMin > 0,
      navigationSteps: buildNavigationSteps({
        start,
        end,
        leg1,
        leg2,
        chargingStation: station,
      }),
    };
  }

  // Otherwise use Direct A* Leg
  const canReachDirectly =
    directArrivalBattery >= SAFE_RESERVE_PCT && directArrivalO2 >= SAFE_RESERVE_PCT;
  const roundTripMin = directLeg.durationMin * 2;
  const safeMarginMin = 300 - roundTripMin;

  let rangeStatus = 'direct_clear';
  if (!canReachDirectly) {
    rangeStatus = 'out_of_range';
  }

  return {
    pathCoords: directLeg.pathCoords,
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
    isFeasible:
      weather.evaAllowed &&
      canReachDirectly &&
      safeMarginMin > 0,
    navigationSteps: buildNavigationSteps({
      start,
      end,
      leg1: directLeg,
      leg2: null,
      chargingStation: null,
    }),
  };
}
