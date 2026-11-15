import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import scienceHazardsData from '../data/jezero_science_hazards.json';
import { renderArHudToCanvas } from '../utils/arHudRenderer';

const MARS_MTM_RADIUS = 3396190.0;
const CENTRAL_MERIDIAN_RAD = (77.5 * Math.PI) / 180;
const VERTICAL_EXAGGERATION = 1.6;
export const VISOR_VERTICAL_FOV = 62;

/**
 * Generates tileable procedural Martian regolith albedo + bump CanvasTextures
 * (eolian wind ripples, iron-oxide mottling, and basalt gravel/pebbles).
 */
function createMarsRegolithTextures(repeatX, repeatY, maxAnisotropy = 4) {
  const size = 512;
  const albedoCanvas = document.createElement('canvas');
  albedoCanvas.width = size;
  albedoCanvas.height = size;
  const aCtx = albedoCanvas.getContext('2d');
  const aImg = aCtx.createImageData(size, size);

  const bumpCanvas = document.createElement('canvas');
  bumpCanvas.width = size;
  bumpCanvas.height = size;
  const bCtx = bumpCanvas.getContext('2d');
  const bImg = bCtx.createImageData(size, size);

  // Deterministic fast hash for tileable micro-grit
  let seed = 133742;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // Precompute seamless multi-octave sinusoidal + noise field
  const TWO_PI = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    const v = (y / size) * TWO_PI;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * TWO_PI;

      // Eolian wind-swept ripples (diagonal)
      const warp = Math.sin(u * 2 + v * 1) * 0.45 + Math.cos(u * 3 - v * 2) * 0.25;
      const ripple = Math.sin(u * 14 + v * 6 + warp * 2.2) * 0.5 + 0.5;

      // Broad mineral/dust mottling
      const mottle =
        Math.sin(u * 3 + 0.7) * Math.cos(v * 3 - 0.4) * 0.35 +
        Math.sin(u * 7 - v * 5) * 0.2 +
        0.5;

      // Fine regolith grain
      const grit = (rand() - 0.5) * 0.22;

      const heightNorm = Math.max(0, Math.min(1, ripple * 0.48 + mottle * 0.38 + 0.14 + grit));
      const bumpVal = Math.round(heightNorm * 255);

      // Keep albedo centered bright (175-245) so vertexColors drive macro geology
      const shade = 178 + heightNorm * 64 + grit * 45;
      const idx = (y * size + x) * 4;
      aImg.data[idx] = Math.max(0, Math.min(255, Math.round(shade * 1.04)));
      aImg.data[idx + 1] = Math.max(0, Math.min(255, Math.round(shade * 0.94)));
      aImg.data[idx + 2] = Math.max(0, Math.min(255, Math.round(shade * 0.84)));
      aImg.data[idx + 3] = 255;

      bImg.data[idx] = bumpVal;
      bImg.data[idx + 1] = bumpVal;
      bImg.data[idx + 2] = bumpVal;
      bImg.data[idx + 3] = 255;
    }
  }

  aCtx.putImageData(aImg, 0, 0);
  bCtx.putImageData(bImg, 0, 0);

  // Scatter subtle basalt pebbles & dark dust streaks
  for (let i = 0; i < 650; i++) {
    const px = rand() * size;
    const py = rand() * size;
    const r = 0.8 + rand() * 2.4;
    const dark = rand() > 0.35;
    aCtx.fillStyle = dark ? 'rgba(85, 52, 38, 0.32)' : 'rgba(255, 224, 195, 0.22)';
    aCtx.beginPath();
    aCtx.arc(px, py, r, 0, TWO_PI);
    aCtx.fill();

    bCtx.fillStyle = dark ? 'rgba(235, 235, 235, 0.35)' : 'rgba(60, 60, 60, 0.25)';
    bCtx.beginPath();
    bCtx.arc(px, py, r, 0, TWO_PI);
    bCtx.fill();
  }

  const map = new THREE.CanvasTexture(albedoCanvas);
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.repeat.set(repeatX, repeatY);
  map.anisotropy = Math.min(8, maxAnisotropy);
  map.colorSpace = THREE.SRGBColorSpace;

  const bumpMap = new THREE.CanvasTexture(bumpCanvas);
  bumpMap.wrapS = THREE.RepeatWrapping;
  bumpMap.wrapT = THREE.RepeatWrapping;
  bumpMap.repeat.set(repeatX, repeatY);
  bumpMap.anisotropy = Math.min(8, maxAnisotropy);

  return { map, bumpMap };
}

