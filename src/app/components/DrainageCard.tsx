"use client";

import { Waves, TrendingDown, AlertTriangle } from "lucide-react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface DrainageInput {
  recorded_at: string;
  moisture_pct: number;
  raw: number;
}

interface DrainageResult {
  category: "rapid" | "moderate" | "stagnant" | "insufficient";
  label: string;
  velocity: number | null;      // %/hour, negative means draining
  saturationEvent: string | null; // ISO timestamp of the last detected saturation
  peakMoisture: number | null;    // Peak moisture % reached during saturation
  description: string;
  plantHint: string;
  color: string;
  textColor: string;
  bgColor: string;
}

function getRecentRawData(data: DrainageInput[]) {
  const sorted = [...data].sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime());
  
  // limit to last 5 days
  const FIVE_DAYS = 5 * 24 * 60 * 60 * 1000;
  const latestTime = sorted.length > 0 ? new Date(sorted[sorted.length - 1].recorded_at).getTime() : Date.now();
  const recentData = sorted.filter(d => latestTime - new Date(d.recorded_at).getTime() <= FIVE_DAYS);

  // Thin out data slightly if there are too many points to keep Recharts performant
  if (recentData.length > 200) {
    const thinFactor = Math.ceil(recentData.length / 200);
    return recentData.filter((_, i) => i % thinFactor === 0).map(d => ({
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

const SPIKE_THRESHOLD = 10; // % jump required between 2-hour blocks to trigger saturation

export function analyzeDrainage(data: DrainageInput[]): DrainageResult {
  if (data.length < 6) {
    return {
      category: "insufficient",
      label: "Insufficient Data",
      velocity: null,
      saturationEvent: null,
      peakMoisture: null,
      description: "Need at least 6 calibrated soil moisture readings to detect a saturation event.",
      plantHint: "Continue collecting data.",
      color: "#71717a",
      textColor: "text-zinc-400",
      bgColor: "bg-zinc-800/40",
    };
  }

  // Sort ascending
  const sorted = [...data].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  // 1. Lightweight median filter (window size 3) to strip isolated sensor anomalies
  // without flattening actual sharp spikes.
  const medians = sorted.map((d, i) => {
    const window = sorted.slice(Math.max(0, i - 1), Math.min(sorted.length, i + 2));
    const vals = window.map(w => w.moisture_pct).sort((a, b) => a - b);
    const median = vals[Math.floor(vals.length / 2)];
    return { ...d, moisture_pct: median };
  });

  // 2. Spike Detection (2-hour block comparison)
  // We compare the average moisture of the current 2-hour block against the average of the previous 2-hour block.
  let wateringIdx = -1;

  for (let i = medians.length - 1; i >= 0; i--) {
    const current = medians[i];
    const t = new Date(current.recorded_at).getTime();
    
    // Current 2-hour block (t - 2h to t)
    const currentBlockPoints = medians.filter(m => {
      const mt = new Date(m.recorded_at).getTime();
      return mt >= t - 2 * 60 * 60 * 1000 && mt <= t;
    });

    // Previous 2-hour block (t - 4h to t - 2h)
    const baselineBlockPoints = medians.filter(m => {
      const mt = new Date(m.recorded_at).getTime();
      return mt >= t - 4 * 60 * 60 * 1000 && mt < t - 2 * 60 * 60 * 1000;
    });
    
    if (currentBlockPoints.length > 0 && baselineBlockPoints.length > 0) {
      const currentAvg = currentBlockPoints.reduce((sum, p) => sum + p.moisture_pct, 0) / currentBlockPoints.length;
      const baselineAvg = baselineBlockPoints.reduce((sum, p) => sum + p.moisture_pct, 0) / baselineBlockPoints.length;
      
      if (currentAvg - baselineAvg >= SPIKE_THRESHOLD) {
        wateringIdx = i;
        break;
      }
    }
  }

  // We remove the early return here because we ALWAYS want to calculate today's drying rate
  // even if no recent watering event was detected.

  const latestTime = new Date(medians[medians.length - 1].recorded_at).getTime();
  const midnight = new Date(latestTime);
  midnight.setHours(0, 0, 0, 0);

  // Determine observation window for calculating drying rate
  let windowStart = midnight.getTime();
  let peakTime: number | null = null;
  let peakMoisture: number | null = null;
  let saturationEvent: string | null = null;

  if (wateringIdx !== -1) {
    // 3. Find absolute peak near the detected spike
    let peakIdx = -1;
    let peakMoistureVal = -1;
    const searchStart = new Date(medians[wateringIdx].recorded_at).getTime() - 1 * 60 * 60 * 1000;
    const searchEnd = new Date(medians[wateringIdx].recorded_at).getTime() + 3 * 60 * 60 * 1000;

    for (let i = 0; i < medians.length; i++) {
      const t = new Date(medians[i].recorded_at).getTime();
      if (t >= searchStart && t <= searchEnd) {
        if (medians[i].moisture_pct > peakMoistureVal) {
          peakMoistureVal = medians[i].moisture_pct;
          peakIdx = i;
        }
      }
    }

    if (peakIdx === -1) {
      peakIdx = wateringIdx;
    }

    peakTime = new Date(medians[peakIdx].recorded_at).getTime();
    peakMoisture = medians[peakIdx].moisture_pct;
    saturationEvent = medians[peakIdx].recorded_at;

    // If the watering happened TODAY, start measuring the drying rate from the peak instead of midnight
    if (peakTime > midnight.getTime()) {
      windowStart = peakTime;
    }
  }

  // 4. Collect readings for today's drying rate
  const window = medians.filter((d) => {
    const t = new Date(d.recorded_at).getTime();
    return t >= windowStart && t <= latestTime;
  });

  if (window.length < 2) {
    return {
      category: "insufficient",
      label: "Observing…",
      velocity: null,
      saturationEvent,
      peakMoisture,
      description: "Not enough data collected since midnight to calculate today's drying rate.",
      plantHint: "Check back later today.",
      color: "#71717a",
      textColor: "text-zinc-400",
      bgColor: "bg-zinc-800/40",
    };
  }

  // Least-squares slope over today's window
  const times = window.map((d) =>
    (new Date(d.recorded_at).getTime() - windowStart) / (1000 * 60 * 60)
  );
  const moistures = window.map((d) => d.moisture_pct);
  const n = times.length;
  const sumX   = times.reduce((a, b) => a + b, 0);
  const sumY   = moistures.reduce((a, b) => a + b, 0);
  const sumXY  = times.reduce((s, x, i) => s + x * moistures[i], 0);
  const sumX2  = times.reduce((s, x) => s + x * x, 0);
  
  // Guard against division by zero if all times are the same
  const denominator = (n * sumX2 - sumX * sumX);
  const slope = denominator === 0 ? 0 : (n * sumXY - sumX * sumY) / denominator; // %/hr

  // If slope is positive (gaining moisture but not flagged as a full spike), lock velocity to 0
  const velocity = slope < 0 ? Math.abs(slope) : 0;
  const hoursTracked = Math.round((latestTime - windowStart) / (1000 * 60 * 60));
  const liveStatusText = `Today's rate (${Math.max(1, hoursTracked)}h tracked since ${windowStart === peakTime ? "watering" : "midnight"})`;

  if (velocity > 0.5) { // Rapid (>12% per day)
    return {
      category: "rapid",
      label: "Rapid Drainage",
      velocity,
      saturationEvent,
      peakMoisture,
      description: `Soil is drying at ~${velocity.toFixed(2)}%/hr. (${liveStatusText})`,
      plantHint: "Ideal for: Succulents, cacti, herbs, lavender. Avoid: Bog plants, mosses.",
      color: "#10b981",
      textColor: "text-emerald-400",
      bgColor: "bg-emerald-950/20",
    };
  }

  if (velocity > 0.1) { // Moderate (>2.4% per day)
    return {
      category: "moderate",
      label: "Moderate Drainage",
      velocity,
      saturationEvent,
      peakMoisture,
      description: `Soil is drying at ~${velocity.toFixed(2)}%/hr. (${liveStatusText})`,
      plantHint: "Ideal for: Most common houseplants, tomatoes, pothos, herbs.",
      color: "#f59e0b",
      textColor: "text-amber-400",
      bgColor: "bg-amber-950/20",
    };
  }

  return {
    category: "stagnant",
    label: "Slow / Stagnant",
    velocity,
    saturationEvent,
    peakMoisture,
    description: `Soil is barely drying (~${velocity.toFixed(2)}%/hr). (${liveStatusText})`,
    plantHint: "Ideal for: Mosses, ferns, bog plants. Danger for: Succulents, cacti, most vegetables.",
    color: "#ef4444",
    textColor: "text-red-400",
    bgColor: "bg-red-950/20",
  };
}

export function DrainageCard({ data }: { data: DrainageInput[] }) {
  const result = analyzeDrainage(data);
  const chartData = getRecentRawData(data);

  return (
    <div
      className={`rounded-3xl border backdrop-blur-xl shadow-2xl overflow-hidden
        ${result.category === "rapid"    ? "border-emerald-500/25" :
          result.category === "stagnant" ? "border-red-500/25" :
          result.category === "moderate" ? "border-amber-500/25" :
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
            <h3 className="text-base font-semibold text-white">Soil Drainage Velocity</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Post-saturation slope analysis</p>
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
        {/* Velocity metric */}
        <div className="flex items-end gap-4">
          <div>
            <p className="text-xs text-zinc-500 mb-1">Drainage Rate</p>
            <div className="flex items-baseline gap-2">
              {result.velocity !== null ? (
                <>
                  <span className="text-4xl font-bold text-white">
                    {result.velocity.toFixed(2)}
                  </span>
                  <span className="text-sm text-zinc-400">%/hr</span>
                </>
              ) : (
                <span className="text-2xl font-semibold text-zinc-500">—</span>
              )}
            </div>
            {result.velocity !== null && (
              <p className="text-xs text-zinc-500 mt-1">
                ≈ {(result.velocity * 24).toFixed(1)}% / day
              </p>
            )}
          </div>

          {result.velocity !== null && (
            <div className="flex-1">
              {/* Visual slope indicator */}
              <div className="flex items-center gap-2 text-xs text-zinc-500 mb-2">
                <TrendingDown className="w-3.5 h-3.5" style={{ color: result.color }} />
                <span style={{ color: result.color }}>
                  {result.category === "rapid" ? "Fast" :
                   result.category === "moderate" ? "Moderate" :
                   result.category === "stagnant" ? "Very slow" : ""}
                </span>
              </div>
              {/* Speed bar */}
              <div className="h-2 bg-zinc-800 rounded-full overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${Math.min(100, (result.velocity / 2) * 100)}%`,
                    backgroundColor: result.color,
                  }}
                />
              </div>
              <div className="flex justify-between text-xs text-zinc-600 mt-1">
                <span>Stagnant</span>
                <span>Rapid</span>
              </div>
            </div>
          )}
        </div>
        {/* Raw Moisture Chart */}
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

        {/* Saturation event info */}
        {result.saturationEvent && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center gap-2 text-xs text-zinc-500">
              <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: result.color }} />
              Last saturation event:{" "}
              <span className="text-zinc-300">
                {new Date(result.saturationEvent).toLocaleString(undefined, {
                  month: "short", day: "numeric",
                  hour: "2-digit", minute: "2-digit",
                })}
              </span>
            </div>
            {result.peakMoisture !== null && (
              <div className="flex items-center gap-2 text-xs text-zinc-500 ml-3.5">
                Peak moisture hit:{" "}
                <span className="text-zinc-300 font-medium">
                  {result.peakMoisture.toFixed(1)}%
                </span>
              </div>
            )}
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
            {result.category === "stagnant" ? (
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
