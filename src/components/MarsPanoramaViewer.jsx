import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import {
  Compass,
  Maximize2,
  Minimize2,
  RotateCw,
  RotateCcw,
  Play,
  Pause,
  ZoomIn,
  ZoomOut,
  MapPin,
  Camera,
  X,
  Navigation,
  RefreshCw,
} from 'lucide-react';

/**
 * MarsPanoramaViewer
 * Supports:
 * 1. True 360° Photosphere (Three.js spherical projection) ONLY when panorama.is360 === true.
 * 2. High-Resolution Normal Image Viewer with zoom & pan when panorama.is360 is false.
 */
export default function MarsPanoramaViewer({
  panorama,
  allPanoramas = [],
  onSelectPanorama,
  onClose,
  onNavigateToLocation,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  // Check whether current image is a true 360 photosphere
  const is360 = Boolean(panorama?.is360);

  // 360 Photosphere State
  const [autoRotate, setAutoRotate] = useState(true);
  const [headingDeg, setHeadingDeg] = useState(0);
  const [pitchDeg, setPitchDeg] = useState(0);
  const [fov, setFov] = useState(65);
  const [activeHotspot, setActiveHotspot] = useState(null);

  // Normal 2D Image Zoom & Pan State
  const [imgZoom, setImgZoom] = useState(1);
  const [imgPan, setImgPan] = useState({ x: 0, y: 0 });
  const [isDraggingImg, setIsDraggingImg] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, initialPanX: 0, initialPanY: 0 });

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // Reset zoom & pan when panorama changes
  useEffect(() => {
    setImageLoaded(false);
    setLoadError(false);
    setActiveHotspot(null);
    setImgZoom(1);
    setImgPan({ x: 0, y: 0 });
  }, [panorama]);

  // Three.js 360 Scene setup (ONLY runs if is360 is true)
  useEffect(() => {
    if (!is360 || !containerRef.current || !canvasRef.current || !panorama) return;

    let scene, camera, renderer, sphere;
    let isUserInteracting = false;
    let onPointerDownPointerX = 0;
    let onPointerDownPointerY = 0;
    let onPointerDownLon = 0;
    let onPointerDownLat = 0;
    let lon = 0;
    let lat = 0;
    let phi = 0;
    let theta = 0;
    let animationFrameId;

    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 500;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(fov, width / height, 1, 1100);
    camera.target = new THREE.Vector3(0, 0, 0);

    renderer = new THREE.WebGLRenderer({
      canvas: canvasRef.current,
      antialias: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);

    const geometry = new THREE.SphereGeometry(500, 60, 40);
    geometry.scale(-1, 1, 1);

    const textureLoader = new THREE.TextureLoader();
    textureLoader.load(
      panorama.image || panorama.url,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        const material = new THREE.MeshBasicMaterial({ map: texture });
        sphere = new THREE.Mesh(geometry, material);
        scene.add(sphere);
        setImageLoaded(true);
      },
      undefined,
      (err) => {
        console.error('Error loading Mars 360 texture:', err);
        setLoadError(true);
      }
    );

    const onPointerDown = (event) => {
      isUserInteracting = true;
      const clientX = event.clientX || (event.touches && event.touches[0].clientX) || 0;
      const clientY = event.clientY || (event.touches && event.touches[0].clientY) || 0;

      onPointerDownPointerX = clientX;
      onPointerDownPointerY = clientY;
      onPointerDownLon = lon;
      onPointerDownLat = lat;
    };

    const onPointerMove = (event) => {
      if (!isUserInteracting) return;
      const clientX = event.clientX || (event.touches && event.touches[0].clientX) || 0;
      const clientY = event.clientY || (event.touches && event.touches[0].clientY) || 0;

      lon = (onPointerDownPointerX - clientX) * 0.18 + onPointerDownLon;
      lat = (clientY - onPointerDownPointerY) * 0.18 + onPointerDownLat;
    };

    const onPointerUp = () => {
      isUserInteracting = false;
    };

    const onWheel = (event) => {
      event.preventDefault();
      setFov((prev) => {
        const next = Math.max(35, Math.min(90, prev + event.deltaY * 0.05));
        camera.fov = next;
        camera.updateProjectionMatrix();
        return next;
      });
    };

    const onResize = () => {
      if (!containerRef.current) return;
      const w = containerRef.current.clientWidth;
      const h = containerRef.current.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const domElement = containerRef.current;
    domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    domElement.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      if (autoRotate && !isUserInteracting) {
        lon += 0.08;
      }

      lat = Math.max(-85, Math.min(85, lat));
      phi = THREE.MathUtils.degToRad(90 - lat);
      theta = THREE.MathUtils.degToRad(lon);

      const targetX = 500 * Math.sin(phi) * Math.cos(theta);
      const targetY = 500 * Math.cos(phi);
      const targetZ = 500 * Math.sin(phi) * Math.sin(theta);

      camera.lookAt(targetX, targetY, targetZ);
      renderer.render(scene, camera);

      const curHeading = (Math.round(lon) % 360 + 360) % 360;
      setHeadingDeg(curHeading);
      setPitchDeg(Math.round(lat));
    };

    animate();

    return () => {
      cancelAnimationFrame(animationFrameId);
      domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      geometry.dispose();
    };
  }, [is360, panorama, autoRotate, fov]);

  // Jump camera to hotspot (360 mode only)
  const jumpToHotspot = (hotspot) => {
    setActiveHotspot(hotspot);
    setHeadingDeg(hotspot.yaw);
    setPitchDeg(hotspot.pitch);
    setAutoRotate(false);
  };

  const nudgeHeading = (delta) => {
    setHeadingDeg((prev) => (prev + delta + 360) % 360);
    setAutoRotate(false);
  };

  const nudgeFov = (delta) => {
    setFov((prev) => Math.max(35, Math.min(90, prev + delta)));
  };

  // Normal 2D Image handlers
  const handleNormalZoom = (delta) => {
    setImgZoom((prev) => {
      const next = Math.max(1, Math.min(4, Number((prev + delta).toFixed(2))));
      if (next === 1) setImgPan({ x: 0, y: 0 });
      return next;
    });
  };

  const handleNormalReset = () => {
    setImgZoom(1);
    setImgPan({ x: 0, y: 0 });
  };

  const onNormalPointerDown = (e) => {
    if (imgZoom <= 1) return;
    setIsDraggingImg(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      initialPanX: imgPan.x,
      initialPanY: imgPan.y,
    };
  };

  const onNormalPointerMove = (e) => {
    if (!isDraggingImg) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setImgPan({
      x: dragStartRef.current.initialPanX + dx,
      y: dragStartRef.current.initialPanY + dy,
    });
  };

  const onNormalPointerUp = () => {
    setIsDraggingImg(false);
  };

  const onNormalWheel = (e) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      handleNormalZoom(0.25);
    } else {
      handleNormalZoom(-0.25);
    }
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen?.();
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.();
      setIsFullscreen(false);
    }
  };

  if (!panorama) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/85 p-2 sm:p-4 backdrop-blur-md animate-in fade-in duration-200">
      <div
        ref={containerRef}
        className="relative flex flex-col w-full max-w-5xl h-[92vh] sm:h-[86vh] rounded-3xl bg-slate-900 border-2 border-cyan-500/70 shadow-2xl overflow-hidden"
      >
        {/* 1. TOP MARS ASTRONAUT HUD HEADER */}
        <div className="flex items-center justify-between px-4 py-3 bg-gradient-to-r from-slate-950 via-slate-900 to-cyan-950/80 border-b border-cyan-500/30 text-white z-20">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-950/90 border border-cyan-400/60 shadow-lg text-cyan-300">
              <Camera className="h-6 w-6 animate-pulse" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-black text-cyan-400 uppercase tracking-widest">
                  SOL {panorama.sol} • {panorama.locationName || 'Jezero Crater'}
                </span>
                <span
                  className={`rounded-full px-2.5 py-0.5 text-[10px] font-mono font-bold border ${
                    is360
                      ? 'bg-cyan-500/20 text-cyan-300 border-cyan-400/50'
                      : 'bg-emerald-500/20 text-emerald-300 border-emerald-400/50'
                  }`}
                >
                  {is360 ? '🌐 360° PHOTOSPHERE' : '📷 SURFACE PHOTO'}
                </span>
              </div>
              <h2 className="text-base sm:text-lg font-black tracking-tight text-white line-clamp-1">
                {panorama.title}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* Close Button */}
            <button
              onClick={onClose}
              className="glove-btn p-2.5 rounded-2xl bg-rose-950/80 hover:bg-rose-900 text-rose-300 hover:text-white border border-rose-500/50 cursor-pointer transition-transform active:scale-95 shadow-lg"
              title="Close View (ESC)"
            >
              <X className="h-6 w-6" />
            </button>
          </div>
        </div>

        {/* 2. MAIN VIEWER VIEWPORT */}
        <div className="relative flex-1 bg-black overflow-hidden flex items-center justify-center select-none">
          {is360 ? (
            /* THREE.JS 360 PHOTOSPHERE CANVAS */
            <canvas
              ref={canvasRef}
              className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
            />
          ) : (
            /* NORMAL HIGH-RESOLUTION SURFACE IMAGE VIEW */
            <div
              className={`w-full h-full flex items-center justify-center p-3 sm:p-6 overflow-hidden ${
                imgZoom > 1 ? 'cursor-grab active:cursor-grabbing' : ''
              }`}
              onPointerDown={onNormalPointerDown}
              onPointerMove={onNormalPointerMove}
              onPointerUp={onNormalPointerUp}
              onWheel={onNormalWheel}
            >
              <img
                src={panorama.image || panorama.url}
                alt={panorama.title}
                className="max-h-full max-w-full object-contain rounded-2xl shadow-2xl transition-transform duration-75 pointer-events-none"
                style={{
                  transform: `translate(${imgPan.x}px, ${imgPan.y}px) scale(${imgZoom})`,
                  transformOrigin: 'center center',
                }}
                onLoad={() => setImageLoaded(true)}
                onError={() => {
                  setImageLoaded(true);
                  setLoadError(true);
                }}
              />
            </div>
          )}

          {/* LOADING SPINNER */}
          {!imageLoaded && !loadError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/85 gap-3 z-10 text-cyan-300 font-mono text-sm">
              <div className="h-10 w-10 border-3 border-cyan-400 border-t-transparent rounded-full animate-spin" />
              <span>TRANSMITTING HIGH-RES MARS TELEMETRY...</span>
            </div>
          )}

          {/* ERROR FALLBACK */}
          {loadError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-950/90 gap-2 z-10 text-rose-300 font-mono text-sm">
              <X className="h-8 w-8 text-rose-400" />
              <span>UNABLE TO LOAD TELEMETRY IMAGE</span>
            </div>
          )}

          {/* OVERLAY COMPASS & PITCH HUD (360 MODE ONLY) */}
          {is360 && (
            <div className="absolute top-4 left-4 z-20 flex items-center gap-2 rounded-2xl bg-slate-950/85 border border-cyan-500/50 px-3.5 py-2 font-mono text-xs text-cyan-300 shadow-xl backdrop-blur-md">
              <Compass
                className="h-5 w-5 text-cyan-400 transition-transform duration-200"
                style={{ transform: `rotate(${-headingDeg}deg)` }}
              />
              <span className="font-extrabold text-white">
                {String(headingDeg).padStart(3, '0')}° {getCardinal(headingDeg)}
              </span>
              <span className="text-slate-500">|</span>
              <span className="text-slate-300">
                PITCH {pitchDeg >= 0 ? `+${pitchDeg}°` : `${pitchDeg}°`}
              </span>
              <span className="text-slate-500">|</span>
              <span className="text-emerald-400">FOV {Math.round(fov)}°</span>
            </div>
          )}

          {/* NORMAL IMAGE MAGNIFICATION HUD */}
          {!is360 && (
            <div className="absolute top-4 left-4 z-20 flex items-center gap-2 rounded-2xl bg-slate-950/85 border border-emerald-500/50 px-3.5 py-2 font-mono text-xs text-emerald-300 shadow-xl backdrop-blur-md">
              <span className="font-bold text-white">MAGNIFICATION: {Math.round(imgZoom * 100)}%</span>
              {imgZoom > 1 && (
                <>
                  <span className="text-slate-500">|</span>
                  <span className="text-slate-300 text-[11px]">Drag to pan details</span>
                </>
              )}
            </div>
          )}

          {/* TACTICAL HUD CONTROLS */}
          <div className="absolute right-4 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-2 p-1.5 rounded-2xl bg-slate-950/85 border border-slate-700/80 shadow-2xl backdrop-blur-md">
            {is360 ? (
              /* 360 CONTROLS */
              <>
                <button
                  onClick={() => nudgeHeading(-20)}
                  className="glove-btn p-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 cursor-pointer shadow-md active:scale-95"
                  title="Pan Left"
                >
                  <RotateCcw className="h-5 w-5" />
                </button>
                <button
                  onClick={() => nudgeHeading(20)}
                  className="glove-btn p-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 cursor-pointer shadow-md active:scale-95"
                  title="Pan Right"
                >
                  <RotateCw className="h-5 w-5" />
                </button>
                <div className="h-px bg-slate-800 my-0.5" />
                <button
                  onClick={() => nudgeFov(-8)}
                  className="glove-btn p-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 cursor-pointer shadow-md active:scale-95"
                  title="Zoom In (FOV)"
                >
                  <ZoomIn className="h-5 w-5" />
                </button>
                <button
                  onClick={() => nudgeFov(8)}
                  className="glove-btn p-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 cursor-pointer shadow-md active:scale-95"
                  title="Zoom Out (FOV)"
                >
                  <ZoomOut className="h-5 w-5" />
                </button>
                <div className="h-px bg-slate-800 my-0.5" />
                <button
                  onClick={() => setAutoRotate(!autoRotate)}
                  className={`glove-btn p-3 rounded-xl border cursor-pointer shadow-md active:scale-95 ${
                    autoRotate
                      ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold'
                      : 'bg-slate-900 text-slate-300 border-slate-700'
                  }`}
                  title={autoRotate ? 'Pause Auto-Pan' : 'Start Auto-Pan 360°'}
                >
                  {autoRotate ? <Pause className="h-5 w-5" /> : <Play className="h-5 w-5" />}
                </button>
              </>
            ) : (
              /* NORMAL IMAGE 2D CONTROLS */
              <>
                <button
                  onClick={() => handleNormalZoom(0.5)}
                  className="glove-btn p-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-slate-700 cursor-pointer shadow-md active:scale-95"
                  title="Zoom In"
                >
                  <ZoomIn className="h-5 w-5" />
                </button>
                <button
                  onClick={() => handleNormalZoom(-0.5)}
                  className="glove-btn p-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-emerald-300 border border-slate-700 cursor-pointer shadow-md active:scale-95"
                  title="Zoom Out"
                >
                  <ZoomOut className="h-5 w-5" />
                </button>
                {imgZoom > 1 && (
                  <button
                    onClick={handleNormalReset}
                    className="glove-btn p-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 cursor-pointer shadow-md active:scale-95"
                    title="Reset Zoom to 100%"
                  >
                    <RefreshCw className="h-5 w-5" />
                  </button>
                )}
              </>
            )}

            <button
              onClick={toggleFullscreen}
              className="glove-btn p-3 rounded-xl bg-slate-900 hover:bg-slate-800 text-cyan-300 border border-slate-700 cursor-pointer shadow-md active:scale-95"
              title="Fullscreen"
            >
              {isFullscreen ? <Minimize2 className="h-5 w-5" /> : <Maximize2 className="h-5 w-5" />}
            </button>
          </div>

          {/* ACTIVE HOTSPOT CALLOUT (360 MODE ONLY) */}
          {is360 && activeHotspot && (
            <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 max-w-md w-[90%] rounded-2xl bg-cyan-950/95 border-2 border-cyan-400 p-3 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-bottom-2 duration-200">
              <div className="flex items-center justify-between border-b border-cyan-500/40 pb-1.5 mb-1.5">
                <span className="text-xs font-mono font-black text-cyan-300 flex items-center gap-1.5">
                  <MapPin className="h-4 w-4 text-cyan-400" /> {activeHotspot.name}
                </span>
                <button
                  onClick={() => setActiveHotspot(null)}
                  className="text-cyan-400 hover:text-white p-1 cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <p className="text-xs text-slate-200 font-sans leading-relaxed">
                {activeHotspot.desc}
              </p>
            </div>
          )}
        </div>

        {/* 3. HOTSPOT JUMP STRIP (360 MODE ONLY) */}
        {is360 && panorama.hotspots && panorama.hotspots.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-slate-950 border-t border-slate-800 overflow-x-auto text-xs z-20">
            <span className="text-[11px] font-mono uppercase font-bold text-slate-400 whitespace-nowrap flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-cyan-400" /> HOTSPOTS:
            </span>
            {panorama.hotspots.map((hs, i) => (
              <button
                key={i}
                onClick={() => jumpToHotspot(hs)}
                className={`glove-btn min-h-[36px] px-3 py-1.5 rounded-xl border text-xs font-mono font-bold whitespace-nowrap transition-all cursor-pointer ${
                  activeHotspot?.name === hs.name
                    ? 'bg-cyan-500 text-slate-950 border-cyan-400 shadow-lg'
                    : 'bg-slate-900 hover:bg-slate-800 text-cyan-300 border-slate-700'
                }`}
              >
                📍 {hs.name}
              </button>
            ))}
          </div>
        )}

        {/* 4. BOTTOM TELEMETRY, GEOLOGIC CAPTION & QUICK LOCATIONS CAROUSEL */}
        <div className="p-3.5 bg-slate-950 border-t border-slate-800/80 z-20 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-1">
              <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
                <span className="text-cyan-300 font-bold">INSTRUMENT:</span>{' '}
                {panorama.instrument || (panorama.camera ? `Camera: ${panorama.camera}` : 'NASA Surface Imager')}
                {panorama.attribution && (
                  <>
                    <span>•</span>
                    <span className="text-cyan-300 font-bold">ATTRIBUTION:</span> {panorama.attribution}
                  </>
                )}
              </div>
              <p className="text-xs text-slate-300 font-sans leading-relaxed line-clamp-2 max-w-3xl">
                {panorama.caption}
              </p>
            </div>

            {/* ACTION: NAVIGATE TO LOCATION */}
            {onNavigateToLocation && (
              <button
                onClick={() => {
                  onNavigateToLocation(panorama);
                  onClose();
                }}
                className="glove-btn whitespace-nowrap w-full sm:w-auto min-h-[46px] px-5 py-2.5 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-400 hover:to-teal-500 text-slate-950 font-black text-xs uppercase flex items-center justify-center gap-2 shadow-xl cursor-pointer transition-transform active:scale-95"
              >
                <Navigation className="h-4 w-4" />
                <span>SET DESTINATION & NAVIGATE</span>
              </button>
            )}
          </div>

          {/* QUICK LOCATION CAROUSEL */}
          {allPanoramas.length > 1 && (
            <div className="pt-2 border-t border-slate-800/60 flex items-center gap-2 overflow-x-auto">
              <span className="text-[10px] font-mono uppercase text-slate-400 whitespace-nowrap">
                MORE SIGHTS:
              </span>
              {allPanoramas.map((p) => {
                const isSelected = p.id === panorama.id;
                const pIs360 = Boolean(p.is360);
                return (
                  <button
                    key={p.id}
                    onClick={() => onSelectPanorama?.(p)}
                    className={`glove-btn min-h-[38px] px-3 py-1.5 rounded-xl border text-[11px] font-mono font-bold whitespace-nowrap flex items-center gap-1.5 cursor-pointer transition-all ${
                      isSelected
                        ? pIs360
                          ? 'bg-cyan-500 text-slate-950 border-cyan-300 shadow-md scale-102'
                          : 'bg-emerald-500 text-slate-950 border-emerald-300 shadow-md scale-102'
                        : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    <span>{pIs360 ? '🌐' : '📷'}</span>
                    <span>
                      Sol {p.sol}: {p.title.split(' ')[0]} {pIs360 ? '(360°)' : '(Photo)'}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function getCardinal(deg) {
  const directions = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  const index = Math.round(deg / 45) % 8;
  return directions[index];
}