function paintMarsSkyGradient(canvas, zenithHex, midHex, horizonHex) {
  const ctx = canvas.getContext('2d');
  const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
  grad.addColorStop(0.0, zenithHex);
  grad.addColorStop(0.42, midHex);
  grad.addColorStop(0.55, horizonHex);
  grad.addColorStop(1.0, horizonHex);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

/**
 * Generates procedural basalt boulder & stratified sedimentary rock textures
 * (albedo + bump) for 3D Jezero geological formations.
 */
function createMarsRockTextures(maxAnisotropy = 4) {
  const size = 256;
  let seed = 90210;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };

  // 1. Basalt Boulder Texture (dark volcanic grain + dusty iron-oxide pockets)
  const bCanvas = document.createElement('canvas');
  bCanvas.width = size;
  bCanvas.height = size;
  const bCtx = bCanvas.getContext('2d');
  const bBumpCanvas = document.createElement('canvas');
  bBumpCanvas.width = size;
  bBumpCanvas.height = size;
  const bbCtx = bBumpCanvas.getContext('2d');

  const bImg = bCtx.createImageData(size, size);
  const bbImg = bbCtx.createImageData(size, size);
  const TWO_PI = Math.PI * 2;
  for (let y = 0; y < size; y++) {
    const v = (y / size) * TWO_PI;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * TWO_PI;
      const vein = Math.sin(u * 4 + Math.cos(v * 3) * 2) * 0.35 + Math.cos(v * 6 - u * 2) * 0.25;
      const grain = (rand() - 0.5) * 0.45;
      const n = Math.max(0, Math.min(1, 0.5 + vein * 0.4 + grain * 0.5));
      const idx = (y * size + x) * 4;
      // Dark Martian basalt with rusty dust tint (lifted for clear silhouette/detail)
      bImg.data[idx] = Math.round(95 + n * 95);
      bImg.data[idx + 1] = Math.round(66 + n * 62);
      bImg.data[idx + 2] = Math.round(52 + n * 44);
      bImg.data[idx + 3] = 255;

      const bv = Math.round(n * 255);
      bbImg.data[idx] = bv;
      bbImg.data[idx + 1] = bv;
      bbImg.data[idx + 2] = bv;
      bbImg.data[idx + 3] = 255;
    }
  }
  bCtx.putImageData(bImg, 0, 0);
  bbCtx.putImageData(bbImg, 0, 0);

  const basaltMap = new THREE.CanvasTexture(bCanvas);
  basaltMap.colorSpace = THREE.SRGBColorSpace;
  basaltMap.wrapS = THREE.RepeatWrapping;
  basaltMap.wrapT = THREE.RepeatWrapping;
  basaltMap.anisotropy = Math.min(4, maxAnisotropy);

  const basaltBump = new THREE.CanvasTexture(bBumpCanvas);
  basaltBump.wrapS = THREE.RepeatWrapping;
  basaltBump.wrapT = THREE.RepeatWrapping;

  // 2. Stratified Sedimentary Outcrop Texture (horizontal delta bedding layers)
  const sCanvas = document.createElement('canvas');
  sCanvas.width = size;
  sCanvas.height = size;
  const sCtx = sCanvas.getContext('2d');
  const sBumpCanvas = document.createElement('canvas');
  sBumpCanvas.width = size;
  sBumpCanvas.height = size;
  const sbCtx = sBumpCanvas.getContext('2d');

  const sImg = sCtx.createImageData(size, size);
  const sbImg = sbCtx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    const v = (y / size) * TWO_PI;
    const strata =
      Math.sin(v * 9) * 0.35 + Math.sin(v * 21 + 1.2) * 0.22 + Math.cos(v * 5) * 0.2;
    for (let x = 0; x < size; x++) {
      const u = (x / size) * TWO_PI;
      const crack = Math.sin(u * 5 + v * 2) * 0.15 + (rand() - 0.5) * 0.2;
      const n = Math.max(0, Math.min(1, 0.52 + strata * 0.48 + crack));
      const idx = (y * size + x) * 4;
      // Warm Jezero delta sandstone/mudstone ochre-rust bands
      sImg.data[idx] = Math.round(115 + n * 95);
      sImg.data[idx + 1] = Math.round(66 + n * 58);
      sImg.data[idx + 2] = Math.round(44 + n * 38);
      sImg.data[idx + 3] = 255;

      const bv = Math.round(n * 255);
      sbImg.data[idx] = bv;
      sbImg.data[idx + 1] = bv;
      sbImg.data[idx + 2] = bv;
      sbImg.data[idx + 3] = 255;
    }
  }
  sCtx.putImageData(sImg, 0, 0);
  sbCtx.putImageData(sbImg, 0, 0);

  const strataMap = new THREE.CanvasTexture(sCanvas);
  strataMap.colorSpace = THREE.SRGBColorSpace;
  strataMap.wrapS = THREE.RepeatWrapping;
  strataMap.wrapT = THREE.RepeatWrapping;
  strataMap.anisotropy = Math.min(4, maxAnisotropy);

  const strataBump = new THREE.CanvasTexture(sBumpCanvas);
  strataBump.wrapS = THREE.RepeatWrapping;
  strataBump.wrapT = THREE.RepeatWrapping;

  return { basaltMap, basaltBump, strataMap, strataBump };
}

