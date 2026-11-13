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
  Globe,
  X,
  Navigation,
  RefreshCw,
} from 'lucide-react';

/**
 * MarsPanoramaViewer
 * Supports:
 * 1. Three.js 360 Spherical Photosphere ONLY when panorama.is360 === true.
 * 2. 2D Surface Imagery Viewport with magnification & pan when panorama.is360 is false.
 * Strictly follows aerospace neutral dark palette, 1px borders, 4px radii, and zero emojis.
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

  const is360 = Boolean(panorama?.is360);

  // Refs shared with the live Three.js render loop so buttons never recreate the WebGL context
  const lonRef = useRef(0);
  const latRef = useRef(0);
  const fovRef = useRef(65);
  const autoRotateRef = useRef(true);
  const cameraRef = useRef(null);
  const lastTelemetryRef = useRef({ heading: 0, pitch: 0 });

  // 360 UI readout state
  const [autoRotate, setAutoRotate] = useState(true);
  const [headingDeg, setHeadingDeg] = useState(0);
  const [pitchDeg, setPitchDeg] = useState(0);
  const [fov, setFov] = useState(65);
  const [activeHotspot, setActiveHotspot] = useState(null);

  // 2D Surface Image zoom & pan state
  const [imgZoom, setImgZoom] = useState(1);
  const [imgPan, setImgPan] = useState({ x: 0, y: 0 });
  const [isDraggingImg, setIsDraggingImg] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0, initialPanX: 0, initialPanY: 0 });

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [imageLoaded, setImageLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);

  // ESC shortcut to exit modal
  useEffect(() => {
    if (!panorama) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [panorama, onClose]);

  // Reset telemetry, zoom, and pan when active image changes
  useEffect(() => {
    setImageLoaded(false);
    setLoadError(false);
    setActiveHotspot(null);
    setImgZoom(1);
    setImgPan({ x: 0, y: 0 });
    lonRef.current = 0;
    latRef.current = 0;
    fovRef.current = 65;
    autoRotateRef.current = true;
    lastTelemetryRef.current = { heading: 0, pitch: 0 };
    setFov(65);
    setHeadingDeg(0);
    setPitchDeg(0);
    setAutoRotate(true);
  }, [panorama]);

  // Sync ref when user toggles Auto-Pan
  useEffect(() => {
    autoRotateRef.current = autoRotate;
  }, [autoRotate]);

  // Three.js 360 Scene setup (depends ONLY on [is360, panorama] so buttons actuate live refs smoothly)
  useEffect(() => {
    if (!is360 || !containerRef.current || !canvasRef.current || !panorama) return undefined;

    let scene;
    let camera;
    let renderer;
    let sphere;
    let textureRef = null;
    let materialRef = null;
    let isDisposed = false;
    let isUserInteracting = false;
    let onPointerDownPointerX = 0;
    let onPointerDownPointerY = 0;
    let onPointerDownLon = 0;
    let onPointerDownLat = 0;
    let animationFrameId;

    const viewportEl = canvasRef.current.parentElement || containerRef.current;
    const width = viewportEl.clientWidth || 800;
    const height = viewportEl.clientHeight || 500;

    scene = new THREE.Scene();
    camera = new THREE.PerspectiveCamera(fovRef.current, width / height, 1, 1100);
    camera.target = new THREE.Vector3(0, 0, 0);
    cameraRef.current = camera;

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
        if (isDisposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearFilter;
        textureRef = texture;
        materialRef = new THREE.MeshBasicMaterial({ map: texture });
        sphere = new THREE.Mesh(geometry, materialRef);
        scene.add(sphere);
        setImageLoaded(true);
      },
      undefined,
      (err) => {
        if (isDisposed) return;
        console.error('Error loading Mars 360 texture:', err);
        setLoadError(true);
      }
    );

    const onPointerDown = (event) => {
      isUserInteracting = true;
      const clientX = event.clientX ?? (event.touches && event.touches[0]?.clientX) ?? 0;
      const clientY = event.clientY ?? (event.touches && event.touches[0]?.clientY) ?? 0;

      onPointerDownPointerX = clientX;
      onPointerDownPointerY = clientY;
      onPointerDownLon = lonRef.current;
      onPointerDownLat = latRef.current;
    };

    const onPointerMove = (event) => {
      if (!isUserInteracting) return;
      const clientX = event.clientX ?? (event.touches && event.touches[0]?.clientX) ?? 0;
      const clientY = event.clientY ?? (event.touches && event.touches[0]?.clientY) ?? 0;

      lonRef.current = (onPointerDownPointerX - clientX) * 0.18 + onPointerDownLon;
      latRef.current = (clientY - onPointerDownPointerY) * 0.18 + onPointerDownLat;
    };

    const onPointerUp = () => {
      isUserInteracting = false;
    };

    const onWheel = (event) => {
      event.preventDefault();
      const next = Math.max(35, Math.min(90, fovRef.current + event.deltaY * 0.05));
      fovRef.current = next;
      if (cameraRef.current) {
        cameraRef.current.fov = next;
        cameraRef.current.updateProjectionMatrix();
      }
      setFov(Math.round(next));
    };

    const onResize = () => {
      const parentEl = canvasRef.current?.parentElement || containerRef.current;
      if (!parentEl || !cameraRef.current) return;
      const w = parentEl.clientWidth || 800;
      const h = parentEl.clientHeight || 500;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const domElement = canvasRef.current;
    domElement.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    domElement.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('resize', onResize);

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      if (autoRotateRef.current && !isUserInteracting) {
        lonRef.current += 0.08;
      }

      latRef.current = Math.max(-85, Math.min(85, latRef.current));
      const phi = THREE.MathUtils.degToRad(90 - latRef.current);
      const theta = THREE.MathUtils.degToRad(lonRef.current);

      const targetX = 500 * Math.sin(phi) * Math.cos(theta);
      const targetY = 500 * Math.cos(phi);
      const targetZ = 500 * Math.sin(phi) * Math.sin(theta);

      camera.lookAt(targetX, targetY, targetZ);
      renderer.render(scene, camera);

      const curHeading = ((Math.round(lonRef.current) % 360) + 360) % 360;
      const curPitch = Math.round(latRef.current);
      if (
        curHeading !== lastTelemetryRef.current.heading ||
        curPitch !== lastTelemetryRef.current.pitch
      ) {
        lastTelemetryRef.current = { heading: curHeading, pitch: curPitch };
        setHeadingDeg(curHeading);
        setPitchDeg(curPitch);
      }
    };

    animate();

    return () => {
      isDisposed = true;
      cameraRef.current = null;
      cancelAnimationFrame(animationFrameId);
      domElement.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      domElement.removeEventListener('wheel', onWheel);
      window.removeEventListener('resize', onResize);
      if (materialRef) materialRef.dispose();
      if (textureRef) textureRef.dispose();
      geometry.dispose();
      renderer.dispose();
    };
  }, [is360, panorama]);

  // Actuate camera directly to hotspot orientation
  const jumpToHotspot = (hotspot) => {
    setActiveHotspot(hotspot);
    lonRef.current = Number(hotspot.yaw) || 0;
    latRef.current = Number(hotspot.pitch) || 0;
    autoRotateRef.current = false;
    setAutoRotate(false);
    const normalizedHeading = ((Math.round(lonRef.current) % 360) + 360) % 360;
    const roundedPitch = Math.round(latRef.current);
    lastTelemetryRef.current = { heading: normalizedHeading, pitch: roundedPitch };
    setHeadingDeg(normalizedHeading);
    setPitchDeg(roundedPitch);
  };

  // Pan heading manually without destroying WebGL sphere
  const nudgeHeading = (delta) => {
    lonRef.current = lonRef.current + delta;
    autoRotateRef.current = false;
    setAutoRotate(false);
    const normalizedHeading = ((Math.round(lonRef.current) % 360) + 360) % 360;
    lastTelemetryRef.current = { ...lastTelemetryRef.current, heading: normalizedHeading };
    setHeadingDeg(normalizedHeading);
  };

  // Adjust FOV zoom directly on the active camera
  const nudgeFov = (delta) => {
    const next = Math.max(35, Math.min(90, fovRef.current + delta));
    fovRef.current = next;
    if (cameraRef.current) {
      cameraRef.current.fov = next;
      cameraRef.current.updateProjectionMatrix();
    }
    setFov(Math.round(next));
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
    <div className="fixed inset-0 z-[1500] flex items-center justify-center bg-[#0b0d11]/90 p-2 sm:p-4">
      <div
        ref={containerRef}
        className="relative flex flex-col w-full max-w-5xl h-[92vh] sm:h-[88vh] rounded-[4px] bg-[#13161c] border border-[#353c4a] overflow-hidden"
      >
        {/* TOP INSTRUMENT HEADER */}
        <div className="flex items-center justify-between px-4 py-3 bg-[#191d24] border-b border-[#242933] text-[#edf0f5] z-20 gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[4px] bg-[#13161c] border border-[#353c4a] text-[#edf0f5]">
              {is360 ? <Globe className="h-5 w-5" /> : <Camera className="h-5 w-5" />}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[11px] font-mono font-bold text-[#9da5b4] uppercase tracking-wider">
                  {panorama.sol ? `SOL ${panorama.sol}` : 'ORBITAL / SURFACE'} //{' '}
                  {panorama.locationName || 'JEZERO CRATER'}
                </span>
                <span className="inline-flex items-center gap-1.5 rounded-[4px] px-2 py-0.5 text-[10px] font-mono font-bold border border-[#353c4a] bg-[#13161c] text-[#edf0f5] uppercase">
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      is360 ? 'bg-[#22c55e]' : 'bg-[#9da5b4]'
                    }`}
                  />
                  {is360 ? '360 PHOTOSPHERE' : 'SURFACE IMAGE'}
                </span>
              </div>
              <h2 className="text-sm sm:text-base font-bold tracking-tight text-[#edf0f5] truncate uppercase mt-0.5">
                {panorama.title}
              </h2>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="glove-btn min-h-[42px] min-w-[42px] px-3 rounded-[4px] bg-[#222731] hover:bg-[#dc2626]/20 text-[#edf0f5] hover:text-[#ef4444] border border-[#353c4a] hover:border-[#ef4444] cursor-pointer flex items-center justify-center gap-1.5 text-[11px] font-mono font-bold uppercase"
            title="Close Viewer (ESC)"
          >
            <X className="h-4 w-4" />
            <span className="hidden sm:inline">CLOSE</span>
          </button>
        </div>

        {/* MAIN VIEWPORT */}
        <div className="relative flex-1 bg-[#0b0d11] overflow-hidden flex items-center justify-center select-none">
          {is360 ? (
            <canvas
              ref={canvasRef}
              className="w-full h-full cursor-grab active:cursor-grabbing touch-none"
            />
          ) : (
            <div
              className={`w-full h-full flex items-center justify-center p-3 sm:p-6 overflow-hidden ${
                imgZoom > 1 ? 'cursor-grab active:cursor-grabbing' : ''
              }`}
              onPointerDown={onNormalPointerDown}
              onPointerMove={onNormalPointerMove}
              onPointerUp={onNormalPointerUp}
              onPointerLeave={onNormalPointerUp}
              onWheel={onNormalWheel}
            >
              <img
                src={panorama.image || panorama.url}
                alt={panorama.title}
                className="max-h-full max-w-full object-contain rounded-[4px] border border-[#242933] transition-transform duration-75 pointer-events-none"
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

          {/* LOADING OVERLAY */}
          {!imageLoaded && !loadError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b0d11]/90 gap-3 z-10 text-[#9da5b4] font-mono text-xs uppercase tracking-wider">
              <div className="h-8 w-8 border-2 border-[#edf0f5] border-t-transparent rounded-full animate-spin" />
              <span>LOADING SURFACE IMAGERY...</span>
            </div>
          )}

          {/* ERROR FALLBACK */}
          {loadError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-[#0b0d11]/95 gap-2 z-10 text-[#ef4444] font-mono text-xs uppercase tracking-wider">
              <X className="h-7 w-7 text-[#ef4444]" />
              <span>IMAGERY TELEMETRY UNAVAILABLE</span>
            </div>
          )}

          {/* OVERLAY COMPASS & PITCH HUD (360 MODE) */}
          {is360 && (
            <div className="absolute top-3 left-3 z-20 flex items-center gap-2.5 rounded-[4px] bg-[#13161c]/95 border border-[#353c4a] px-3 py-2 font-mono text-[11px] text-[#9da5b4]">
              <Compass
                className="h-4 w-4 text-[#edf0f5] transition-transform duration-150"
                style={{ transform: `rotate(${-headingDeg}deg)` }}
              />
              <span className="font-bold text-[#edf0f5]">
                HDG {String(headingDeg).padStart(3, '0')} deg {getCardinal(headingDeg)}
              </span>
              <span className="text-[#353c4a]">|</span>
              <span>PITCH {pitchDeg >= 0 ? `+${pitchDeg}` : pitchDeg} deg</span>
              <span className="text-[#353c4a]">|</span>
              <span className="text-[#22c55e] font-bold">FOV {Math.round(fov)} deg</span>
            </div>
          )}

          {/* NORMAL IMAGE MAGNIFICATION HUD */}
          {!is360 && (
            <div className="absolute top-3 left-3 z-20 flex items-center gap-2 rounded-[4px] bg-[#13161c]/95 border border-[#353c4a] px-3 py-2 font-mono text-[11px] text-[#9da5b4]">
              <span className="font-bold text-[#edf0f5]">
                MAGNIFICATION: {Math.round(imgZoom * 100)}%
              </span>
              {imgZoom > 1 && (
                <>
                  <span className="text-[#353c4a]">|</span>
                  <span>DRAG TO PAN</span>
                </>
              )}
            </div>
          )}

          {/* GLOVE-COMPATIBLE INSTRUMENT CONTROLS */}
          <div className="absolute right-3 top-1/2 -translate-y-1/2 z-20 flex flex-col gap-1.5 p-1.5 rounded-[4px] bg-[#13161c]/95 border border-[#353c4a]">
            {is360 ? (
              <>
                <button
                  type="button"
                  onClick={() => nudgeHeading(-20)}
                  className="glove-btn min-h-[42px] min-w-[42px] flex items-center justify-center rounded-[4px] bg-[#191d24] hover:bg-[#222731] active:bg-[#2c323f] text-[#edf0f5] border border-[#353c4a] cursor-pointer"
                  title="Pan Left 20 deg"
                  aria-label="Pan Left"
                >
                  <RotateCcw className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => nudgeHeading(20)}
                  className="glove-btn min-h-[42px] min-w-[42px] flex items-center justify-center rounded-[4px] bg-[#191d24] hover:bg-[#222731] active:bg-[#2c323f] text-[#edf0f5] border border-[#353c4a] cursor-pointer"
                  title="Pan Right 20 deg"
                  aria-label="Pan Right"
                >
                  <RotateCw className="h-4 w-4" />
                </button>
                <div className="h-px bg-[#242933] my-0.5" />
                <button
                  type="button"
                  onClick={() => nudgeFov(-8)}
                  className="glove-btn min-h-[42px] min-w-[42px] flex items-center justify-center rounded-[4px] bg-[#191d24] hover:bg-[#222731] active:bg-[#2c323f] text-[#edf0f5] border border-[#353c4a] cursor-pointer"
                  title="Zoom In (Decrease FOV)"
                  aria-label="Zoom In"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => nudgeFov(8)}
                  className="glove-btn min-h-[42px] min-w-[42px] flex items-center justify-center rounded-[4px] bg-[#191d24] hover:bg-[#222731] active:bg-[#2c323f] text-[#edf0f5] border border-[#353c4a] cursor-pointer"
                  title="Zoom Out (Increase FOV)"
                  aria-label="Zoom Out"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                <div className="h-px bg-[#242933] my-0.5" />
                <button
                  type="button"
                  onClick={() => setAutoRotate((prev) => !prev)}
                  className={`glove-btn min-h-[42px] min-w-[42px] flex items-center justify-center rounded-[4px] border cursor-pointer ${
                    autoRotate
                      ? 'bg-[#22c55e]/20 text-[#22c55e] border-[#22c55e]'
                      : 'bg-[#191d24] hover:bg-[#222731] text-[#9da5b4] border-[#353c4a]'
                  }`}
                  title={autoRotate ? 'Pause Auto-Pan' : 'Resume Auto-Pan'}
                  aria-label="Toggle Auto-Pan"
                >
                  {autoRotate ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => handleNormalZoom(0.5)}
                  className="glove-btn min-h-[42px] min-w-[42px] flex items-center justify-center rounded-[4px] bg-[#191d24] hover:bg-[#222731] active:bg-[#2c323f] text-[#edf0f5] border border-[#353c4a] cursor-pointer"
                  title="Zoom In"
                  aria-label="Zoom In"
                >
                  <ZoomIn className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={() => handleNormalZoom(-0.5)}
                  className="glove-btn min-h-[42px] min-w-[42px] flex items-center justify-center rounded-[4px] bg-[#191d24] hover:bg-[#222731] active:bg-[#2c323f] text-[#edf0f5] border border-[#353c4a] cursor-pointer"
                  title="Zoom Out"
                  aria-label="Zoom Out"
                >
                  <ZoomOut className="h-4 w-4" />
                </button>
                {imgZoom > 1 && (
                  <button
                    type="button"
                    onClick={handleNormalReset}
                    className="glove-btn min-h-[42px] min-w-[42px] flex items-center justify-center rounded-[4px] bg-[#191d24] hover:bg-[#222731] active:bg-[#2c323f] text-[#edf0f5] border border-[#353c4a] cursor-pointer"
                    title="Reset Magnification to 100%"
                    aria-label="Reset Zoom"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                )}
              </>
            )}

            <button
              type="button"
              onClick={toggleFullscreen}
              className="glove-btn min-h-[42px] min-w-[42px] flex items-center justify-center rounded-[4px] bg-[#191d24] hover:bg-[#222731] active:bg-[#2c323f] text-[#edf0f5] border border-[#353c4a] cursor-pointer"
              title="Toggle Fullscreen"
              aria-label="Toggle Fullscreen"
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </button>
          </div>

          {/* ACTIVE HOTSPOT CALLOUT (360 MODE) */}
          {is360 && activeHotspot && (
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 max-w-md w-[90%] rounded-[4px] bg-[#13161c]/95 border border-[#4f5767] p-3">
              <div className="flex items-center justify-between border-b border-[#242933] pb-1.5 mb-1.5">
                <span className="text-[11px] font-mono font-bold text-[#edf0f5] uppercase flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5 text-[#22c55e]" />
                  {activeHotspot.name}
                </span>
                <button
                  type="button"
                  onClick={() => setActiveHotspot(null)}
                  className="text-[#9da5b4] hover:text-[#edf0f5] p-1 cursor-pointer"
                  aria-label="Close Hotspot"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              <p className="text-xs text-[#9da5b4] font-sans leading-relaxed">
                {activeHotspot.desc}
              </p>
            </div>
          )}
        </div>

        {/* HOTSPOT JUMP STRIP (360 MODE) */}
        {is360 && panorama.hotspots && panorama.hotspots.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-2 bg-[#13161c] border-t border-[#242933] overflow-x-auto text-xs z-20">
            <span className="text-[10px] font-mono uppercase font-bold text-[#656d7d] whitespace-nowrap flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5 text-[#9da5b4]" />
              BEARING MARKERS:
            </span>
            {panorama.hotspots.map((hs, i) => {
              const isHot = activeHotspot?.name === hs.name;
              return (
                <button
                  type="button"
                  key={`${hs.name}-${i}`}
                  onClick={() => jumpToHotspot(hs)}
                  className={`glove-btn min-h-[38px] px-3 py-1.5 rounded-[4px] border text-[11px] font-mono font-bold whitespace-nowrap uppercase flex items-center gap-1.5 cursor-pointer ${
                    isHot
                      ? 'bg-[#22c55e]/20 text-[#22c55e] border-[#22c55e]'
                      : 'bg-[#191d24] hover:bg-[#222731] text-[#edf0f5] border-[#353c4a]'
                  }`}
                >
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span>{hs.name}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* FOOTER TELEMETRY & VISTA CAROUSEL */}
        <div className="p-3.5 bg-[#191d24] border-t border-[#242933] z-20 space-y-3">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 text-xs">
            <div className="space-y-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-[#9da5b4]">
                <span className="text-[#edf0f5] font-bold">INSTRUMENT:</span>
                <span>
                  {panorama.instrument || (panorama.camera ? panorama.camera : 'NASA SURFACE IMAGER')}
                </span>
                {panorama.attribution && (
                  <>
                    <span className="text-[#353c4a]">//</span>
                    <span className="text-[#edf0f5] font-bold">SOURCE:</span>
                    <span>{panorama.attribution}</span>
                  </>
                )}
              </div>
              {panorama.caption && (
                <p className="text-xs text-[#9da5b4] font-sans leading-relaxed line-clamp-2 max-w-3xl">
                  {panorama.caption}
                </p>
              )}
            </div>

            {onNavigateToLocation && (
              <button
                type="button"
                onClick={() => {
                  onNavigateToLocation(panorama);
                  onClose();
                }}
                className="glove-btn whitespace-nowrap w-full sm:w-auto min-h-[44px] px-4 py-2 rounded-[4px] bg-[#16a34a] hover:bg-[#22c55e] text-[#0b0d11] font-mono font-bold text-xs uppercase flex items-center justify-center gap-2 border border-[#22c55e] cursor-pointer"
              >
                <Navigation className="h-4 w-4" />
                <span>ROUTE TO SITE</span>
              </button>
            )}
          </div>

          {allPanoramas.length > 1 && (
            <div className="pt-2.5 border-t border-[#242933] flex items-center gap-2 overflow-x-auto">
              <span className="text-[10px] font-mono uppercase font-bold text-[#656d7d] whitespace-nowrap">
                ARCHIVE VIEWS:
              </span>
              {allPanoramas.map((p) => {
                const isSelected = p.id === panorama.id;
                const pIs360 = Boolean(p.is360);
                return (
                  <button
                    type="button"
                    key={p.id}
                    onClick={() => onSelectPanorama?.(p)}
                    className={`glove-btn min-h-[40px] px-3 py-1.5 rounded-[4px] border text-[11px] font-mono font-bold whitespace-nowrap flex items-center gap-1.5 cursor-pointer ${
                      isSelected
                        ? 'bg-[#22c55e]/20 text-[#22c55e] border-[#22c55e]'
                        : 'bg-[#13161c] hover:bg-[#222731] text-[#9da5b4] hover:text-[#edf0f5] border-[#353c4a]'
                    }`}
                  >
                    {pIs360 ? <Globe className="h-3.5 w-3.5" /> : <Camera className="h-3.5 w-3.5" />}
                    <span>
                      {p.locationName || p.title} {pIs360 ? '[360]' : '[IMG]'}
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
