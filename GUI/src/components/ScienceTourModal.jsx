import React, { useState } from 'react';
import {
  Clock,
  Compass,
  Play,
  RotateCcw,
  Route,
  Sparkles,
  Timer,
  X,
} from 'lucide-react';
import { planScienceTourApi } from '../utils/engineApi';

export default function ScienceTourModal({
  isOpen,
  onClose,
  sciencePOIs = [],
  shelters = [],
  currentMode = 'rover',
  currentWeather = 'nominal',
  startBattery = 100,
  startO2 = 100,
  startLstMinutes = 540, // 09:00 LST
  onApplyTourToMap,
  showToast,
}) {
  const [baseLocationKey, setBaseLocationKey] = useState('hab-alpha');
  const [selectedTargetIds, setSelectedTargetIds] = useState(() => [
    'seitah',
    'three-forks',
    'hawksbill',
    'kodiak',
  ]);
  const [maxHours, setMaxHours] = useState(6.0);
  const [dwellMinutes, setDwellMinutes] = useState(25.0);
  const [tourMode, setTourMode] = useState(currentMode);
  const [tourLoading, setTourLoading] = useState(false);
  const [tourResult, setTourResult] = useState(null);
  const [tourError, setTourError] = useState(null);

  if (!isOpen) return null;

  // Filter science targets (exclude Hab Alpha base itself)
  const candidateTargets = sciencePOIs.filter((p) => !p.id.includes('hab-alpha'));

  const handleToggleTarget = (id) => {
    setSelectedTargetIds((prev) =>
      prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]
    );
  };

  const handleSelectAll = () => {
    setSelectedTargetIds(candidateTargets.map((t) => t.id));
  };

  const handleSelectTopPriority = () => {
    setSelectedTargetIds(['seitah', 'three-forks', 'hawksbill', 'kodiak']);
  };

  const handleClearTargets = () => {
    setSelectedTargetIds([]);
  };

  const handleSolveTour = async () => {
    if (selectedTargetIds.length === 0) {
      setTourError('Select at least one science target to plan an orienteering tour.');
      return;
    }
    setTourError(null);
    setTourLoading(true);

    try {
      const basePOI =
        sciencePOIs.find((p) => p.id === baseLocationKey) ||
        shelters.find((s) => s.id === baseLocationKey) ||
        sciencePOIs[0];

      const targetsPayload = candidateTargets
        .filter((t) => selectedTargetIds.includes(t.id))
        .map((t) => [t.lat, t.lon]);

      const depLstHours = ((startLstMinutes % 1440) + 1440) % 1440 / 60;

      const res = await planScienceTourApi({
        base_location: [basePOI.lat, basePOI.lon],
        targets: targetsPayload,
        max_duration_hours: Number(maxHours),
        stay_duration_min: Number(dwellMinutes),
        mode: tourMode === 'rover' ? 'rover' : 'on_foot',
        departure_lst: depLstHours,
        weather: currentWeather,
        initial_battery_pct: startBattery,
        initial_o2_pct: startO2,
      });

      setTourResult(res);
      showToast?.({
        id: `tour-solved-${Date.now()}`,
        type: 'success',
        title: 'MARTIAN ORIENTEERING SOLVED',
        message: `${res.targets_visited_count ?? 0} science stops scheduled in ${res.summary?.total_mission_duration_formatted || `${res.total_duration_min} min`}.`,
      });
    } catch (err) {
      setTourError(err.message || 'Engine failed to compute combinatorial science tour.');
    } finally {
      setTourLoading(false);
    }
  };

  const handleApply = () => {
    if (!tourResult) return;
    onApplyTourToMap?.(tourResult);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[600] flex items-center justify-center p-3 bg-black/80 backdrop-blur-sm font-mono animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl max-h-[92vh] flex flex-col bg-[#11141a] border-2 border-[#38bdf8]/60 rounded-lg shadow-2xl text-[#edf0f5] overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[#242933] bg-[#161a22]">
          <div className="flex items-center gap-2.5">
            <Route className="h-5 w-5 text-[#38bdf8]" />
            <div>
              <div className="text-sm font-extrabold uppercase tracking-wider text-[#edf0f5] flex items-center gap-2">
                <span>Martian Orienteering Science Tour Planner</span>
                <span className="text-[10px] rounded bg-[#38bdf8]/20 border border-[#38bdf8]/40 px-2 py-0.5 text-[#38bdf8] font-bold">
                  STAGE 6 ENGINE SOLVER
                </span>
              </div>
              <div className="text-[11px] text-[#9da5b4]">
                Combines high-res A* pathfinding & combinatorial TSP to maximize science return within EVA time and life-support budgets.
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-[#9da5b4] hover:text-white hover:bg-[#242933] cursor-pointer"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content Body (Two-Column Layout) */}
        <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-4 p-5 overflow-y-auto aerospace-scroll">
          {/* Left Column: Mission Controls & Targets (5 cols) */}
          <div className="md:col-span-5 flex flex-col gap-4">
            {/* Mode & Base Selection */}
            <div className="p-3 bg-[#191d24] border border-[#242933] rounded">
              <label className="text-[11px] font-bold text-[#38bdf8] uppercase tracking-wider block mb-1.5">
                1. Base Habitat & Mobility
              </label>
              <div className="grid grid-cols-2 gap-2 mb-2.5">
                <button
                  type="button"
                  onClick={() => setTourMode('rover')}
                  className={`py-1.5 px-2 rounded text-xs font-bold border cursor-pointer ${
                    tourMode === 'rover'
                      ? 'bg-[#38bdf8]/20 border-[#38bdf8] text-[#38bdf8]'
                      : 'bg-[#11141a] border-[#242933] text-[#9da5b4] hover:text-white'
                  }`}
                >
                  Rover Mode
                </button>
                <button
                  type="button"
                  onClick={() => setTourMode('on_foot')}
                  className={`py-1.5 px-2 rounded text-xs font-bold border cursor-pointer ${
                    tourMode === 'on_foot'
                      ? 'bg-[#22c55e]/20 border-[#22c55e] text-[#22c55e]'
                      : 'bg-[#11141a] border-[#242933] text-[#9da5b4] hover:text-white'
                  }`}
                >
                  On Foot (EVA)
                </button>
              </div>

              <select
                value={baseLocationKey}
                onChange={(e) => setBaseLocationKey(e.target.value)}
                className="w-full bg-[#11141a] border border-[#353c4a] rounded px-2.5 py-1.5 text-xs text-[#edf0f5] focus:outline-none focus:border-[#38bdf8]"
              >
                <option value="hab-alpha">Hab Alpha (Primary Pressurized Base)</option>
                {shelters.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.type || 'Shelter'})
                  </option>
                ))}
              </select>
            </div>

            {/* Budget Sliders */}
            <div className="p-3 bg-[#191d24] border border-[#242933] rounded flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <label className="text-[11px] font-bold text-[#38bdf8] uppercase tracking-wider flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Max Mission Budget
                </label>
                <span className="text-xs font-bold text-amber-300 font-mono">{maxHours} Hours</span>
              </div>
              <input
                type="range"
                min="2.0"
                max="8.0"
                step="0.5"
                value={maxHours}
                onChange={(e) => setMaxHours(parseFloat(e.target.value))}
                className="w-full accent-[#38bdf8] cursor-pointer"
              />

              <div className="flex items-center justify-between pt-1 border-t border-[#242933]">
                <label className="text-[11px] font-bold text-[#38bdf8] uppercase tracking-wider flex items-center gap-1.5">
                  <Timer className="h-3.5 w-3.5" />
                  Site Dwell (Sampling)
                </label>
                <span className="text-xs font-bold text-cyan-300 font-mono">{dwellMinutes} Min / Stop</span>
              </div>
              <input
                type="range"
                min="10"
                max="45"
                step="5"
                value={dwellMinutes}
                onChange={(e) => setDwellMinutes(parseFloat(e.target.value))}
                className="w-full accent-cyan-400 cursor-pointer"
              />
            </div>

            {/* Candidate Science Targets */}
            <div className="p-3 bg-[#191d24] border border-[#242933] rounded flex-1 flex flex-col">
              <div className="flex items-center justify-between mb-2">
                <label className="text-[11px] font-bold text-[#38bdf8] uppercase tracking-wider">
                  Candidate Targets ({selectedTargetIds.length}/{candidateTargets.length})
                </label>
                <div className="flex gap-1.5 text-[9.5px]">
                  <button
                    type="button"
                    onClick={handleSelectTopPriority}
                    className="text-[#38bdf8] hover:underline cursor-pointer"
                  >
                    Priority [4]
                  </button>
                  <span className="text-[#656d7d]">•</span>
                  <button
                    type="button"
                    onClick={handleSelectAll}
                    className="text-[#22c55e] hover:underline cursor-pointer"
                  >
                    All
                  </button>
                  <span className="text-[#656d7d]">•</span>
                  <button
                    type="button"
                    onClick={handleClearTargets}
                    className="text-[#ef4444] hover:underline cursor-pointer"
                  >
                    Clear
                  </button>
                </div>
              </div>

              <div className="flex flex-col gap-1.5 max-h-[220px] overflow-y-auto aerospace-scroll pr-1">
                {candidateTargets.map((target) => {
                  const isChecked = selectedTargetIds.includes(target.id);
                  return (
                    <label
                      key={target.id}
                      className={`flex items-center justify-between p-2 rounded border text-xs cursor-pointer transition-colors ${
                        isChecked
                          ? 'bg-[#1e293b]/70 border-[#38bdf8]/60 text-white'
                          : 'bg-[#11141a] border-[#242933] text-[#9da5b4] hover:bg-[#161a22]'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleToggleTarget(target.id)}
                          className="accent-[#38bdf8] rounded"
                        />
                        <span className="truncate font-semibold">{target.name}</span>
                      </div>
                      <span className="text-[10px] text-[#656d7d] shrink-0 ml-1">
                        {target.elevation_m ? `${target.elevation_m}m` : ''}
                      </span>
                    </label>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={handleSolveTour}
                disabled={tourLoading || selectedTargetIds.length === 0}
                className="mt-3 w-full py-2.5 rounded bg-[#16a34a] hover:bg-[#22c55e] disabled:opacity-50 text-[#0b0d11] font-mono font-bold text-xs uppercase flex items-center justify-center gap-2 cursor-pointer shadow-lg"
              >
                {tourLoading ? (
                  <>
                    <RotateCcw className="h-4 w-4 animate-spin" />
                    Solving Combinatorial Tour...
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    Solve Optimal Science Tour
                  </>
                )}
              </button>

              {tourError && (
                <div className="mt-2 text-[11px] text-red-400 bg-red-950/60 border border-red-500/40 p-2 rounded">
                  {tourError}
                </div>
              )}
            </div>
          </div>

          {/* Right Column: Tour Results & Schedule Timeline (7 cols) */}
          <div className="md:col-span-7 flex flex-col gap-3 bg-[#161a22] border border-[#242933] rounded p-4">
            <div className="flex items-center justify-between border-b border-[#242933] pb-2">
              <span className="text-xs font-bold text-[#edf0f5] uppercase tracking-wider flex items-center gap-2">
                <Compass className="h-4 w-4 text-[#38bdf8]" />
                Tour Synthesis & Mission Timeline
              </span>
              {tourResult && (
                <span className="rounded bg-emerald-500/20 border border-emerald-500/40 px-2 py-0.5 text-[10px] font-bold text-emerald-300">
                  {tourResult.status || 'OPTIMAL TOUR READY'}
                </span>
              )}
            </div>

            {tourResult ? (
              <div className="flex flex-col gap-3 flex-1 overflow-hidden">
                {/* Metric Summary Cards */}
                <div className="grid grid-cols-3 gap-2">
                  <div className="p-2.5 bg-[#11141a] border border-[#242933] rounded">
                    <div className="text-[10px] text-[#9da5b4] uppercase">Total Traverse</div>
                    <div className="text-sm font-bold text-[#38bdf8] font-mono">
                      {tourResult.summary?.total_distance_km ?? tourResult.total_distance_km} km
                    </div>
                  </div>
                  <div className="p-2.5 bg-[#11141a] border border-[#242933] rounded">
                    <div className="text-[10px] text-[#9da5b4] uppercase">Mission Duration</div>
                    <div className="text-sm font-bold text-amber-300 font-mono">
                      {tourResult.summary?.total_mission_duration_formatted ?? `${tourResult.total_duration_min} min`}
                    </div>
                  </div>
                  <div className="p-2.5 bg-[#11141a] border border-[#242933] rounded">
                    <div className="text-[10px] text-[#9da5b4] uppercase">Safe Walkback</div>
                    <div className="text-sm font-bold text-emerald-400 font-mono">
                      +{tourResult.summary?.min_walkback_battery_margin_pct ?? 100}% MARGIN
                    </div>
                  </div>
                </div>

                {/* Sub-breakdown: Travel vs Science */}
                <div className="flex items-center justify-between px-3 py-1.5 bg-[#191d24] border border-[#242933] rounded text-[11px]">
                  <span className="text-[#9da5b4]">
                    Transit: <strong className="text-white">{tourResult.summary?.travel_time_hours ?? '?'} hrs</strong>
                  </span>
                  <span className="text-[#656d7d]">•</span>
                  <span className="text-[#9da5b4]">
                    Science Dwell: <strong className="text-cyan-300">{tourResult.summary?.science_dwell_hours ?? '?'} hrs</strong>
                  </span>
                  <span className="text-[#656d7d]">•</span>
                  <span className="text-[#9da5b4]">
                    Hazards Avoided: <strong className="text-emerald-300">{tourResult.summary?.total_red_nodes_avoided ?? 0}</strong>
                  </span>
                </div>

                {/* Stops Timeline Schedule */}
                <div className="text-[11px] font-bold text-[#9da5b4] uppercase tracking-wider flex items-center justify-between">
                  <span>Target Sequence & Waypoint Dwell Schedule</span>
                  <span className="text-[#38bdf8]">{tourResult.ordered_stops?.length || 0} Total Checkpoints</span>
                </div>

                <div className="flex-1 overflow-y-auto aerospace-scroll border border-[#242933] rounded bg-[#11141a] divide-y divide-[#1e242f] max-h-[260px]">
                  {(tourResult.ordered_stops || []).map((stop, idx) => {
                    const isBase = idx === 0 || idx === (tourResult.ordered_stops.length - 1);
                    return (
                      <div key={idx} className="p-2.5 flex items-center justify-between text-xs hover:bg-[#161a22]">
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${
                            isBase ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' : 'bg-[#38bdf8]/20 text-[#38bdf8] border border-[#38bdf8]/40'
                          }`}>
                            {idx}
                          </span>
                          <div className="min-w-0">
                            <div className="font-bold truncate text-[#edf0f5]">
                              {stop.name}
                            </div>
                            <div className="text-[10px] text-[#9da5b4]">
                              {isBase && idx === 0
                                ? 'Mission Departure Point'
                                : isBase
                                  ? 'Final Return / EVA Conclusion'
                                  : `Conduct Regolith Sampling (${dwellMinutes}m dwell)`}
                            </div>
                          </div>
                        </div>

                        <div className="text-right shrink-0 font-mono text-[11px]">
                          <span className="text-[#38bdf8] font-bold">
                            {stop.arrival_lst || `Stop ${idx}`}
                          </span>
                          {stop.battery_arrival_pct != null && (
                            <div className="text-[9.5px] text-[#656d7d]">
                              Bat: {Math.round(stop.battery_arrival_pct)}%
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Apply Tour Action Button */}
                <div className="pt-2 flex items-center gap-3">
                  <button
                    type="button"
                    onClick={handleApply}
                    className="flex-1 py-2.5 rounded bg-[#38bdf8] hover:bg-[#0284c7] text-[#0b0d11] font-mono font-bold text-xs uppercase flex items-center justify-center gap-2 cursor-pointer shadow-lg"
                  >
                    <Play className="h-4 w-4" />
                    Load Tour on Map & Begin Mission
                  </button>
                  <button
                    type="button"
                    onClick={() => setTourResult(null)}
                    className="px-4 py-2.5 rounded bg-[#191d24] hover:bg-[#222731] border border-[#353c4a] text-[#edf0f5] text-xs font-bold uppercase cursor-pointer"
                  >
                    Reset
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 border-2 border-dashed border-[#242933] rounded">
                <Route className="h-10 w-10 text-[#38bdf8]/40 mb-3" />
                <div className="text-sm font-bold text-[#edf0f5] mb-1">
                  No Science Tour Planned
                </div>
                <div className="text-xs text-[#9da5b4] max-w-sm">
                  Select candidate science targets on the left, adjust your EVA duration budget, and click "Solve Optimal Science Tour" to execute the Martian Orienteering solver.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
