"use client";

import {
  Waves,
  Droplets,
  TrendingDown,
  TrendingUp,
  AlertTriangle,
  Clock,
  ArrowRight,
  Gauge,
  Wind,
} from "lucide-react";
import {
  analyzePiecewiseDrainage,
  type PiecewiseDrainageResult,
  PHASE_1_BOUNDARY,
  PHASE_3_BOUNDARY,
} from "@/lib/piecewiseDrainage";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

// ── Public types ──────────────────────────────────────────────────────────────

import {
  type DrainageInput,
  type DrainCategory,
  type DrainageResult,
  analyzeDrainage
} from "@/lib/drainageAnalysis";

// ── Chart data helper (unchanged — 7-day thinned data for Recharts) ───────────

/**
 * Prepares and thins soil moisture telemetry data for the Recharts component.
 * It enforces a strict 7-day visual window to ensure the graph aligns with the 
 * 'Observed Range (7d)' UI metrics, regardless of the underlying analysis window.
 * 
 * @param data - The raw drainage input data
 * @param plantType - The type of plant (unused for visual windowing, but kept for signature compatibility)
 */
function getRecentRawData(data: DrainageInput[], plantType?: string | null) {
  const sorted = [...data].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());

  // Limit to last 7 days for the visual chart, regardless of plant type
  const WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
  const latestTime = sorted.length > 0 ? new Date(sorted[sorted.length - 1].recorded_at).getTime() : Date.now();
  const recentData = sorted.filter(d => latestTime - new Date(d.recorded_at).getTime() <= WINDOW_MS);

  // Thin out data slightly if there are too many points to keep Recharts performant
  if (recentData.length > 200) {
    const thinFactor = Math.ceil(recentData.length / 200);
    const thinned = recentData.filter((_, i) => i % thinFactor === 0);
    
    // Ensure the absolute latest data point is always included so the graph reaches "Now"
    if (thinned[thinned.length - 1] !== recentData[recentData.length - 1]) {
      thinned.push(recentData[recentData.length - 1]);
    }

    return thinned.map(d => ({
      time: new Date(d.recorded_at).getTime(),
      moisture: d.moisture_pct,
      raw: d.raw
    }));
  }

  return recentData.map(d => ({
    time: new Date(d.recorded_at).getTime(),
    moisture: d.moisture_pct,
    raw: d.raw
  }));
}

const RETENTION_DROP  = 10;   // Absolute % drop from peak to measure retention to

// ── Moisture Range Bar sub-component ──────────────────────────────────────────

function MoistureRangeBar({
  min,
  max,
  current,
  color,
}: {
  min: number;
  max: number;
  current: number;
  color: string;
}) {
  const range = max - min;
  // Position current reading as % within the observed range
  const position = range > 0 ? Math.max(0, Math.min(100, ((current - min) / range) * 100)) : 50;

  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-[10px] uppercase tracking-wider text-zinc-500">
        <span>Observed Range (7d)</span>
        <span>{min.toFixed(0)}% – {max.toFixed(0)}%</span>
      </div>
      <div className="relative h-3 bg-zinc-800 rounded-full overflow-hidden">
        {/* Gradient fill from min to max */}
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: "100%",
            background: `linear-gradient(to right, #ef4444 0%, #22c55e 40%, #22c55e 60%, #3b82f6 100%)`,
            opacity: 0.25,
          }}
        />
        {/* Current position indicator */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full border-2 border-white shadow-lg shadow-black/50 transition-all duration-700"
          style={{
            left: `calc(${position}% - 6px)`,
            backgroundColor: color,
          }}
        />
      </div>
      <div className="flex justify-between text-[10px] text-zinc-600">
        <span>Dry</span>
        <span className="font-medium" style={{ color }}>
          Now: {current.toFixed(1)}%
        </span>
        <span>Wet</span>
      </div>
    </div>
  );
}

// ── Phase Indicator Bar ───────────────────────────────────────────────────────