function createMarsSunSpriteTexture() {
  const size = 128;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(size / 2, size / 2, 2, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, 'rgba(255, 246, 228, 1.0)');
  g.addColorStop(0.18, 'rgba(255, 212, 165, 0.85)');
  g.addColorStop(0.45, 'rgba(224, 138, 82, 0.28)');
  g.addColorStop(1.0, 'rgba(180, 90, 45, 0.0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * Converts (lat, lon) in degrees to MTM_clon77.5E metric coordinates (meters).
 */
export function latLonToMTM(lat, lon) {
  const latRad = (lat * Math.PI) / 180;
  const dLonRad = (lon * Math.PI) / 180 - CENTRAL_MERIDIAN_RAD;
  const B = Math.cos(latRad) * Math.sin(dLonRad);
  const x = 0.5 * MARS_MTM_RADIUS * Math.log((1 + B) / (1 - B));
  const y = MARS_MTM_RADIUS * Math.atan2(Math.tan(latRad), Math.cos(dLonRad));
  return [x, y];
}

/**
 * Bilinear elevation lookup (in meters) from the loaded USGS SIM 3464 DEM grid.
 */
function sampleDemElevation(dem, mtmX, mtmY) {
  if (!dem) return -2540;
  const { ncols, nrows, xllcorner, yllcorner, dx, dy, elevations } = dem;
  const cFloat = (mtmX - xllcorner) / dx;
  const rFloat = nrows - 1 - (mtmY - yllcorner) / dy;

  const c0 = Math.max(0, Math.min(ncols - 2, Math.floor(cFloat)));
  const r0 = Math.max(0, Math.min(nrows - 2, Math.floor(rFloat)));
  const fc = Math.max(0, Math.min(1, cFloat - c0));
  const fr = Math.max(0, Math.min(1, rFloat - r0));

  const e00 = elevations[r0 * ncols + c0];
  const e10 = elevations[r0 * ncols + (c0 + 1)];
  const e01 = elevations[(r0 + 1) * ncols + c0];
  const e11 = elevations[(r0 + 1) * ncols + (c0 + 1)];

  const top = e00 * (1 - fc) + e10 * fc;
  const bot = e01 * (1 - fc) + e11 * fc;
  return top * (1 - fr) + bot * fr;
}

export default function Visor3DTerrain({
  currentLatLon,
  viewHeading,
  lookPitchDeg,
  routePathCoords = [],
  isOffRoute = false,
  isDusty = false,
  isLowLight = false,
  showContours = true,
  arPassthrough = false,
  xrSession = null,
  hudState = null,
  targetBearingDeg = null,
  targetDistM = null,
  projectedMarkers = [],
  onXrHeadYaw,
  onXrStickMove,
  onGroundElevation,
  onProjectedScreenMarkers,
}) {
  const mountRef = useRef(null);
  const [demData, setDemData] = useState(null);

  const sceneRefs = useRef({
    scene: null,
    camera: null,
    renderer: null,
    wireframeMat: null,
    routeLine: null,
    originMtm: [0, 0],
    baseElev: -2550,
    markerAnchors: [],
    targetCamPos: new THREE.Vector3(),
    hasCamPos: false,
    lastProjPos: new THREE.Vector3(),
    lastProjYaw: null,
    lastProjPitch: null,
    onProjectedScreenMarkers: null,
  });

  // Load USGS SIM 3464 DEM JSON once
  useEffect(() => {
    let cancelled = false;
    fetch('/terrain/jezero_dem.json')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setDemData(data);
      })
      .catch((err) => {
        console.error('Failed to load jezero_dem.json:', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Build Three.js terrain scene once DEM is loaded
  useEffect(() => {
    const container = mountRef.current;
    if (!container || !demData) return;

    const { ncols, nrows, xllcorner, yllcorner, dx, dy, elevations, minElev, maxElev } = demData;
    const widthM = (ncols - 1) * dx;
    const heightM = (nrows - 1) * dy;
    const originX = xllcorner + widthM / 2;
    const originY = yllcorner + heightM / 2;
    const baseElev = -2550;

    const scene = new THREE.Scene();
    scene.background = arPassthrough ? null : new THREE.Color('#1a0f0a');
    scene.fog = arPassthrough ? null : new THREE.FogExp2('#2a160e', 0.000045);

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;
    const camera = new THREE.PerspectiveCamera(
      VISOR_VERTICAL_FOV,
      width / height,
      0.1,
      70000
    );
    camera.rotation.order = 'YXZ';
    const vrRig = new THREE.Group();
    scene.add(vrRig);
    vrRig.add(camera);

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: arPassthrough,
      powerPreference: 'high-performance',
    });
    renderer.xr.enabled = true;
    if (arPassthrough) {
      renderer.setClearColor(0x000000, 0);
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.55;
    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    // Atmospheric Mars Sky Dome
    const skyCanvas = document.createElement('canvas');
    skyCanvas.width = 4;
    skyCanvas.height = 256;
    paintMarsSkyGradient(skyCanvas, '#2e1710', '#8a4427', '#c97848');
    const skyTexture = new THREE.CanvasTexture(skyCanvas);
    skyTexture.colorSpace = THREE.SRGBColorSpace;
    const skyGeo = new THREE.SphereGeometry(55000, 32, 16);
    const skyMat = new THREE.MeshBasicMaterial({
      map: skyTexture,
      side: THREE.BackSide,
      fog: false,
      depthWrite: false,
    });
    const skyDome = new THREE.Mesh(skyGeo, skyMat);
    scene.add(skyDome);

    // Lighting (bright Martian daylight sun + warm bounced hemisphere fill)
    const hemi = new THREE.HemisphereLight(0xffd2b3, 0x6b3a24, 1.15);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff0dd, 2.15);
    sun.position.set(12000, 18000, -8000);
    scene.add(sun);

    // Build Terrain Geometry in X (East), Y (Up), -Z (North)
    const geometry = new THREE.PlaneGeometry(widthM, heightM, ncols - 1, nrows - 1);
    geometry.rotateX(-Math.PI / 2);

    const posAttr = geometry.attributes.position;
    const colors = new Float32Array(posAttr.count * 3);
    const elevSpan = Math.max(1, maxElev - minElev);

    for (let r = 0; r < nrows; r++) {
      for (let c = 0; c < ncols; c++) {
        const idx = r * ncols + c;
        const elev = elevations[idx];
        const yWorld = (elev - baseElev) * VERTICAL_EXAGGERATION;
        posAttr.setY(idx, yWorld);

        // Estimate local slope for vertex shading
        const eRight = elevations[r * ncols + Math.min(ncols - 1, c + 1)];
        const eDown = elevations[Math.min(nrows - 1, r + 1) * ncols + c];
        const slopeApprox = Math.hypot((eRight - elev) / dx, (eDown - elev) / dy);

        const normH = Math.max(0, Math.min(1, (elev - minElev) / elevSpan));
        // Depth-aware Martian palette: deeper terrain is darker, upper terrain is lighter
        const depthLum = Math.pow(normH, 0.9);
        let red = 0.24 + depthLum * 0.72;
        let green = 0.16 + depthLum * 0.58;
        let blue = 0.13 + depthLum * 0.45;
        if (slopeApprox > 0.25) {
          red = Math.min(1, red + 0.10);
          green *= 0.94;
        }
        colors[idx * 3] = red;
        colors[idx * 3 + 1] = green;
        colors[idx * 3 + 2] = blue;
      }
    }

    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geometry.computeVertexNormals();

    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const { map: regolithMap, bumpMap: regolithBumpMap } = createMarsRegolithTextures(
      Math.max(12, widthM / 180),
      Math.max(12, heightM / 180),
      maxAniso
    );

    const terrainMat = new THREE.MeshStandardMaterial({
      map: regolithMap,
      bumpMap: regolithBumpMap,
      bumpScale: 14,
      vertexColors: true,
      roughness: 0.92,
      metalness: 0.04,
    });
    const terrainMesh = new THREE.Mesh(geometry, terrainMat);
    scene.add(terrainMesh);

    // Load real NASA/Caltech MRO CTX orbital orthophoto aligned to Jezero DEM bounds
    let ctxOrthoTex = null;
    let hiriseTex = null;
    let isUnmounted = false;
    const texLoader = new THREE.TextureLoader();
    texLoader.load('/terrain/jezero_ctx_ortho.png', (loadedTex) => {
      if (isUnmounted) {
        loadedTex.dispose();
        return;
      }
      loadedTex.colorSpace = THREE.SRGBColorSpace;
      loadedTex.anisotropy = Math.min(8, maxAniso);
      loadedTex.wrapS = THREE.ClampToEdgeWrapping;
      loadedTex.wrapT = THREE.ClampToEdgeWrapping;
      ctxOrthoTex = loadedTex;
      terrainMat.map = loadedTex;
      terrainMat.needsUpdate = true;
    });

    // High-resolution NASA Mars Trek MRO HiRISE mosaic draped over the Jezero EVA zone
    const HIRISE_BOUNDS = {
      latS: 18.34716796875,
      latN: 18.56689453125,
      lonW: 77.34375,
      lonE: 77.5634765625,
    };
    const hrSegs = 128;
    const hiriseGeo = new THREE.PlaneGeometry(1, 1, hrSegs, hrSegs);
    const hrPos = hiriseGeo.attributes.position;
    const hrColors = new Float32Array(hrPos.count * 3);
    for (let r = 0; r <= hrSegs; r++) {
      const vFrac = 1 - r / hrSegs;
      const lat = HIRISE_BOUNDS.latS + (HIRISE_BOUNDS.latN - HIRISE_BOUNDS.latS) * vFrac;
      for (let c = 0; c <= hrSegs; c++) {
        const uFrac = c / hrSegs;
        const lon = HIRISE_BOUNDS.lonW + (HIRISE_BOUNDS.lonE - HIRISE_BOUNDS.lonW) * uFrac;
        const [mx, my] = latLonToMTM(lat, lon);
        const elev = sampleDemElevation(demData, mx, my);
        const idx = r * (hrSegs + 1) + c;
        const wx = mx - originX;
        const wz = -(my - originY);
        const wy = (elev - baseElev) * VERTICAL_EXAGGERATION + 0.8;
        hrPos.setXYZ(idx, wx, wy, wz);

        const normH = Math.max(0, Math.min(1, (elev - minElev) / elevSpan));
        hrColors[idx * 3] = 0.86 + normH * 0.14;
        hrColors[idx * 3 + 1] = 0.56 + normH * 0.20;
        hrColors[idx * 3 + 2] = 0.38 + normH * 0.16;
      }
    }
    hiriseGeo.setAttribute('color', new THREE.BufferAttribute(hrColors, 3));
    hiriseGeo.computeVertexNormals();
    const hiriseMat = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      bumpMap: regolithBumpMap,
      bumpScale: 14,
      vertexColors: true,
      roughness: 0.90,
      metalness: 0.04,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
      visible: false,
    });
    const hiriseMesh = new THREE.Mesh(hiriseGeo, hiriseMat);
    scene.add(hiriseMesh);
    texLoader.load('/terrain/jezero_hirise_trek.png', (loadedHr) => {
      if (isUnmounted) {
        loadedHr.dispose();
        return;
      }
      loadedHr.colorSpace = THREE.SRGBColorSpace;
      loadedHr.anisotropy = Math.min(8, maxAniso);
      loadedHr.wrapS = THREE.ClampToEdgeWrapping;
      loadedHr.wrapT = THREE.ClampToEdgeWrapping;
      hiriseTex = loadedHr;
      hiriseMat.map = loadedHr;
      hiriseMat.visible = true;
      hiriseMat.needsUpdate = true;
    });

    // Actual 3D Geological Formations (Instanced Basalt Boulders + Stratified Delta Outcrops)
    const { basaltMap, basaltBump, strataMap, strataBump } = createMarsRockTextures(maxAniso);

    // Angular fractured basalt boulder geometry
    const boulderGeo = new THREE.DodecahedronGeometry(1, 1);
    const bPos = boulderGeo.attributes.position;
    for (let i = 0; i < bPos.count; i++) {
      const vx = bPos.getX(i);
      const vy = bPos.getY(i);
      const vz = bPos.getZ(i);
      const disp =
        0.78 +
        0.28 * Math.sin(vx * 3.7 + vy * 2.1) +
        0.16 * Math.cos(vz * 4.3 - vx * 1.9);
      bPos.setXYZ(i, vx * disp, Math.max(-0.45, vy * disp * 0.72), vz * disp);
    }
    boulderGeo.computeVertexNormals();
    const boulderMat = new THREE.MeshStandardMaterial({
      map: basaltMap,
      bumpMap: basaltBump,
      bumpScale: 0.45,
      roughness: 0.88,
      metalness: 0.08,
    });

    // Stratified sedimentary outcrop slab geometry
    const outcropGeo = new THREE.CylinderGeometry(1.0, 1.38, 0.72, 7, 2);
    const oPos = outcropGeo.attributes.position;
    for (let i = 0; i < oPos.count; i++) {
      const vx = oPos.getX(i);
      const vy = oPos.getY(i);
      const vz = oPos.getZ(i);
      const shelf = 0.86 + 0.22 * Math.sin(vx * 2.9 + vz * 3.1);
      oPos.setXYZ(i, vx * shelf, vy, vz * shelf);
    }
    outcropGeo.computeVertexNormals();
    const outcropMat = new THREE.MeshStandardMaterial({
      map: strataMap,
      bumpMap: strataBump,
      bumpScale: 0.55,
      roughness: 0.92,
      metalness: 0.03,
    });

    const BOULDER_COUNT = 460;
    const OUTCROP_COUNT = 160;
    const bouldersMesh = new THREE.InstancedMesh(boulderGeo, boulderMat, BOULDER_COUNT);
    const outcropsMesh = new THREE.InstancedMesh(outcropGeo, outcropMat, OUTCROP_COUNT);

    let rockSeed = 202042;
    const rockRand = () => {
      rockSeed = (rockSeed * 1664525 + 1013904223) >>> 0;
      return rockSeed / 4294967296;
    };
    const dummy = new THREE.Object3D();

    for (let i = 0; i < BOULDER_COUNT; i++) {
      const lat =
        HIRISE_BOUNDS.latS + 0.02 + rockRand() * (HIRISE_BOUNDS.latN - HIRISE_BOUNDS.latS - 0.04);
      const lon =
        HIRISE_BOUNDS.lonW + 0.02 + rockRand() * (HIRISE_BOUNDS.lonE - HIRISE_BOUNDS.lonW - 0.04);
      const [mx, my] = latLonToMTM(lat, lon);
      const wx = mx - originX;
      const wz = -(my - originY);
      const wy = (sampleDemElevation(demData, mx, my) - baseElev) * VERTICAL_EXAGGERATION;
      const s = 1.4 + Math.pow(rockRand(), 2) * 6.5;
      dummy.position.set(wx, wy + s * 0.22, wz);
      dummy.rotation.set((rockRand() - 0.5) * 0.4, rockRand() * Math.PI * 2, (rockRand() - 0.5) * 0.4);
      dummy.scale.set(s * (0.8 + rockRand() * 0.5), s * (0.55 + rockRand() * 0.45), s * (0.8 + rockRand() * 0.5));
      dummy.updateMatrix();
      bouldersMesh.setMatrixAt(i, dummy.matrix);
    }
    bouldersMesh.instanceMatrix.needsUpdate = true;
    scene.add(bouldersMesh);

    for (let i = 0; i < OUTCROP_COUNT; i++) {
      const lat =
        HIRISE_BOUNDS.latS + 0.02 + rockRand() * (HIRISE_BOUNDS.latN - HIRISE_BOUNDS.latS - 0.04);
      const lon =
        HIRISE_BOUNDS.lonW + 0.02 + rockRand() * (HIRISE_BOUNDS.lonE - HIRISE_BOUNDS.lonW - 0.04);
      const [mx, my] = latLonToMTM(lat, lon);
      const wx = mx - originX;
      const wz = -(my - originY);
      const wy = (sampleDemElevation(demData, mx, my) - baseElev) * VERTICAL_EXAGGERATION;
      const w = 4.5 + rockRand() * 11.0;
      const h = 1.6 + rockRand() * 3.8;
      dummy.position.set(wx, wy + h * 0.25, wz);
      dummy.rotation.set((rockRand() - 0.5) * 0.2, rockRand() * Math.PI * 2, (rockRand() - 0.5) * 0.2);
      dummy.scale.set(w, h, w * (0.55 + rockRand() * 0.45));
      dummy.updateMatrix();
      outcropsMesh.setMatrixAt(i, dummy.matrix);
    }
    outcropsMesh.instanceMatrix.needsUpdate = true;
    scene.add(outcropsMesh);

    // Martian Sun Disc & Halo aligned with DirectionalLight
    const sunSpriteTex = createMarsSunSpriteTexture();
    const sunSpriteMat = new THREE.SpriteMaterial({
      map: sunSpriteTex,
      transparent: true,
      opacity: 0.9,
      fog: false,
      depthWrite: false,
    });
    const sunSprite = new THREE.Sprite(sunSpriteMat);
    sunSprite.position.set(12000, 18000, -8000).normalize().multiplyScalar(42000);
    sunSprite.scale.set(8500, 8500, 1);
    scene.add(sunSprite);

    // Airborne Martian Dust Motes around camera
    const DUST_COUNT = 280;
    const dustPositions = new Float32Array(DUST_COUNT * 3);
    for (let i = 0; i < DUST_COUNT; i++) {
      dustPositions[i * 3] = (rockRand() - 0.5) * 260;
      dustPositions[i * 3 + 1] = (rockRand() - 0.5) * 90;
      dustPositions[i * 3 + 2] = (rockRand() - 0.5) * 260;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPositions, 3));
    const dustMat = new THREE.PointsMaterial({
      color: 0xfdba74,
      size: 1.4,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const dustPoints = new THREE.Points(dustGeo, dustMat);
    scene.add(dustPoints);

    // Synthetic AR contour wireframe overlay
    const wireframeMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      wireframe: true,
      transparent: true,
      opacity: 0.09,
    });
    const wireMesh = new THREE.Mesh(geometry, wireframeMat);
    wireMesh.position.y = 1.5;
    scene.add(wireMesh);

    // Hide the Martian world meshes in AR Passthrough mode so real-world camera feed shows through
    if (arPassthrough) {
      skyDome.visible = false;
      terrainMesh.visible = false;
      hiriseMesh.visible = false;
      bouldersMesh.visible = false;
      outcropsMesh.visible = false;
      sunSprite.visible = false;
      dustPoints.visible = false;
      wireMesh.visible = false;
    }

    // Add 3D Science POI & Hazard beacons + world-space 3D sprite pins on terrain
    const makeWaypointSprite = (label, bg, border, fg) => {
      const c = document.createElement('canvas');
      c.width = 512;
      c.height = 128;
      const g = c.getContext('2d');
      g.fillStyle = bg;
      g.strokeStyle = border;
      g.lineWidth = 5;
      g.beginPath();
      g.roundRect(12, 16, 488, 96, 48);
      g.fill();
      g.stroke();
      g.font = 'bold 34px ui-monospace, SFMono-Regular, Menlo, monospace';
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(label.slice(0, 22), 256, 65);
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: true });
      const sp = new THREE.Sprite(mat);
      sp.scale.set(240, 60, 1);
      return sp;
    };

    const xrMarkersGroup = new THREE.Group();
    xrMarkersGroup.visible = Boolean(arPassthrough);
    scene.add(xrMarkersGroup);

    const markerAnchors = [];
    const { sciencePOIs = [], hazardZones = [] } = scienceHazardsData;
    for (const poi of sciencePOIs) {
      const [mx, my] = latLonToMTM(poi.lat, poi.lon);
      const wx = mx - originX;
      const wz = -(my - originY);
      const wy = (sampleDemElevation(demData, mx, my) - baseElev) * VERTICAL_EXAGGERATION;

      const beaconGeo = new THREE.CylinderGeometry(8, 8, 220, 8);
      const beaconMat = new THREE.MeshBasicMaterial({
        color: poi.isChargingStation ? 0xfbbf24 : 0x22d3ee,
        transparent: true,
        opacity: 0.55,
      });
      const beacon = new THREE.Mesh(beaconGeo, beaconMat);
      beacon.position.set(wx, wy + 110, wz);
      xrMarkersGroup.add(beacon);

      const pin = makeWaypointSprite(
        poi.name || 'POI',
        poi.isChargingStation ? 'rgba(69,26,3,0.88)' : 'rgba(2,6,23,0.88)',
        poi.isChargingStation ? '#fbbf24' : '#22d3ee',
        poi.isChargingStation ? '#fde68a' : '#a5f3fc'
      );
      pin.position.set(wx, wy + 265, wz);
      xrMarkersGroup.add(pin);

      markerAnchors.push({
        id: `poi-${poi.id}`,
        worldPos: new THREE.Vector3(wx, wy + 230, wz),
      });
    }

    for (const hz of hazardZones) {
      const [mx, my] = latLonToMTM(hz.lat, hz.lon);
      const wx = mx - originX;
      const wz = -(my - originY);
      const wy = (sampleDemElevation(demData, mx, my) - baseElev) * VERTICAL_EXAGGERATION;

      const ringGeo = new THREE.RingGeometry(45, 75, 24);
      ringGeo.rotateX(-Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0xef4444,
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.65,
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.position.set(wx, wy + 8, wz);
      xrMarkersGroup.add(ring);

      const hPin = makeWaypointSprite(
        hz.name || 'HAZARD',
        'rgba(69,10,10,0.88)',
        '#f87171',
        '#fecaca'
      );
      hPin.position.set(wx, wy + 95, wz);
      xrMarkersGroup.add(hPin);

      markerAnchors.push({
        id: `hz-${hz.id}`,
        worldPos: new THREE.Vector3(wx, wy + 36, wz),
      });
    }

    sceneRefs.current = {
      scene,
      camera,
      vrRig,
      renderer,
      xrMarkersGroup,
      wireframeMat,
      skyCanvas,
      skyTexture,
      sunSprite,
      dustMat,
      routeLine: null,
      originMtm: [originX, originY],
      baseElev,
      markerAnchors,
      targetCamPos: new THREE.Vector3(),
      hasCamPos: false,
      targetCamYaw: 0,
      targetCamPitch: 0,
      hasCamRot: false,
      lastProjPos: new THREE.Vector3(),
      lastProjYaw: null,
      lastProjPitch: null,
      onProjectedScreenMarkers: sceneRefs.current.onProjectedScreenMarkers || null,
    };

    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    let lastTime = performance.now();
    let lastXrYawTs = 0;
    let lastStickMoveTs = 0;
    let stickAccumDt = 0;
    let lastDrawnYaw = null;
    const xrEuler = new THREE.Euler(0, 0, 0, 'YXZ');
    const xrQuat = new THREE.Quaternion();
    const renderLoop = () => {
      const now = performance.now();
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) / 1000));
      lastTime = now;
      const refs = sceneRefs.current;

      // Sync Quest 2 gyroscope/6DOF head yaw & animate 3D AR walking path when in WebXR
      if (renderer.xr.isPresenting) {
        const xrCam = renderer.xr.getCamera(camera);
        // WebXRManager updates matrixWorld directly; getWorldQuaternion reads the true world head pose (including vrRig)
        xrCam.getWorldQuaternion(xrQuat);
        xrEuler.setFromQuaternion(xrQuat, 'YXZ');
        const baseHeading = arHudRef.current.hudState?.liveNavState?.heading ?? 285;
        const liveHeading = (((Math.round((-xrEuler.y * 180) / Math.PI)) % 360) + 360) % 360;
        const yawDeg = Math.round(((liveHeading - baseHeading + 540) % 360) - 180);
        arHudRef.current.viewHeading = liveHeading;

        if (liveHeading !== lastDrawnYaw && arHudRef.current.canvas && arHudRef.current.texture) {
          lastDrawnYaw = liveHeading;
          renderArHudToCanvas(arHudRef.current.canvas, arHudRef.current.hudState, {
            headingDeg: liveHeading,
            targetBearingDeg: arHudRef.current.targetBearingDeg,
            targetDistM: arHudRef.current.targetDistM,
            markers: arHudRef.current.projectedMarkers || [],
            linkLive: true,
          });
          arHudRef.current.texture.needsUpdate = true;
        }

        if (now - lastXrYawTs > 100 && arHudRef.current.onXrHeadYaw) {
          lastXrYawTs = now;
          arHudRef.current.onXrHeadYaw(yawDeg);
        }

        // Poll Quest 2 Touch controller thumbstick axes to move astronaut
        const xrSessionActive = renderer.xr.getSession();
        if (xrSessionActive && arHudRef.current.onXrStickMove) {
          let stickX = 0;
          let stickY = 0;
          for (const src of xrSessionActive.inputSources) {
            const axes = src.gamepad?.axes;
            if (!axes || axes.length < 2) continue;
            const axX = axes.length >= 4 ? axes[2] : axes[0];
            const axY = axes.length >= 4 ? axes[3] : axes[1];
            if (Math.abs(axX) > 0.18 || Math.abs(axY) > 0.18) {
              stickX = axX;
              stickY = axY;
              break;
            }
          }
          stickAccumDt += dt;
          if ((stickX !== 0 || stickY !== 0) && now - lastStickMoveTs > 65) {
            lastStickMoveTs = now;
            arHudRef.current.onXrStickMove(-stickY, stickX, Math.min(0.2, stickAccumDt));
            stickAccumDt = 0;
          } else if (stickX === 0 && stickY === 0) {
            stickAccumDt = 0;
          }
        }

        const pd = arHudRef.current.pathData;
        if (pd) {
          if (pd.pathGroup) {
            pd.pathGroup.rotation.y = -THREE.MathUtils.degToRad(yawDeg);
          }
          const { targetBearingDeg: tb, viewHeading: vh, isOffRoute: offRoute } = arHudRef.current;
          const deltaDeg = tb !== null && tb !== undefined ? ((tb - vh + 540) % 360) - 180 : 0;
          const clampedTurn = Math.max(-55, Math.min(55, deltaDeg));
          const maxLateral = Math.sin((clampedTurn * Math.PI) / 180) * 2.2;
          const mainColor = offRoute ? 0xf87171 : 0x22d3ee;
          const accentColor = offRoute ? 0xfbbf24 : 0x34d399;
          pd.railMat.color.setHex(accentColor);
          pd.beaconMat.color.setHex(accentColor);

          const tPulse = (now * 0.0022) % 1;
          const numChev = pd.chevrons.length;
          for (let i = 0; i < numChev; i++) {
            const frac = (i + 0.5) / numChev;
            const z = -(1.25 + frac * 4.2);
            const x = maxLateral * (frac * frac);
            const yaw = -Math.atan2(2 * maxLateral * frac, 4.2);
            const chev = pd.chevrons[i];
            chev.position.set(x, 0, z);
            chev.rotation.set(0, yaw, 0);
            const waveDist = Math.abs(((i / numChev - tPulse + 1) % 1) - 0.5);
            const highlight = Math.max(0, 1 - waveDist * 4.5);
            chev.material.color.setHex(highlight > 0.35 ? accentColor : mainColor);
            chev.material.opacity = 0.45 + highlight * 0.55;
            const s = 0.9 + highlight * 0.28;
            chev.scale.set(s, 1, s);
          }

          const lp = pd.leftRail.geometry.attributes.position.array;
          const rp = pd.rightRail.geometry.attributes.position.array;
          for (let i = 0; i < 20; i++) {
            const frac = i / 19;
            const z = -(1.1 + frac * 4.5);
            const xc = maxLateral * (frac * frac);
            lp[i * 3] = xc - 0.28;
            lp[i * 3 + 1] = -0.01;
            lp[i * 3 + 2] = z;
            rp[i * 3] = xc + 0.28;
            rp[i * 3 + 1] = -0.01;
            rp[i * 3 + 2] = z;
          }
          pd.leftRail.geometry.attributes.position.needsUpdate = true;
          pd.rightRail.geometry.attributes.position.needsUpdate = true;

          pd.beacon.position.set(maxLateral, 0.35 + Math.sin(now * 0.003) * 0.06, -5.65);
          pd.beacon.rotation.y = now * 0.0018;
        }
      }

      if (refs.hasCamPos) {
        const posAlpha = 1 - Math.exp(-8 * dt);
        vrRig.position.lerp(refs.targetCamPos, posAlpha);
      }
      if (!renderer.xr.isPresenting && refs.hasCamRot) {
        const rotAlpha = 1 - Math.exp(-6 * dt);
        let yawDiff = refs.targetCamYaw - camera.rotation.y;
        while (yawDiff > Math.PI) yawDiff -= Math.PI * 2;
        while (yawDiff < -Math.PI) yawDiff += Math.PI * 2;
        camera.rotation.y += yawDiff * rotAlpha;
        camera.rotation.x += (refs.targetCamPitch - camera.rotation.x) * rotAlpha;
      }
      vrRig.updateMatrixWorld(true);

      // Drift airborne Martian dust motes subtly around the rig
      dustPoints.position.set(
        vrRig.position.x + Math.sin(now * 0.00025) * 14,
        vrRig.position.y,
        vrRig.position.z + Math.cos(now * 0.0002) * 14
      );

      if (
        !renderer.xr.isPresenting &&
        refs.onProjectedScreenMarkers &&
        refs.markerAnchors?.length &&
        (vrRig.position.distanceTo(refs.lastProjPos) > 0.15 ||
          refs.lastProjYaw !== camera.rotation.y ||
          refs.lastProjPitch !== camera.rotation.x)
      ) {
        refs.lastProjPos.copy(vrRig.position);
        refs.lastProjYaw = camera.rotation.y;
        refs.lastProjPitch = camera.rotation.x;
        const projected = {};
        for (const anchor of refs.markerAnchors) {
          const ndc = anchor.worldPos.clone().project(camera);
          if (ndc.z >= -1 && ndc.z <= 1) {
            const xPct = (ndc.x * 0.5 + 0.5) * 100;
            const yPct = (-ndc.y * 0.5 + 0.5) * 100;
            if (xPct >= -5 && xPct <= 105 && yPct >= -5 && yPct <= 105) {
              projected[anchor.id] = { xPct, yPct };
            }
          }
        }
        refs.onProjectedScreenMarkers(projected);
      }

      renderer.render(scene, camera);
    };
    renderer.setAnimationLoop(renderLoop);

    return () => {
      isUnmounted = true;
      renderer.setAnimationLoop(null);
      window.removeEventListener('resize', handleResize);
      geometry.dispose();
      hiriseGeo.dispose();
      hiriseMat.dispose();
      if (hiriseTex) hiriseTex.dispose();
      boulderGeo.dispose();
      boulderMat.dispose();
      outcropGeo.dispose();
      outcropMat.dispose();
      basaltMap.dispose();
      basaltBump.dispose();
      strataMap.dispose();
      strataBump.dispose();
      sunSpriteTex.dispose();
      sunSpriteMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      regolithMap.dispose();
      regolithBumpMap.dispose();
      if (ctxOrthoTex) ctxOrthoTex.dispose();
      terrainMat.dispose();
      wireframeMat.dispose();
      skyGeo.dispose();
      skyMat.dispose();
      skyTexture.dispose();
      renderer.dispose();
    };
  }, [demData, arPassthrough]);

  const arHudRef = useRef({
    canvas: null,
    texture: null,
    tintMat: null,
    pathData: null,
    onXrHeadYaw: null,
    targetBearingDeg: null,
    viewHeading: 0,
    isOffRoute: false,
  });

  // Attach/detach WebXR session (supports both Full 3D Mars VR and AR Passthrough)
  useEffect(() => {
    const { renderer, camera, vrRig, xrMarkersGroup } = sceneRefs.current;
    if (!renderer || !camera || !vrRig || !xrSession) return;
    if (xrMarkersGroup) xrMarkersGroup.visible = true;

    // Align vrRig forward (-Z) to the initial route heading so Quest 2 faces straight down the route
    vrRig.rotation.order = 'YXZ';
    vrRig.rotation.y = -THREE.MathUtils.degToRad(hudState?.liveNavState?.heading ?? 285);

    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local-floor');

    // Head-locked Fullscreen HUD CanvasTexture (guaranteed to render in Quest 2 WebXR)
    const hudCanvas = document.createElement('canvas');
    hudCanvas.width = 1280;
    hudCanvas.height = 720;
    renderArHudToCanvas(hudCanvas, hudState, {
      headingDeg: viewHeading,
      targetBearingDeg,
      targetDistM,
      markers: projectedMarkers,
      linkLive: true,
    });
    const hudTex = new THREE.CanvasTexture(hudCanvas);
    hudTex.colorSpace = THREE.SRGBColorSpace;
    hudTex.minFilter = THREE.LinearFilter;
    hudTex.magFilter = THREE.LinearFilter;

    const hudGeo = new THREE.PlaneGeometry(0.96, 0.54);
    const hudMat = new THREE.MeshBasicMaterial({
      map: hudTex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const hudMesh = new THREE.Mesh(hudGeo, hudMat);
    hudMesh.frustumCulled = false;
    hudMesh.renderOrder = 999;
    hudMesh.position.set(0, 0, -1.05);
    camera.add(hudMesh);

    // 3D Google-Maps-Style AR Walking Path & Chevrons on the floor in front of user
    const pathGroup = new THREE.Group();
    pathGroup.position.set(0, 0.25, 0);
    const numChevrons = 7;
    const chevrons = [];
    const chevShape = new THREE.Shape();
    chevShape.moveTo(0, 0.14);
    chevShape.lineTo(0.18, -0.06);
    chevShape.lineTo(0.12, -0.12);
    chevShape.lineTo(0, 0.02);
    chevShape.lineTo(-0.12, -0.12);
    chevShape.lineTo(-0.18, -0.06);
    chevShape.closePath();
    const chevGeo = new THREE.ShapeGeometry(chevShape);
    chevGeo.rotateX(-Math.PI / 2);

    for (let i = 0; i < numChevrons; i++) {
      const cMat = new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
        depthWrite: false,
      });
      const cm = new THREE.Mesh(chevGeo, cMat);
      cm.frustumCulled = false;
      cm.renderOrder = 995;
      pathGroup.add(cm);
      chevrons.push(cm);
    }

    const leftLineGeo = new THREE.BufferGeometry();
    leftLineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(20 * 3), 3));
    const rightLineGeo = new THREE.BufferGeometry();
    rightLineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(20 * 3), 3));
    const railMat = new THREE.LineBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.7,
    });
    const leftRail = new THREE.Line(leftLineGeo, railMat);
    const rightRail = new THREE.Line(rightLineGeo, railMat);
    leftRail.frustumCulled = false;
    rightRail.frustumCulled = false;
    pathGroup.add(leftRail, rightRail);

    const beaconGeo = new THREE.OctahedronGeometry(0.14, 0);
    const beaconMat = new THREE.MeshBasicMaterial({
      color: 0x34d399,
      transparent: true,
      opacity: 0.9,
    });
    const beacon = new THREE.Mesh(beaconGeo, beaconMat);
    beacon.frustumCulled = false;
    pathGroup.add(beacon);

    vrRig.add(pathGroup);
    const pathData = { pathGroup, chevrons, leftRail, rightRail, beacon, railMat, beaconMat };

    arHudRef.current = {
      canvas: hudCanvas,
      texture: hudTex,
      pathData,
      onXrHeadYaw,
      targetBearingDeg,
      viewHeading,
      isOffRoute,
    };

    renderer.xr.setSession(xrSession).catch((err) => {
      console.error('Failed to bind XR session to Visor3DTerrain:', err);
    });

    return () => {
      if (xrMarkersGroup) xrMarkersGroup.visible = Boolean(arPassthrough);
      camera.remove(hudMesh);
      vrRig.remove(pathGroup);
      vrRig.rotation.y = 0;
      hudGeo.dispose();
      hudMat.dispose();
      hudTex.dispose();
      chevGeo.dispose();
      chevrons.forEach((c) => c.material.dispose());
      leftLineGeo.dispose();
      rightLineGeo.dispose();
      railMat.dispose();
      beaconGeo.dispose();
      beaconMat.dispose();
      arHudRef.current = {
        canvas: null,
        texture: null,
        pathData: null,
        onXrHeadYaw: null,
        targetBearingDeg: null,
        viewHeading: 0,
        isOffRoute: false,
      };
    };
  }, [xrSession, arPassthrough, demData]);

  // Keep WebXR HUD and Path Bearings updated as telemetry/heading changes
  useEffect(() => {
    arHudRef.current.onXrHeadYaw = onXrHeadYaw;
    arHudRef.current.onXrStickMove = onXrStickMove;
    arHudRef.current.targetBearingDeg = targetBearingDeg;
    arHudRef.current.targetDistM = targetDistM;
    arHudRef.current.hudState = hudState;
    arHudRef.current.viewHeading = viewHeading;
    arHudRef.current.isOffRoute = isOffRoute;
    arHudRef.current.projectedMarkers = projectedMarkers;

    const { canvas, texture } = arHudRef.current;
    if (canvas && texture) {
      renderArHudToCanvas(canvas, hudState, {
        headingDeg: viewHeading,
        targetBearingDeg,
        targetDistM,
        markers: projectedMarkers,
        linkLive: true,
      });
      texture.needsUpdate = true;
    }
  }, [hudState, viewHeading, targetBearingDeg, targetDistM, isOffRoute, projectedMarkers, onXrHeadYaw, onXrStickMove]);

  // Update 3D Terrain-Draped A* Route Ribbon whenever routePathCoords or isOffRoute changes
  useEffect(() => {
    const { scene, routeLine, originMtm, baseElev } = sceneRefs.current;
    if (!scene || !demData) return;

    if (routeLine) {
      scene.remove(routeLine);
      routeLine.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
      });
      sceneRefs.current.routeLine = null;
    }

    if (!routePathCoords || routePathCoords.length < 2) return;

    const [originX, originY] = originMtm;
    const rawPts = routePathCoords.map(([lat, lon]) => {
      const [mx, my] = latLonToMTM(lat, lon);
      return [mx, my];
    });

    // Subdivide path every ~40m so the ribbon hugs DEM ridges & slopes smoothly
    const densePts = [];
    for (let i = 0; i < rawPts.length - 1; i++) {
      const [x0, y0] = rawPts[i];
      const [x1, y1] = rawPts[i + 1];
      const segLen = Math.hypot(x1 - x0, y1 - y0);
      const steps = Math.max(1, Math.ceil(segLen / 40));
      for (let s = 0; s < steps; s++) {
        const t = s / steps;
        const mx = x0 + (x1 - x0) * t;
        const my = y0 + (y1 - y0) * t;
        const wx = mx - originX;
        const wz = -(my - originY);
        const wy = (sampleDemElevation(demData, mx, my) - baseElev) * VERTICAL_EXAGGERATION + 10;
        densePts.push(new THREE.Vector3(wx, wy, wz));
      }
    }
    const [lastMx, lastMy] = rawPts[rawPts.length - 1];
    densePts.push(
      new THREE.Vector3(
        lastMx - originX,
        (sampleDemElevation(demData, lastMx, lastMy) - baseElev) * VERTICAL_EXAGGERATION + 10,
        -(lastMy - originY)
      )
    );

    const routeGroup = new THREE.Group();
    const halfWidth = 18; // 36m wide AR path corridor visible end-to-end
    const positions = [];
    const indices = [];

    for (let i = 0; i < densePts.length; i++) {
      const curr = densePts[i];
      const next = densePts[Math.min(densePts.length - 1, i + 1)];
      const prev = densePts[Math.max(0, i - 1)];
      const dir = new THREE.Vector3().subVectors(next, prev);
      dir.y = 0;
      if (dir.lengthSq() < 1e-6) dir.set(0, 0, -1);
      dir.normalize();
      const perpX = -dir.z * halfWidth;
      const perpZ = dir.x * halfWidth;

      positions.push(curr.x + perpX, curr.y, curr.z + perpZ);
      positions.push(curr.x - perpX, curr.y, curr.z - perpZ);

      if (i < densePts.length - 1) {
        const base = i * 2;
        indices.push(base, base + 1, base + 2);
        indices.push(base + 1, base + 3, base + 2);
      }
    }

    const ribbonGeo = new THREE.BufferGeometry();
    ribbonGeo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    ribbonGeo.setIndex(indices);
    ribbonGeo.computeVertexNormals();

    const routeColor = isOffRoute ? 0xf59e0b : 0x34d399;
    const ribbonMat = new THREE.MeshBasicMaterial({
      color: routeColor,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.92,
      fog: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const ribbonMesh = new THREE.Mesh(ribbonGeo, ribbonMat);
    routeGroup.add(ribbonMesh);

    scene.add(routeGroup);
    sceneRefs.current.routeLine = routeGroup;
  }, [demData, routePathCoords, isOffRoute]);

  // Update atmosphere, sky dome, fog, and wireframe contour boost
  useEffect(() => {
    const { scene, wireframeMat, skyCanvas, skyTexture, sunSprite, dustMat } = sceneRefs.current;
    if (!scene || !wireframeMat) return;

    if (isDusty) {
      if (skyCanvas && skyTexture) {
        paintMarsSkyGradient(skyCanvas, '#6b2c0a', '#a64d17', '#c96e28');
        skyTexture.needsUpdate = true;
      }
      if (sunSprite) sunSprite.visible = false;
      if (dustMat) dustMat.opacity = 0.72;
      scene.background = new THREE.Color('#6b2c0a');
      scene.fog = new THREE.FogExp2('#9a4a18', 0.00022);
      wireframeMat.opacity = showContours ? 0.34 : 0;
    } else if (isLowLight) {
      if (skyCanvas && skyTexture) {
        paintMarsSkyGradient(skyCanvas, '#071024', '#162440', '#283b5c');
        skyTexture.needsUpdate = true;
      }
      if (sunSprite) sunSprite.visible = false;
      if (dustMat) dustMat.opacity = 0.15;
      scene.background = new THREE.Color('#071024');
      scene.fog = new THREE.FogExp2('#132038', 0.00010);
      wireframeMat.opacity = showContours ? 0.32 : 0;
    } else {
      if (skyCanvas && skyTexture) {
        paintMarsSkyGradient(skyCanvas, '#2e1710', '#8a4427', '#c97848');
        skyTexture.needsUpdate = true;
      }
      if (sunSprite) sunSprite.visible = true;
      if (dustMat) dustMat.opacity = 0.35;
      scene.background = new THREE.Color('#3b1e14');
      scene.fog = new THREE.FogExp2('#8a4a2c', 0.000028);
      wireframeMat.opacity = showContours ? 0.07 : 0;
    }
  }, [isDusty, isLowLight, showContours]);

  // Update First-Person Camera Position, Yaw (viewHeading), and Pitch (lookPitchDeg)
  useEffect(() => {
    const refs = sceneRefs.current;
    const { camera, vrRig, originMtm, baseElev } = refs;
    if (!camera || !vrRig || !demData || !currentLatLon) return;

    const [lat, lon] = currentLatLon;
    const [mx, my] = latLonToMTM(lat, lon);
    const [originX, originY] = originMtm;

    const groundElev = sampleDemElevation(demData, mx, my);
    onGroundElevation?.(Math.round(groundElev));

    const camX = mx - originX;
    const camZ = -(my - originY);
    const camY = (groundElev - baseElev) * VERTICAL_EXAGGERATION + 28; // 28m astronaut/mast vantage

    refs.targetCamPos.set(camX, camY, camZ);
    if (!refs.hasCamPos || vrRig.position.distanceTo(refs.targetCamPos) > 400) {
      vrRig.position.copy(refs.targetCamPos);
      camera.position.set(0, 0, 0);
      refs.hasCamPos = true;
    }

    const targetYaw = -THREE.MathUtils.degToRad(viewHeading);
    const targetPitch = THREE.MathUtils.degToRad(lookPitchDeg);
    refs.targetCamYaw = targetYaw;
    refs.targetCamPitch = targetPitch;
    if (!refs.hasCamRot) {
      camera.rotation.order = 'YXZ';
      camera.rotation.y = targetYaw;
      camera.rotation.x = targetPitch;
      camera.rotation.z = 0;
      refs.hasCamRot = true;
    }
    refs.onProjectedScreenMarkers = onProjectedScreenMarkers;
  }, [demData, currentLatLon, viewHeading, lookPitchDeg, onGroundElevation, onProjectedScreenMarkers]);

  return <div ref={mountRef} className="h-full w-full" />;
}
