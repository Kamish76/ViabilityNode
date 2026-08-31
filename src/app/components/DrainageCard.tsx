"use client";

import { Waves, TrendingDown, AlertTriangle } from "lucide-react";

export interface DrainageInput {
  recorded_at: string;
  moisture_pct: number;
}

interface DrainageResult {
  category: "rapid" | "moderate" | "stagnant" | "insufficient";
  label: string;
  velocity: number | null;      // %/hour, negative means draining
  saturationEvent: string | null; // ISO timestamp of the last detected saturation
  description: string;
  plantHint: string;
  color: string;
  textColor: string;
  bgColor: string;
}

const SATURATION_THRESHOLD = 70;   // % — consider "wet event" start
const OBSERVATION_WINDOW_H  = 48;  // hours to track slope after saturation

function analyzeDrainage(data: DrainageInput[]): DrainageResult {
  if (data.length < 6) {
    return {
      category: "insufficient",
      label: "Insufficient Data",
      velocity: null,
      saturationEvent: null,
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

  // Find the last saturation peak: find highest moisture reading above threshold
  let peakIdx = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].moisture_pct >= SATURATION_THRESHOLD) {
      peakIdx = i;
      break;
    }
  }

  if (peakIdx === -1) {
    return {
      category: "insufficient",
      label: "No Saturation Event",
      velocity: null,
      saturationEvent: null,
      description: `Soil has not crossed the ${SATURATION_THRESHOLD}% saturation threshold. Water the plant or wait for rain to observe drainage.`,
      plantHint: "Cannot classify soil drainage yet.",
      color: "#71717a",
      textColor: "text-zinc-400",
      bgColor: "bg-zinc-800/40",
    };
  }

  const peakTime   = new Date(sorted[peakIdx].recorded_at).getTime();
  const windowEnd  = peakTime + OBSERVATION_WINDOW_H * 60 * 60 * 1000;
  const peakMoisture = sorted[peakIdx].moisture_pct;

  // Collect readings within the window after the peak
  const window = sorted.slice(peakIdx).filter(
    (d) => new Date(d.recorded_at).getTime() <= windowEnd
  );

  if (window.length < 2) {
    return {
      category: "insufficient",
      label: "Observing…",
      velocity: null,
      saturationEvent: sorted[peakIdx].recorded_at,
      description: `Saturation event detected at ${peakMoisture.toFixed(0)}%. Waiting for enough post-saturation readings (${OBSERVATION_WINDOW_H}h window).`,
      plantHint: "Check back soon.",
      color: "#14b8a6",
      textColor: "text-teal-400",
      bgColor: "bg-teal-950/20",
    };
  }

  // Least-squares slope in %/hour over the window
  const times = window.map((d) =>
    (new Date(d.recorded_at).getTime() - peakTime) / (1000 * 60 * 60)
  );
  const moistures = window.map((d) => d.moisture_pct);
  const n = times.length;
  const sumX   = times.reduce((a, b) => a + b, 0);
  const sumY   = moistures.reduce((a, b) => a + b, 0);
  const sumXY  = times.reduce((s, x, i) => s + x * moistures[i], 0);
  const sumX2  = times.reduce((s, x) => s + x * x, 0);
  const slope  = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX); // %/hr

  // Positive slope = gaining moisture (still wet); negative = draining
  // velocity = |slope| for display, sign conveyed by category
  const velocity = Math.abs(slope);

  // Classify: slope < -0.5 %/hr = rapid, -0.5 to -0.1 = moderate, > -0.1 = stagnant
  if (slope < -0.5) {
    return {
      category: "rapid",
      label: "Rapid Drainage",
      velocity,
      saturationEvent: sorted[peakIdx].recorded_at,
      description: `Soil sheds water at ~${velocity.toFixed(2)}%/hr. Well-aerated root zone — oxygen returns quickly after watering.`,
      plantHint: "Ideal for: Succulents, cacti, herbs, lavender. Avoid: Bog plants, mosses.",
      color: "#10b981",
      textColor: "text-emerald-400",
      bgColor: "bg-emerald-950/20",
    };
  }

  if (slope < -0.1) {
    return {
      category: "moderate",
      label: "Moderate Drainage",
      velocity,
      saturationEvent: sorted[peakIdx].recorded_at,
      description: `Soil drains at ~${velocity.toFixed(2)}%/hr. Balanced moisture retention.`,
      plantHint: "Ideal for: Most common houseplants, tomatoes, pothos, herbs.",
      color: "#f59e0b",
      textColor: "text-amber-400",
      bgColor: "bg-amber-950/20",
    };
  }

  return {
    category: "stagnant",
    label: "Stagnant / Hypoxic",
    velocity,
    saturationEvent: sorted[peakIdx].recorded_at,
    description: `Soil barely drains (~${velocity.toFixed(2)}%/hr). Root zone oxygen depletion risk is high.`,
    plantHint: "Ideal for: Mosses, ferns, bog plants. Danger for: Succulents, cacti, most vegetables.",
    color: "#ef4444",
    textColor: "text-red-400",
    bgColor: "bg-red-950/20",
  };
}

export function DrainageCard({ data }: { data: DrainageInput[] }) {
  const result = analyzeDrainage(data);

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

        {/* Saturation event timestamp */}
        {result.saturationEvent && (
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
