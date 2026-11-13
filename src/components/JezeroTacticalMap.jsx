import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import APP_THEME from '../theme';
import { estimateElev, checkCursorHazards } from '../utils/pathfinder';

const REGIONAL_BOUNDS = APP_THEME.regionalBounds;

const GROUND_CONTROL_SCIENCE_HAZARDS = [
  {
    name: 'DELTA FRONT ESCARPMENT',
    type: 'SLOPE / CLIFF ROLLOVER (>25 DEG GRADE)',
    lat: 18.525,
    lon: 77.382,
    radius: 950,
    color: APP_THEME.hazards.heat.color,
    fillColor: APP_THEME.hazards.heat.fill,
    severity: 'CRITICAL',
  },
  {
    name: 'SEITAH DUNE FIELD',
    type: 'REGOLITH ENTRAPMENT / HIGH SLIP (>40%)',
    lat: 18.435,
    lon: 77.442,
    radius: 800,
    color: APP_THEME.hazards.rough.color,
    fillColor: APP_THEME.hazards.rough.fill,
    severity: 'HIGH',
  },
  {
    name: 'NORTH RIM THERMAL INERTIA',
    type: 'EXTREME THERMAL SHOCK / HIGH ROCK FRACTION',
    lat: 18.63,
    lon: 77.455,
    radius: 1200,
    color: APP_THEME.hazards.heat.color,
    fillColor: APP_THEME.hazards.heat.fill,
    severity: 'MODERATE',
  },
  {
    name: 'BELVA CRATER PERCHLORATE ZONE',
    type: 'CORROSIVE OXIDANT CONCENTRATION (>0.8 WT%)',
    lat: 18.505,
    lon: 77.492,
    radius: 900,
    color: APP_THEME.hazards.chemical.color,
    fillColor: APP_THEME.hazards.chemical.fill,
    severity: 'HAZARDOUS',
  },
  {
    name: 'WEST HIGHLANDS GCR FLUX PEAK',
    type: 'UNSHIELDED COSMIC RADIATION (0.84 mSv/d)',
    lat: 18.58,
    lon: 77.31,
    radius: 1100,
    color: APP_THEME.hazards.radiation.color,
    fillColor: APP_THEME.hazards.radiation.fill,
    severity: 'CAUTION',
  },
];

