import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import APP_THEME from '../theme';
import {
  estimateElev,
  estimateSlope,
  checkCursorHazards,
  setLoadedDemData,
} from '../utils/pathfinder';

const REGIONAL_BOUNDS = APP_THEME.regionalBounds;
const TERRAIN_W = 100;
const TERRAIN_D = 105;
const BASE_RELIEF_H = 8.5;

const BASEMAP_TEXTURES = {
  satellite: '/terrain/jezero_ctx_ortho.png',
  terrain: '/data/hrsc_hillshade.png',
  elevation: '/data/consolidated_depth_map.png',
  themis: '/data/themis_night_ir.png',
  default: '/data/hrsc_elevation_color.png',
};

const GROUND_CONTROL_SCIENCE_HAZARDS = [
  {
    name: 'DELTA FRONT ESCARPMENT',
    type: 'SLOPE / CLIFF ROLLOVER (>25 DEG GRADE)',
    lat: 18.525,
    lon: 77.382,
    radius: 950,
    color: APP_THEME.hazards.heat.color,
    severity: 'CRITICAL',
  },
  {
    name: 'SEITAH DUNE FIELD',
    type: 'REGOLITH ENTRAPMENT / HIGH SLIP (>40%)',
    lat: 18.435,
    lon: 77.442,
    radius: 800,
    color: APP_THEME.hazards.rough.color,
    severity: 'HIGH',
  },
  {
    name: 'NORTH RIM THERMAL INERTIA',
    type: 'EXTREME THERMAL SHOCK / HIGH ROCK FRACTION',
    lat: 18.63,
    lon: 77.455,
    radius: 1200,
    color: APP_THEME.hazards.heat.color,
    severity: 'MODERATE',
  },
  {
    name: 'BELVA CRATER PERCHLORATE ZONE',
    type: 'CORROSIVE OXIDANT CONCENTRATION (>0.8 WT%)',
    lat: 18.505,
    lon: 77.492,
    radius: 900,
    color: APP_THEME.hazards.chemical.color,
    severity: 'HAZARDOUS',
  },
  {
    name: 'WEST HIGHLANDS GCR FLUX PEAK',
    type: 'UNSHIELDED COSMIC RADIATION (0.84 mSv/d)',
    lat: 18.58,
    lon: 77.31,
    radius: 1100,
    color: APP_THEME.hazards.radiation.color,
    severity: 'CAUTION',
  },
];

function getDemBounds(dem) {
  return {
    latMin: dem?.latMin ?? REGIONAL_BOUNDS[0][0],
    latMax: dem?.latMax ?? REGIONAL_BOUNDS[1][0],
    lonMin: dem?.lonMin ?? REGIONAL_BOUNDS[0][1],
    lonMax: dem?.lonMax ?? REGIONAL_BOUNDS[1][1],
  };
}

function latLonToSceneXZ(lat, lon, dem) {
  const b = getDemBounds(dem);
  const u = (lon - b.lonMin) / (b.lonMax - b.lonMin);
  const v = (b.latMax - lat) / (b.latMax - b.latMin);
  return {
    x: (u - 0.5) * TERRAIN_W,
    z: (v - 0.5) * TERRAIN_D,
  };
}

function sceneXZToLatLon(x, z, dem) {
  const b = getDemBounds(dem);
  const u = x / TERRAIN_W + 0.5;
  const v = z / TERRAIN_D + 0.5;
  const lon = b.lonMin + Math.max(0, Math.min(1, u)) * (b.lonMax - b.lonMin);
  const lat = b.latMax - Math.max(0, Math.min(1, v)) * (b.latMax - b.latMin);
  return { lat, lon };
}

function sampleDemBilinear(dem, lat, lon) {
  if (!dem || !Array.isArray(dem.elevations)) {
    return { elev: estimateElev(lat, lon), slope: estimateSlope(lat, lon), hazardStatus: 0 };
  }
  const b = getDemBounds(dem);
  const u = Math.max(0, Math.min(1, (lon - b.lonMin) / (b.lonMax - b.lonMin)));
  const v = Math.max(0, Math.min(1, (b.latMax - lat) / (b.latMax - b.latMin)));
  const fx = u * (dem.ncols - 1);
  const fy = v * (dem.nrows - 1);
  const c0 = Math.floor(fx);
  const r0 = Math.floor(fy);
  const c1 = Math.min(dem.ncols - 1, c0 + 1);
  const r1 = Math.min(dem.nrows - 1, r0 + 1);
  const tx = fx - c0;
  const ty = fy - r0;
  const i00 = r0 * dem.ncols + c0;
  const i10 = r0 * dem.ncols + c1;
  const i01 = r1 * dem.ncols + c0;
  const i11 = r1 * dem.ncols + c1;
  const lerp = (arr) => {
    const a = arr[i00] * (1 - tx) + arr[i10] * tx;
    const bVal = arr[i01] * (1 - tx) + arr[i11] * tx;
    return a * (1 - ty) + bVal * ty;
  };
  const elev = lerp(dem.elevations);
  const slope = Array.isArray(dem.slopes) ? lerp(dem.slopes) : 0;
  const nr = Math.round(fy);
  const nc = Math.round(fx);
  const hazardStatus = Array.isArray(dem.hazardStatus) ? dem.hazardStatus[nr * dem.ncols + nc] : 0;
  return { elev, slope, hazardStatus };
}

function elevToSceneY(elev, dem, depthExaggeration) {
  const minE = dem?.minElev ?? -3070;
  const maxE = dem?.maxElev ?? -1376;
  const t = Math.max(0, Math.min(1, (elev - minE) / Math.max(1, maxE - minE)));
  return t * BASE_RELIEF_H * depthExaggeration;
}

function latLonToVec3(lat, lon, dem, depthExaggeration, yOffset = 0.25) {
  const { x, z } = latLonToSceneXZ(lat, lon, dem);
  const { elev } = sampleDemBilinear(dem, lat, lon);
  const y = elevToSceneY(elev, dem, depthExaggeration) + yOffset;
  return new THREE.Vector3(x, y, z);
}

