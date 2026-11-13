import React, { useState, useEffect } from 'react';
import {
  X,
  Navigation,
  MapPin,
  Crosshair,
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
  onSetTargetLandmark,
  onOpenPanorama,
  isCurrentLocation = false,
}) {
  const [photoIdx, setPhotoIdx] = useState(0);

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
      className="fixed top-[42px] left-0 bottom-[48px] z-[980] w-full sm:w-[410px] max-w-[92vw] bg-[#13161c] border-r border-[#242933] flex flex-col overflow-hidden text-[#edf0f5]"
    >
      {/* 1. Header */}
      <div className="flex items-center justify-between px-3 py-2.5 bg-[#191d24] border-b border-[#242933] shrink-0">
        <div className="flex items-center gap-2 min-w-0 pr-2">
          <div className="h-8 w-8 rounded-[4px] bg-[#0b0d11] border border-[#353c4a] flex items-center justify-center text-[#22c55e] shrink-0">
            <Compass className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-[11px] font-bold font-mono tracking-wider text-[#edf0f5] truncate uppercase">
              {landmark.name}
            </h2>
            <div className="text-[10px] font-mono text-[#9da5b4] flex items-center gap-1.5">
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-[#22c55e]" />
              <span className="text-[#22c55e] font-semibold">{landmark.category}</span>
              <span>|</span>
              <span>ELEV {landmark.elevation_m} m</span>
            </div>
          </div>
        </div>

        <button
          onClick={onClose}
          title="Close Dossier"
          className="glove-btn h-10 w-10 rounded-[4px] bg-[#13161c] hover:bg-[#222731] active:bg-[#2c323f] border border-[#353c4a] text-[#9da5b4] hover:text-[#edf0f5] flex items-center justify-center shrink-0 cursor-pointer"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* 2. Scrollable Body */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {/* Multi-Sensor Photo Carousel */}
        {photos.length > 0 && (
          <div className="rounded-[4px] border border-[#242933] overflow-hidden bg-[#0b0d11]">
            <div className="relative w-full h-52 bg-[#0b0d11]">
              <img
                src={photoUrl}
                alt={currentPhoto?.title || landmark.name}
                className="w-full h-full object-cover"
              />

              {photos.length > 1 && (
                <>
                  <button
                    onClick={prevPhoto}
                    title="Previous Sensor Frame"
                    className="glove-btn absolute left-2 top-1/2 -translate-y-1/2 h-10 w-9 rounded-[4px] bg-[#13161c]/90 hover:bg-[#222731] border border-[#353c4a] text-[#edf0f5] flex items-center justify-center cursor-pointer"
                  >
                    <ChevronLeft className="h-5 w-5" />
                  </button>
                  <button
                    onClick={nextPhoto}
                    title="Next Sensor Frame"
                    className="glove-btn absolute right-2 top-1/2 -translate-y-1/2 h-10 w-9 rounded-[4px] bg-[#13161c]/90 hover:bg-[#222731] border border-[#353c4a] text-[#edf0f5] flex items-center justify-center cursor-pointer"
                  >
                    <ChevronRight className="h-5 w-5" />
                  </button>
                </>
              )}

              <div className="absolute top-2 right-2 px-2 py-0.5 rounded-[4px] bg-[#0b0d11]/90 border border-[#353c4a] text-[10px] font-mono text-[#edf0f5]">
                {photoIdx + 1} / {photos.length}
              </div>

              <div className="absolute bottom-0 inset-x-0 bg-[#0b0d11]/90 border-t border-[#242933] px-2.5 py-1.5">
                <div className="text-[11px] font-semibold text-[#edf0f5] truncate font-mono">
                  {currentPhoto?.title}
                </div>
                <div className="text-[9.5px] font-mono text-[#9da5b4]">
                  {currentPhoto?.source || 'NASA / JPL-Caltech / USGS'}
                </div>
              </div>
            </div>

            {photos.length > 1 && (
              <div className="grid grid-cols-5 gap-1 p-1.5 bg-[#0b0d11] border-t border-[#242933]">
                {photos.map((p, idx) => (
                  <button
                    key={idx}
                    onClick={() => setPhotoIdx(idx)}
                    title={p.title}
                    className={`h-11 rounded-[4px] border overflow-hidden cursor-pointer ${
                      idx === photoIdx
                        ? 'border-[#edf0f5] opacity-100'
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

        {/* Action Buttons */}
        <div className="grid grid-cols-2 gap-2">
          {!isCurrentLocation ? (
            <button
              onClick={() => onNavigateToLandmark?.(landmark)}
              className="glove-btn col-span-2 min-h-[44px] rounded-[4px] bg-[#22c55e] hover:bg-[#16a34a] text-[#0b0d11] font-mono font-bold text-xs uppercase tracking-wider flex items-center justify-center gap-2 cursor-pointer"
            >
              <Navigation className="h-4 w-4" />
              <span>ROUTE HERE</span>
            </button>
          ) : (
            <div className="col-span-2 min-h-[40px] flex items-center justify-center rounded-[4px] bg-[#191d24] border border-[#22c55e]/50 text-[#22c55e] font-mono font-bold text-[11px] uppercase">
              [CURRENT ORIGIN POSITION]
            </div>
          )}

          <button
            onClick={() => onSetOriginLandmark?.(landmark)}
            className="glove-btn min-h-[40px] rounded-[4px] bg-[#191d24] hover:bg-[#222731] active:bg-[#2c323f] border border-[#353c4a] text-[#edf0f5] font-mono text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <MapPin className="h-3.5 w-3.5 text-[#22c55e]" />
            <span>SET BASE</span>
          </button>

          <button
            onClick={() => onSetTargetLandmark?.(landmark)}
            className="glove-btn min-h-[40px] rounded-[4px] bg-[#191d24] hover:bg-[#222731] active:bg-[#2c323f] border border-[#353c4a] text-[#edf0f5] font-mono text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Crosshair className="h-3.5 w-3.5 text-[#9da5b4]" />
            <span>SET TARGET</span>
          </button>

          <button
            onClick={() => onOpenPanorama?.(landmark)}
            className="glove-btn col-span-2 min-h-[40px] rounded-[4px] bg-[#191d24] hover:bg-[#222731] active:bg-[#2c323f] border border-[#353c4a] text-[#edf0f5] font-mono text-[11px] font-semibold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            <Camera className="h-3.5 w-3.5 text-[#edf0f5]" />
            <span>SURFACE VISTA / 360</span>
          </button>
        </div>

        {/* Geological Unit & Coordinates */}
        <div className="p-2.5 rounded-[4px] bg-[#191d24] border border-[#242933] space-y-1.5">
          <div className="flex items-center justify-between text-[10px] font-mono uppercase text-[#9da5b4]">
            <span className="flex items-center gap-1">
              <Layers className="h-3.5 w-3.5 text-[#22c55e]" /> USGS SIM 3464 UNIT
            </span>
            <span>
              {landmark.coords?.[0]?.toFixed(4)} N, {landmark.coords?.[1]?.toFixed(4)} E
            </span>
          </div>
          <div className="text-xs font-bold font-mono text-[#edf0f5]">
            {landmark.usgs_unit || 'Regional Cartographic Unit'}
          </div>
          <p className="text-[11px] text-[#9da5b4] leading-relaxed pt-1 border-t border-[#242933]">
            {landmark.brief}
          </p>
        </div>

        {/* PIXL XRF Chemistry */}
        {chem && Object.keys(chem).length > 0 && (
          <div className="p-2.5 rounded-[4px] bg-[#191d24] border border-[#242933] space-y-2">
            <div className="text-[10px] font-mono uppercase text-[#9da5b4] font-bold flex items-center gap-1.5">
              <FlaskConical className="h-3.5 w-3.5 text-[#edf0f5]" />
              <span>PIXL XRF MAJOR OXIDES (WT%)</span>
            </div>
            <div className="grid grid-cols-6 gap-1 text-center">
              {[
                { k: 'SiO2', v: chem.sio2_wt },
                { k: 'FeO', v: chem.feo_wt },
                { k: 'Al2O3', v: chem.al2o3_wt },
                { k: 'MgO', v: chem.mgo_wt },
                { k: 'CaO', v: chem.cao_wt },
                { k: 'SO3', v: chem.so3_wt },
              ].map((item, idx) => (
                <div key={idx} className="p-1 rounded-[4px] bg-[#0b0d11] border border-[#242933]">
                  <div className="text-[8px] font-mono text-[#656d7d]">{item.k}</div>
                  <div className="text-[11px] font-mono font-bold text-[#edf0f5]">{item.v ?? '--'}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Regolith & Geotechnical */}
        {soil && (
          <div className="p-2.5 rounded-[4px] bg-[#191d24] border border-[#242933] space-y-1.5 text-xs">
            <div className="text-[10px] font-mono uppercase text-[#9da5b4] font-bold flex items-center gap-1.5">
              <Activity className="h-3.5 w-3.5 text-[#22c55e]" />
              <span>REGOLITH & GEOTECHNICAL READINGS</span>
            </div>
            <div className="space-y-1 text-[10.5px] font-mono">
              <div className="flex justify-between py-0.5 border-b border-[#242933]">
                <span className="text-[#656d7d]">BEARING CAPACITY</span>
                <span className="font-semibold text-[#22c55e] text-right">
                  {soil.soil_bearing_capacity || '140 kPa (Nominal)'}
                </span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#242933] gap-2">
                <span className="text-[#656d7d]">GRAIN SIZE</span>
                <span className="font-semibold text-[#edf0f5] text-right truncate max-w-[200px]">
                  {soil.grain_size || 'Sand / Pebble'}
                </span>
              </div>
              <div className="flex justify-between py-0.5 border-b border-[#242933] gap-2">
                <span className="text-[#656d7d]">PERCHLORATE</span>
                <span className="font-semibold text-[#ef4444] text-right">
                  {soil.perchlorate_content || '0.2 wt%'}
                </span>
              </div>
              <div className="flex justify-between py-0.5 gap-2">
                <span className="text-[#656d7d]">BIOSIGNATURES</span>
                <span className="font-semibold text-[#edf0f5] text-right truncate max-w-[190px]">
                  {soil.organics_biosignatures || 'Baseline'}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Cored Samples */}
        {samples.length > 0 && (
          <div className="p-2.5 rounded-[4px] bg-[#191d24] border border-[#242933] space-y-1.5 text-xs">
            <div className="text-[10px] font-mono uppercase text-[#9da5b4] font-bold">
              CACHED PERSEVERANCE SAMPLES
            </div>
            <div className="space-y-1">
              {samples.map((s, idx) => (
                <div
                  key={idx}
                  className="p-1.5 rounded-[4px] bg-[#0b0d11] border border-[#242933] text-[10.5px] font-mono text-[#9da5b4] flex items-center gap-2"
                >
                  <span className="h-1.5 w-1.5 rounded-full bg-[#22c55e] shrink-0" />
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
