import React, { useState, useEffect } from 'react';
import {
  X,
  Navigation,
  MapPin,
  ChevronLeft,
  ChevronRight,
  Camera,
  Layers,
  FlaskConical,
  Activity,
  Compass,
} from 'lucide-react';

export default function LandmarkDrawer({
  landmark,
  onClose,
  onNavigateToLandmark,
  onSetOriginLandmark,
  onOpenPanorama,
  isCurrentLocation = false,
}) {
  const [photoIdx, setPhotoIdx] = useState(0);

  // Reset photo index when landmark changes
  useEffect(() => {
    setPhotoIdx(0);
  }, [landmark?.id]);

  if (!landmark) return null;

  const photos = landmark.photos || [];
  const currentPhoto = photos[photoIdx] || photos[0];
  const photoUrl = currentPhoto?.url?.startsWith('/')
    ? currentPhoto.url
    : `/${currentPhoto?.url || ''}`;

  const nextPhoto = () => {
    if (photos.length > 0) {
      setPhotoIdx((prev) => (prev + 1) % photos.length);
    }
  };

  const prevPhoto = () => {
    if (photos.length > 0) {
      setPhotoIdx((prev) => (prev - 1 + photos.length) % photos.length);
    }
  };

  const soil = landmark.soil_regolith || {};
  const chem = soil.chemistry || {};
  const samples = landmark.rover_samples || [];

  return (
    <aside
      className="fixed top-0 left-0 bottom-0 z-40 w-full sm:w-[420px] max-w-[92vw] bg-[#13161c] border-r border-[#242933] shadow-2xl flex flex-col overflow-hidden text-[#edf0f5] animate-slideInLeft transition-transform"
      style={{ zIndex: 1050 }}
    >
      {/* 1. Header with Landmark Title & Close Button */}
      <div className="flex items-center justify-between p-3.5 bg-[#191d24] border-b border-[#242933] shrink-0">
        <div className="flex items-center gap-2 min-w-0 pr-2">
          <div className="h-8 w-8 rounded-lg bg-[#222731] border border-[#353c4a] flex items-center justify-center text-cyan-400 shrink-0">
            <Compass className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-xs font-bold font-mono tracking-wider text-[#edf0f5] truncate uppercase">
              {landmark.name}
            </h2>
            <div className="text-[10px] font-mono text-[#9da5b4] flex items-center gap-2">
              <span className="text-[#22c55e] font-semibold">{landmark.category}</span>
              <span>•</span>
              <span>Elev {landmark.elevation_m} m</span>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          title="Close Dossier"
          className="glove-btn h-9 w-9 rounded-xl bg-[#222731] hover:bg-[#2c323f] border border-[#353c4a] text-[#9da5b4] hover:text-[#edf0f5] flex items-center justify-center shrink-0 cursor-pointer transition-colors"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* 2. Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3.5">
        {/* Multi-Sensor Photo Carousel (5 Images) */}
        {photos.length > 0 && (
          <div className="rounded-xl border border-[#242933] overflow-hidden bg-[#0b0d11]">
            <div className="relative w-full h-52 bg-[#0b0d11]">
              <img
                src={photoUrl}
                alt={currentPhoto?.title || landmark.name}
                className="w-full h-full object-cover transition-opacity duration-150"
              />

              {/* Prev / Next Buttons */}
              {photos.length > 1 && (
                <>
                  <button
                    onClick={prevPhoto}
                    title="Previous Image"
                    className="glove-btn absolute left-2 top-1/2 -translate-y-1/2 h-10 w-9 rounded-lg bg-[#13161c]/80 hover:bg-[#191d24] border border-[#353c4a] text-[#edf0f5] flex items-center justify-center cursor-pointer transition-all active:scale-95"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={nextPhoto}
                    title="Next Image"
                    className="glove-btn absolute right-2 top-1/2 -translate-y-1/2 h-10 w-9 rounded-lg bg-[#13161c]/80 hover:bg-[#191d24] border border-[#353c4a] text-[#edf0f5] flex items-center justify-center cursor-pointer transition-all active:scale-95"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}

              {/* Counter Badge */}
              <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-[#0b0d11]/85 border border-[#242933] text-[10px] font-mono text-[#edf0f5]">
                {photoIdx + 1} / {photos.length}
              </div>

              {/* Photo Caption Bar */}
              <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-[#0b0d11] via-[#0b0d11]/80 to-transparent p-2.5 pt-6">
                <div className="text-xs font-semibold text-[#edf0f5] truncate">
                  {currentPhoto?.title}
                </div>
                <div className="text-[10px] font-mono text-[#9da5b4]">
                  {currentPhoto?.source || 'NASA / JPL-Caltech / USGS'}
                </div>
              </div>
            </div>

            {/* Thumbnail Strip (5 thumbs) */}
            {photos.length > 1 && (
              <div className="grid grid-cols-5 gap-1.5 p-2 bg-[#0b0d11] border-t border-[#242933]">
                {photos.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => setPhotoIdx(idx)}
                    className={`h-11 rounded border overflow-hidden cursor-pointer transition-all ${
                      idx === photoIdx
                        ? 'border-[#edf0f5] ring-1 ring-[#edf0f5] opacity-100'
                        : 'border-[#242933] opacity-60 hover:opacity-90'
                    }`}
                  >
                    <img
                      src={p.url.startsWith('/') ? p.url : `/${p.url}`}
                      alt={p.title}
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Action Buttons: Route Here / Set Origin */}
        <div className="grid grid-cols-2 gap-2">
          {!isCurrentLocation ? (
            <button
              onClick={() => onNavigateToLandmark?.(landmark)}
              className="glove-btn col-span-2 min-h-[46px] rounded-xl bg-[#22c55e] hover:bg-[#16a34a] text-[#0b0d11] font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer shadow-lg active:scale-95 transition-all"
            >
              <Navigation className="h-4 w-4 fill-[#0b0d11]" />
              <span>Navigate Here From Position</span>
            </button>
          ) : (
            <div className="col-span-2 py-2.5 rounded-xl bg-cyan-950/60 border border-cyan-500/50 text-cyan-300 text-center font-mono font-bold text-xs">
              📍 YOU ARE CURRENTLY AT THIS LANDMARK
            </div>
          )}

          <button
            onClick={() => onSetOriginLandmark?.(landmark)}
            className="glove-btn min-h-[40px] rounded-xl bg-[#191d24] hover:bg-[#222731] border border-[#353c4a] text-[#9da5b4] hover:text-[#edf0f5] font-mono text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
          >
            <MapPin className="h-3.5 w-3.5 text-cyan-400" />
            <span>Set As Origin</span>
          </button>

          <button
            onClick={() => onOpenPanorama?.(landmark.id)}
            className="glove-btn min-h-[40px] rounded-xl bg-[#191d24] hover:bg-[#222731] border border-[#353c4a] text-[#9da5b4] hover:text-[#edf0f5] font-mono text-[11px] font-bold flex items-center justify-center gap-1.5 cursor-pointer active:scale-95"
          >
            <Camera className="h-3.5 w-3.5 text-amber-400" />
            <span>360° / Vista</span>
          </button>
        </div>

        {/* Geological Unit & Coordinates */}
        <div className="p-3 rounded-xl bg-[#191d24] border border-[#242933] space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase text-[#9da5b4]">
            <span className="flex items-center gap-1">
              <Layers className="h-3.5 w-3.5 text-[#22c55e]" /> USGS SIM 3464 Unit
            </span>
            <span>{landmark.coords?.[0]?.toFixed(4)}°N, {landmark.coords?.[1]?.toFixed(4)}°E</span>
          </div>
          <div className="text-xs font-bold text-[#edf0f5]">{landmark.usgs_unit || 'Regional Cartographic Unit'}</div>
          <p className="text-[11px] text-[#9da5b4] leading-relaxed pt-1 border-t border-[#242933]/60">
            {landmark.brief}
          </p>
        </div>

        {/* PIXL XRF Elemental Oxide Chemistry Grid */}
        {chem && Object.keys(chem).length > 0 && (
          <div className="p-3 rounded-xl bg-[#191d24] border border-[#242933] space-y-2">
            <div className="text-[10px] font-mono uppercase text-[#9da5b4] font-bold flex items-center gap-1.5">
              <FlaskConical className="h-3.5 w-3.5 text-cyan-400" />
              <span>PIXL XRF Major Elemental Oxides (wt%)</span>
            </div>
            <div className="grid grid-cols-6 gap-1.5 text-center">
              {[
                { k: 'SiO₂', v: chem.sio2_wt },
                { k: 'FeO', v: chem.feo_wt },
                { k: 'Al₂O₃', v: chem.al2o3_wt },
                { k: 'MgO', v: chem.mgo_wt },
                { k: 'CaO', v: chem.cao_wt },
                { k: 'SO₃', v: chem.so3_wt },
              ].map((item, idx) => (
                <div key={idx} className="p-1 rounded bg-[#0b0d11] border border-[#242933]">
                  <div className="text-[8px] font-mono text-[#656d7d]">{item.k}</div>
                  <div className="text-[11px] font-mono font-bold text-[#edf0f5]">{item.v ?? '—'}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Soil Mechanics & Bearing Capacity */}
        {soil && (
          <div className="p-3 rounded-xl bg-[#191d24] border border-[#242933] space-y-2 text-xs">
            <div className="text-[10px] font-mono uppercase text-[#9da5b4] font-bold flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-emerald-400" />
              <span>Regolith & Geotechnical Properties</span>
            </div>
            <div className="space-y-1.5 text-[11px] font-mono">
              <div className="flex justify-between py-0.5 border-b border-[#242933]/50">
                <span className="text-[#9da5b4]">Bearing Capacity:</span>
                <span className="font-bold text-[#22c55e]">{soil.soil_bearing_capacity || '140 kPa (Nominal)'}</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#242933]/50">
                <span className="text-[#9da5b4]">Grain Size:</span>
                <span className="font-bold text-[#edf0f5] truncate max-w-[200px]">{soil.grain_size || 'Sand / Pebble'}</span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#242933]/50">
                <span className="text-[#9da5b4]">Perchlorate:</span>
                <span className="font-bold text-[#ef4444]">{soil.perchlorate_content || '0.2 wt%'}</span>
              </div>
              <div className="flex justify-between py-0.5">
                <span className="text-[#9da5b4]">Biosignatures:</span>
                <span className="font-bold text-amber-300 truncate max-w-[190px]">{soil.organics_biosignatures || 'Baseline'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Mars 2020 Cored Sample Tubes */}
        {samples.length > 0 && (
          <div className="p-3 rounded-xl bg-[#191d24] border border-[#242933] space-y-1.5 text-xs">
            <div className="text-[10px] font-mono uppercase text-[#9da5b4] font-bold">
              Cached Perseverance Samples
            </div>
            <div className="space-y-1">
              {samples.map((s, idx) => (
                <div
                  key={idx}
                  className="p-1.5 rounded-lg bg-[#0b0d11] border border-[#242933] text-[11px] font-mono text-[#9da5b4] flex items-center gap-2"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e]" />
                  <span>{s}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </aside>
  );
}