export default function JezeroTacticalMap({
  waypoints = [],
  sciencePOIs = [],
  hazardZones = [],
  layers = {},
  routeResult = null,
  startPOI = null,
  endPOI = null,
  showDirectComparison = false,
  weatherCondition = 'nominal',
  liveNavState = null,
  followAstronaut = false,
  locatePulse = null,
  flyToTarget = null,
  dustFrontState = null,
  solarPhase = 'day',
  astronautLocId = 'hab-alpha',
  basemap = 'satellite',
  reliefBlend = 0.3,
  landmarks = [],
  activeDrawMode = null,
  drawVertices = [],
  drawnZones = [],
  cleanTabletMode = false,
  onSelectPOI,
  onSelectWaypointSol,
  onOpenPanorama,
  onOpenLandmarkVista,
  onNavigateToPOI,
  onSetOrigin,
  onSelectLandmark,
  onAddDrawVertex,
  onDeleteZone,
  onCursorMove,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layerGroupsRef = useRef({});
  const staticOverlaysRef = useRef({});
  const liveMarkerRef = useRef(null);
  const basemapOverlayRef = useRef(null);
  const reliefOverlayRef = useRef(null);
  const opmTileRef = useRef(null);

  // Refs for stable event listeners inside map init
  const activeDrawModeRef = useRef(activeDrawMode);
  const onAddDrawVertexRef = useRef(onAddDrawVertex);
  const onCursorMoveRef = useRef(onCursorMove);
  const hazardZonesRef = useRef(hazardZones);
  const drawnZonesRef = useRef(drawnZones);
  const landmarksRef = useRef(landmarks);

  useEffect(() => {
    activeDrawModeRef.current = activeDrawMode;
    onAddDrawVertexRef.current = onAddDrawVertex;
    onCursorMoveRef.current = onCursorMove;
    hazardZonesRef.current = hazardZones;
    drawnZonesRef.current = drawnZones;
    landmarksRef.current = landmarks;
  });

  // Dispatch bridge for Leaflet HTML popup buttons
  useEffect(() => {
    window.dispatchMarsPano = (sol) => {
      onOpenPanorama?.(sol);
    };
    window.dispatchNavigateTo = (targetId) => {
      mapInstanceRef.current?.closePopup();
      onNavigateToPOI?.(targetId);
    };
    window.dispatchSetOrigin = (originId) => {
      mapInstanceRef.current?.closePopup();
      onSetOrigin?.(originId);
    };
    window.dispatchOpenLandmark = (landmarkId) => {
      mapInstanceRef.current?.closePopup();
      const match = landmarksRef.current.find(
        (l) => l.id === landmarkId || l.id.replace(/_/g, '-') === landmarkId.replace(/_/g, '-')
      );
      onSelectLandmark?.(match || landmarkId);
    };
    window.dispatchOpenLandmarkVista = (landmarkId) => {
      mapInstanceRef.current?.closePopup();
      onOpenLandmarkVista?.(landmarkId);
    };
    window.dispatchDeleteZone = (zoneId) => {
      mapInstanceRef.current?.closePopup();
      onDeleteZone?.(zoneId);
    };

    return () => {
      delete window.dispatchMarsPano;
      delete window.dispatchNavigateTo;
      delete window.dispatchSetOrigin;
      delete window.dispatchOpenLandmark;
      delete window.dispatchOpenLandmarkVista;
      delete window.dispatchDeleteZone;
    };
  }, [
    onOpenPanorama,
    onNavigateToPOI,
    onSetOrigin,
    onSelectLandmark,
    onOpenLandmarkVista,
    onDeleteZone,
  ]);

  // Initialize Leaflet Map once
  useEffect(() => {
    if (!mapContainerRef.current || mapInstanceRef.current) return undefined;

    const map = L.map(mapContainerRef.current, {
      center: [18.455, 77.41],
      zoom: 12,
      minZoom: 10,
      maxZoom: 18,
      maxBounds: [
        [17.6, 76.68],
        [18.82, 77.92],
      ],
      maxBoundsViscosity: 0.75,
      preferCanvas: true,
      zoomControl: false,
      attributionControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Base planetary tile layer (visible under regional overlays or when basemap === 'default')
    const opmBasemap = L.tileLayer(
      'https://cartocdn-gusc.global.ssl.fastly.net/opmbuilder/api/v1/map/named/opm-mars-basemap-v0-2/all/{z}/{x}/{y}.png',
      {
        maxZoom: 18,
        maxNativeZoom: 14,
        opacity: 0.9,
        zIndex: 0,
      }
    ).addTo(map);
    opmTileRef.current = opmBasemap;

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

    reliefOverlayRef.current = L.imageOverlay('/data/hrsc_hillshade.png', REGIONAL_BOUNDS, {
      opacity: basemap !== 'terrain' && basemap !== 'default' ? reliefBlend : 0.0,
      zIndex: 2,
      interactive: false,
    }).addTo(map);

    // NASA HiRISE 25cm Ultra-High Resolution TMS Overlay
    const hiriseLayer = L.tileLayer(
      'https://mars.nasa.gov/mmgis-maps/M20/Layers/M20_HiRISE_RGB_mosaic_25cm_v4p2/{z}/{x}/{-y}.png',
      {
        tms: true,
        maxZoom: 18,
        opacity: 0.92,
        keepBuffer: 6,
        updateWhenIdle: true,
        updateInterval: 120,
        zIndex: 5,
      }
    );

    // USGS SIM 3464 Vector GeoJSON Overlays
    const ellipseLayer = L.geoJSON(null, {
      style: {
        color: APP_THEME.layers.ellipseBorder,
        weight: 1.5,
        dashArray: '4, 4',
        fillOpacity: 0.05,
        fillColor: APP_THEME.layers.ellipseFill,
      },
      interactive: false,
    });

    const linearLayer = L.geoJSON(null, {
      style: {
        color: APP_THEME.layers.linearFeature,
        weight: 1.2,
        opacity: 0.85,
      },
      interactive: false,
    });

    const surfaceLayer = L.geoJSON(null, {
      style: {
        color: APP_THEME.layers.surfaceFeature,
        weight: 1,
        fillOpacity: 0.14,
        fillColor: APP_THEME.layers.surfaceFeature,
      },
      interactive: false,
    });

    const nomenclatureLayer = L.geoJSON(null, {
      pointToLayer: (feature, latlng) => {
        const name = feature.properties ? feature.properties.TextString || feature.properties.Name || '' : '';
        return L.marker(latlng, {
          icon: L.divIcon({
            className: 'nomen-label',
            html: `<div style="font-family:'JetBrains Mono',monospace;font-size:10px;font-weight:600;letter-spacing:0.06em;color:#9da5b4;text-shadow:0 1px 2px #0b0d11;white-space:nowrap;text-align:center;">${name}</div>`,
            iconSize: [140, 16],
            iconAnchor: [70, 8],
          }),
          interactive: false,
        });
      },
    });

    const m20TraverseRemote = L.geoJSON(null, {
      style: {
        color: APP_THEME.layers.traverseLine,
        weight: 1.8,
        dashArray: '3, 4',
        opacity: 0.75,
      },
      interactive: false,
    });

    staticOverlaysRef.current = {
      hirise: hiriseLayer,
      ellipse: ellipseLayer,
      linear: linearLayer,
      surface: surfaceLayer,
      nomenclature: nomenclatureLayer,
      m20TraverseRemote,
    };

    // Fetch local GeoJSON datasets quietly
    fetch('/data/LandingEllipse.geojson')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && ellipseLayer.addData(d))
      .catch(() => {});

    fetch('/data/LinearFeatures.geojson')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && linearLayer.addData(d))
      .catch(() => {});

    fetch('/data/SurfaceFeatures.geojson')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && surfaceLayer.addData(d))
      .catch(() => {});

    fetch('/data/Nomenclature.geojson')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d || !Array.isArray(d.features)) return;
        d.features.forEach((f) => {
          if (f.geometry?.type === 'MultiPolygon' && f.geometry.coordinates?.[0]?.[0]) {
            const coords = f.geometry.coordinates[0][0];
            let avgLat = 0;
            let avgLon = 0;
            coords.forEach((c) => {
              avgLon += c[0];
              avgLat += c[1];
            });
            avgLon /= coords.length;
            avgLat /= coords.length;
            nomenclatureLayer.addData({
              type: 'Feature',
              properties: f.properties,
              geometry: { type: 'Point', coordinates: [avgLon, avgLat] },
            });
          } else if (f.geometry?.type === 'Point') {
            nomenclatureLayer.addData(f);
          }
        });
      })
      .catch(() => {});

    fetch('https://mars.nasa.gov/mmgis-maps/M20/Layers/json/M20_traverse.json')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && m20TraverseRemote.addData(d))
      .catch(() => {});

    layerGroupsRef.current = {
      traverse: L.layerGroup().addTo(map),
      slope: L.layerGroup().addTo(map),
      hazards: L.layerGroup().addTo(map),
      drawnZones: L.layerGroup().addTo(map),
      drawPreview: L.layerGroup().addTo(map),
      science: L.layerGroup().addTo(map),
      route: L.layerGroup().addTo(map),
      dustFront: L.layerGroup().addTo(map),
      landmarks: L.layerGroup().addTo(map),
    };

    // Map click handler for Exclusion Polygon drawing
    const handleMapClick = (e) => {
      if (activeDrawModeRef.current) {
        onAddDrawVertexRef.current?.([
          Number(e.latlng.lat.toFixed(6)),
          Number(e.latlng.lng.toFixed(6)),
        ]);
      }
    };
    map.on('click', handleMapClick);

    // RequestAnimationFrame throttled cursor telemetry probe
    let rafPending = false;
    let lastMouseLatLng = null;
    const handleMouseMove = (e) => {
      lastMouseLatLng = e.latlng;
      if (rafPending) return;
      rafPending = true;
      requestAnimationFrame(() => {
        rafPending = false;
        if (!lastMouseLatLng || !onCursorMoveRef.current) return;
        const { lat, lng } = lastMouseLatLng;
        const elevM = estimateElev(lat, lng);
        const haz = checkCursorHazards(lat, lng, hazardZonesRef.current, drawnZonesRef.current);
        onCursorMoveRef.current({
          lat,
          lon: lng,
          elevM,
          hazardLabel: haz.label,
          isFault: haz.isFault,
        });
      });
    };
    map.on('mousemove', handleMouseMove);

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            map.invalidateSize({ animate: false });
          })
        : null;
    if (resizeObserver && mapContainerRef.current) {
      resizeObserver.observe(mapContainerRef.current);
    }

    mapInstanceRef.current = map;

    return () => {
      if (resizeObserver) resizeObserver.disconnect();
      map.off('click', handleMapClick);
      map.off('mousemove', handleMouseMove);
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

  // Update draw cursor & disable doubleClickZoom while actively placing polygon vertices
  useEffect(() => {
    const map = mapInstanceRef.current;
    const container = mapContainerRef.current;
    if (!map || !container) return;

    if (activeDrawMode) {
      container.style.cursor = 'crosshair';
      map.doubleClickZoom.disable();
    } else {
      container.style.cursor = '';
      map.doubleClickZoom.enable();
    }
  }, [activeDrawMode]);

  // Toggle static overlays (HiRISE 25cm, Ellipse, Linear, Surface, Nomenclature, Remote Traverse)
  useEffect(() => {
    const map = mapInstanceRef.current;
    const staticMap = staticOverlaysRef.current;
    if (!map || !staticMap) return;

    const syncLayer = (key, enabled) => {
      const lyr = staticMap[key];
      if (!lyr) return;
      if (enabled && !map.hasLayer(lyr)) {
        lyr.addTo(map);
      } else if (!enabled && map.hasLayer(lyr)) {
        map.removeLayer(lyr);
      }
    };

    syncLayer('hirise', Boolean(layers.hirise));
    syncLayer('ellipse', Boolean(layers.ellipse));
    syncLayer('linear', Boolean(layers.linear));
    syncLayer('surface', Boolean(layers.surface));
    syncLayer('nomenclature', Boolean(layers.nomenclature) && !cleanTabletMode);
    syncLayer('m20TraverseRemote', Boolean(layers.traverse));
  }, [
    layers.hirise,
    layers.ellipse,
    layers.linear,
    layers.surface,
    layers.nomenclature,
    layers.traverse,
    cleanTabletMode,
  ]);

  // Update Basemap & Relief Hillshade Blend dynamically
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

    if (reliefOverlayRef.current) {
      const showRelief = basemap !== 'terrain' && basemap !== 'default';
      reliefOverlayRef.current.setOpacity(showRelief ? reliefBlend : 0.0);
    }
  }, [basemap, reliefBlend]);

  // Fly-to when Quick Landmark, Target, or Origin changes
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !flyToTarget?.timestamp || !flyToTarget.latLon) return;

    map.flyTo(flyToTarget.latLon, flyToTarget.zoom || 14, {
      animate: true,
      duration: 0.9,
      easeLinearity: 0.25,
    });
  }, [flyToTarget]);

  // Smooth Animated Fly-To Zoom when Locate EVA / North Pin is pressed
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !locatePulse?.timestamp || !liveNavState?.currentLatLon) return;

    map.flyTo(liveNavState.currentLatLon, locatePulse.zoom || 14.5, {
      animate: true,
      duration: 1.0,
      easeLinearity: 0.25,
    });
  }, [locatePulse, liveNavState?.currentLatLon]);

  // Render Traverse Waypoints & Slope Telemetry
  useEffect(() => {
    const { traverse, slope } = layerGroupsRef.current;
    if (!traverse || !slope) return;
    traverse.clearLayers();
    slope.clearLayers();

    if (layers.traverse && waypoints.length > 0) {
      const latlngs = waypoints.map((w) => [w.lat, w.lon]);
      L.polyline(latlngs, {
        color: APP_THEME.layers.traverseLine,
        weight: 2,
        opacity: 0.85,
        dashArray: '4, 5',
      }).addTo(traverse);
    }

    if (layers.slope && waypoints.length > 0) {
      for (let i = 0; i < waypoints.length; i += 2) {
        const w = waypoints[i];
        const tilt = w.tilt || 0;
        let color = APP_THEME.colors.ok; // < 7 deg nominal
        if (tilt >= 14) color = APP_THEME.colors.fault; // >= 14 deg fault
        else if (tilt >= 7) color = APP_THEME.colors.textSecondary; // 7-13.9 deg moderate

        const circle = L.circleMarker([w.lat, w.lon], {
          radius: tilt >= 14 ? 5 : 3.5,
          color,
          fillColor: color,
          fillOpacity: 0.8,
          weight: 1,
        });

        const is360Waypoint = w.sol === 3 || w.sol === 68;
        circle.bindPopup(`
          <div style="font-size:11px; min-width:190px; font-family:'JetBrains Mono',monospace;">
            <div style="font-weight:700; color:#edf0f5; border-bottom:1px solid #242933; padding-bottom:4px; margin-bottom:6px; text-transform:uppercase;">
              SOL ${w.sol} // TELEMETRY
            </div>
            <div style="color:#9da5b4; line-height:1.5;">
              <div><span style="color:#656d7d;">ELEV:</span> <span style="color:#edf0f5;">${w.elev} m</span></div>
              <div><span style="color:#656d7d;">GRADE:</span> <span style="color:${tilt >= 14 ? '#ef4444' : '#edf0f5'};">${tilt} deg</span></div>
              <div><span style="color:#656d7d;">ODOM:</span> <span style="color:#edf0f5;">${(w.dist_total_m / 1000).toFixed(2)} km</span></div>
            </div>
            <button onclick="window.dispatchMarsPano(${w.sol})" style="
              margin-top:8px; width:100%; min-height:36px; padding:6px 10px;
              background:${is360Waypoint ? '#16a34a' : '#222731'};
              color:${is360Waypoint ? '#0b0d11' : '#edf0f5'};
              font-weight:700; font-size:10px; border-radius:4px; border:1px solid ${is360Waypoint ? '#22c55e' : '#353c4a'};
              cursor:pointer; text-transform:uppercase; letter-spacing:0.04em;
            ">${is360Waypoint ? 'OPEN 360 PHOTOSPHERE' : 'VIEW SURFACE IMAGERY'}</button>
          </div>
        `);

        circle.on('click', () => {
          onSelectWaypointSol?.(w.sol);
        });

        circle.addTo(slope);
      }
    }
  }, [waypoints, layers.traverse, layers.slope, onSelectWaypointSol]);

  // Render Hazard Zones (Terrain Hazards + Modeled Science Hazards)
  useEffect(() => {
    const { hazards } = layerGroupsRef.current;
    if (!hazards) return;
    hazards.clearLayers();

    if (!layers.hazards) return;

    hazardZones.forEach((hz) => {
      const color =
        hz.severity === 'critical'
          ? APP_THEME.colors.fault
          : hz.severity === 'high'
          ? APP_THEME.colors.faultDark
          : '#991b1b';

      const circle = L.circle([hz.lat, hz.lon], {
        radius: hz.radiusMeters,
        color,
        fillColor: color,
        fillOpacity: 0.2,
        weight: 1.5,
        dashArray: '5, 5',
      });

      circle.bindPopup(`
        <div style="font-size:11px; max-width:230px; font-family:'JetBrains Mono',monospace;">
          <div style="font-weight:700; color:#ef4444; text-transform:uppercase; font-size:10px; border-bottom:1px solid #242933; padding-bottom:4px; margin-bottom:4px;">
            [FAULT] ${hz.severity.toUpperCase()} TERRAIN HAZARD
          </div>
          <div style="font-weight:700; font-size:12px; color:#edf0f5; margin-bottom:4px;">${hz.name}</div>
          <div style="color:#9da5b4; margin-bottom:4px;">PEAK GRADE: <span style="color:#edf0f5;">${hz.maxSlope} deg</span></div>
          <p style="margin:0; color:#9da5b4; font-family:'Inter',sans-serif; font-size:11px; line-height:1.4;">${hz.description}</p>
        </div>
      `);

      circle.addTo(hazards);
    });

    GROUND_CONTROL_SCIENCE_HAZARDS.forEach((h) => {
      const circle = L.circle([h.lat, h.lon], {
        radius: h.radius,
        color: h.color,
        fillColor: h.fillColor,
        fillOpacity: 0.18,
        weight: 1.5,
        dashArray: '4, 4',
      });

      circle.bindTooltip(
        `<div style="font-family:'JetBrains Mono',monospace;font-size:10px;line-height:1.4;color:#edf0f5;">
          <span style="color:#ef4444;font-weight:700;">[ZONE: ${h.name}]</span><br>
          <span>TYPE: ${h.type}</span><br>
          <span>STATUS: ${h.severity}</span>
        </div>`,
        { sticky: true, opacity: 0.96 }
      );

      circle.addTo(hazards);
    });
  }, [hazardZones, layers.hazards]);

  // Render Operator-Drawn Exclusion & Safe Corridor Polygons
  useEffect(() => {
    const { drawnZones: drawnGroup } = layerGroupsRef.current;
    if (!drawnGroup) return;
    drawnGroup.clearLayers();

    drawnZones.forEach((z) => {
      const style = APP_THEME.hazards[z.type] || APP_THEME.hazards.rough;
      const poly = L.polygon(z.latlngs, {
        color: style.color,
        fillColor: style.fill,
        fillOpacity: style.opacity,
        weight: 2,
      });

      const isSafe = z.type === 'safe';
      poly.bindPopup(`
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;min-width:190px;">
          <div style="font-weight:700;color:${isSafe ? '#22c55e' : '#ef4444'};border-bottom:1px solid #242933;padding-bottom:4px;margin-bottom:6px;text-transform:uppercase;">
            ${isSafe ? '[OK] ' : '[EXCLUSION] '}${style.label}
          </div>
          <div style="color:#9da5b4;font-size:10px;margin-bottom:8px;">
            ID: ${z.id} // VERTICES: ${z.latlngs.length}
          </div>
          <button onclick="window.dispatchDeleteZone('${z.id}')" style="
            width:100%;min-height:36px;padding:6px 10px;background:#222731;color:#ef4444;
            border:1px solid #ef4444;border-radius:4px;font-weight:700;font-size:10px;cursor:pointer;text-transform:uppercase;
          ">DELETE ZONE</button>
        </div>
      `);

      poly.addTo(drawnGroup);
    });
  }, [drawnZones]);

  // Render Live Draw Polygon Preview while operator places vertices
  useEffect(() => {
    const { drawPreview } = layerGroupsRef.current;
    if (!drawPreview) return;
    drawPreview.clearLayers();

    if (!activeDrawMode || drawVertices.length === 0) return;

    const style = APP_THEME.hazards[activeDrawMode] || APP_THEME.hazards.rough;

    if (drawVertices.length >= 3) {
      L.polygon(drawVertices, {
        color: style.color,
        fillColor: style.fill,
        fillOpacity: style.opacity * 0.85,
        weight: 2,
        dashArray: '4, 4',
        interactive: false,
      }).addTo(drawPreview);
    } else if (drawVertices.length >= 2) {
      L.polyline(drawVertices, {
        color: style.color,
        weight: 2,
        dashArray: '4, 4',
        interactive: false,
      }).addTo(drawPreview);
    }

    drawVertices.forEach((pt, idx) => {
      L.circleMarker(pt, {
        radius: idx === 0 ? 5 : 4,
        color: '#edf0f5',
        fillColor: style.color,
        fillOpacity: 1,
        weight: 1.5,
        interactive: false,
      }).addTo(drawPreview);
    });
  }, [activeDrawMode, drawVertices]);

  // Render Science, ISRU & Charging Stations (Monochrome / Green / Crimson only)
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
      const isCurrentLoc = poi.id === astronautLocId;

      if (isStation) {
        L.circle([poi.lat, poi.lon], {
          radius: 2500,
          color: APP_THEME.colors.ok,
          fillColor: APP_THEME.colors.ok,
          fillOpacity: isActivePitStop ? 0.08 : 0.03,
          weight: isActivePitStop ? 1.5 : 0.8,
          dashArray: '3, 6',
          interactive: false,
        }).addTo(science);
      }

      // Monochrome & Green/Crimson Status Encoding only
      const borderColor = isActivePitStop || isStation
        ? APP_THEME.colors.ok
        : isStart || isEnd
        ? APP_THEME.colors.textPrimary
        : APP_THEME.colors.borderStrong;

      const markerBg = isEnd
        ? '#16a34a'
        : isStart
        ? '#2c323f'
        : '#13161c';

      // Visual vector SVG glyphs per station type (zero emojis)
      const strokeHex = isEnd ? '#0b0d11' : borderColor === APP_THEME.colors.ok ? '#22c55e' : '#edf0f5';
      const svgIcon =
        poi.type === 'charging' || poi.type === 'habitat'
          ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${strokeHex}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`
          : poi.type === 'isru'
          ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${strokeHex}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"/></svg>`
          : poi.type === 'resource'
          ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${strokeHex}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>`
          : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="${strokeHex}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3"/></svg>`;

      const topBadgeHtml = isActivePitStop
        ? `<div style="
            position:absolute; top:-22px; left:50%; transform:translateX(-50%);
            white-space:nowrap; background:#13161c; color:#22c55e; border:1px solid #22c55e;
            font-size:9px; font-weight:700; font-family:'JetBrains Mono',monospace; padding:1px 6px; border-radius:4px;
          ">PIT STOP 100%</div>`
        : isCurrentLoc
        ? `<div style="
            position:absolute; bottom:-20px; left:50%; transform:translateX(-50%);
            white-space:nowrap; background:#13161c; color:#edf0f5; border:1px solid #edf0f5;
            font-size:9px; font-weight:700; font-family:'JetBrains Mono',monospace; padding:1px 6px; border-radius:4px;
          ">UNIT BASE</div>`
        : '';

      const customIcon = L.divIcon({
        className: 'custom-mars-poi',
        html: `<div style="position:relative;">
          ${topBadgeHtml}
          <div style="
            width: 32px; height: 32px; border-radius: 4px;
            background: ${markerBg}; color: ${strokeHex};
            display: flex; align-items: center; justify-content: center;
            border: 1.5px solid ${borderColor};
          ">${svgIcon}</div>
        </div>`,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
      });

      const marker = L.marker([poi.lat, poi.lon], { icon: customIcon });
      const matchingLm = landmarks.find(
        (l) =>
          l.id === poi.id ||
          l.id.replace(/_/g, '-') === poi.id.replace(/_/g, '-') ||
          (poi.id === 'hab-alpha' && l.id === 'landing_site')
      );

      marker.bindPopup(`
        <div style="font-size:11px; max-width:250px; font-family:'JetBrains Mono',monospace;">
          <div style="font-weight:700; color:#22c55e; font-size:10px; text-transform:uppercase; margin-bottom:2px;">
            ${poi.type.toUpperCase()} NODE
          </div>
          <div style="font-weight:700; font-size:12px; color:#edf0f5; border-bottom:1px solid #242933; padding-bottom:4px; margin-bottom:6px;">
            ${poi.name}
          </div>
          <p style="margin:0 0 8px; color:#9da5b4; font-family:'Inter',sans-serif; font-size:11px; line-height:1.4;">
            ${poi.description}
          </p>
          <div style="display:flex; flex-direction:column; gap:5px;">
            <button onclick="window.dispatchSetOrigin('${poi.id}')" style="
              width:100%; min-height:36px; padding:6px 10px; background:#191d24; color:#edf0f5;
              border:1px solid #353c4a; border-radius:4px; font-weight:700; font-size:10px; cursor:pointer; text-transform:uppercase;
            ">SET AS ORIGIN BASE</button>
            <button onclick="window.dispatchNavigateTo('${poi.id}')" style="
              width:100%; min-height:36px; padding:6px 10px; background:#16a34a; color:#0b0d11;
              border:1px solid #22c55e; border-radius:4px; font-weight:700; font-size:10px; cursor:pointer; text-transform:uppercase;
            ">ROUTE TO TARGET</button>
            ${
              matchingLm
                ? `<button onclick="window.dispatchOpenLandmark('${matchingLm.id}')" style="
                    width:100%; min-height:36px; padding:6px 10px; background:#222731; color:#22c55e;
                    border:1px solid rgba(34,197,94,0.45); border-radius:4px; font-weight:700; font-size:10px; cursor:pointer; text-transform:uppercase;
                  ">OPEN DOSSIER & PHOTOS</button>`
                : ''
            }
          </div>
        </div>
      `);

      marker.on('click', () => {
        onSelectPOI?.(poi);
      });

      marker.addTo(science);
    });
  }, [
    sciencePOIs,
    layers.science,
    startPOI,
    endPOI,
    routeResult,
    astronautLocId,
    landmarks,
    onSelectPOI,
  ]);

  // Render 11 Regional Science Landmarks
  useEffect(() => {
    const { landmarks: lmGroup } = layerGroupsRef.current;
    if (!lmGroup) return;
    lmGroup.clearLayers();

    if (!layers.landmarks || landmarks.length === 0) return;

    landmarks.forEach((lm) => {
      if (!lm.coords || lm.coords.length < 2) return;
      const isCurrentLoc =
        lm.id === astronautLocId ||
        (astronautLocId === 'hab-alpha' && lm.id === 'landing_site');
      const pinColor = isCurrentLoc ? '#22c55e' : '#edf0f5';

      const labelTagHtml = cleanTabletMode
        ? ''
        : `<span style="
            background:#13161c;border:1px solid #353c4a;
            color:${pinColor};font-family:'JetBrains Mono',monospace;
            font-size:9px;font-weight:700;letter-spacing:0.04em;
            padding:2px 6px;border-radius:4px;white-space:nowrap;
          ">${lm.name.toUpperCase()}</span>`;

      const icon = L.divIcon({
        className: 'aerospace-landmark-marker',
        html: `
          <div style="display:flex;align-items:center;gap:5px;transform:translate(-11px,-11px);cursor:pointer;">
            <div style="
              width:22px;height:22px;border-radius:4px;
              background:#13161c;border:1.5px solid ${pinColor};
              display:flex;align-items:center;justify-content:center;
            ">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="${pinColor}" stroke-width="2">
                <circle cx="12" cy="12" r="8" />
                <circle cx="12" cy="12" r="2" fill="${pinColor}" />
              </svg>
            </div>
            ${labelTagHtml}
          </div>
        `,
        iconSize: [24, 24],
        iconAnchor: [11, 11],
      });

      const marker = L.marker(lm.coords, { icon, zIndexOffset: 650 });
      if (cleanTabletMode) {
        marker.bindTooltip(lm.name.toUpperCase(), {
          direction: 'right',
          offset: [10, 0],
        });
      }
      const regolith = lm.regolith || 'Basaltic-Olivine Floor';

      marker.bindPopup(`
        <div style="font-size:11px; min-width:235px; font-family:'Inter',sans-serif;">
          <div style="font-family:'JetBrains Mono',monospace; font-size:9.5px; color:#22c55e; font-weight:700; text-transform:uppercase; letter-spacing:0.06em;">
            REGIONAL LANDMARK
          </div>
          <div style="font-weight:700; font-size:13px; color:#edf0f5; margin:2px 0 4px;">
            ${lm.name}
          </div>
          <div style="font-size:11px; color:#9da5b4; margin-bottom:8px; line-height:1.4;">
            ${lm.type || 'Jezero Geologic Feature'} // ${lm.region || 'Jezero Quadrangle'}
          </div>
          <div style="background:#191d24; border:1px solid #242933; border-radius:4px; padding:6px; font-size:10px; margin-bottom:8px; font-family:'JetBrains Mono',monospace; line-height:1.5;">
            <div><span style="color:#656d7d;">ELEV:</span> <span style="color:#edf0f5;">${lm.elevation_m} m</span></div>
            <div><span style="color:#656d7d;">COORDS:</span> <span style="color:#edf0f5;">${lm.coords[0].toFixed(4)} N, ${lm.coords[1].toFixed(4)} E</span></div>
            <div><span style="color:#656d7d;">SOIL:</span> <span style="color:#9da5b4;">${regolith}</span></div>
          </div>
          <div style="display:flex; flex-direction:column; gap:5px;">
            <button onclick="window.dispatchOpenLandmark('${lm.id}')" style="
              width:100%; min-height:36px; padding:6px 10px; background:#191d24; color:#edf0f5;
              border:1px solid #353c4a; border-radius:4px; font-weight:700; font-size:10px;
              font-family:'JetBrains Mono',monospace; cursor:pointer; text-transform:uppercase;
            ">OPEN DOSSIER & 5-PHOTO LOG</button>
            <button onclick="window.dispatchOpenLandmarkVista('${lm.id}')" style="
              width:100%; min-height:36px; padding:6px 10px; background:#222731; color:#edf0f5;
              border:1px solid #4f5767; border-radius:4px; font-weight:700; font-size:10px;
              font-family:'JetBrains Mono',monospace; cursor:pointer; text-transform:uppercase;
            ">OPEN SURFACE VISTA / 360</button>
            <button onclick="window.dispatchSetOrigin('${lm.id}')" style="
              width:100%; min-height:36px; padding:6px 10px; background:#191d24; color:#9da5b4;
              border:1px solid #353c4a; border-radius:4px; font-weight:700; font-size:10px;
              font-family:'JetBrains Mono',monospace; cursor:pointer; text-transform:uppercase;
            ">SET AS ORIGIN BASE</button>
            <button onclick="window.dispatchNavigateTo('${lm.id}')" style="
              width:100%; min-height:36px; padding:6px 10px; background:#16a34a; color:#0b0d11;
              border:1px solid #22c55e; border-radius:4px; font-weight:700; font-size:10px;
              font-family:'JetBrains Mono',monospace; cursor:pointer; text-transform:uppercase;
            ">ROUTE TO THIS SITE</button>
          </div>
        </div>
      `);

      marker.on('click', () => {
        onSelectLandmark?.(lm);
      });

      marker.addTo(lmGroup);
    });
  }, [landmarks, layers.landmarks, astronautLocId, onSelectLandmark, cleanTabletMode]);

  // Render Dual-Layer Aerospace A* Safe Route
  useEffect(() => {
    const { route } = layerGroupsRef.current;
    if (!route) return;
    route.clearLayers();

    if (!routeResult) return;

    if (showDirectComparison && routeResult.directCoords) {
      L.polyline(routeResult.directCoords, {
        color: APP_THEME.routeLine.directColor,
        weight: 2,
        opacity: 0.7,
        dashArray: '6, 8',
      })
        .bindTooltip('DIRECT LINE (UNPLANNED)', { sticky: true })
        .addTo(route);
    }

    if (routeResult.chargingStop && routeResult.leg1Coords && routeResult.leg2Coords) {
      // Leg 1 halo + off-white core
      L.polyline(routeResult.leg1Coords, {
        color: APP_THEME.routeLine.haloColor,
        weight: APP_THEME.routeLine.haloWeight,
        opacity: 0.9,
        lineJoin: 'round',
      }).addTo(route);

      L.polyline(routeResult.leg1Coords, {
        color: APP_THEME.routeLine.coreColor,
        weight: APP_THEME.routeLine.coreWeight,
        opacity: 1.0,
        lineJoin: 'round',
      })
        .bindTooltip(
          `LEG 1 TO ${routeResult.chargingStop.station.name.toUpperCase()}: ${routeResult.chargingStop.leg1Stats.distKm} KM`,
          { sticky: true }
        )
        .addTo(route);

      // Leg 2 halo + status-green core
      L.polyline(routeResult.leg2Coords, {
        color: APP_THEME.routeLine.haloColor,
        weight: APP_THEME.routeLine.haloWeight,
        opacity: 0.9,
        lineJoin: 'round',
      }).addTo(route);

      L.polyline(routeResult.leg2Coords, {
        color: APP_THEME.routeLine.leg2Color,
        weight: APP_THEME.routeLine.coreWeight,
        opacity: 1.0,
        lineJoin: 'round',
      })
        .bindTooltip(
          `LEG 2 (POST-CHARGE 100%): ${routeResult.chargingStop.leg2Stats.distKm} KM`,
          { sticky: true }
        )
        .addTo(route);
    } else if (routeResult.pathCoords?.length) {
      const coreColor =
        routeResult.rangeStatus === 'out_of_range'
          ? APP_THEME.routeLine.faultColor
          : weatherCondition === 'solar_storm'
          ? APP_THEME.routeLine.faultColor
          : APP_THEME.routeLine.coreColor;

      L.polyline(routeResult.pathCoords, {
        color: APP_THEME.routeLine.haloColor,
        weight: APP_THEME.routeLine.haloWeight,
        opacity: 0.9,
        lineJoin: 'round',
      }).addTo(route);

      L.polyline(routeResult.pathCoords, {
        color: coreColor,
        weight: APP_THEME.routeLine.coreWeight,
        opacity: 1.0,
        lineJoin: 'round',
      })
        .bindTooltip(
          `A* SAFE TRAVERSE: ${routeResult.distKm} KM | ${routeResult.durationMin} MIN`,
          { sticky: true }
        )
        .addTo(route);
    }
  }, [routeResult, showDirectComparison, weatherCondition]);

  // Render Predictive Dust Squall Radar & Vector (Crimson Alert Palette only)
  useEffect(() => {
    const { dustFront } = layerGroupsRef.current;
    if (!dustFront) return;
    dustFront.clearLayers();

    if (!dustFrontState?.active) return;

    const { lat, lon, radiusMeters = 1150, distanceAheadKm, etaMin } = dustFrontState;

    L.circle([lat, lon], {
      radius: radiusMeters * 1.5,
      color: APP_THEME.colors.fault,
      fillColor: APP_THEME.colors.faultDark,
      fillOpacity: 0.08,
      weight: 1.5,
      dashArray: '4, 8',
    }).addTo(dustFront);

    L.circle([lat, lon], {
      radius: radiusMeters,
      color: APP_THEME.colors.fault,
      fillColor: '#991b1b',
      fillOpacity: 0.25,
      weight: 2,
      dashArray: '8, 6',
    }).addTo(dustFront);

    if (liveNavState?.currentLatLon) {
      L.polyline([[lat, lon], liveNavState.currentLatLon], {
        color: APP_THEME.colors.fault,
        weight: 1.5,
        dashArray: '5, 8',
        opacity: 0.75,
      }).addTo(dustFront);
    }

    const stormBadge = L.divIcon({
      className: 'dust-storm-radar-badge',
      html: `<div style="
        transform: translate(-50%, -50%);
        white-space: nowrap;
        background: #13161c;
        color: #ef4444;
        border: 1px solid #ef4444;
        padding: 4px 10px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        font-family: 'JetBrains Mono', monospace;
        letter-spacing: 0.04em;
      ">SQUALL VECTOR: ${distanceAheadKm} KM // IMPACT T-${etaMin}M</div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });

    L.marker([lat, lon], { icon: stormBadge, interactive: false }).addTo(dustFront);
  }, [dustFrontState, liveNavState?.currentLatLon]);

  // Live Astronaut Heading Chevron & Telemetry Puck (Zero Blue / Zero Emojis)
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
      ? APP_THEME.colors.ok
      : currentBattery < 20
      ? APP_THEME.colors.fault
      : APP_THEME.colors.textPrimary;

    const pillBorder = isRecharging
      ? APP_THEME.colors.ok
      : currentBattery < 20
      ? APP_THEME.colors.fault
      : APP_THEME.colors.borderMedium;

    const pillColor = isRecharging
      ? APP_THEME.colors.ok
      : currentBattery < 20
      ? APP_THEME.colors.fault
      : APP_THEME.colors.textPrimary;

    const showLocatingRadar = Boolean(locatePulse?.showWave);

    const puckHtml = `
      <div class="google-maps-astronaut-puck">
        ${showLocatingRadar ? '<div class="locating-radar-wave"></div>' : ''}

        <div style="
          position: absolute; top: -28px; left: 50%; transform: translateX(-50%);
          white-space: nowrap; background: #13161c; color: ${pillColor};
          border: 1px solid ${pillBorder}; font-family: 'JetBrains Mono', monospace;
          font-size: 9.5px; font-weight: 700; padding: 2px 7px; border-radius: 4px;
          letter-spacing: 0.04em; z-index: 10;
        ">${isRecharging ? 'CHG 100%' : `BAT ${Math.round(currentBattery)}%`}</div>

        <div class="nav-pulse-ring"></div>
        <div class="nav-heading-beam" style="transform: translateX(-50%) rotate(${heading}deg); transform-origin: bottom center;"></div>

        <div style="transform: rotate(${heading}deg); transform-origin: center center; display: flex; align-items: center; justify-content: center;">
          <svg viewBox="0 0 24 24" class="nav-chevron-arrow">
            <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" fill="${arrowColor}" stroke="#0b0d11" stroke-width="2" stroke-linejoin="round"/>
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
    <div className="relative w-full h-full bg-[#0b0d11]">
      <div ref={mapContainerRef} className="w-full h-full z-0" />

      {/* Neutral Daylight / Dusk / Night Atmospheric Overlay (Zero Blue/Indigo) */}
      {solarPhase === 'dusk' && (
        <div className="pointer-events-none absolute inset-0 z-[340] bg-[#0b0d11]/30 transition-opacity duration-500" />
      )}
      {solarPhase === 'night' && (
        <div className="pointer-events-none absolute inset-0 z-[340] bg-[#0b0d11]/60 transition-opacity duration-500" />
      )}

      {/* Environmental Weather Overlays (Neutral Slate / Crimson Only — Zero Amber/Orange) */}
      {weatherCondition === 'dust_storm' && (
        <div className="pointer-events-none absolute inset-0 z-[350] bg-[#191d24]/30 border-2 border-[#ef4444]/40 transition-opacity duration-500" />
      )}
      {weatherCondition === 'solar_storm' && (
        <div className="pointer-events-none absolute inset-0 z-[350] border-2 border-[#ef4444]/70 bg-[#dc2626]/10 transition-opacity duration-500" />
      )}
    </div>
  );
}
