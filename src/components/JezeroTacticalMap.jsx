import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

export default function JezeroTacticalMap({
  waypoints,
  sciencePOIs,
  hazardZones,
  layers,
  routeResult,
  startPOI,
  endPOI,
  showDirectComparison,
  weatherCondition,
  liveNavState,
  followAstronaut = false,
  locatePulse = null,
  dustFrontState = null,
  solarPhase = 'day',
  astronautLocId = 'hab-alpha',
  basemap = 'satellite',
  reliefBlend = 0.3,
  landmarks = [],
  onSelectPOI,
  onSelectWaypointSol,
  onOpenPanorama,
  onNavigateToPOI,
  onSetOrigin,
  onSelectLandmark,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layerGroupsRef = useRef({});
  const liveMarkerRef = useRef(null);
  const basemapOverlayRef = useRef(null);
  const reliefOverlayRef = useRef(null);

  const REGIONAL_BOUNDS = [[17.7000, 76.7980], [18.7013, 77.8009]];

  // Global dispatcher for popup button clicks
  useEffect(() => {
    window.dispatchMarsPano = (sol) => {
      onOpenPanorama?.(sol);
    };
    window.dispatchNavigateTo = (poiId) => {
      mapInstanceRef.current?.closePopup();
      onNavigateToPOI?.(poiId);
    };
    window.dispatchSetOrigin = (poiId) => {
      mapInstanceRef.current?.closePopup();
      onSetOrigin?.(poiId);
    };
    window.dispatchOpenLandmark = (landmarkId) => {
      mapInstanceRef.current?.closePopup();
      const match = landmarks.find(
        (l) => l.id === landmarkId || l.id.replace(/_/g, '-') === landmarkId.replace(/_/g, '-')
      );
      if (match) {
        onSelectLandmark?.(match);
      } else {
        onSelectLandmark?.(landmarkId);
      }
    };
    return () => {
      delete window.dispatchMarsPano;
      delete window.dispatchNavigateTo;
      delete window.dispatchSetOrigin;
      delete window.dispatchOpenLandmark;
    };
  }, [onOpenPanorama, onNavigateToPOI, onSetOrigin, onSelectLandmark, landmarks]);

  // Initialize Leaflet Map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return;

    const map = L.map(mapContainerRef.current, {
      center: [18.455, 77.39],
      zoom: 12,
      minZoom: 4,
      maxZoom: 16,
      zoomControl: false,
    });

    // Custom positioned Zoom Control on the right
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    const opmBasemap = L.tileLayer(
      'https://cartocdn-gusc.global.ssl.fastly.net/opmbuilder/api/v1/map/named/opm-mars-basemap-v0-2/all/{z}/{x}/{y}.png',
      {
        maxZoom: 16,
        maxNativeZoom: 14,
        attribution: 'NASA / MOLA / USGS / OpenPlanetaryMap',
      }
    );

    opmBasemap.addTo(map);

    // Basemap Image Overlay for Regional Jezero Quadrangle
    const basemapUrls = {
      satellite: '/data/ctx_mosaic_regional.png',
      terrain: '/data/hrsc_hillshade.png',
      elevation: '/data/hrsc_elevation_color.png',
      themis: '/data/themis_night_ir.png',
    };

    if (basemapUrls[basemap]) {
      basemapOverlayRef.current = L.imageOverlay(basemapUrls[basemap], REGIONAL_BOUNDS, {
        opacity: 1.0,
        zIndex: 1,
        interactive: false,
      }).addTo(map);
    }

    // Hillshade Relief Blend Overlay
    reliefOverlayRef.current = L.imageOverlay('/data/hrsc_hillshade.png', REGIONAL_BOUNDS, {
      opacity: basemap === 'satellite' ? reliefBlend : 0.0,
      zIndex: 2,
      interactive: false,
    }).addTo(map);

    layerGroupsRef.current = {
      traverse: L.layerGroup().addTo(map),
      slope: L.layerGroup().addTo(map),
      hazards: L.layerGroup().addTo(map),
      science: L.layerGroup().addTo(map),
      route: L.layerGroup().addTo(map),
      dustFront: L.layerGroup().addTo(map),
      landmarks: L.layerGroup().addTo(map),
    };

    mapInstanceRef.current = map;

    return () => {
      if (liveMarkerRef.current) {
        liveMarkerRef.current.remove();
        liveMarkerRef.current = null;
      }
      if (basemapOverlayRef.current) {
        basemapOverlayRef.current.remove();
        basemapOverlayRef.current = null;
      }
      if (reliefOverlayRef.current) {
        reliefOverlayRef.current.remove();
        reliefOverlayRef.current = null;
      }
      map.remove();
      mapInstanceRef.current = null;
    };
  }, []);

  // Update Basemap & Regional Image Overlays dynamically
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const basemapUrls = {
      satellite: '/data/ctx_mosaic_regional.png',
      terrain: '/data/hrsc_hillshade.png',
      elevation: '/data/hrsc_elevation_color.png',
      themis: '/data/themis_night_ir.png',
    };

    if (basemapOverlayRef.current) {
      basemapOverlayRef.current.remove();
      basemapOverlayRef.current = null;
    }

    const targetUrl = basemapUrls[basemap];
    if (targetUrl) {
      basemapOverlayRef.current = L.imageOverlay(targetUrl, REGIONAL_BOUNDS, {
        opacity: 1.0,
        zIndex: 1,
        interactive: false,
      }).addTo(map);
    }

    // Set relief blend according to basemap mode
    if (reliefOverlayRef.current) {
      reliefOverlayRef.current.setOpacity(basemap === 'satellite' ? reliefBlend : 0.0);
    }
  }, [basemap, reliefBlend]);

  // Smooth Animated Fly-To Zoom when Locate / Compass Pin is Pressed!
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !locatePulse?.timestamp || !liveNavState?.currentLatLon) return;

    map.flyTo(liveNavState.currentLatLon, locatePulse.zoom || 14.5, {
      animate: true,
      duration: 1.25,
      easeLinearity: 0.25,
    });
  }, [locatePulse, liveNavState?.currentLatLon]);

  // Render Layer 1 & 4: Perseverance Traverse & Slope Heatmap
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const { traverse, slope } = layerGroupsRef.current;
    traverse.clearLayers();
    slope.clearLayers();

    if (layers.traverse && waypoints.length > 0) {
      const latlngs = waypoints.map((w) => [w.lat, w.lon]);
      L.polyline(latlngs, {
        color: '#f97316',
        weight: 2,
        opacity: 0.65,
        dashArray: '4, 6',
      }).addTo(traverse);
    }

    if (layers.slope && waypoints.length > 0) {
      for (let i = 0; i < waypoints.length; i += 2) {
        const w = waypoints[i];
        const tilt = w.tilt || 0;
        let color = '#10b981';
        if (tilt >= 14) color = '#ef4444';
        else if (tilt >= 7) color = '#f59e0b';

        const circle = L.circleMarker([w.lat, w.lon], {
          radius: tilt >= 14 ? 5 : 3.5,
          color: color,
          fillColor: color,
          fillOpacity: 0.75,
          weight: 1,
        });

        const is360Waypoint = w.sol === 3 || w.sol === 68;
        circle.bindPopup(`
          <div style="font-size:12px; min-width:180px;">
            <div style="font-weight:700; color:#fb923c; margin-bottom:4px;">Sol ${w.sol} Telemetry</div>
            <div><b>Elevation:</b> ${w.elev} m</div>
            <div><b>Measured Tilt:</b> ${tilt}°</div>
            <div><b>Drive Dist:</b> ${(w.dist_total_m / 1000).toFixed(2)} km</div>
            <button onclick="window.dispatchMarsPano(${w.sol})" style="
              margin-top:8px; width:100%; padding:6px 10px; background:${is360Waypoint ? '#06b6d4' : '#10b981'}; color:#020617;
              font-weight:800; font-size:11px; border-radius:8px; border:none; cursor:pointer;
              display:flex; align-items:center; justify-content:center; gap:4px;
            ">${is360Waypoint ? '🌐 OPEN 360° PHOTOSPHERE' : '📷 VIEW SURFACE PHOTO'}</button>
          </div>
        `);

        circle.on('click', () => {
          onSelectWaypointSol?.(w.sol);
          onOpenPanorama?.(w.sol, [w.lat, w.lon]);
        });

        circle.addTo(slope);
      }
    }
  }, [waypoints, layers.traverse, layers.slope, onSelectWaypointSol, onOpenPanorama]);

  // Render Layer 2: Hazard Zones
  useEffect(() => {
    const { hazards } = layerGroupsRef.current;
    if (!hazards) return;
    hazards.clearLayers();

    if (!layers.hazards) return;

    hazardZones.forEach((hz) => {
      const color = hz.severity === 'critical' ? '#ef4444' : hz.severity === 'high' ? '#f97316' : '#eab308';
      const circle = L.circle([hz.lat, hz.lon], {
        radius: hz.radiusMeters,
        color,
        fillColor: color,
        fillOpacity: 0.22,
        weight: 1.5,
        dashArray: '5, 5',
      });

      circle.bindPopup(`
        <div style="font-size:12px; max-width:220px;">
          <div style="font-weight:700; color:${color}; text-transform:uppercase; font-size:11px;">⚠ ${hz.severity} Terrain Hazard</div>
          <div style="font-weight:700; font-size:13px; margin:2px 0 4px;">${hz.name}</div>
          <div><b>Peak Slope:</b> ${hz.maxSlope}°</div>
          <p style="margin:4px 0 0; color:#cbd5e1; font-size:11px;">${hz.description}</p>
        </div>
      `);

      circle.addTo(hazards);
    });
  }, [hazardZones, layers.hazards]);

  // Render Layer 3: Science, ISRU & Virtual Base Charging Stations
  useEffect(() => {
    const { science } = layerGroupsRef.current;
    if (!science) return;
    science.clearLayers();

    if (!layers.science) return;

    sciencePOIs.forEach((poi) => {
      const isStart = startPOI?.id === poi.id;
      const isEnd = endPOI?.id === poi.id;
      const isStation = Boolean(poi.isChargingStation);
      const isActivePitStop = routeResult?.chargingStop?.station?.id === poi.id;

      if (isStation) {
        L.circle([poi.lat, poi.lon], {
          radius: 2500,
          color: '#10b981',
          fillColor: '#10b981',
          fillOpacity: isActivePitStop ? 0.08 : 0.03,
          weight: isActivePitStop ? 1.5 : 0.8,
          dashArray: '3, 6',
          interactive: false,
        }).addTo(science);
      }

      let bgColor = '#f59e0b';
      let iconChar = '★';
      if (poi.type === 'charging') {
        bgColor = '#22c55e';
        iconChar = '⚡';
      } else if (poi.type === 'habitat') {
        bgColor = '#06b6d4';
        iconChar = '⚡';
      } else if (poi.type === 'isru') {
        bgColor = '#10b981';
        iconChar = '💧';
      } else if (poi.type === 'resource') {
        bgColor = '#a855f7';
        iconChar = '⬡';
      }

      const ringStyle = isStart
        ? 'box-shadow: 0 0 0 3px #22d3ee, 0 0 16px #22d3ee;'
        : isEnd
        ? 'box-shadow: 0 0 0 3px #34d399, 0 0 16px #34d399;'
        : isActivePitStop
        ? 'box-shadow: 0 0 0 3px #facc15, 0 0 18px #facc15;'
        : isStation
        ? 'box-shadow: 0 0 12px rgba(34, 197, 94, 0.6);'
        : 'box-shadow: 0 2px 6px rgba(0,0,0,0.6);';

      const isCurrentLoc = poi.id === astronautLocId;

      const locBadgeHtml = isCurrentLoc
        ? `<div style="
            position:absolute; top:-20px; left:50%; transform:translateX(-50%);
            white-space:nowrap; background:#0284c7; color:#f0f9ff;
            font-size:9px; font-weight:800; padding:1px 6px; border-radius:999px;
            box-shadow:0 2px 6px rgba(0,0,0,0.8); border:1px solid #38bdf8;
          ">📍 YOU ARE HERE</div>`
        : '';

      const badgeHtml = isActivePitStop
        ? `<div style="
            position:absolute; top:-24px; left:50%; transform:translateX(-50%);
            white-space:nowrap; background:#facc15; color:#020617;
            font-size:10px; font-weight:800; padding:2px 8px; border-radius:999px;
            box-shadow:0 3px 8px rgba(0,0,0,0.7);
          ">⚡ PIT STOP: RECHARGE 100%</div>`
        : locBadgeHtml;

      const customIcon = L.divIcon({
        className: 'custom-mars-poi',
        html: `<div style="position:relative;">
          ${badgeHtml}
          <div style="
            width: ${isStation ? 32 : 28}px; height: ${isStation ? 32 : 28}px; border-radius: 50%;
            background: ${bgColor}; color: #020617;
            display: flex; align-items: center; justify-content: center;
            font-weight: 800; font-size: 14px; border: 2.5px solid #ffffff;
            ${ringStyle}
          ">${iconChar}</div>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const marker = L.marker([poi.lat, poi.lon], { icon: customIcon });
      const matchingLm = landmarks.find(
        (l) => l.id === poi.id || l.id.replace(/_/g, '-') === poi.id.replace(/_/g, '-') || (poi.id === 'hab-alpha' && l.id === 'landing_site')
      );

      marker.bindPopup(`
        <div style="font-size:12px; max-width:250px;">
          <div style="font-weight:700; color:${bgColor}; text-transform:uppercase; font-size:10px;">
            ${isStation ? `⚡ Virtual Charging Base (${poi.powerOutputKw || 25} kW)` : poi.type === 'isru' ? 'ISRU Resource Target' : 'Science Target'}
          </div>
          <div style="font-weight:700; font-size:13px; margin:2px 0 4px;">${poi.name}</div>
          <div><b>Elevation:</b> ${poi.elev} m | <b>Sol:</b> ${poi.sol}</div>
          <div><b>Composition:</b> ${poi.minerals}</div>
          ${isStation ? `<div style="margin-top:4px; color:#4ade80; font-weight:600;">⚡ Fast-Charge: 15 min to 100% Battery & O2</div>` : ''}
          <p style="margin:5px 0 0; color:#cbd5e1; font-size:11px;">${poi.description}</p>
          
          <div style="margin-top:8px; display:flex; flex-direction:column; gap:4px;">
            ${!isCurrentLoc ? `
              <button onclick="window.dispatchNavigateTo('${poi.id}')" style="
                width:100%; padding:6px 10px; background:#10b981; color:#020617;
                font-weight:800; font-size:11px; border-radius:8px; border:none; cursor:pointer;
                display:flex; align-items:center; justify-content:center; gap:4px;
              ">🎯 NAVIGATE HERE FROM CURRENT POSITION</button>
            ` : `
              <div style="
                width:100%; padding:4px 8px; background:rgba(6,182,212,0.2); color:#38bdf8;
                border:1px solid #0284c7; font-weight:700; font-size:10px; border-radius:6px; text-align:center;
              ">📍 YOU ARE CURRENTLY HERE</div>
            `}
            <button onclick="window.dispatchSetOrigin('${poi.id}')" style="
              width:100%; padding:4px 8px; background:#334155; color:#cbd5e1;
              font-weight:700; font-size:10px; border-radius:6px; border:none; cursor:pointer;
            ">📍 SET AS STARTING ORIGIN</button>
            ${matchingLm ? `
              <button onclick="window.dispatchOpenLandmark('${matchingLm.id}')" style="
                width:100%; padding:5px 8px; background:#191d24; color:#22c55e;
                border:1px solid rgba(34,197,94,0.4); font-weight:700; font-size:10px;
                border-radius:6px; cursor:pointer; font-family:monospace;
              ">📖 SCIENTIFIC DOSSIER & 5-PHOTO CAROUSEL</button>
            ` : ''}
            <button onclick="window.dispatchMarsPano('${poi.id}')" style="
              width:100%; padding:5px 8px; background:${bgColor}; color:#020617;
              font-weight:800; font-size:11px; border-radius:8px; border:none; cursor:pointer;
              display:flex; align-items:center; justify-content:center; gap:4px;
            ">${(poi.id === 'hab-alpha' || poi.id === 'seitah-ridge') ? '🌐 OPEN 360° PHOTOSPHERE' : '📷 VIEW SURFACE PHOTO'}</button>
          </div>
        </div>
      `);

      marker.on('click', () => {
        onSelectPOI?.(poi);
        onSelectWaypointSol?.(poi.sol);
      });

      marker.addTo(science);
    });
  }, [sciencePOIs, layers.science, startPOI, endPOI, routeResult?.chargingStop, astronautLocId, landmarks, onSelectPOI, onSelectWaypointSol, onOpenPanorama, onNavigateToPOI, onSetOrigin]);

  // Render Layer: Jezero Planetary Landmarks & Regional Science Dossiers
  useEffect(() => {
    const { landmarks: lmGroup } = layerGroupsRef.current;
    if (!lmGroup) return;
    lmGroup.clearLayers();

    if (layers.landmarks === false || !landmarks || landmarks.length === 0) return;

    landmarks.forEach((lm) => {
      const isCurrentLoc = lm.id === astronautLocId;
      const markerIcon = L.divIcon({
        className: 'landmark-map-pin',
        html: `
          <div style="position: relative; display: flex; align-items: center; justify-content: center; cursor: pointer;">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <circle cx="12" cy="12" r="9" stroke="#353c4a" stroke-width="1.5" fill="#13161c"/>
              <circle cx="12" cy="12" r="7.5" stroke="#edf0f5" stroke-width="1.2" fill="#191d24"/>
              <circle cx="12" cy="12" r="3" fill="#22c55e"/>
            </svg>
            <div style="
              position: absolute; top: -16px; left: 50%; transform: translateX(-50%);
              white-space: nowrap; font-family: monospace; font-size: 8.5px; font-weight: 700;
              color: #9da5b4; background: rgba(11, 13, 17, 0.85); padding: 1px 4px;
              border-radius: 3px; border: 1px solid #242933; pointer-events: none;
            ">${lm.name.length > 16 ? lm.name.slice(0, 15) + '…' : lm.name}</div>
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [12, 12],
      });

      const marker = L.marker(lm.coords, { icon: markerIcon });
      const regolith = lm.soil_regolith?.dominant_type || 'Basaltic Regolith';
      const usgsUnit = lm.usgs_unit || 'USGS SIM 3464';

      marker.bindPopup(`
        <div style="font-size:12px; max-width:270px; font-family:var(--font-sans, sans-serif); color:#edf0f5;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
            <span style="font-family:monospace; font-size:9.5px; font-weight:700; color:#22c55e; letter-spacing:0.05em; text-transform:uppercase;">
              ${lm.category || 'LANDMARK'}
            </span>
            <span style="font-family:monospace; font-size:9px; color:#656d7d;">${usgsUnit}</span>
          </div>
          <div style="font-weight:700; font-size:13px; color:#edf0f5; margin-bottom:4px; font-family:monospace;">
            ${lm.name}
          </div>
          <div style="font-size:11px; color:#9da5b4; margin-bottom:6px; line-height:1.35;">
            ${lm.brief ? lm.brief.slice(0, 130) + '…' : ''}
          </div>
          <div style="background:#191d24; border:1px solid #242933; border-radius:4px; padding:6px; font-size:10px; margin-bottom:8px; font-family:monospace;">
            <div><span style="color:#656d7d;">ELEVATION:</span> <span style="color:#edf0f5;">${lm.elevation_m} m</span></div>
            <div><span style="color:#656d7d;">COORDS:</span> <span style="color:#edf0f5;">${lm.coords[0].toFixed(4)}°N, ${lm.coords[1].toFixed(4)}°E</span></div>
            <div><span style="color:#656d7d;">REGOLITH:</span> <span style="color:#9da5b4;">${regolith}</span></div>
          </div>
          
          <div style="display:flex; flex-direction:column; gap:5px;">
            <button onclick="window.dispatchOpenLandmark('${lm.id}')" style="
              width:100%; min-height:36px; padding:6px 10px; background:#191d24; color:#22c55e;
              border:1px solid rgba(34,197,94,0.4); border-radius:4px; font-weight:700; font-size:10.5px;
              font-family:monospace; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;
            ">📖 SCIENTIFIC DOSSIER & 5-PHOTO CAROUSEL</button>
            <button onclick="window.dispatchNavigateTo('${lm.id}')" style="
              width:100%; min-height:32px; padding:5px 8px; background:#22c55e; color:#0b0d11;
              border:none; border-radius:4px; font-weight:700; font-size:10.5px;
              font-family:monospace; cursor:pointer; display:flex; align-items:center; justify-content:center; gap:6px;
            ">🎯 NAVIGATE HERE FROM POSITION</button>
          </div>
        </div>
      `);

      marker.on('click', () => {
        onSelectLandmark?.(lm);
      });

      marker.addTo(lmGroup);
    });
  }, [landmarks, layers.landmarks, astronautLocId, onSelectLandmark]);

  // Render A* Safe Marswalk Route (1-Leg or 2-Leg Recharged Route)
  useEffect(() => {
    const { route } = layerGroupsRef.current;
    if (!route) return;
    route.clearLayers();

    if (!routeResult) return;

    if (showDirectComparison && routeResult.directCoords) {
      L.polyline(routeResult.directCoords, {
        color: '#f43f5e',
        weight: 2,
        opacity: 0.65,
        dashArray: '6, 8',
      })
        .bindTooltip('Direct Line (Unplanned / High Hazard)', { sticky: true })
        .addTo(route);
    }

    if (routeResult.chargingStop && routeResult.leg1Coords && routeResult.leg2Coords) {
      L.polyline(routeResult.leg1Coords, {
        color: '#38bdf8',
        weight: 5,
        opacity: 0.95,
        lineJoin: 'round',
      })
        .bindTooltip(
          `Leg 1 to ${routeResult.chargingStop.station.name}: ${routeResult.chargingStop.leg1Stats.distKm} km`,
          { sticky: true }
        )
        .addTo(route);

      L.polyline(routeResult.leg2Coords, {
        color: '#34d399',
        weight: 5.5,
        opacity: 0.95,
        lineJoin: 'round',
      })
        .bindTooltip(
          `Leg 2 (Post-Charge 100%): ${routeResult.chargingStop.leg2Stats.distKm} km`,
          { sticky: true }
        )
        .addTo(route);
    } else {
      const routeColor =
        routeResult.rangeStatus === 'out_of_range'
          ? '#ef4444'
          : weatherCondition === 'solar_storm' || weatherCondition === 'dust_storm'
          ? '#f59e0b'
          : '#22d3ee';

      L.polyline(routeResult.pathCoords, {
        color: routeColor,
        weight: 5,
        opacity: 0.95,
        lineJoin: 'round',
      })
        .bindTooltip(
          `A* Safe Marswalk: ${routeResult.distKm} km • ${routeResult.durationMin} min`,
          { sticky: true }
        )
        .addTo(route);
    }
  }, [routeResult, showDirectComparison, weatherCondition]);

  // Render Predictive Incoming Dust Storm Front Radar & Impact Vector
  useEffect(() => {
    const { dustFront } = layerGroupsRef.current;
    if (!dustFront) return;
    dustFront.clearLayers();

    if (!dustFrontState?.active) return;

    const { lat, lon, radiusMeters = 1150, distanceAheadKm, etaMin } = dustFrontState;

    // Outer expanding radar wave ring
    L.circle([lat, lon], {
      radius: radiusMeters * 1.5,
      color: '#f97316',
      fillColor: '#ea580c',
      fillOpacity: 0.08,
      weight: 1.5,
      dashArray: '4, 8',
    }).addTo(dustFront);

    // Primary dense storm core
    L.circle([lat, lon], {
      radius: radiusMeters,
      color: '#ea580c',
      fillColor: '#c2410c',
      fillOpacity: 0.32,
      weight: 2.5,
      dashArray: '8, 6',
    }).addTo(dustFront);

    // Trajectory dashed line pointing from storm center toward astronaut's location
    if (liveNavState?.currentLatLon) {
      L.polyline([[lat, lon], liveNavState.currentLatLon], {
        color: '#f97316',
        weight: 2,
        dashArray: '5, 8',
        opacity: 0.7,
      }).addTo(dustFront);
    }

    const stormBadge = L.divIcon({
      className: 'dust-storm-radar-badge',
      html: `<div style="
        transform: translate(-50%, -50%);
        white-space: nowrap;
        background: rgba(124, 45, 18, 0.95);
        color: #ffedd5;
        border: 2px solid #fb923c;
        padding: 4px 10px;
        border-radius: 999px;
        font-size: 11px;
        font-weight: 800;
        font-family: monospace;
        box-shadow: 0 0 20px rgba(249, 115, 22, 0.75);
      ">🌪 DUST SQUALL: ${distanceAheadKm} KM AHEAD • IMPACT IN ${etaMin}M</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });

    L.marker([lat, lon], { icon: stormBadge, interactive: false }).addTo(dustFront);
  }, [dustFrontState, liveNavState?.currentLatLon]);

  // Google Maps Android-Style Live Astronaut Navigation Arrow & Directional Beam Cone
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    if (!liveNavState?.currentLatLon) {
      if (liveMarkerRef.current) {
        liveMarkerRef.current.remove();
        liveMarkerRef.current = null;
      }
      return;
    }

    const { currentLatLon, heading = 0, currentBattery = 85, isRecharging, active } = liveNavState;
    const arrowColor = isRecharging
      ? '#22c55e'
      : currentBattery < 20
      ? '#ef4444'
      : '#0284c7'; // Google Maps blue navigation arrow!

    const pillBg = isRecharging
      ? 'background: #15803d; color: #f0fdf4;'
      : currentBattery < 20
      ? 'background: #b91c1c; color: #fef2f2;'
      : 'background: rgba(15, 23, 42, 0.92); color: #38bdf8;';

    // Show high-impact radar wave animation when locatePulse is active!
    const showLocatingRadar = Boolean(locatePulse?.showWave);

    const puckHtml = `
      <div class="google-maps-astronaut-puck">
        <!-- High-Impact Locating Radar Ring when Pin is Clicked -->
        ${showLocatingRadar ? '<div class="locating-radar-wave"></div>' : ''}

        <!-- Floating Status Pill above Navigation Arrow -->
        <div style="
          position: absolute; top: -30px; left: 50%; transform: translateX(-50%);
          white-space: nowrap; ${pillBg}
          border: 1px solid rgba(255, 255, 255, 0.25); font-family: monospace;
          font-size: 10px; font-weight: 700; padding: 2px 7px; border-radius: 999px;
          box-shadow: 0 3px 10px rgba(0, 0, 0, 0.85); z-index: 10;
        ">${isRecharging ? '⚡ CHARGING 100%' : `🔋 ${Math.round(currentBattery)}%`}</div>

        <!-- Pulse Ring -->
        <div class="nav-pulse-ring"></div>

        <!-- Directional Beam Light Cone (radiates toward heading) -->
        <div class="nav-heading-beam" style="transform: translateX(-50%) rotate(${heading}deg); transform-origin: bottom center;"></div>

        <!-- Google Maps 3D Navigation Chevron Arrow (Rotated to exact Heading Azimuth) -->
        <div style="transform: rotate(${heading}deg); transform-origin: center center; display: flex; align-items: center; justify-content: center;">
          <svg viewBox="0 0 24 24" class="nav-chevron-arrow">
            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" fill="${arrowColor}" stroke="#ffffff" stroke-width="2.2" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>
    `;

    const icon = L.divIcon({
      className: 'google-maps-nav-icon',
      html: puckHtml,
      iconSize: [48, 48],
      iconAnchor: [24, 24],
    });

    if (!liveMarkerRef.current) {
      liveMarkerRef.current = L.marker(currentLatLon, {
        icon,
        zIndexOffset: 1200,
      }).addTo(map);
    } else {
      liveMarkerRef.current.setLatLng(currentLatLon);
      liveMarkerRef.current.setIcon(icon);
    }

    if (followAstronaut && active) {
      map.panTo(currentLatLon, { animate: true, duration: 0.35 });
    }
  }, [liveNavState, followAstronaut, locatePulse]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Twilight / Night Martian Atmospheric Shading */}
      {solarPhase === 'dusk' && (
        <div className="pointer-events-none absolute inset-0 z-[340] bg-indigo-950/30 mix-blend-multiply transition-opacity duration-500" />
      )}
      {solarPhase === 'night' && (
        <div className="pointer-events-none absolute inset-0 z-[340] bg-slate-950/60 mix-blend-multiply transition-opacity duration-500" />
      )}

      {/* Storm / Dust Visual Tint Overlay */}
      {weatherCondition === 'dust_storm' && (
        <div className="pointer-events-none absolute inset-0 z-[350] bg-amber-900/25 mix-blend-multiply transition-opacity duration-500" />
      )}
      {weatherCondition === 'solar_storm' && (
        <div className="pointer-events-none absolute inset-0 z-[350] border-4 border-red-500/40 shadow-[inset_0_0_80px_rgba(239,68,68,0.22)] transition-opacity duration-500" />
      )}
    </div>
  );
}
