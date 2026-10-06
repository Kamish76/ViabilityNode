"use client";

import { useState } from "react";
import {
  Sun,
  CheckCircle2,
  AlertTriangle,
  Flame,
  Info,
  Clock,
  ChevronDown,
  ChevronUp,
  MapPin,
  Sparkles,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from "recharts";
import type { PhotoperiodAnalysisResult } from "@/lib/photoperiodAnalysis";

export function UsableLightCard({
  photoperiod,
  placementType,
}: {
  photoperiod: PhotoperiodAnalysisResult;
  placementType?: string | null;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const {
    config,
    placementNote,
    yesterday,
    today,
    usableStatus,
    usableHeadline,
    usableDetail,
    avgDailyUsableHours,
    history,
  } = photoperiod;

  // Primary display day: yesterday baseline (complete 24h) or today running progress
  const primaryDay = yesterday || today;
  const usableHours = primaryDay ? primaryDay.usableLightHours : 0;
  const isYesterday = !!yesterday;
  const pctOfTarget = primaryDay ? primaryDay.usablePctOfTarget : 0;

  // Status styling
  const statusStyles = {
    optimal: {
      badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      icon: CheckCircle2,
      iconColor: "text-emerald-400",
      accentGlow: "from-emerald-500/10 via-amber-500/5 to-transparent",
      barColor: "#10b981",
    },
    adequate: {
      badge: "bg-teal-500/10 text-teal-300 border-teal-500/20",
      icon: CheckCircle2,
      iconColor: "text-teal-400",
      accentGlow: "from-teal-500/10 via-amber-500/5 to-transparent",
      barColor: "#14b8a6",
    },
    "sub-optimal": {
      badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      icon: AlertTriangle,
      iconColor: "text-amber-400",
      accentGlow: "from-amber-500/10 via-orange-500/5 to-transparent",
      barColor: "#f59e0b",
    },
    "scorch-risk": {
      badge: "bg-rose-500/10 text-rose-400 border-rose-500/20",
      icon: Flame,
      iconColor: "text-rose-400",
      accentGlow: "from-rose-500/10 via-red-500/5 to-transparent",
      barColor: "#f43f5e",
    },
    monitoring: {
      badge: "bg-zinc-800/80 text-zinc-400 border-zinc-700/50",
      icon: Sun,
      iconColor: "text-amber-400",
      accentGlow: "from-amber-500/5 to-transparent",
      barColor: "#71717a",
    },
  }[usableStatus];

  const StatusIcon = statusStyles.icon;

  // Last 7 days history
  const chartData = history.slice(-7).map((d) => ({
    day: d.day,
    usableHours: d.usableLightHours,
    peakLux: d.peakLux,
    pctOfTarget: d.usablePctOfTarget,
  }));

  // Light spectrum tier proportions
  const totalTracked = primaryDay?.totalTrackedHours || 24;
  const subCompensationHours = Math.max(
    0,
    totalTracked - (primaryDay?.usableLightHours || 0)
  );
  const optimalHours = primaryDay?.optimalLightHours || 0;
  const intenseHours = primaryDay?.intenseLightHours || 0;

  const subPct = Math.round((subCompensationHours / totalTracked) * 100);
  const optPct = Math.round((optimalHours / totalTracked) * 100);
  const intPct = Math.min(100 - subPct - optPct, Math.round((intenseHours / totalTracked) * 100));

  return (
    <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-xl shadow-2xl overflow-hidden relative flex flex-col justify-between transition-all duration-300 hover:border-zinc-700/80">
      {/* Ambient background glow */}
      <div className={`absolute inset-0 bg-gradient-to-br ${statusStyles.accentGlow} pointer-events-none`} />

      <div>
        {/* Card Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800 relative z-10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-amber-500/10 rounded-2xl border border-amber-500/20 text-amber-400 shadow-inner">
              <Sun className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white tracking-tight">Plant Usable Light</h3>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  {config.icon} {config.label}{placementType ? ` · ${placementType}` : ""}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Effective photosynthetically active hours · ≥ {config.usableThresholdLux.toLocaleString()} lx LCP
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium px-3 py-1 rounded-full border flex items-center gap-1.5 ${statusStyles.badge}`}
            >
              <StatusIcon className={`w-3.5 h-3.5 ${statusStyles.iconColor}`} />
              <span className="capitalize">{usableStatus.replace("-", " ")}</span>
            </span>
          </div>
        </div>

        {/* Hero Metric Section */}
        <div className="p-6 relative z-10 border-b border-zinc-800/60">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium">
                {isYesterday ? "Yesterday's Usable Light (Full 24h)" : "Today's Usable Light Progress"}
              </p>
              <div className="flex items-baseline gap-3 mt-1.5">
                <span className="text-4xl md:text-5xl font-extrabold text-white tracking-tight tabular-nums">
                  {usableHours.toFixed(1)}
                </span>
                <span className="text-lg font-medium text-amber-300">hours</span>
                <span
                  className={`text-xs px-2.5 py-1 rounded-lg border font-semibold tabular-nums ${
                    pctOfTarget >= 100
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
                      : pctOfTarget >= 70
                      ? "bg-amber-500/15 text-amber-400 border-amber-500/30"
                      : "bg-red-500/15 text-red-400 border-red-500/30"
                  }`}
                >
                  {pctOfTarget}% of {config.targetUsableHours}h target
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-2 font-medium flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-zinc-500" />
                {usableHeadline}
              </p>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 gap-3 shrink-0 sm:text-right">
              <div className="p-3 rounded-2xl bg-zinc-800/40 border border-zinc-800">
                <p className="text-[11px] text-zinc-500 uppercase tracking-wider">7-Day Avg Usable</p>
                <p className="text-base font-bold text-white tabular-nums mt-0.5">
                  {avgDailyUsableHours > 0 ? `${avgDailyUsableHours.toFixed(1)} hrs/d` : "—"}
                </p>
              </div>
              <div className="p-3 rounded-2xl bg-zinc-800/40 border border-zinc-800">
                <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Peak Illuminance</p>
                <p className="text-base font-bold text-amber-400 tabular-nums mt-0.5">
                  {primaryDay?.peakLux ? `${primaryDay.peakLux.toLocaleString()} lx` : "—"}
                </p>
              </div>
            </div>
          </div>

          {/* Usable Light Progress Bar vs Target */}
          <div className="mt-5 pt-4 border-t border-zinc-800/60">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
              <span className="font-medium text-zinc-300">
                Daily Photoperiod Target Progress ({config.targetUsableHours}h recommended)
              </span>
              <span className="text-zinc-400 font-semibold tabular-nums">{pctOfTarget}%</span>
            </div>
            <div className="h-3 w-full rounded-full bg-zinc-800/80 overflow-hidden p-0.5 border border-zinc-700/50">
              <div
                className="h-full rounded-full transition-all duration-700"
                style={{
                  width: `${Math.min(100, pctOfTarget)}%`,
                  backgroundColor: statusStyles.barColor,
                }}
              />
            </div>
          </div>

          {/* Light Intensity Spectrum Breakdown */}
          <div className="mt-4 pt-3 border-t border-zinc-800/40">
            <div className="flex items-center justify-between text-[11px] text-zinc-400 mb-1.5">
              <span className="text-zinc-500 uppercase tracking-wider">Intensity Spectrum Tiers</span>
              <span className="text-zinc-500">Compensation Cutoff: {config.usableThresholdLux.toLocaleString()} lx</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              <div className="p-2.5 rounded-xl bg-zinc-800/30 border border-zinc-800/80">
                <p className="text-[10px] text-zinc-500">Sub-Usable (&lt; {config.usableThresholdLux} lx)</p>
                <p className="text-xs font-semibold text-zinc-400 mt-0.5">
                  {subCompensationHours.toFixed(1)}h <span className="text-[10px] text-zinc-600">({subPct}%)</span>
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-amber-500/10 border border-amber-500/20">
                <p className="text-[10px] text-amber-400">Optimal ({config.usableThresholdLux}–{config.saturationLux.toLocaleString()} lx)</p>
                <p className="text-xs font-semibold text-amber-300 mt-0.5">
                  {optimalHours.toFixed(1)}h <span className="text-[10px] text-amber-400/60">({optPct}%)</span>
                </p>
              </div>
              <div className="p-2.5 rounded-xl bg-orange-500/10 border border-orange-500/20">
                <p className="text-[10px] text-orange-400">Peak Sun (&gt; {config.saturationLux.toLocaleString()} lx)</p>
                <p className="text-xs font-semibold text-orange-300 mt-0.5">
                  {intenseHours.toFixed(1)}h <span className="text-[10px] text-orange-400/60">({intPct}%)</span>
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* 7-Day Usable Light Trend Chart */}
        <div className="px-6 py-4 relative z-10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-400">7-Day Usable Light Trend</span>
            <span className="text-[11px] text-zinc-500">Threshold: ≥ {config.usableThresholdLux} lx</span>
          </div>
          {chartData.length < 2 ? (
            <div className="h-28 flex items-center justify-center text-xs text-zinc-500 rounded-2xl bg-zinc-800/20 border border-dashed border-zinc-800">
              <Sparkles className="w-4 h-4 mr-1.5 text-zinc-600" /> Accumulating daylight history...
            </div>
          ) : (
            <div className="h-32 -ml-3">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }} barCategoryGap="28%">
                  <XAxis
                    dataKey="day"
                    tickFormatter={(v: string) =>
                      new Date(v + "T12:00:00Z").toLocaleDateString(undefined, { month: "numeric", day: "numeric" })
                    }
                    tick={{ fill: "#71717a", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fill: "#71717a", fontSize: 10 }}
                    axisLine={false}
                    tickLine={false}
                    domain={[0, "dataMax + 2"]}
                    tickFormatter={(v: number) => `${v}h`}
                  />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="rounded-xl border border-zinc-700 bg-zinc-900/95 backdrop-blur px-3 py-2 shadow-xl text-xs">
                          <p className="text-zinc-400 mb-0.5">
                            {new Date(d.day + "T12:00:00Z").toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                            })}
                          </p>
                          <p className="text-white font-semibold">Usable Light: {d.usableHours} hrs</p>
                          <p className="text-amber-400">Peak Lux: {d.peakLux.toLocaleString()} lx</p>
                          <p className="text-emerald-400 mt-1 font-medium">{d.pctOfTarget}% of target photoperiod</p>
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine
                    y={config.targetUsableHours}
                    stroke="#f59e0b"
                    strokeDasharray="3 3"
                    label={{
                      value: `Target ${config.targetUsableHours}h`,
                      fill: "#f59e0b",
                      fontSize: 9,
                      position: "right",
                    }}
                  />
                  <Bar dataKey="usableHours" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell
                        key={entry.day}
                        fill={
                          entry.usableHours >= config.targetUsableHours
                            ? "#10b981"
                            : entry.usableHours >= config.targetUsableHours * 0.7
                            ? "#f59e0b"
                            : "#f43f5e"
                        }
                        opacity={0.85}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Biological Guidance & Location Intelligence Footer */}
      <div className="border-t border-zinc-800 bg-zinc-950/40 p-4 relative z-10">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full flex items-center justify-between text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <Info className="w-3.5 h-3.5 text-amber-400" />
            Photosynthetic Profile & Placement ({config.label})
          </span>
          {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showDetails && (
          <div className="mt-3 text-xs text-zinc-400 space-y-2.5 border-t border-zinc-800/60 pt-3 animate-in fade-in duration-200">
            <p className="leading-relaxed">{usableDetail}</p>

            {placementNote && (
              <div className="flex items-start gap-2 p-2.5 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-300">
                <MapPin className="w-4 h-4 shrink-0 text-blue-400 mt-0.5" />
                <p className="text-[11px] leading-relaxed">{placementNote}</p>
              </div>
            )}

            <p className="text-zinc-500 leading-relaxed italic">{config.biologyDescription}</p>
          </div>
        )}
      </div>
    </div>
  );
}
