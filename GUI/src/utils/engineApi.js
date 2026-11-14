/**
 * Dalil-Mars Tactical Engine API Client & Response Adapter
 * Connects the React GUI to the FastAPI backend running backend/core/engine.py.
 */

import { LOADOUT_PROFILES, SAFE_RESERVE_PCT, WEATHER_CONDITIONS } from './pathfinder';

const API_BASE = '/api';

async function postJson(path, body, signal) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Engine API ${path} failed (${res.status}): ${errText}`);
  }
  return res.json();
}

async function getJson(path, signal) {
  const res = await fetch(`${API_BASE}${path}`, { signal });
  if (!res.ok) {
    const errText = await res.text().catch(() => res.statusText);
    throw new Error(`Engine API ${path} failed (${res.status}): ${errText}`);
  }
  return res.json();
}

export async function getEngineStatusApi(signal) {
  return getJson('/engine/status', signal);
}

export async function planRouteApi(params, signal) {
  return postJson('/route/plan', params, signal);
}

export async function planEmergencyAbortApi(params, signal) {
  return postJson('/route/abort', params, signal);
}

export async function planScienceTourApi(params, signal) {
  return postJson('/route/science-tour', params, signal);
}

export async function findOptimalDepartureApi(params, signal) {
  return postJson('/route/optimal-departure', params, signal);
}

export async function predictTelemetryApi(params, signal) {
  return postJson('/telemetry/predict', params, signal);
}

export async function evaluateRfCommsApi(params, signal) {
  return postJson('/comms/evaluate', params, signal);
}

/**
 * Converts GeoJSON [lon, lat] coordinates from engine.py to Leaflet [lat, lon] tuples.
 */
function toLatLonCoords(coords = []) {
  return coords.map((pt) => [pt[1], pt[0]]);
}

/**
 * Adapts engine.py's plan_route() JSON payload into the routeResult shape
 * expected by App.jsx and JezeroTacticalMap.jsx, while preserving rich engine telemetry.
 */
export function adaptEngineRouteToGui(
  engineRes,
  {
    start,
    end,
    loadoutKey = 'light',
    weatherKey = 'nominal',
    startBatteryPct = 85,
    startO2Pct = 90,
  } = {}
) {
  const loadout = LOADOUT_PROFILES[loadoutKey] || LOADOUT_PROFILES.light;
  const weather = WEATHER_CONDITIONS[weatherKey] || WEATHER_CONDITIONS.nominal;

  const legs = engineRes.legs || [];
  const leg1 = legs[0] || null;
  const leg2 = legs[1] || null;

  const pathCoords = toLatLonCoords(engineRes.path_coords || engineRes.path_coordinates || []);
  const leg1Coords = leg1 ? toLatLonCoords(leg1.path_coords || []) : pathCoords;
  const leg2Coords = leg2 ? toLatLonCoords(leg2.path_coords || []) : null;

  const pitStopIndex = leg2 && leg1Coords.length > 0 ? leg1Coords.length - 1 : null;

  const telemetry = engineRes.telemetry_profile || [];
  const elevProfile =
    telemetry.length > 0
      ? telemetry.map((pt) => ({
          distKm: Number((pt.dist_km ?? 0).toFixed(3)),
          elev: Number((pt.elevation_m ?? pt.elev_m ?? -2500).toFixed(1)),
          lat: pt.lat,
          lon: pt.lon,
          slopeDeg: pt.slope_deg ?? 0,
          isShadowed: Boolean(pt.is_shadowed),
          commsStatus: pt.comms_status || 'DIRECT_HAB_LINK',
          isBeyondHorizon: Boolean(pt.is_beyond_horizon),
        }))
      : pathCoords.map((pt, i) => ({
          distKm: Number(((i / Math.max(1, pathCoords.length - 1)) * (engineRes.total_dist_km || 0)).toFixed(3)),
          elev: -2500,
          lat: pt[0],
          lon: pt[1],
        }));

  const elevValues = elevProfile.map((p) => p.elev);
  const minElevationM = elevValues.length ? Math.round(Math.min(...elevValues)) : -2500;
  const maxElevationM = elevValues.length ? Math.round(Math.max(...elevValues)) : -2500;

  const finalArrivalBattery = Number((engineRes.battery_remaining_pct ?? startBatteryPct).toFixed(1));
  const finalArrivalO2 = Number((engineRes.o2_remaining_pct ?? startO2Pct).toFixed(1));
  const maxSlopeAlongPath = Number((engineRes.max_slope_deg ?? 0).toFixed(1));

  const station = engineRes.charging_station || null;
  const chargingStop =
    station && leg1 && leg2
      ? {
          station,
          leg1Stats: {
            distKm: Number((leg1.dist_km ?? 0).toFixed(2)),
            durationMin: leg1.duration_min ?? 0,
            batteryPercentUsed: Number((leg1.battery_used_pct ?? 0).toFixed(1)),
            o2PercentUsed: Number((leg1.o2_used_pct ?? 0).toFixed(1)),
          },
          leg2Stats: {
            distKm: Number((leg2.dist_km ?? 0).toFixed(2)),
            durationMin: leg2.duration_min ?? 0,
            batteryPercentUsed: Number((leg2.battery_used_pct ?? 0).toFixed(1)),
            o2PercentUsed: Number((leg2.o2_used_pct ?? 0).toFixed(1)),
          },
          arrivalAtStationBattery: Number((startBatteryPct - (leg1.battery_used_pct ?? 0)).toFixed(1)),
          arrivalAtStationO2: Number((startO2Pct - (leg1.o2_used_pct ?? 0)).toFixed(1)),
          chargeDwellMin: engineRes.charging_pitstop?.recharge_duration_min ?? 15,
          pitStopIndex,
        }
      : null;

  const isOutOfRange =
    engineRes.status === 'OUT_OF_RANGE' ||
    finalArrivalBattery < SAFE_RESERVE_PCT ||
    finalArrivalO2 < SAFE_RESERVE_PCT;

  const rangeStatus = chargingStop ? 'recharged_ok' : isOutOfRange ? 'out_of_range' : 'direct_clear';

  const durationMin = engineRes.duration_min ?? engineRes.estimated_duration_min ?? 0;
  const roundTripMin = chargingStop ? durationMin : durationMin * 2;
  const safeMarginMin = 300 - roundTripMin;

  const redAvoided = legs.reduce((acc, l) => acc + (l.red_nodes_avoided || 0), 0);
  const walkback = engineRes.summary?.walkback_horizon || null;
  const rfComms = engineRes.summary?.rf_comms || null;

  const viabilityScore = Math.max(
    0,
    Math.min(
      100,
      Math.round(
        (isOutOfRange ? 45 : 100) -
          (maxSlopeAlongPath > loadout.maxSlopeDeg ? 30 : 0) -
          (walkback && walkback.status !== 'SAFE_HORIZON_MAINTAINED' ? 15 : 0)
      )
    )
  );

  return {
    source: 'dalil_engine',
    engineStatus: engineRes.status,
    pathCoords,
    elevProfile,
    minElevationM,
    maxElevationM,
    elevGainM: Number((engineRes.elevation_gain_m ?? 0).toFixed(1)),
    elevLossM: Number((engineRes.elevation_loss_m ?? 0).toFixed(1)),
    hazardCrossings: 0,
    viabilityScore,
    leg1Coords,
    leg2Coords,
    directCoords:
      start && end
        ? [
            [start.lat, start.lon],
            [end.lat, end.lon],
          ]
        : pathCoords.length >= 2
          ? [pathCoords[0], pathCoords[pathCoords.length - 1]]
          : [],
    distKm: Number((engineRes.total_dist_km ?? 0).toFixed(2)),
    directDistKm: Number((engineRes.direct_km ?? engineRes.total_dist_km ?? 0).toFixed(2)),
    durationMin,
    roundTripMin,
    o2ConsumedLiters: Math.round(((engineRes.o2_used_pct ?? 0) / 100) * 480),
    suitO2TankPercent: Math.min(100, Math.round(engineRes.o2_used_pct ?? 0)),
    batteryUsedTotalPct: Number((engineRes.battery_used_pct ?? 0).toFixed(1)),
    directArrivalBattery: finalArrivalBattery,
    directArrivalO2: finalArrivalO2,
    finalArrivalBattery,
    finalArrivalO2,
    maxSlopeAlongPath,
    radiationDoseMgy: Number((engineRes.radiation_dose_mgy ?? 0).toFixed(3)),
    hazardsAvoided: redAvoided,
    safeMarginMin,
    needsChargeStop: Boolean(chargingStop) || isOutOfRange,
    rangeStatus,
    chargingStop,
    pitStopIndex,
    canOfferStation: station,
    isFeasible: Boolean(weather.evaAllowed && !isOutOfRange && safeMarginMin > 0),
    navigationSteps: engineRes.navigation_steps || [],
    // Rich Dalil-Mars Engine Telemetry
    solarContext: engineRes.solar_context || null,
    rfComms,
    walkbackHorizon: walkback,
    advisories: engineRes.advisories || null,
    geojson: engineRes.geojson || null,
  };
}
