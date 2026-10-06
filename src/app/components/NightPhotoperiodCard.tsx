"use client";

import { useState } from "react";
import {
  Moon,
  MoonStar,
  ShieldCheck,
  AlertTriangle,
  Clock,
  Sparkles,
  Info,
  ChevronDown,
  ChevronUp,
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

export function NightPhotoperiodCard({ photoperiod }: { photoperiod: PhotoperiodAnalysisResult }) {
  const [showDetails, setShowDetails] = useState(false);
  const { config, yesterday, today, darkStatus, darkHeadline, darkDetail, avgDailyDarkHours, avgDailyZeroLuxHours, avgNightInterruptions, history } = photoperiod;

  // Primary display day: use completed yesterday baseline if available; otherwise today's running hours
  const primaryDay = yesterday || today;
  const headlineHours = primaryDay ? primaryDay.zeroLuxHours : 0;
  const isYesterday = !!yesterday;

  // Status visual themes
  const statusStyles = {
    optimal: {
      badge: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
      icon: ShieldCheck,
      iconColor: "text-emerald-400",
      accentGlow: "from-emerald-500/10 via-indigo-500/5 to-transparent",
    },
    interrupted: {
      badge: "bg-amber-500/10 text-amber-400 border-amber-500/20",
      icon: AlertTriangle,
      iconColor: "text-amber-400",
      accentGlow: "from-amber-500/10 via-indigo-500/5 to-transparent",
    },
    insufficient: {
      badge: "bg-red-500/10 text-red-400 border-red-500/20",
      icon: AlertTriangle,
      iconColor: "text-red-400",
      accentGlow: "from-red-500/10 via-purple-500/5 to-transparent",
    },
    monitoring: {
      badge: "bg-zinc-800/80 text-zinc-400 border-zinc-700/50",
      icon: Moon,
      iconColor: "text-indigo-400",
      accentGlow: "from-indigo-500/5 to-transparent",
    },
  }[darkStatus];

  const StatusIcon = statusStyles.icon;

  // Prepare chart data for last 7 days
  const chartData = history.slice(-7).map((d) => ({
    day: d.day,
    zeroLux: d.zeroLuxHours,
    bioDark: d.biologicalDarkHours,
    interruptions: d.nightInterruptions,
  }));

  // Diurnal proportion for the primary day
  const totalHours = primaryDay?.totalTrackedHours || 24;
  const zeroLuxPct = primaryDay ? Math.min(100, Math.round((primaryDay.zeroLuxHours / totalHours) * 100)) : 0;
  const twilightPct = primaryDay ? Math.min(100 - zeroLuxPct, Math.round((primaryDay.twilightHours / totalHours) * 100)) : 0;
  const daylightPct = Math.max(0, 100 - zeroLuxPct - twilightPct);

  return (
    <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-xl shadow-2xl overflow-hidden relative flex flex-col justify-between transition-all duration-300 hover:border-zinc-700/80">
      {/* Ambient background glow */}
      <div className={`absolute inset-0 bg-gradient-to-br ${statusStyles.accentGlow} pointer-events-none`} />

      <div>
        {/* Card Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800 relative z-10">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-indigo-500/10 rounded-2xl border border-indigo-500/20 text-indigo-400 shadow-inner">
              <MoonStar className="w-5 h-5 text-indigo-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-semibold text-white tracking-tight">Dark Period & 0-Lux Time</h3>
                <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
                  {config.strictDarkNeeded ? "Strict CAM" : "Circadian"}
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-0.5">
                Biological darkness & night continuity · {config.label}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span
              className={`text-xs font-medium px-3 py-1 rounded-full border flex items-center gap-1.5 ${statusStyles.badge}`}
            >
              <StatusIcon className={`w-3.5 h-3.5 ${statusStyles.iconColor}`} />
              <span className="capitalize">{darkStatus}</span>
            </span>
          </div>
        </div>

        {/* Hero Metric Section */}
        <div className="p-6 relative z-10 border-b border-zinc-800/60">
          <div className="flex flex-col sm:flex-row sm:items-baseline justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium">
                {isYesterday ? "Yesterday's 0-Lux Duration (Full 24h)" : "Today's 0-Lux Progress"}
              </p>
              <div className="flex items-baseline gap-3 mt-1.5">
                <span className="text-4xl md:text-5xl font-extrabold text-white tracking-tight tabular-nums">
                  {headlineHours.toFixed(1)}
                </span>
                <span className="text-lg font-medium text-indigo-300">hours</span>
                <span className="text-xs px-2.5 py-1 rounded-lg bg-zinc-800/80 text-zinc-400 border border-zinc-700/50">
                  Target: ≥ {config.targetDarkHours}h
                </span>
              </div>
              <p className="text-xs text-zinc-400 mt-2 font-medium flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-zinc-500" />
                {darkHeadline}
              </p>
            </div>

            {/* Quick Stats Grid */}
            <div className="grid grid-cols-2 gap-3 shrink-0 sm:text-right">
              <div className="p-3 rounded-2xl bg-zinc-800/40 border border-zinc-800">
                <p className="text-[11px] text-zinc-500 uppercase tracking-wider">7-Day Avg Dark</p>
                <p className="text-base font-bold text-white tabular-nums mt-0.5">
                  {avgDailyZeroLuxHours > 0 ? `${avgDailyZeroLuxHours.toFixed(1)} hrs` : "—"}
                </p>
                <p className="text-[10px] text-zinc-500 tabular-nums">Bio: {avgDailyDarkHours.toFixed(1)}h</p>
              </div>
              <div className="p-3 rounded-2xl bg-zinc-800/40 border border-zinc-800">
                <p className="text-[11px] text-zinc-500 uppercase tracking-wider">Night Leaks (ALAN)</p>
                <p
                  className={`text-base font-bold tabular-nums mt-0.5 ${
                    avgNightInterruptions > 0 ? "text-amber-400" : "text-emerald-400"
                  }`}
                >
                  {avgNightInterruptions > 0 ? `${avgNightInterruptions} leaks` : "0 (Clear)"}
                </p>
              </div>
            </div>
          </div>

          {/* 24-Hour Diurnal Photoperiod Proportion Bar */}
          <div className="mt-5 pt-4 border-t border-zinc-800/60">
            <div className="flex items-center justify-between text-xs text-zinc-400 mb-2">
              <span className="font-medium text-zinc-300">24-Hour Diurnal Cycle Breakdown</span>
              <span className="text-zinc-500 text-[11px]">
                {primaryDay?.totalTrackedHours.toFixed(1) || 24}h tracked
              </span>
            </div>
            <div className="h-3 w-full rounded-full bg-zinc-800/80 overflow-hidden flex p-0.5 border border-zinc-700/50 gap-0.5">
              <div
                className="h-full rounded-full bg-indigo-500 transition-all duration-500"
                style={{ width: `${zeroLuxPct}%` }}
                title={`0-Lux Darkness: ${primaryDay?.zeroLuxHours || 0}h (${zeroLuxPct}%)`}
              />
              <div
                className="h-full rounded-full bg-purple-400/60 transition-all duration-500"
                style={{ width: `${twilightPct}%` }}
                title={`Dim Twilight: ${primaryDay?.twilightHours || 0}h (${twilightPct}%)`}
              />
              <div
                className="h-full rounded-full bg-amber-400/80 transition-all duration-500"
                style={{ width: `${daylightPct}%` }}
                title={`Daylight: ${(totalHours - (primaryDay?.biologicalDarkHours || 0) - (primaryDay?.twilightHours || 0)).toFixed(1)}h (${daylightPct}%)`}
              />
            </div>
            <div className="flex items-center justify-between text-[11px] text-zinc-500 mt-2">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block" />
                0-Lux Dark ({primaryDay?.zeroLuxHours || 0}h)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-purple-400/60 inline-block" />
                Twilight ({primaryDay?.twilightHours || 0}h)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400/80 inline-block" />
                Daylight ({Math.max(0, totalHours - (primaryDay?.zeroLuxHours || 0) - (primaryDay?.twilightHours || 0)).toFixed(1)}h)
              </span>
            </div>
          </div>
        </div>

        {/* 7-Night Trend Chart */}
        <div className="px-6 py-4 relative z-10">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-zinc-400">7-Day Night Duration Trend</span>
            <span className="text-[11px] text-zinc-500">Threshold: ≤ {config.darkThresholdLux} lx</span>
          </div>
          {chartData.length < 2 ? (
            <div className="h-28 flex items-center justify-center text-xs text-zinc-500 rounded-2xl bg-zinc-800/20 border border-dashed border-zinc-800">
              <Sparkles className="w-4 h-4 mr-1.5 text-zinc-600" /> Accumulating consecutive night data...
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
                          <p className="text-white font-semibold">0-Lux Time: {d.zeroLux} hrs</p>
                          <p className="text-indigo-400">Bio Dark: {d.bioDark} hrs</p>
                          {d.interruptions > 0 && (
                            <p className="text-amber-400 mt-1 font-medium">⚠ {d.interruptions} ALAN leaks detected</p>
                          )}
                        </div>
                      );
                    }}
                  />
                  <ReferenceLine
                    y={config.targetDarkHours}
                    stroke="#818cf8"
                    strokeDasharray="3 3"
                    label={{
                      value: `Target ${config.targetDarkHours}h`,
                      fill: "#818cf8",
                      fontSize: 9,
                      position: "right",
                    }}
                  />
                  <Bar dataKey="zeroLux" radius={[4, 4, 0, 0]}>
                    {chartData.map((entry) => (
                      <Cell
                        key={entry.day}
                        fill={entry.zeroLux >= config.targetDarkHours ? "#6366f1" : entry.zeroLux >= config.targetDarkHours * 0.7 ? "#818cf8" : "#f43f5e"}
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

      {/* Biological Guidance Footer / Accordion */}
      <div className="border-t border-zinc-800 bg-zinc-950/40 p-4 relative z-10">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full flex items-center justify-between text-xs text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          <span className="flex items-center gap-1.5 font-medium">
            <Info className="w-3.5 h-3.5 text-indigo-400" />
            Biological Physiology ({config.label})
          </span>
          {showDetails ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
        </button>

        {showDetails && (
          <div className="mt-3 text-xs text-zinc-400 space-y-2 border-t border-zinc-800/60 pt-3 animate-in fade-in duration-200">
            <p className="leading-relaxed">{darkDetail}</p>
            <p className="text-zinc-500 leading-relaxed italic">{config.biologyDescription}</p>
          </div>
        )}
      </div>
    </div>
  );
}
