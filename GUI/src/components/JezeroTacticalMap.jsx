import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import APP_THEME from '../theme';
import { estimateElev, checkCursorHazards, loadDepthHazardRegions } from '../utils/pathfinder';

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
  onSetArbitraryOrigin,
  onSetArbitraryDestination,
  activePickMode = null,
  onClearPickMode,
  rfProbeActive = false,
  onProbeRfComms = null,
  rfProbeResult = null,
  scienceTourResult = null,
  onSelectLandmark,
  onAddDrawVertex,
  onDeleteZone,
  onCursorMove,
  onUserPan,
}) {
  const mapContainerRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const layerGroupsRef = useRef({});
  const staticOverlaysRef = useRef({});
  const liveMarkerRef = useRef(null);
  const basemapOverlayRef = useRef(null);
  const reliefOverlayRef = useRef(null);
  const opmTileRef = useRef(null);
  const depthHazardsGeoRef = useRef(null);

  // Animation and interaction tracking refs
  const lastFlyToTargetTimestampRef = useRef(null);
  const lastLocatePulseTimestampRef = useRef(null);
  const lastPannedCoordRef = useRef(null);

  // Refs for stable event listeners inside map init
  const activeDrawModeRef = useRef(activeDrawMode);
  const onAddDrawVertexRef = useRef(onAddDrawVertex);
  const onCursorMoveRef = useRef(onCursorMove);
  const hazardZonesRef = useRef(hazardZones);
  const drawnZonesRef = useRef(drawnZones);
  const landmarksRef = useRef(landmarks);
  const onSetArbitraryOriginRef = useRef(onSetArbitraryOrigin);
  const onSetArbitraryDestinationRef = useRef(onSetArbitraryDestination);
  const activePickModeRef = useRef(activePickMode);
  const onClearPickModeRef = useRef(onClearPickMode);
  const rfProbeActiveRef = useRef(rfProbeActive);
  const onProbeRfCommsRef = useRef(onProbeRfComms);
  const onUserPanRef = useRef(onUserPan);

  useEffect(() => {
    activeDrawModeRef.current = activeDrawMode;
    onAddDrawVertexRef.current = onAddDrawVertex;
    onCursorMoveRef.current = onCursorMove;
    hazardZonesRef.current = hazardZones;
    drawnZonesRef.current = drawnZones;
    landmarksRef.current = landmarks;
    onSetArbitraryOriginRef.current = onSetArbitraryOrigin;
    onSetArbitraryDestinationRef.current = onSetArbitraryDestination;
    activePickModeRef.current = activePickMode;
    onClearPickModeRef.current = onClearPickMode;
    rfProbeActiveRef.current = rfProbeActive;
    onProbeRfCommsRef.current = onProbeRfComms;
    onUserPanRef.current = onUserPan;
  }, [
    activeDrawMode,
    onAddDrawVertex,
    onCursorMove,
    hazardZones,
    drawnZones,
    landmarks,
    onSetArbitraryOrigin,
    onSetArbitraryDestination,
    activePickMode,
    onClearPickMode,
    rfProbeActive,
    onProbeRfComms,
    onUserPan,
  ]);

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
    window.dispatchSetArbitraryOrigin = (lat, lon) => {
      mapInstanceRef.current?.closePopup();
      onSetArbitraryOriginRef.current?.([parseFloat(lat), parseFloat(lon)]);
    };
    window.dispatchSetArbitraryDestination = (lat, lon) => {
      mapInstanceRef.current?.closePopup();
      onSetArbitraryDestinationRef.current?.([parseFloat(lat), parseFloat(lon)]);
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
      delete window.dispatchSetArbitraryOrigin;
      delete window.dispatchSetArbitraryDestination;
      delete window.dispatchOpenLandmark;
      delete window.dispatchOpenLandmarkVista;
      delete window.dispatchDeleteZone;
    };
  }, [
    onOpenPanorama,
    onNavigateToPOI,
    onSetOrigin,
    onSetArbitraryOrigin,
    onSetArbitraryDestination,
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
      minZoom: 8,
      maxZoom: 18,
      maxBounds: [
        [16.5, 75.8],
        [19.9, 78.8],
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
      satellite: '/data/ctx_full_stage6.png',
      terrain: '/data/hrsc_hillshade.png',
      elevation: '/data/consolidated_depth_map.png',
      themis: '/data/consolidated_depth_map.png',
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

    // NASA HiRISE 25cm Ultra-High Resolution TMS Overlay (Optional MMGIS Layer)
    const hiriseLayer = L.tileLayer(
      'https://mars.nasa.gov/mmgis-maps/M20/Layers/M20_HiRISE_RGB_mosaic_25cm_v4p2/{z}/{x}/{-y}.png',
      {
        tms: true,
        maxZoom: 18,
        opacity: 0.92,
        keepBuffer: 2,
        updateWhenIdle: true,
        updateInterval: 200,
        zIndex: 5,
        // Suppress broken tile red-X / console spam if remote NASA MMGIS server blocks requests
        errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
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
      endpoints: L.layerGroup().addTo(map),
      rfProbe: L.layerGroup().addTo(map),
      scienceTour: L.layerGroup().addTo(map),
    };

    const showCoordinateContextPopup = (lat, lng, latlng) => {
      const elevM = estimateElev(lat, lng);
      const haz = checkCursorHazards(lat, lng, hazardZonesRef.current, drawnZonesRef.current);
      const content = `
        <div style="font-size:12px; min-width:260px; max-width:290px; font-family:'JetBrains Mono',monospace;">
          <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:4px;">
            <span style="font-weight:700; color:#38bdf8; font-size:11px; text-transform:uppercase; letter-spacing:0.04em;">TACTICAL VECTOR</span>
            <span style="color:#656d7d; font-size:9.5px;">ARBITRARY POINT</span>
          </div>
          <div style="font-weight:700; font-size:13px; color:#edf0f5; border-bottom:1px solid #242933; padding-bottom:5px; margin-bottom:8px;">
            ${lat.toFixed(5)}°N, ${lng.toFixed(5)}°E
          </div>
          <div style="background:#191d24; border:1px solid #242933; border-radius:4px; padding:6px 8px; font-size:11px; margin-bottom:10px; line-height:1.5;">
            <div style="display:flex; justify-content:space-between;">
              <span style="color:#656d7d;">ELEVATION:</span>
              <span style="color:#edf0f5; font-weight:700;">${elevM} m</span>
            </div>
            <div style="display:flex; justify-content:space-between;">
              <span style="color:#656d7d;">SECTOR:</span>
              <span style="color:${haz.isFault ? '#ef4444' : '#22c55e'}; font-weight:700;">${haz.label}</span>
            </div>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <button onclick="window.dispatchSetArbitraryOrigin(${lat}, ${lng})" style="
              width:100%; min-height:38px; padding:6px 12px; background:#191d24; color:#38bdf8;
              border:1px solid #38bdf8; border-radius:4px; font-weight:700; font-size:11px; cursor:pointer; text-transform:uppercase; font-family:'JetBrains Mono',monospace;
            ">SET AS ORIGIN (START)</button>
            <button onclick="window.dispatchSetArbitraryDestination(${lat}, ${lng})" style="
              width:100%; min-height:38px; padding:6px 12px; background:#16a34a; color:#0b0d11;
              border:1px solid #22c55e; border-radius:4px; font-weight:700; font-size:11px; cursor:pointer; text-transform:uppercase; font-family:'JetBrains Mono',monospace;
            ">ROUTE TO THIS DESTINATION</button>
          </div>
        </div>
      `;
      L.popup({ minWidth: 260, offset: [0, -4] })
        .setLatLng(latlng)
        .setContent(content)
        .openOn(map);
    };

    // Map click handler for polygon drawing, arbitrary picking mode, or coordinate context
    const handleMapClick = (e) => {
      const lat = Number(e.latlng.lat.toFixed(6));
      const lng = Number(e.latlng.lng.toFixed(6));

      if (rfProbeActiveRef.current) {
        onProbeRfCommsRef.current?.([lat, lng]);
        return;
      }

      if (activeDrawModeRef.current) {
        onAddDrawVertexRef.current?.([lat, lng]);
        return;
      }

      if (activePickModeRef.current === 'origin') {
        onSetArbitraryOriginRef.current?.([lat, lng]);
        onClearPickModeRef.current?.();
        return;
      }

      if (activePickModeRef.current === 'dest') {
        onSetArbitraryDestinationRef.current?.([lat, lng]);
        onClearPickModeRef.current?.();
        return;
      }

      showCoordinateContextPopup(lat, lng, e.latlng);
    };
    map.on('click', handleMapClick);

    // Right-click contextmenu for instant tactical coordinate context anywhere on Mars
    const handleMapContextMenu = (e) => {
      L.DomEvent.preventDefault(e);
      const lat = Number(e.latlng.lat.toFixed(6));
      const lng = Number(e.latlng.lng.toFixed(6));
      showCoordinateContextPopup(lat, lng, e.latlng);
    };
    map.on('contextmenu', handleMapContextMenu);

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

    // Disengage GPS camera tether when user manually pans/drags the map
    const handleDragStart = () => {
      onUserPanRef.current?.();
    };
    map.on('dragstart', handleDragStart);

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
      map.off('contextmenu', handleMapContextMenu);
      map.off('mousemove', handleMouseMove);
      map.off('dragstart', handleDragStart);
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

  // Update draw cursor & disable doubleClickZoom while actively placing polygon vertices or picking vectors
  useEffect(() => {
    const map = mapInstanceRef.current;
    const container = mapContainerRef.current;
    if (!map || !container) return;

    if (activeDrawMode || activePickMode) {
      container.style.cursor = 'crosshair';
      map.doubleClickZoom.disable();
    } else {
      container.style.cursor = '';
      map.doubleClickZoom.enable();
    }
  }, [activeDrawMode, activePickMode]);

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
      satellite: '/data/ctx_full_stage6.png',
      terrain: '/data/hrsc_hillshade.png',
      elevation: '/data/consolidated_depth_map.png',
      themis: '/data/consolidated_depth_map.png',
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

  // Fly-to when Quick Landmark, Target, or Origin changes (runs once per unique timestamp)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !flyToTarget?.timestamp || !flyToTarget.latLon) return;
    if (lastFlyToTargetTimestampRef.current === flyToTarget.timestamp) return;
    lastFlyToTargetTimestampRef.current = flyToTarget.timestamp;

    map.flyTo(flyToTarget.latLon, flyToTarget.zoom || 14, {
      animate: true,
      duration: 0.9,
      easeLinearity: 0.25,
    });
  }, [flyToTarget]);

  // Smooth Animated Fly-To Zoom when Locate EVA / North Pin is pressed (runs once per unique timestamp)
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !locatePulse?.timestamp) return;
    if (lastLocatePulseTimestampRef.current === locatePulse.timestamp) return;
    lastLocatePulseTimestampRef.current = locatePulse.timestamp;

    const targetCoords = locatePulse.latLon || liveNavState?.currentLatLon;
    if (!targetCoords) return;

    map.flyTo(targetCoords, locatePulse.zoom || 14.5, {
      animate: true,
      duration: 1.0,
      easeLinearity: 0.25,
    });
  }, [locatePulse]);

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
        if (tilt >= 14) color = '#f59e0b'; // >= 14 deg steep grade (amber dot; red reserved for depth-map hazard shapes)
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

  // Render Depth-Map Hazard Regions (Preprocess Stages 1, 2 & 4 polygon shapes instead of red circles)
  useEffect(() => {
    const { hazards } = layerGroupsRef.current;
    if (!hazards) return;
    hazards.clearLayers();

    if (!layers.hazards) return;

    let cancelled = false;

    const renderGeoRegions = (geojson) => {
      if (cancelled || !geojson?.features?.length) return;
      hazards.clearLayers();
      L.geoJSON(geojson, {
        style: (feature) => {
          const sev = feature?.properties?.severity;
          const isCritical = sev === 'critical';
          return {
            color: isCritical ? APP_THEME.colors.fault : APP_THEME.colors.faultDark,
            fillColor: isCritical ? APP_THEME.colors.fault : APP_THEME.colors.faultDark,
            fillOpacity: isCritical ? 0.28 : 0.16,
            weight: isCritical ? 1.4 : 1.0,
            opacity: isCritical ? 0.85 : 0.65,
          };
        },
        onEachFeature: (feature, layer) => {
          const p = feature?.properties || {};
          const isCritical = p.severity === 'critical';
          layer.bindPopup(`
            <div style="font-size:11px; max-width:240px; font-family:'JetBrains Mono',monospace;">
              <div style="font-weight:700; color:#ef4444; text-transform:uppercase; font-size:10px; border-bottom:1px solid #242933; padding-bottom:4px; margin-bottom:4px;">
                [FAULT] ${(p.severity || 'HIGH').toUpperCase()} DEPTH-MAP HAZARD
              </div>
              <div style="font-weight:700; font-size:12px; color:#edf0f5; margin-bottom:4px;">${p.label || 'STEEP TERRAIN REGION'}</div>
              <div style="color:#9da5b4; line-height:1.5;">
                <div>PEAK GRADE: <span style="color:${isCritical ? '#ef4444' : '#edf0f5'}; font-weight:700;">${p.peakSlopeDeg ?? '--'} deg</span></div>
                <div>ELEVATION: <span style="color:#edf0f5;">${p.minElevM ?? '--'} m .. ${p.maxElevM ?? '--'} m</span></div>
                <div>REGION AREA: <span style="color:#edf0f5;">${p.areaKm2 ?? '--'} km²</span></div>
              </div>
              <p style="margin:6px 0 0; color:#656d7d; font-family:'Inter',sans-serif; font-size:10px; line-height:1.35;">
                Derived from Preprocess Stages 1, 2 & 4 consolidated DEM & slope grids.
              </p>
            </div>
          `);
        },
      }).addTo(hazards);
    };

    if (depthHazardsGeoRef.current) {
      renderGeoRegions(depthHazardsGeoRef.current);
    } else {
      loadDepthHazardRegions()
        .then((geojson) => {
          if (geojson) {
            depthHazardsGeoRef.current = geojson;
            renderGeoRegions(geojson);
          }
        })
        .catch(() => {});
    }

    return () => {
      cancelled = true;
    };
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
        <div style="font-size:12px; min-width:260px; max-width:280px; font-family:'JetBrains Mono',monospace;">
          <div style="font-weight:700; color:#22c55e; font-size:11px; text-transform:uppercase; margin-bottom:3px; letter-spacing:0.04em;">
            ${poi.type.toUpperCase()} NODE
          </div>
          <div style="font-weight:700; font-size:13px; color:#edf0f5; border-bottom:1px solid #242933; padding-bottom:5px; margin-bottom:8px;">
            ${poi.name}
          </div>
          <p style="margin:0 0 10px; color:#9da5b4; font-family:'Inter',sans-serif; font-size:12px; line-height:1.45;">
            ${poi.description}
          </p>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <button onclick="window.dispatchSetOrigin('${poi.id}')" style="
              width:100%; min-height:42px; padding:8px 12px; background:#191d24; color:#edf0f5;
              border:1px solid #353c4a; border-radius:6px; font-weight:700; font-size:11.5px; cursor:pointer; text-transform:uppercase; font-family:'JetBrains Mono',monospace;
            ">SET AS ORIGIN BASE</button>
            <button onclick="window.dispatchNavigateTo('${poi.id}')" style="
              width:100%; min-height:42px; padding:8px 12px; background:#16a34a; color:#0b0d11;
              border:1px solid #22c55e; border-radius:6px; font-weight:700; font-size:11.5px; cursor:pointer; text-transform:uppercase; font-family:'JetBrains Mono',monospace;
            ">ROUTE TO TARGET</button>
            ${
              matchingLm
                ? `<button onclick="window.dispatchOpenLandmark('${matchingLm.id}')" style="
                    width:100%; min-height:42px; padding:8px 12px; background:#222731; color:#22c55e;
                    border:1px solid rgba(34,197,94,0.45); border-radius:6px; font-weight:700; font-size:11.5px; cursor:pointer; text-transform:uppercase; font-family:'JetBrains Mono',monospace;
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
        <div style="font-size:12px; min-width:270px; max-width:300px; font-family:'Inter',sans-serif;">
          <div style="font-family:'JetBrains Mono',monospace; font-size:10.5px; color:#22c55e; font-weight:700; text-transform:uppercase; letter-spacing:0.06em;">
            REGIONAL LANDMARK
          </div>
          <div style="font-weight:700; font-size:14px; color:#edf0f5; margin:3px 0 5px;">
            ${lm.name}
          </div>
          <div style="font-size:11.5px; color:#9da5b4; margin-bottom:10px; line-height:1.4;">
            ${lm.type || 'Jezero Geologic Feature'} // ${lm.region || 'Jezero Quadrangle'}
          </div>
          <div style="background:#191d24; border:1px solid #242933; border-radius:6px; padding:8px; font-size:11px; margin-bottom:10px; font-family:'JetBrains Mono',monospace; line-height:1.6;">
            <div><span style="color:#656d7d;">ELEV:</span> <span style="color:#edf0f5; font-weight:700;">${lm.elevation_m} m</span></div>
            <div><span style="color:#656d7d;">COORDS:</span> <span style="color:#edf0f5;">${lm.coords[0].toFixed(4)} N, ${lm.coords[1].toFixed(4)} E</span></div>
            <div><span style="color:#656d7d;">SOIL:</span> <span style="color:#9da5b4;">${regolith}</span></div>
          </div>
          <div style="display:flex; flex-direction:column; gap:6px;">
            <button onclick="window.dispatchOpenLandmark('${lm.id}')" style="
              width:100%; min-height:42px; padding:8px 12px; background:#191d24; color:#edf0f5;
              border:1px solid #353c4a; border-radius:6px; font-weight:700; font-size:11px;
              font-family:'JetBrains Mono',monospace; cursor:pointer; text-transform:uppercase;
            ">OPEN DOSSIER & 6-PHOTO LOG</button>
            <button onclick="window.dispatchOpenLandmarkVista('${lm.id}')" style="
              width:100%; min-height:42px; padding:8px 12px; background:#222731; color:#edf0f5;
              border:1px solid #4f5767; border-radius:6px; font-weight:700; font-size:11px;
              font-family:'JetBrains Mono',monospace; cursor:pointer; text-transform:uppercase;
            ">OPEN SURFACE VISTA / 360</button>
            <button onclick="window.dispatchSetOrigin('${lm.id}')" style="
              width:100%; min-height:42px; padding:8px 12px; background:#191d24; color:#9da5b4;
              border:1px solid #353c4a; border-radius:6px; font-weight:700; font-size:11px;
              font-family:'JetBrains Mono',monospace; cursor:pointer; text-transform:uppercase;
            ">SET AS ORIGIN BASE</button>
            <button onclick="window.dispatchNavigateTo('${lm.id}')" style="
              width:100%; min-height:42px; padding:8px 12px; background:#16a34a; color:#0b0d11;
              border:1px solid #22c55e; border-radius:6px; font-weight:700; font-size:11px;
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

    const {
      currentLatLon,
      heading = 0,
      viewHeading,
      currentBattery = 85,
      isRecharging,
      active,
    } = liveNavState;
    const displayHeading = viewHeading ?? heading;
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
        <div class="nav-heading-beam" style="transform: translateX(-50%) rotate(${displayHeading}deg); transform-origin: bottom center;"></div>

        <div style="transform: rotate(${displayHeading}deg); transform-origin: center center; display: flex; align-items: center; justify-content: center;">
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
      const prev = lastPannedCoordRef.current;
      const moved =
        !prev ||
        Math.abs(prev[0] - currentLatLon[0]) > 0.00002 ||
        Math.abs(prev[1] - currentLatLon[1]) > 0.00002;
      if (moved) {
        lastPannedCoordRef.current = currentLatLon;
        map.panTo(currentLatLon, { animate: true, duration: 0.35 });
      }
    }
  }, [liveNavState, followAstronaut]);

  // Render Prominent Draggable Route Endpoints (Origin Base & Target Waypoint)
  useEffect(() => {
    const { endpoints } = layerGroupsRef.current;
    if (!endpoints) return;
    endpoints.clearLayers();

    // 1. Render tactical Start / Origin marker
    if (startPOI && startPOI.lat != null && startPOI.lon != null) {
      const startIcon = L.divIcon({
        className: 'mars-tactical-start-marker',
        html: `
          <div style="position:relative; display:flex; flex-direction:column; align-items:center; pointer-events:auto; transform:translate(-50%, -100%);">
            <div style="
              white-space:nowrap; background:#0b0d11; color:#38bdf8; border:1.5px solid #38bdf8;
              font-size:9.5px; font-weight:700; font-family:'JetBrains Mono',monospace; padding:2px 7px;
              border-radius:4px; margin-bottom:3px; box-shadow:0 0 10px rgba(56,189,248,0.4);
            ">ORIGIN // START</div>
            <div style="
              width:32px; height:32px; border-radius:50%; background:#0b0d11;
              border:2.5px solid #38bdf8; display:flex; align-items:center; justify-content:center;
              box-shadow:0 0 12px rgba(56,189,248,0.55); cursor:grab;
            ">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38bdf8" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
                <path d="M2 12h20" />
              </svg>
            </div>
            <div style="width:2px; height:6px; background:#38bdf8;"></div>
            <div style="width:6px; height:6px; border-radius:50%; background:#38bdf8;"></div>
          </div>
        `,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const startMarker = L.marker([startPOI.lat, startPOI.lon], {
        icon: startIcon,
        draggable: true,
        zIndexOffset: 900,
      });

      startMarker.bindPopup(`
        <div style="font-size:12px; min-width:250px; font-family:'JetBrains Mono',monospace;">
          <div style="font-weight:700; color:#38bdf8; font-size:11px; text-transform:uppercase; margin-bottom:2px;">
            TRAVERSE ORIGIN
          </div>
          <div style="font-weight:700; font-size:13px; color:#edf0f5; border-bottom:1px solid #242933; padding-bottom:4px; margin-bottom:6px;">
            ${startPOI.name}
          </div>
          <div style="background:#191d24; border:1px solid #242933; border-radius:4px; padding:6px; font-size:11px; margin-bottom:8px; line-height:1.5;">
            <div><span style="color:#656d7d;">COORDS:</span> <span style="color:#edf0f5;">${Number(startPOI.lat).toFixed(5)}°N, ${Number(startPOI.lon).toFixed(5)}°E</span></div>
            <div><span style="color:#656d7d;">ELEVATION:</span> <span style="color:#edf0f5;">${estimateElev(startPOI.lat, startPOI.lon)} m</span></div>
          </div>
          <div style="font-size:10px; color:#9da5b4; font-family:'Inter',sans-serif;">
            Drag this marker anywhere on Mars to reposition origin.
          </div>
        </div>
      `);

      startMarker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        onSetArbitraryOriginRef.current?.([
          Number(pos.lat.toFixed(6)),
          Number(pos.lng.toFixed(6)),
        ]);
      });

      startMarker.addTo(endpoints);
    }

    // 2. Render tactical Target / Destination marker
    if (endPOI && endPOI.lat != null && endPOI.lon != null) {
      const endIcon = L.divIcon({
        className: 'mars-tactical-dest-marker',
        html: `
          <div style="position:relative; display:flex; flex-direction:column; align-items:center; pointer-events:auto; transform:translate(-50%, -100%);">
            <div style="
              white-space:nowrap; background:#0b0d11; color:#22c55e; border:1.5px solid #22c55e;
              font-size:9.5px; font-weight:700; font-family:'JetBrains Mono',monospace; padding:2px 7px;
              border-radius:4px; margin-bottom:3px; box-shadow:0 0 10px rgba(34,197,94,0.4);
            ">TARGET // DEST</div>
            <div style="
              width:32px; height:32px; border-radius:50%; background:#0b0d11;
              border:2.5px solid #22c55e; display:flex; align-items:center; justify-content:center;
              box-shadow:0 0 12px rgba(34,197,94,0.55); cursor:grab;
            ">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#22c55e" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <circle cx="12" cy="12" r="10" />
                <circle cx="12" cy="12" r="6" />
                <circle cx="12" cy="12" r="2" />
              </svg>
            </div>
            <div style="width:2px; height:6px; background:#22c55e;"></div>
            <div style="width:6px; height:6px; border-radius:50%; background:#22c55e;"></div>
          </div>
        `,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      const endMarker = L.marker([endPOI.lat, endPOI.lon], {
        icon: endIcon,
        draggable: true,
        zIndexOffset: 950,
      });

      endMarker.bindPopup(`
        <div style="font-size:12px; min-width:250px; font-family:'JetBrains Mono',monospace;">
          <div style="font-weight:700; color:#22c55e; font-size:11px; text-transform:uppercase; margin-bottom:2px;">
            TRAVERSE TARGET
          </div>
          <div style="font-weight:700; font-size:13px; color:#edf0f5; border-bottom:1px solid #242933; padding-bottom:4px; margin-bottom:6px;">
            ${endPOI.name}
          </div>
          <div style="background:#191d24; border:1px solid #242933; border-radius:4px; padding:6px; font-size:11px; margin-bottom:8px; line-height:1.5;">
            <div><span style="color:#656d7d;">COORDS:</span> <span style="color:#edf0f5;">${Number(endPOI.lat).toFixed(5)}°N, ${Number(endPOI.lon).toFixed(5)}°E</span></div>
            <div><span style="color:#656d7d;">ELEVATION:</span> <span style="color:#edf0f5;">${estimateElev(endPOI.lat, endPOI.lon)} m</span></div>
          </div>
          <div style="font-size:10px; color:#9da5b4; font-family:'Inter',sans-serif;">
            Drag this marker anywhere on Mars to reposition target.
          </div>
        </div>
      `);

      endMarker.on('dragend', (e) => {
        const pos = e.target.getLatLng();
        onSetArbitraryDestinationRef.current?.([
          Number(pos.lat.toFixed(6)),
          Number(pos.lng.toFixed(6)),
        ]);
      });

      endMarker.addTo(endpoints);
    }
  }, [
    startPOI?.lat,
    startPOI?.lon,
    startPOI?.name,
    endPOI?.lat,
    endPOI?.lon,
    endPOI?.name,
  ]);

  // Render RF Comms 7-Mast Raymarch Probe
  useEffect(() => {
    const { rfProbe } = layerGroupsRef.current;
    if (!rfProbe) return;
    rfProbe.clearLayers();
    if (!rfProbeResult?.location) return;

    const [pLat, pLon] = rfProbeResult.location;

    // Probe Origin Marker
    const probeIcon = L.divIcon({
      className: 'rf-probe-origin-marker',
      html: `
        <div style="
          width:24px; height:24px; border-radius:50%; background:rgba(56,189,248,0.25);
          border:2px solid #38bdf8; display:flex; align-items:center; justify-content:center;
          box-shadow:0 0 14px #38bdf8;
        ">
          <div style="width:8px; height:8px; border-radius:50%; background:#38bdf8;"></div>
        </div>
      `,
      iconSize: [24, 24],
      iconAnchor: [12, 12],
    });

    L.marker([pLat, pLon], { icon: probeIcon, zIndexOffset: 1100 })
      .bindTooltip(`RF PROBE: ${pLat.toFixed(5)}°N, ${pLon.toFixed(5)}°E`, { permanent: false, sticky: true })
      .addTo(rfProbe);

    // 3D Line-of-sight rays to each of the 7 towers
    (rfProbeResult.towers || []).forEach((tow) => {
      const isLos = tow.has_los;
      L.polyline([[pLat, pLon], [tow.lat, tow.lon]], {
        color: isLos ? '#22c55e' : '#ef4444',
        weight: isLos ? 2.5 : 1.5,
        dashArray: isLos ? null : '6, 6',
        opacity: isLos ? 0.95 : 0.6,
      })
        .bindTooltip(
          `<b>${tow.name}</b><br/>${isLos ? `LOS CLEAR • ${tow.distance_km} km • ${tow.path_loss_db} dB FSPL` : `TERRAIN OCCLUDED • ${tow.distance_km} km`}`,
          { sticky: true }
        )
        .addTo(rfProbe);
    });
  }, [rfProbeResult]);

  // Render Martian Orienteering Science Tour Circuit
  useEffect(() => {
    const { scienceTour } = layerGroupsRef.current;
    if (!scienceTour) return;
    scienceTour.clearLayers();
    if (!scienceTourResult?.legs?.length) return;

    const legColors = ['#38bdf8', '#22c55e', '#f59e0b', '#ec4899', '#8b5cf6', '#06b6d4'];

    scienceTourResult.legs.forEach((leg, i) => {
      const coords = (leg.path_coords || []).map((pt) => [pt[1], pt[0]]);
      if (coords.length > 0) {
        const color = legColors[i % legColors.length];
        L.polyline(coords, {
          color: '#0b0d11',
          weight: 6,
          opacity: 0.9,
          lineJoin: 'round',
        }).addTo(scienceTour);

        L.polyline(coords, {
          color,
          weight: 3.5,
          opacity: 1.0,
          lineJoin: 'round',
        })
          .bindTooltip(
            `<b>TOUR LEG ${i + 1}</b><br/>${leg.from_stop} &rarr; ${leg.to_stop}<br/>${Number((leg.dist_km ?? 0).toFixed(2))} km (${leg.duration_min ?? '?'} min)`,
            { sticky: true }
          )
          .addTo(scienceTour);
      }
    });

    (scienceTourResult.ordered_stops || []).forEach((stop, idx) => {
      const isBase = idx === 0 || idx === scienceTourResult.ordered_stops.length - 1;
      const stopIcon = L.divIcon({
        className: 'tour-stop-marker',
        html: `
          <div style="
            padding:2px 8px; border-radius:12px;
            background:${isBase ? '#d97706' : '#0284c7'};
            color:#ffffff; font-size:10px; font-weight:700;
            font-family:'JetBrains Mono',monospace; border:1.5px solid #ffffff;
            box-shadow:0 2px 8px rgba(0,0,0,0.8); white-space:nowrap;
          ">
            ${idx}. ${stop.name}
          </div>
        `,
        iconSize: [0, 0],
        iconAnchor: [0, 0],
      });

      L.marker([stop.lat, stop.lon], { icon: stopIcon, zIndexOffset: 1000 })
        .bindTooltip(
          `<b>${stop.name}</b> [Stop ${idx}]<br/>Arrival: ${stop.arrival_lst || '09:00 LST'}<br/>${isBase ? 'Mission Base' : `Sample collection (${stop.dwell_time_min ?? 25}m dwell)`}`,
          { sticky: true }
        )
        .addTo(scienceTour);
    });
  }, [scienceTourResult]);

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