const PHASE_CONFIG = {
  1: {
    label: "Phase 1 — Gravitational Drainage",
    shortLabel: "Gravity",
    color: "#3b82f6",
    bg: "bg-blue-950/20",
    border: "border-blue-500/30",
    text: "text-blue-400",
    description: "Macropore drainage. Vital for oxygenation.",
  },
  2: {
    label: "Phase 2 — Field Capacity",
    shortLabel: "Field Cap.",
    color: "#14b8a6",
    bg: "bg-teal-950/20",
    border: "border-teal-500/30",
    text: "text-teal-400",
    description: "Matric potential. Soil stabilising.",
  },
  3: {
    label: "Phase 3 — Capillary / ET",
    shortLabel: "Capillary",
    color: "#f59e0b",
    bg: "bg-amber-950/20",
    border: "border-amber-500/30",
    text: "text-amber-400",
    description: "VPD & root uptake only.",
  },
} as const;

function PhaseIndicatorBar({
  currentPhase,
  currentMoisture,
}: {
  currentPhase: 1 | 2 | 3 | null;
  currentMoisture: number | null;
}) {
  if (currentPhase === null || currentMoisture === null) return null;

  const cfg = PHASE_CONFIG[currentPhase];
  // Position the indicator on a 0–100 scale (inverted: 100% moisture = left, 0% = right)
  const position = Math.max(0, Math.min(100, 100 - currentMoisture));

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${currentPhase === 1 ? "animate-pulse" : ""}`} style={{ backgroundColor: cfg.color }} />
          <span className={`text-xs font-medium ${cfg.text}`}>{cfg.label}</span>
        </div>
        <span className="text-[10px] text-zinc-500">{cfg.description}</span>
      </div>

      {/* Phase bar */}
      <div className="relative h-2.5 bg-zinc-800 rounded-full overflow-hidden">
        {/* Phase 1: >70% (left portion) */}
        <div
          className="absolute inset-y-0 left-0 rounded-l-full"
          style={{ width: "30%", backgroundColor: PHASE_CONFIG[1].color + "30" }}
        />
        {/* Phase 2: 30–70% (middle) */}
        <div
          className="absolute inset-y-0"
          style={{ left: "30%", width: "40%", backgroundColor: PHASE_CONFIG[2].color + "20" }}
        />
        {/* Phase 3: <30% (right portion) */}
        <div
          className="absolute inset-y-0 right-0 rounded-r-full"
          style={{ width: "30%", backgroundColor: PHASE_CONFIG[3].color + "20" }}
        />
        {/* Current position dot */}
        <div
          className="absolute top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full border-2 border-white shadow-lg transition-all duration-700"
          style={{ left: `calc(${position}% - 5px)`, backgroundColor: cfg.color }}
        />
      </div>

      {/* Phase labels */}
      <div className="flex justify-between text-[9px] text-zinc-600">
        <span>{'>'}{PHASE_1_BOUNDARY}%</span>
        <span>{PHASE_3_BOUNDARY}–{PHASE_1_BOUNDARY}%</span>
        <span>{'<'}{PHASE_3_BOUNDARY}%</span>
      </div>
    </div>
  );
}

// ── Piecewise Velocity Metrics ────────────────────────────────────────────────

function PiecewiseVelocities({
  piecewise,
}: {
  piecewise: PiecewiseDrainageResult;
}) {
  const hasData = piecewise.vGrav !== null || piecewise.vDry !== null;
  if (!hasData && piecewise.wateringEvents === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-3">
      {/* V_grav — Gravitational Clearance Rate */}
      <div className={`rounded-xl border bg-zinc-800/20 px-3 py-2.5 ${
        piecewise.phase1Failure || piecewise.phase2Failure ? "border-red-500/40" : "border-zinc-800/60"
      }`}>
        <div className="flex items-center gap-1.5 mb-1">
          <Gauge className="w-3 h-3 text-blue-400" />
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">V<sub>grav</sub></span>
        </div>
        <p className={`text-sm font-semibold ${
          piecewise.vGrav === null ? "text-zinc-500" :
          piecewise.vGrav > 3 ? "text-emerald-400" :
          piecewise.vGrav > 0.5 ? "text-blue-400" : "text-red-400"
        }`}>
          {piecewise.vGrav !== null ? `${piecewise.vGrav.toFixed(2)} %/hr` : "—"}
        </p>
        <p className="text-[10px] text-zinc-600 mt-0.5">
          {piecewise.vGrav === null
            ? piecewise.wateringEvents > 0 ? "Peak didn't reach Phase 1" : "No event"
            : piecewise.phase1DurationHours !== null
            ? `Phase 1 cleared in ${piecewise.phase1DurationHours.toFixed(1)}h`
            : "Measuring..."}
        </p>
        {piecewise.phase1Failure && (
          <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5" />
            Macropore failure
          </p>
        )}
        {piecewise.phase2Failure && !piecewise.phase1Failure && (
          <p className="text-[10px] text-red-400 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5" />
            Waterlogged (Phase 2 &gt;96h)
          </p>
        )}
      </div>

      {/* V_dry — Transpiration / Drying Rate */}
      <div className={`rounded-xl border bg-zinc-800/20 px-3 py-2.5 ${
        piecewise.alan_interference || piecewise.phase3Warning ? "border-amber-500/40" : "border-zinc-800/60"
      }`}>
        <div className="flex items-center gap-1.5 mb-1">
          <Wind className="w-3 h-3 text-amber-400" />
          <span className="text-[10px] uppercase tracking-wider text-zinc-500">V<sub>dry</sub></span>
        </div>
        <p className={`text-sm font-semibold ${
          piecewise.vDry === null ? "text-zinc-500" :
          piecewise.vDry > 0.5 ? "text-amber-400" :
          piecewise.vDry > 0.1 ? "text-zinc-300" : "text-zinc-500"
        }`}>
          {piecewise.vDry !== null ? `${piecewise.vDry.toFixed(2)} %/hr` : "—"}
        </p>
        <p className="text-[10px] text-zinc-600 mt-0.5">
          {piecewise.vDry === null
            ? "Hasn't reached Phase 3 yet"
            : piecewise.phase3DurationHours !== null
            ? `In Phase 3 for ${piecewise.phase3DurationHours.toFixed(1)}h`
            : "Measuring..."}
        </p>
        {piecewise.phase3Warning && (
          <p className="text-[10px] text-amber-500 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5" />
            High demand (rapid loss)
          </p>
        )}
        {piecewise.alan_interference && (
          <p className="text-[10px] text-amber-500 mt-1 flex items-center gap-1">
            <AlertTriangle className="w-2.5 h-2.5" />
            ALAN interference
          </p>
        )}
      </div>
    </div>
  );
}

// ── Main Card Component ───────────────────────────────────────────────────────

export function DrainageCard({ data, plantType, precalculatedResult, precalculatedPiecewise }: { data: DrainageInput[], plantType?: string | null, precalculatedResult?: DrainageResult, precalculatedPiecewise?: PiecewiseDrainageResult }) {
  const result = precalculatedResult || analyzeDrainage(data, plantType);
  const piecewise = precalculatedPiecewise || analyzePiecewiseDrainage(data);
  const chartData = getRecentRawData(data, plantType);

  // Format retention time as human-readable
  const retentionDisplay = (() => {
    if (result.retentionHours === null) return null;
    if (result.retentionHours < 1) return `${Math.round(result.retentionHours * 60)}m`;
    if (result.retentionHours < 24) return `${result.retentionHours.toFixed(1)}h`;
    const days = Math.floor(result.retentionHours / 24);
    const hrs = Math.round(result.retentionHours % 24);
    return `${days}d ${hrs}h`;
  })();

  return (
    <div
      className={`rounded-3xl border backdrop-blur-xl shadow-2xl overflow-hidden
        ${result.category === "fast-draining"  ? "border-emerald-500/25" :
          result.category === "optimal-dry"    ? "border-emerald-500/25" :
          result.category === "well-draining"  ? "border-blue-500/25" :
          result.category === "slow-draining"  ? "border-amber-500/25" :
          result.category === "waterlogged"    ? "border-red-500/25" :
          result.label === "Absorbing"         ? "border-blue-500/25" :
          result.category === "evaluating"     ? "border-violet-500/25" :
                                                  "border-zinc-800/80"}
        bg-zinc-900/40`}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div
            className="p-2 rounded-xl border"
            style={{ backgroundColor: result.color + "18", borderColor: result.color + "40" }}
          >
            <Waves className="w-5 h-5" style={{ color: result.color }} />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Soil Water Dynamics</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Observed retention analysis</p>
          </div>
        </div>
        <span
          className="text-xs font-medium px-3 py-1.5 rounded-full border"
          style={{ color: result.color, borderColor: result.color + "60", backgroundColor: result.color + "18" }}
        >
          {result.label}
        </span>
      </div>

      {/* Body */}
      <div className="px-6 py-5 space-y-4">

        {/* Hero: Retention Time */}
        {result.category !== "insufficient" && result.category !== "no-event" && (
          <div className="flex items-end gap-4">
            <div>
              <div className="flex items-center gap-1.5 mb-1">
                <Clock className="w-3 h-3 text-zinc-500" />
                <p className="text-xs text-zinc-500">Water Retention</p>
              </div>
              <div className="flex items-baseline gap-2">
                {result.category === "optimal-dry" ? (
                  <>
                    <span className="text-2xl font-semibold" style={{ color: result.color }}>
                      Safely dry
                    </span>
                    <span className="text-sm text-zinc-400">
                      capillary phase stabilized
                    </span>
                  </>
                ) : retentionDisplay !== null ? (
                  <>
                    <span className="text-4xl font-bold text-white">
                      {retentionDisplay}
                    </span>
                    <span className="text-sm text-zinc-400">to lose {RETENTION_DROP}%</span>
                  </>
                ) : (
                  <>
                    <span className="text-2xl font-semibold" style={{ color: result.color }}>
                      {result.label === "Absorbing" ? "Just watered" : "Still holding"}
                    </span>
                    {result.label === "Absorbing" ? (
                      <span className="text-sm text-zinc-400">
                        evaluating drainage...
                      </span>
                    ) : (
                      <span className="text-sm text-zinc-400">
                        above {((result.peakMoisture ?? 0) - RETENTION_DROP).toFixed(0)}%
                      </span>
                    )}
                  </>
                )}
              </div>
                {result.peakMoisture !== null && (
                  <p className="text-xs text-zinc-500 mt-1">
                    Peak: {result.peakMoisture.toFixed(1)}%
                    {result.peakDroppedTo !== null && (
                      <> → {result.peakDroppedTo.toFixed(1)}%</>
                    )}
                    {result.daysToLowest !== null && (
                      <span className="block mt-0.5 text-zinc-400">Reached lowest in {result.daysToLowest}d</span>
                    )}
                  </p>
                )}
            </div>
          </div>
        )}

        {/* Stats Row: 24h Change + Watering Events */}
        {result.category !== "insufficient" && (
          <div className="grid grid-cols-2 gap-3">
            {/* 24h Actual Change */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-800/20 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                {result.netChange24h !== null && result.netChange24h >= 0 ? (
                  <TrendingUp className="w-3 h-3 text-blue-400" />
                ) : (
                  <TrendingDown className="w-3 h-3 text-amber-400" />
                )}
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">24h Change</span>
              </div>
              <p className={`text-sm font-semibold ${
                result.netChange24h === null ? "text-zinc-500" :
                result.netChange24h >= 0 ? "text-blue-400" : "text-amber-400"
              }`}>
                {result.netChange24h !== null
                  ? `${result.netChange24h > 0 ? "+" : ""}${result.netChange24h.toFixed(1)}%`
                  : "—"}
              </p>
            </div>

            {/* Watering Events */}
            <div className="rounded-xl border border-zinc-800/60 bg-zinc-800/20 px-3 py-2.5">
              <div className="flex items-center gap-1.5 mb-1">
                <Droplets className="w-3 h-3 text-cyan-400" />
                <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                  Waterings ({plantType === 'succulent' || plantType === 'cactus' ? '30d' : '7d'})
                </span>
              </div>
              <p className="text-sm font-semibold text-cyan-400">
                {result.wateringEvents}
                <span className="text-zinc-500 font-normal"> detected</span>
              </p>
            </div>
          </div>
        )}

        {/* Piecewise Drainage: Phase indicator + Velocities */}
        {result.category !== "insufficient" && (
          <>
            <PhaseIndicatorBar
              currentPhase={piecewise.currentPhase}
              currentMoisture={result.currentMoisture}
            />
            <PiecewiseVelocities piecewise={piecewise} />
          </>
        )}

        {/* Moisture Range Bar */}
        {result.category !== "insufficient" && result.currentMoisture !== null && (
          <MoistureRangeBar
            min={result.moistureMin}
            max={result.moistureMax}
            current={result.currentMoisture}
            color={result.color}
          />
        )}

        {/* Last watering info */}
        {result.lastWateringAt && (
          <div className="flex items-center gap-2 text-xs text-zinc-500">
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: result.color }} />
            Last watering:{" "}
            <span className="text-zinc-300">
              {new Date(result.lastWateringAt).toLocaleString(undefined, {
                month: "short", day: "numeric",
                hour: "2-digit", minute: "2-digit",
              })}
            </span>
            {result.peakMoisture !== null && result.peakDroppedTo !== null && (
              <span className="text-zinc-500 flex items-center gap-1">
                <ArrowRight className="w-3 h-3" />
                {result.peakMoisture.toFixed(0)}% → {result.peakDroppedTo.toFixed(0)}%
              </span>
            )}
          </div>
        )}

        {/* 7-Day Moisture Chart */}
        {chartData.length > 1 && (
          <div className="pt-2 pb-1 h-28">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                <defs>
                  <linearGradient id="colorMoisture" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={result.color} stopOpacity={0.3}/>
                    <stop offset="95%" stopColor={result.color} stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="time"
                  tickFormatter={(v) => new Date(v).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  tick={{ fill: "#71717a", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={30}
                />
                <YAxis
                  domain={['auto', 'auto']}
                  tick={{ fill: "#71717a", fontSize: 10 }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => v.toFixed(0)}
                />
                {/* Retention threshold line (if we have a peak) */}
                {result.peakMoisture !== null && (
                  <ReferenceLine
                    y={result.peakMoisture - RETENTION_DROP}
                    stroke={result.color}
                    strokeDasharray="4 4"
                    strokeOpacity={0.4}
                  />
                )}
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="rounded-xl border border-zinc-700 bg-zinc-900/95 px-3 py-2 text-xs shadow-xl">
                          <p className="text-zinc-400 mb-1">
                            {new Date(payload[0].payload.time).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </p>
                          <p className="font-semibold text-white" style={{ color: result.color }}>
                            Moisture: {Number(payload[0].value).toFixed(1)}%
                          </p>
                          <p className="text-xs text-zinc-500 mt-1">
                            Raw ADC: {payload[0].payload.raw}
                          </p>
                        </div>
                      )
                    }
                    return null;
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="moisture"
                  stroke={result.color}
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorMoisture)"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Description */}
        <p className="text-sm text-zinc-400 leading-relaxed">{result.description}</p>

        {/* Plant hint */}
        {result.plantHint && result.category !== "insufficient" && (
          <div
            className="flex items-start gap-2.5 px-4 py-3 rounded-2xl border text-sm"
            style={{
              borderColor: result.color + "40",
              backgroundColor: result.color + "10",
            }}
          >
            {result.category === "waterlogged" ? (
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" style={{ color: result.color }} />
            ) : (
              <span className="text-base">🌿</span>
            )}
            <p style={{ color: result.color + "dd" }}>{result.plantHint}</p>
          </div>
        )}
      </div>
    </div>
  );
}