/**
 * Depth luminance color ramp:
 * Deeper parts (t near 0) are dark (#0b0f17 -> #262e3d),
 * Mid elevation (t ~ 0.5) are slate-stone (#687385),
 * Upper parts (t near 1) are light (#dfe6f0 -> #f1f5f9).
 */
function depthLuminanceRGB(t, hazardStatus = 0, showSlopeTint = false) {
  const lum = Math.pow(Math.max(0, Math.min(1, t)), 0.88);
  let r = 0.045 + 0.86 * lum;
  let g = 0.058 + 0.87 * lum;
  let b = 0.085 + 0.86 * lum;

  // Subtle mineral warmth in mid-highlands without breaking dark-deep / light-upper contrast
  const midBell = Math.sin(lum * Math.PI);
  r += 0.035 * midBell;
  b -= 0.025 * midBell;

  if (showSlopeTint && hazardStatus >= 2) {
    r = r * 0.55 + 0.92 * 0.45;
    g = g * 0.45 + 0.22 * 0.55;
    b = b * 0.45 + 0.22 * 0.55;
  }
  return [Math.max(0, Math.min(1, r)), Math.max(0, Math.min(1, g)), Math.max(0, Math.min(1, b))];
}

function disposeGroup(group) {
  while (group.children.length > 0) {
    const child = group.children[0];
    group.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) {
      if (Array.isArray(child.material)) child.material.forEach((m) => m.dispose());
      else child.material.dispose();
    }
  }
}

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
  reliefBlend = 0.35,
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
  const containerRef = useRef(null);
  const sceneRef = useRef(null);
  const cameraRef = useRef(null);
  const rendererRef = useRef(null);
  const controlsRef = useRef(null);
  const terrainMeshRef = useRef(null);
  const skirtMeshRef = useRef(null);
  const overlayGroupsRef = useRef({});
  const textureCacheRef = useRef({});
  const demRef = useRef(null);
  const markerDomRefs = useRef(new Map());
  const projectedItemsRef = useRef([]);
  const flyAnimRef = useRef(null);
  const pulseStateRef = useRef({ active: false, t: 0, lat: 18.4446, lon: 77.4509 });

  const [demLoaded, setDemLoaded] = useState(false);
  const [depthExaggeration, setDepthExaggeration] = useState(2.8);
  const [cameraPreset, setCameraPreset] = useState('3d_plan');
  const [selectedPopup, setSelectedPopup] = useState(null);
  const [projectedMarkers, setProjectedMarkers] = useState([]);

  // Stable refs for event listeners
  const activeDrawModeRef = useRef(activeDrawMode);
  const onAddDrawVertexRef = useRef(onAddDrawVertex);
  const onCursorMoveRef = useRef(onCursorMove);
  const hazardZonesRef = useRef(hazardZones);
  const drawnZonesRef = useRef(drawnZones);
  const depthExaggerationRef = useRef(depthExaggeration);

  useEffect(() => {
    activeDrawModeRef.current = activeDrawMode;
    onAddDrawVertexRef.current = onAddDrawVertex;
    onCursorMoveRef.current = onCursorMove;
    hazardZonesRef.current = hazardZones;
    drawnZonesRef.current = drawnZones;
    depthExaggerationRef.current = depthExaggeration;
  });

  // Load consolidated 20m DEM JSON
  useEffect(() => {
    let cancelled = false;
    fetch('/terrain/jezero_dem.json')
      .then((res) => res.json())
      .then((dem) => {
        if (cancelled) return;
        demRef.current = dem;
        setLoadedDemData(dem);
        setDemLoaded(true);
      })
      .catch((err) => console.error('Failed to load consolidated jezero_dem.json:', err));
    return () => {
      cancelled = true;
    };
  }, []);

  // Build / update 3D terrain mesh + 3D depth skirt
  const rebuildTerrainGeometry = useCallback((dem, exag, showSlopeTint) => {
    const mesh = terrainMeshRef.current;
    const skirt = skirtMeshRef.current;
    if (!mesh || !dem) return;

    const { ncols, nrows, elevations, hazardStatus = [] } = dem;
    const geo = new THREE.PlaneGeometry(TERRAIN_W, TERRAIN_D, ncols - 1, nrows - 1);
    geo.rotateX(-Math.PI / 2);

    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    const minE = dem.minElev ?? -3070;
    const maxE = dem.maxElev ?? -1376;
    const span = Math.max(1, maxE - minE);

    for (let i = 0; i < pos.count; i++) {
      const r = Math.floor(i / ncols);
      const c = i % ncols;
      const idx = r * ncols + c;
      const e = elevations[idx] ?? minE;
      const t = Math.max(0, Math.min(1, (e - minE) / span));
      pos.setY(i, t * BASE_RELIEF_H * exag);

      const [cr, cg, cb] = depthLuminanceRGB(t, hazardStatus[idx] || 0, showSlopeTint);
      colors[i * 3] = cr;
      colors[i * 3 + 1] = cg;
      colors[i * 3 + 2] = cb;
    }

    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();

    if (mesh.geometry) mesh.geometry.dispose();
    mesh.geometry = geo;

    // Build 3D geological slab skirt around all 4 borders so depth is unmistakable
    if (skirt) {
      const baseBottom = -5.5;
      const verts = [];
      const skirtColors = [];

      const pushQuad = (x1, y1, z1, x2, y2, z2) => {
        verts.push(
          x1, y1, z1, x1, baseBottom, z1, x2, y2, z2,
          x2, y2, z2, x1, baseBottom, z1, x2, baseBottom, z2
        );
        for (let k = 0; k < 6; k++) {
          const isTop = k === 0 || k === 2 || k === 3;
          skirtColors.push(isTop ? 0.14 : 0.04, isTop ? 0.17 : 0.05, isTop ? 0.22 : 0.07);
        }
      };

      const getTopXYZ = (r, c) => {
        const i = r * ncols + c;
        return [pos.getX(i), pos.getY(i), pos.getZ(i)];
      };

      // North & South edges
      for (let c = 0; c < ncols - 1; c++) {
        const [nx1, ny1, nz1] = getTopXYZ(0, c);
        const [nx2, ny2, nz2] = getTopXYZ(0, c + 1);
        pushQuad(nx2, ny2, nz2, nx1, ny1, nz1);

        const [sx1, sy1, sz1] = getTopXYZ(nrows - 1, c);
        const [sx2, sy2, sz2] = getTopXYZ(nrows - 1, c + 1);
        pushQuad(sx1, sy1, sz1, sx2, sy2, sz2);
      }
      // West & East edges
      for (let r = 0; r < nrows - 1; r++) {
        const [wx1, wy1, wz1] = getTopXYZ(r, 0);
        const [wx2, wy2, wz2] = getTopXYZ(r + 1, 0);
        pushQuad(wx1, wy1, wz1, wx2, wy2, wz2);

        const [ex1, ey1, ez1] = getTopXYZ(r, ncols - 1);
        const [ex2, ey2, ez2] = getTopXYZ(r + 1, ncols - 1);
        pushQuad(ex2, ey2, ez2, ex1, ey1, ez1);
      }

      const skirtGeo = new THREE.BufferGeometry();
      skirtGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      skirtGeo.setAttribute('color', new THREE.Float32BufferAttribute(skirtColors, 3));
      skirtGeo.computeVertexNormals();
      if (skirt.geometry) skirt.geometry.dispose();
      skirt.geometry = skirtGeo;
    }
  }, []);

  // Initialize Three.js scene once
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color('#090b0f');
    scene.fog = new THREE.FogExp2('#090b0f', 0.0032);
    sceneRef.current = scene;

    const width = container.clientWidth || 800;
    const height = container.clientHeight || 540;
    const camera = new THREE.PerspectiveCamera(42, width / height, 0.2, 600);
    // Default 3D Tactical Plan View centered on Jezero landing/delta sector
    camera.position.set(-4, 34, 42);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.maxPolarAngle = Math.PI / 2 - 0.06;
    controls.minDistance = 8;
    controls.maxDistance = 145;
    controls.target.set(-5, 2.0, -5);
    controls.update();
    controlsRef.current = controls;

    // Lighting: subtle cool ambient + crisp directional sun light for 3D depth relief
    const hemi = new THREE.HemisphereLight('#dce6f5', '#0a0d12', 0.95);
    scene.add(hemi);

    const sun = new THREE.DirectionalLight('#fff4e6', 1.45);
    sun.position.set(-55, 75, -35);
    scene.add(sun);

    const rimLight = new THREE.DirectionalLight('#64748b', 0.45);
    rimLight.position.set(60, 28, 55);
    scene.add(rimLight);

    // Subtle spatial reference grid under the 3D slab
    const grid = new THREE.GridHelper(130, 26, '#1f2633', '#141922');
    grid.position.y = -5.6;
    scene.add(grid);

    // Terrain mesh & 3D slab skirt
    const terrainMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.88,
      metalness: 0.04,
      side: THREE.DoubleSide,
    });
    const terrainMesh = new THREE.Mesh(new THREE.BufferGeometry(), terrainMat);
    scene.add(terrainMesh);
    terrainMeshRef.current = terrainMesh;

    const skirtMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.95,
      metalness: 0.05,
      side: THREE.DoubleSide,
    });
    const skirtMesh = new THREE.Mesh(new THREE.BufferGeometry(), skirtMat);
    scene.add(skirtMesh);
    skirtMeshRef.current = skirtMesh;

    // Overlay groups
    const groups = {
      traverse: new THREE.Group(),
      slope: new THREE.Group(),
      hazards: new THREE.Group(),
      drawn: new THREE.Group(),
      route: new THREE.Group(),
      markers3d: new THREE.Group(),
      live: new THREE.Group(),
      dust: new THREE.Group(),
    };
    Object.values(groups).forEach((g) => scene.add(g));
    overlayGroupsRef.current = groups;

    // Raycaster for hover telemetry & draw clicks
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerDownPos = null;

    const getTerrainHit = (clientX, clientY) => {
      if (!terrainMeshRef.current || !demRef.current) return null;
      const rect = renderer.domElement.getBoundingClientRect();
      pointer.x = ((clientX - rect.left) / rect.width) * 2 - 1;
      pointer.y = -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hits = raycaster.intersectObject(terrainMeshRef.current, false);
      if (hits.length === 0) return null;
      return hits[0].point;
    };

    const handlePointerMove = (e) => {
      const pt = getTerrainHit(e.clientX, e.clientY);
      if (!pt || !onCursorMoveRef.current) return;
      const { lat, lon } = sceneXZToLatLon(pt.x, pt.z, demRef.current);
      const { elev } = sampleDemBilinear(demRef.current, lat, lon);
      const haz = checkCursorHazards(lat, lon, hazardZonesRef.current, drawnZonesRef.current);
      onCursorMoveRef.current({
        lat,
        lon,
        elevM: Math.round(elev * 10) / 10,
        hazardLabel: haz.label,
        isFault: haz.isFault,
      });
    };

    const handlePointerDown = (e) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
    };

    const handlePointerUp = (e) => {
      if (!pointerDownPos) return;
      const moved = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);
      pointerDownPos = null;
      if (moved > 5) return; // Ignore orbit/pan drags

      if (activeDrawModeRef.current && onAddDrawVertexRef.current) {
        const pt = getTerrainHit(e.clientX, e.clientY);
        if (pt) {
          const { lat, lon } = sceneXZToLatLon(pt.x, pt.z, demRef.current);
          onAddDrawVertexRef.current(Number(lat.toFixed(6)), Number(lon.toFixed(6)));
        }
      } else if (e.target === renderer.domElement) {
        setSelectedPopup(null);
      }
    };

    renderer.domElement.addEventListener('pointermove', handlePointerMove);
    renderer.domElement.addEventListener('pointerdown', handlePointerDown);
    renderer.domElement.addEventListener('pointerup', handlePointerUp);

    const ro = new ResizeObserver(() => {
      if (!container) return;
      const w = container.clientWidth || 800;
      const h = container.clientHeight || 540;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(container);

    let animId = 0;
    const projVec = new THREE.Vector3();

    const animate = () => {
      animId = requestAnimationFrame(animate);

      // Smooth camera flight
      if (flyAnimRef.current) {
        const anim = flyAnimRef.current;
        anim.progress = Math.min(1, anim.progress + 0.05);
        const ease = 1 - Math.pow(1 - anim.progress, 3);
        controls.target.lerpVectors(anim.startTarget, anim.endTarget, ease);
        camera.position.lerpVectors(anim.startCam, anim.endCam, ease);
        if (anim.progress >= 1) flyAnimRef.current = null;
      }

      // Animate locate radar pulse
      if (pulseStateRef.current.active && groups.live) {
        pulseStateRef.current.t += 0.025;
        const ring = groups.live.getObjectByName('locate-pulse-ring');
        if (ring) {
          const s = 1 + (pulseStateRef.current.t % 1) * 5.5;
          ring.scale.set(s, s, 1);
          ring.material.opacity = Math.max(0, 0.85 * (1 - (pulseStateRef.current.t % 1)));
        }
        if (pulseStateRef.current.t > 3.0) {
          pulseStateRef.current.active = false;
          if (ring) ring.visible = false;
        }
      }

      controls.update();
      renderer.render(scene, camera);

      // Project 3D marker anchors into 2D screen coordinates via direct DOM transforms
      const w = renderer.domElement.clientWidth;
      const h = renderer.domElement.clientHeight;
      for (const item of projectedItemsRef.current) {
        const el = markerDomRefs.current.get(item.key);
        if (!el) continue;
        projVec.copy(item.pos).project(camera);
        if (projVec.z > 1 || projVec.z < -1) {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
          continue;
        }
        const sx = (projVec.x * 0.5 + 0.5) * w;
        const sy = (-projVec.y * 0.5 + 0.5) * h;
        if (sx < -40 || sx > w + 40 || sy < -40 || sy > h + 40) {
          el.style.opacity = '0';
          el.style.pointerEvents = 'none';
        } else {
          el.style.opacity = '1';
          el.style.pointerEvents = 'auto';
          el.style.transform = `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) translate(-50%, -100%)`;
        }
      }
    };
    animate();

    return () => {
      cancelAnimationFrame(animId);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointermove', handlePointerMove);
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown);
      renderer.domElement.removeEventListener('pointerup', handlePointerUp);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Rebuild 3D geometry whenever DEM, depthExaggeration, or slope layer changes
  useEffect(() => {
    if (!demLoaded || !demRef.current) return;
    rebuildTerrainGeometry(demRef.current, depthExaggeration, Boolean(layers.slope));
  }, [demLoaded, depthExaggeration, layers.slope, rebuildTerrainGeometry]);

  // Update basemap texture & depth-luminance blending
  useEffect(() => {
    const mesh = terrainMeshRef.current;
    if (!mesh) return;
    const mat = mesh.material;
    const texUrl = BASEMAP_TEXTURES[basemap] || BASEMAP_TEXTURES.satellite;

    const applyTexture = (tex) => {
      if (!terrainMeshRef.current) return;
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      // When basemap is 'elevation', keep pure depth luminance strong; otherwise blend with reliefBlend
      if (basemap === 'elevation') {
        mat.map = tex;
        mat.color.set('#ffffff');
      } else {
        mat.map = tex;
        // Higher reliefBlend => slightly brighter texture, while vertexColors always keep deep=dark, upper=light
        const boost = 0.82 + reliefBlend * 0.35;
        mat.color.setRGB(boost, boost, boost);
      }
      mat.needsUpdate = true;
    };

    if (textureCacheRef.current[texUrl]) {
      applyTexture(textureCacheRef.current[texUrl]);
    } else {
      const loader = new THREE.TextureLoader();
      loader.load(texUrl, (tex) => {
        textureCacheRef.current[texUrl] = tex;
        applyTexture(tex);
      });
    }
  }, [basemap, reliefBlend]);

  // Update lighting for Martian solarPhase / weather
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    const exposureMap = {
      dawn: 0.85,
      day: 1.08,
      dusk: 0.82,
      night: 0.58,
    };
    if (rendererRef.current) {
      let exp = exposureMap[solarPhase] || 1.08;
      if (weatherCondition === 'dust_storm') exp *= 0.85;
      rendererRef.current.toneMappingExposure = exp;
    }
  }, [solarPhase, weatherCondition]);

  // Rebuild 3D Traverse & Slope Waypoints
  useEffect(() => {
    const travGroup = overlayGroupsRef.current.traverse;
    const slopeGroup = overlayGroupsRef.current.slope;
    if (!travGroup || !slopeGroup || !demRef.current) return;
    disposeGroup(travGroup);
    disposeGroup(slopeGroup);
    const dem = demRef.current;

    if (layers.traverse !== false && waypoints.length > 1) {
      const pts = waypoints.map((wp) => latLonToVec3(wp.lat, wp.lon, dem, depthExaggeration, 0.22));
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      const mat = new THREE.LineBasicMaterial({ color: APP_THEME.layers.traverseLine, transparent: true, opacity: 0.72 });
      travGroup.add(new THREE.Line(geo, mat));
    }

    if (layers.slope && waypoints.length > 0) {
      const dotGeo = new THREE.SphereGeometry(0.18, 8, 8);
      for (let i = 0; i < waypoints.length; i += 2) {
        const wp = waypoints[i];
        const tilt = wp.tilt || 0;
        const col = tilt > 15 ? APP_THEME.colors.fault : tilt > 8 ? '#edf0f5' : APP_THEME.colors.ok;
        const m = new THREE.Mesh(
          dotGeo.clone(),
          new THREE.MeshBasicMaterial({ color: col })
        );
        m.position.copy(latLonToVec3(wp.lat, wp.lon, dem, depthExaggeration, 0.3));
        slopeGroup.add(m);
      }
      dotGeo.dispose();
    }
  }, [demLoaded, waypoints, layers.traverse, layers.slope, depthExaggeration]);

  // Rebuild 3D Hazard Rings & Drawn Polygons
  useEffect(() => {
    const hazGroup = overlayGroupsRef.current.hazards;
    const drawnGroup = overlayGroupsRef.current.drawn;
    if (!hazGroup || !drawnGroup || !demRef.current) return;
    disposeGroup(hazGroup);
    disposeGroup(drawnGroup);
    const dem = demRef.current;

    const metersToScene = TERRAIN_W / 56100; // ~56.1 km across terrain width

    if (layers.hazards !== false) {
      const allHaz = [
        ...GROUND_CONTROL_SCIENCE_HAZARDS.map((h) => ({ ...h, radiusMeters: h.radius })),
        ...hazardZones,
      ];
      for (const hz of allHaz) {
        const rScene = Math.max(0.6, (hz.radiusMeters || hz.radius || 800) * metersToScene);
        const center = latLonToVec3(hz.lat, hz.lon, dem, depthExaggeration, 0.25);

        const ringGeo = new THREE.RingGeometry(rScene * 0.9, rScene, 36);
        ringGeo.rotateX(-Math.PI / 2);
        const ringMat = new THREE.MeshBasicMaterial({
          color: hz.color || APP_THEME.colors.fault,
          transparent: true,
          opacity: 0.75,
          side: THREE.DoubleSide,
        });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.position.copy(center);
        hazGroup.add(ring);

        const discGeo = new THREE.CircleGeometry(rScene * 0.9, 32);
        discGeo.rotateX(-Math.PI / 2);
        const discMat = new THREE.MeshBasicMaterial({
          color: hz.color || APP_THEME.colors.fault,
          transparent: true,
          opacity: 0.16,
          side: THREE.DoubleSide,
        });
        const disc = new THREE.Mesh(discGeo, discMat);
        disc.position.copy(center);
        hazGroup.add(disc);
      }
    }

    // Drawn exclusion / safe zones
    for (const zone of drawnZones) {
      if (!zone.coords || zone.coords.length < 3) continue;
      const isSafe = zone.type === 'safe';
      const col = isSafe ? APP_THEME.colors.ok : APP_THEME.colors.fault;
      const pts = zone.coords.map(([lat, lon]) => latLonToVec3(lat, lon, dem, depthExaggeration, 0.35));
      pts.push(pts[0].clone());
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      drawnGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: col })));
    }

    // Active drawing vertices
    if (drawVertices.length > 0) {
      const pts = drawVertices.map(([lat, lon]) => latLonToVec3(lat, lon, dem, depthExaggeration, 0.4));
      if (pts.length > 1) {
        const geo = new THREE.BufferGeometry().setFromPoints(pts);
        drawnGroup.add(new THREE.Line(geo, new THREE.LineBasicMaterial({ color: '#edf0f5' })));
      }
      const vGeo = new THREE.SphereGeometry(0.28, 10, 10);
      for (const p of pts) {
        const m = new THREE.Mesh(vGeo.clone(), new THREE.MeshBasicMaterial({ color: '#edf0f5' }));
        m.position.copy(p);
        drawnGroup.add(m);
      }
      vGeo.dispose();
    }
  }, [demLoaded, hazardZones, drawnZones, drawVertices, layers.hazards, depthExaggeration]);

  // Rebuild 3D Route Ribbons (Leg 1, Leg 2, Direct comparison, elevation posts)
  useEffect(() => {
    const routeGroup = overlayGroupsRef.current.route;
    if (!routeGroup || !demRef.current) return;
    disposeGroup(routeGroup);
    if (!routeResult) return;
    const dem = demRef.current;

    const addRibbon = (coords, color, tubeRadius = 0.24, lift = 0.45) => {
      if (!coords || coords.length < 2) return;
      const pts = coords.map(([lat, lon]) => latLonToVec3(lat, lon, dem, depthExaggeration, lift));
      const curve = new THREE.CatmullRomCurve3(pts);
      const segments = Math.min(220, Math.max(24, pts.length * 2));
      const tubeGeo = new THREE.TubeGeometry(curve, segments, tubeRadius, 8, false);
      const tubeMat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.45,
        roughness: 0.35,
      });
      routeGroup.add(new THREE.Mesh(tubeGeo, tubeMat));
    };

    const leg1Color = routeResult.isSurvivalPossible === false ? APP_THEME.routeLine.faultColor : APP_THEME.routeLine.coreColor;
    if (routeResult.leg1_coords?.length > 1) {
      addRibbon(routeResult.leg1_coords, leg1Color, 0.26, 0.55);
    } else if (routeResult.coords?.length > 1) {
      addRibbon(routeResult.coords, leg1Color, 0.26, 0.55);
    }

    if (routeResult.leg2_coords?.length > 1) {
      addRibbon(routeResult.leg2_coords, APP_THEME.routeLine.leg2Color, 0.24, 0.55);
    }

    if (showDirectComparison && startPOI && endPOI) {
      const p1 = latLonToVec3(startPOI.lat, startPOI.lon, dem, depthExaggeration, 0.8);
      const p2 = latLonToVec3(endPOI.lat, endPOI.lon, dem, depthExaggeration, 0.8);
      const geo = new THREE.BufferGeometry().setFromPoints([p1, p2]);
      const mat = new THREE.LineDashedMaterial({
        color: APP_THEME.routeLine.directColor,
        dashSize: 1.2,
        gapSize: 0.7,
      });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      routeGroup.add(line);
    }
  }, [demLoaded, routeResult, showDirectComparison, startPOI, endPOI, depthExaggeration]);

  // Rebuild 3D POI / Landmark Pins & Projected HTML Marker Anchors
  useEffect(() => {
    const markerGroup = overlayGroupsRef.current.markers3d;
    if (!markerGroup || !demRef.current) return;
    disposeGroup(markerGroup);
    const dem = demRef.current;

    const items = [];
    const pinMatBase = (col) =>
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.4 });

    if (layers.science !== false) {
      for (const poi of sciencePOIs) {
        const isCharging = poi.isChargingStation || poi.type === 'charging' || poi.type === 'habitat';
        const isStart = startPOI?.id === poi.id;
        const isEnd = endPOI?.id === poi.id;
        const col = isStart
          ? '#22c55e'
          : isEnd
          ? '#ef4444'
          : isCharging
          ? '#edf0f5'
          : '#9da5b4';

        const basePos = latLonToVec3(poi.lat, poi.lon, dem, depthExaggeration, 0.05);
        const pinH = isStart || isEnd || isCharging ? 2.4 : 1.7;
        const topPos = basePos.clone().add(new THREE.Vector3(0, pinH, 0));

        const stemGeo = new THREE.CylinderGeometry(0.06, 0.06, pinH, 6);
        const stem = new THREE.Mesh(stemGeo, pinMatBase(col));
        stem.position.copy(basePos).add(new THREE.Vector3(0, pinH / 2, 0));
        markerGroup.add(stem);

        const headGeo = new THREE.SphereGeometry(isStart || isEnd ? 0.36 : 0.26, 12, 12);
        const head = new THREE.Mesh(headGeo, pinMatBase(col));
        head.position.copy(topPos);
        markerGroup.add(head);

        items.push({
          key: `poi-${poi.id}`,
          kind: 'poi',
          data: poi,
          pos: topPos.clone().add(new THREE.Vector3(0, 0.45, 0)),
          label: poi.name.split('(')[0].trim().slice(0, 18),
          badge: isStart ? 'ORIGIN' : isEnd ? 'TARGET' : isCharging ? 'PWR/O2' : 'SCI',
          color: col,
        });
      }
    }

    if (layers.landmarks !== false) {
      for (const lm of landmarks) {
        const [lat, lon] = lm.coords || [];
        if (lat == null || lon == null) continue;
        const basePos = latLonToVec3(lat, lon, dem, depthExaggeration, 0.05);
        const pinH = 2.0;
        const topPos = basePos.clone().add(new THREE.Vector3(0, pinH, 0));

        const stemGeo = new THREE.CylinderGeometry(0.05, 0.05, pinH, 6);
        const stem = new THREE.Mesh(stemGeo, pinMatBase('#656d7d'));
        stem.position.copy(basePos).add(new THREE.Vector3(0, pinH / 2, 0));
        markerGroup.add(stem);

        const headGeo = new THREE.OctahedronGeometry(0.28, 0);
        const head = new THREE.Mesh(headGeo, pinMatBase('#edf0f5'));
        head.position.copy(topPos);
        markerGroup.add(head);

        items.push({
          key: `lm-${lm.id}`,
          kind: 'landmark',
          data: lm,
          pos: topPos.clone().add(new THREE.Vector3(0, 0.45, 0)),
          label: lm.name.slice(0, 18),
          badge: 'VISTA',
          color: '#edf0f5',
        });
      }
    }

    projectedItemsRef.current = items;
    setProjectedMarkers(items);
  }, [demLoaded, sciencePOIs, landmarks, startPOI, endPOI, layers.science, layers.landmarks, depthExaggeration]);

  // Update 3D Live Astronaut / Rover Puck
  useEffect(() => {
    const liveGroup = overlayGroupsRef.current.live;
    if (!liveGroup || !demRef.current) return;
    disposeGroup(liveGroup);
    const dem = demRef.current;

    let lat = liveNavState?.lat;
    let lon = liveNavState?.lon;
    if (lat == null || lon == null) {
      const home = sciencePOIs.find((p) => p.id === astronautLocId) || sciencePOIs[0];
      if (home) {
        lat = home.lat;
        lon = home.lon;
      }
    }
    if (lat == null || lon == null) return;

    const pos = latLonToVec3(lat, lon, dem, depthExaggeration, 0.5);

    const puckGeo = new THREE.CylinderGeometry(0.55, 0.65, 0.45, 16);
    const puckMat = new THREE.MeshStandardMaterial({
      color: '#22c55e',
      emissive: '#22c55e',
      emissiveIntensity: 0.75,
    });
    const puck = new THREE.Mesh(puckGeo, puckMat);
    puck.position.copy(pos);
    liveGroup.add(puck);

    const ringGeo = new THREE.RingGeometry(0.75, 0.95, 28);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: '#22c55e',
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.name = 'locate-pulse-ring';
    ring.position.copy(pos).add(new THREE.Vector3(0, -0.1, 0));
    ring.visible = pulseStateRef.current.active;
    liveGroup.add(ring);

    if (followAstronaut && controlsRef.current && cameraRef.current) {
      const prevTarget = controlsRef.current.target.clone();
      const delta = pos.clone().sub(prevTarget);
      controlsRef.current.target.copy(pos);
      cameraRef.current.position.add(delta);
    }
  }, [demLoaded, liveNavState, astronautLocId, sciencePOIs, followAstronaut, depthExaggeration]);

  // Trigger locate pulse
  useEffect(() => {
    if (!locatePulse) return;
    pulseStateRef.current = { active: true, t: 0, lat: locatePulse.lat, lon: locatePulse.lon };
    if (controlsRef.current && cameraRef.current && demRef.current) {
      const targetPos = latLonToVec3(locatePulse.lat, locatePulse.lon, demRef.current, depthExaggeration, 0.5);
      const offset = cameraRef.current.position.clone().sub(controlsRef.current.target);
      flyAnimRef.current = {
        progress: 0,
        startTarget: controlsRef.current.target.clone(),
        endTarget: targetPos,
        startCam: cameraRef.current.position.clone(),
        endCam: targetPos.clone().add(offset.clampLength(16, 42)),
      };
    }
  }, [locatePulse, depthExaggeration]);

  // Smooth camera flight to target
  useEffect(() => {
    if (!flyToTarget || !controlsRef.current || !cameraRef.current || !demRef.current) return;
    const targetPos = latLonToVec3(flyToTarget.lat, flyToTarget.lon, demRef.current, depthExaggeration, 0.5);
    const offset = cameraRef.current.position.clone().sub(controlsRef.current.target);
    flyAnimRef.current = {
      progress: 0,
      startTarget: controlsRef.current.target.clone(),
      endTarget: targetPos,
      startCam: cameraRef.current.position.clone(),
      endCam: targetPos.clone().add(offset.clampLength(18, 40)),
    };
  }, [flyToTarget, depthExaggeration]);

  // Dust squall 3D dome
  useEffect(() => {
    const dustGroup = overlayGroupsRef.current.dust;
    if (!dustGroup || !demRef.current) return;
    disposeGroup(dustGroup);
    if (!dustFrontState?.active || dustFrontState.lat == null) return;
    const dem = demRef.current;
    const metersToScene = TERRAIN_W / 56100;
    const rScene = Math.max(2.0, (dustFrontState.radiusM || 3500) * metersToScene);
    const center = latLonToVec3(dustFrontState.lat, dustFrontState.lon, dem, depthExaggeration, 0.2);

    const domeGeo = new THREE.SphereGeometry(rScene, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2);
    const domeMat = new THREE.MeshBasicMaterial({
      color: '#ef4444',
      transparent: true,
      opacity: 0.14,
      wireframe: true,
    });
    const dome = new THREE.Mesh(domeGeo, domeMat);
    dome.position.copy(center);
    dustGroup.add(dome);
  }, [demLoaded, dustFrontState, depthExaggeration]);

  const applyCameraPreset = (preset) => {
    setCameraPreset(preset);
    if (!controlsRef.current || !cameraRef.current) return;
    const t = controlsRef.current.target.clone();
    let endCam;
    if (preset === 'top_2d') {
      endCam = t.clone().add(new THREE.Vector3(0, 72, 0.01));
    } else if (preset === 'iso_3d') {
      endCam = t.clone().add(new THREE.Vector3(34, 30, 38));
    } else if (preset === 'rim_view') {
      endCam = new THREE.Vector3(24, 24, 32);
      t.set(-14, 4, -8);
    } else {
      endCam = t.clone().add(new THREE.Vector3(0, 34, 42));
    }
    flyAnimRef.current = {
      progress: 0,
      startTarget: controlsRef.current.target.clone(),
      endTarget: t,
      startCam: cameraRef.current.position.clone(),
      endCam,
    };
  };

  const handleZoomStep = (factor) => {
    if (!cameraRef.current || !controlsRef.current) return;
    const offset = cameraRef.current.position.clone().sub(controlsRef.current.target);
    offset.multiplyScalar(factor).clampLength(8, 145);
    cameraRef.current.position.copy(controlsRef.current.target).add(offset);
  };

  return (
    <div className="relative w-full h-full bg-[#090b0f] overflow-hidden select-none">
      <div
        ref={containerRef}
        className={`w-full h-full ${activeDrawMode ? 'cursor-crosshair' : 'cursor-grab active:cursor-grabbing'}`}
      />

      {/* Projected 3D Marker Pins */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden z-[20]">
        {projectedMarkers.map((m) => (
          <button
            key={m.key}
            type="button"
            ref={(el) => {
              if (el) markerDomRefs.current.set(m.key, el);
              else markerDomRefs.current.delete(m.key);
            }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedPopup(m);
              if (m.kind === 'poi' && onSelectPOI) onSelectPOI(m.data);
            }}
            style={{ opacity: 0 }}
            className="absolute top-0 left-0 flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] bg-[#13161c]/90 border border-[#353c4a] hover:border-[#edf0f5] text-[9.5px] font-mono text-[#edf0f5] shadow-md transition-colors whitespace-nowrap"
          >
            <span
              className="w-1.5 h-1.5 rounded-full shrink-0"
              style={{ backgroundColor: m.color }}
            />
            <span className="font-bold tracking-tight">{m.label}</span>
            {!cleanTabletMode && (
              <span className="text-[8px] px-1 rounded bg-[#191d24] text-[#9da5b4]">
                {m.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Selected 3D Pin Tactical Popup */}
      {selectedPopup && (
        <div className="absolute bottom-14 left-3 z-[460] w-[290px] bg-[#13161c]/95 border border-[#4f5767] rounded-[6px] p-3 font-mono text-[11px] text-[#edf0f5] shadow-2xl">
          <div className="flex items-start justify-between gap-2 pb-2 mb-2 border-b border-[#242933]">
            <div>
              <div className="text-[9px] font-bold text-[#9da5b4] uppercase tracking-wider">
                {selectedPopup.kind === 'poi' ? selectedPopup.data.type : selectedPopup.data.category}
              </div>
              <div className="text-[12px] font-bold text-[#edf0f5]">
                {selectedPopup.data.name}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setSelectedPopup(null)}
              className="text-[#9da5b4] hover:text-[#edf0f5] text-[11px] px-1"
            >
              ✕
            </button>
          </div>

          {selectedPopup.kind === 'poi' ? (
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] text-[#9da5b4]">
                <span>ELEV: {selectedPopup.data.elev} m</span>
                <span>SLOPE: {selectedPopup.data.slope_deg ?? '—'}°</span>
              </div>
              <p className="text-[10px] text-[#9da5b4] leading-relaxed">
                {selectedPopup.data.description}
              </p>
              <div className="flex flex-col gap-1.5 pt-1">
                {onSetOrigin && (
                  <button
                    type="button"
                    onClick={() => {
                      onSetOrigin(selectedPopup.data.id);
                      setSelectedPopup(null);
                    }}
                    className="w-full py-1 px-2 rounded bg-[#22c55e]/15 border border-[#22c55e]/50 text-[#22c55e] font-bold text-[10px] hover:bg-[#22c55e]/25"
                  >
                    SET AS ORIGIN BASE
                  </button>
                )}
                {onNavigateToPOI && (
                  <button
                    type="button"
                    onClick={() => {
                      onNavigateToPOI(selectedPopup.data.id);
                      setSelectedPopup(null);
                    }}
                    className="w-full py-1 px-2 rounded bg-[#edf0f5] text-[#0b0d11] font-bold text-[10px] hover:bg-white"
                  >
                    ROUTE TO TARGET
                  </button>
                )}
                {onOpenPanorama && selectedPopup.data.sol != null && (
                  <button
                    type="button"
                    onClick={() => onOpenPanorama(selectedPopup.data.sol)}
                    className="w-full py-1 px-2 rounded bg-[#191d24] border border-[#353c4a] text-[#edf0f5] text-[10px] hover:border-[#edf0f5]"
                  >
                    OPEN SURFACE VISTA / 360
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex justify-between text-[10px] text-[#9da5b4]">
                <span>ELEV: {selectedPopup.data.elevation_m} m</span>
                <span>SLOPE: {selectedPopup.data.slope_deg ?? '—'}°</span>
              </div>
              <p className="text-[10px] text-[#9da5b4] leading-relaxed">
                {selectedPopup.data.brief}
              </p>
              <div className="flex flex-col gap-1.5 pt-1">
                {onSelectLandmark && (
                  <button
                    type="button"
                    onClick={() => {
                      onSelectLandmark(selectedPopup.data);
                      setSelectedPopup(null);
                    }}
                    className="w-full py-1 px-2 rounded bg-[#edf0f5] text-[#0b0d11] font-bold text-[10px]"
                  >
                    OPEN DOSSIER & PHOTOS
                  </button>
                )}
                {onOpenLandmarkVista && (
                  <button
                    type="button"
                    onClick={() => onOpenLandmarkVista(selectedPopup.data.id)}
                    className="w-full py-1 px-2 rounded bg-[#191d24] border border-[#353c4a] text-[#edf0f5] text-[10px]"
                  >
                    OPEN SURFACE VISTA / 360
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 3D Depth & Camera Controls HUD (Bottom-Right) */}
      <div className="absolute bottom-3 right-3 z-[450] flex flex-col items-end gap-1.5 font-mono text-[9.5px]">
        <div className="flex items-center gap-1 bg-[#13161c]/95 border border-[#242933] rounded-[4px] p-1">
          {[
            { id: '3d_plan', label: '3D PLAN' },
            { id: 'iso_3d', label: 'ISO 3D' },
            { id: 'rim_view', label: 'RIM VIEW' },
            { id: 'top_2d', label: 'TOP 2D' },
          ].map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => applyCameraPreset(p.id)}
              className={`px-2 py-0.5 rounded-[3px] font-bold transition-colors ${
                cameraPreset === p.id
                  ? 'bg-[#edf0f5] text-[#0b0d11]'
                  : 'text-[#9da5b4] hover:text-[#edf0f5] hover:bg-[#191d24]'
              }`}
            >
              {p.label}
            </button>
          ))}
          <div className="w-[1px] h-3.5 bg-[#242933] mx-0.5" />
          <button
            type="button"
            onClick={() => handleZoomStep(0.8)}
            className="px-1.5 py-0.5 rounded bg-[#191d24] text-[#edf0f5] hover:bg-[#2c323f] font-bold"
            title="Zoom In"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => handleZoomStep(1.25)}
            className="px-1.5 py-0.5 rounded bg-[#191d24] text-[#edf0f5] hover:bg-[#2c323f] font-bold"
            title="Zoom Out"
          >
            −
          </button>
        </div>

        <div className="flex items-center gap-2 bg-[#13161c]/95 border border-[#242933] rounded-[4px] px-2.5 py-1 text-[#9da5b4]">
          <span className="font-bold text-[#edf0f5]">3D DEPTH</span>
          <input
            type="range"
            min="1.0"
            max="5.5"
            step="0.2"
            value={depthExaggeration}
            onChange={(e) => setDepthExaggeration(parseFloat(e.target.value))}
            className="w-20 accent-[#edf0f5] cursor-pointer"
          />
          <span className="text-[#edf0f5] w-7 text-right">{depthExaggeration.toFixed(1)}x</span>
        </div>

        {/* Depth Luminance Legend: Deeper = Darker, Upper = Lighter */}
        <div className="flex items-center gap-2 bg-[#13161c]/95 border border-[#242933] rounded-[4px] px-2.5 py-1 text-[9px] text-[#9da5b4]">
          <span>DEEP −3070m</span>
          <div
            className="w-20 h-2 rounded-sm border border-[#353c4a]"
            style={{
              background: 'linear-gradient(90deg, #0c1018 0%, #4b5565 50%, #e5ebf3 100%)',
            }}
          />
          <span className="text-[#edf0f5]">UPPER −1376m</span>
        </div>
      </div>

      {/* Subtle 3D Navigation Hint (Bottom-Left) */}
      <div className="absolute bottom-3 left-3 z-[450] bg-[#13161c]/90 border border-[#242933] rounded-[4px] px-2 py-1 font-mono text-[9px] text-[#9da5b4]">
        CONSOLIDATED 20m DTM · LEFT: ORBIT · RIGHT: PAN · SCROLL: ZOOM
      </div>
    </div>
  );
}
