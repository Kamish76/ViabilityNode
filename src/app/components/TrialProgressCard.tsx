"use client";

import { useMemo } from "react";
import {
  CalendarDays,
  Battery,
  Signal,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Trophy,
} from "lucide-react";
import type { Deployment } from "./DeploymentPanel";
import type { DLIDataPoint } from "./DLIChart";
import type { VPDDataPoint } from "./VPDChart";

// ─── Types ────────────────────────────────────────────────────────────────────

interface TrialProgressCardProps {
  deployment: Deployment | null;
  daysRemaining: number | null;           // battery days remaining estimate
  currentBatteryPct: number | null;
  dliHistory: DLIDataPoint[];
  vpdHistory30: VPDDataPoint[];
  moistureHistory: { recorded_at: string; moisture_pct: number }[];
  trialDurationDays?: number;             // default 30
}

type DayHealth = "optimal" | "warning" | "critical" | "no_data";

// ─── Constants ────────────────────────────────────────────────────────────────

const MILESTONES = [
  { day: 1, label: "Baseline" },
  { day: 7, label: "Week 1" },
  { day: 14, label: "Week 2" },
  { day: 21, label: "Week 3" },
  { day: 30, label: "Complete" },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getDaysBetween(start: Date, end: Date): number {
  const ms = end.getTime() - start.getTime();
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function getDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function classifyDay(
  vpdValues: number[],
  moistureValues: number[],
  dli: number | null,
): DayHealth {
  if (vpdValues.length === 0 && moistureValues.length === 0) return "no_data";

  let issues = 0;

  // VPD check: avg should be 0.4–1.6 kPa
  if (vpdValues.length > 0) {
    const avgVpd = vpdValues.reduce((s, v) => s + v, 0) / vpdValues.length;
    if (avgVpd > 1.6 || avgVpd < 0.4) issues++;
  }

  // Moisture check: should be 10–80% for a pot succulent
  if (moistureValues.length > 0) {
    const avgMoisture = moistureValues.reduce((s, v) => s + v, 0) / moistureValues.length;
    if (avgMoisture < 10 || avgMoisture > 85) issues += 2;
    else if (avgMoisture < 15 || avgMoisture > 75) issues++;
  }

  // DLI check: succulents want > 15 mol/m²/day, but > 5 is acceptable
  if (dli !== null) {
    if (dli < 3) issues += 2;
    else if (dli < 5) issues++;
  }

  if (issues >= 3) return "critical";
  if (issues >= 1) return "warning";
  return "optimal";
}

const HEALTH_COLORS: Record<DayHealth, string> = {
  optimal: "bg-emerald-500",
  warning: "bg-amber-500",
  critical: "bg-red-500",
  no_data: "bg-zinc-700",
};

const HEALTH_RING_COLORS: Record<DayHealth, string> = {
  optimal: "ring-emerald-500/30",
  warning: "ring-amber-500/30",
  critical: "ring-red-500/30",
  no_data: "ring-zinc-700/30",
};

// ─── Component ────────────────────────────────────────────────────────────────

export function TrialProgressCard({
  deployment,
  daysRemaining,
  currentBatteryPct,
  dliHistory,
  vpdHistory30,
  moistureHistory,
  trialDurationDays = 30,
}: TrialProgressCardProps) {
  const trialData = useMemo(() => {
    if (!deployment) return null;

    const startDate = new Date(deployment.started_at);
    const now = new Date();
    const dayNumber = getDaysBetween(startDate, now) + 1; // 1-indexed
    const progress = Math.min(100, (dayNumber / trialDurationDays) * 100);
    const isComplete = dayNumber >= trialDurationDays;

    // Build per-day maps for VPD, moisture, DLI
    const vpdByDay = new Map<string, number[]>();
    for (const v of vpdHistory30) {
      const key = getDateKey(new Date(v.recorded_at));
      const arr = vpdByDay.get(key) ?? [];
      arr.push(v.vpd_kpa);
      vpdByDay.set(key, arr);
    }

    const moistureByDay = new Map<string, number[]>();
    for (const m of moistureHistory) {
      const key = getDateKey(new Date(m.recorded_at));
      const arr = moistureByDay.get(key) ?? [];
      arr.push(m.moisture_pct);
      moistureByDay.set(key, arr);
    }

    const dliByDay = new Map<string, number>();
    for (const d of dliHistory) {
      dliByDay.set(d.day, d.dli_mol_per_m2);
    }

    // Build daily health grid (up to trialDurationDays or current day)
    const maxDay = Math.min(dayNumber, trialDurationDays);
    const dailyHealth: { day: number; date: string; health: DayHealth }[] = [];
    let totalReadings = 0;

    for (let i = 0; i < maxDay; i++) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + i);
      const key = getDateKey(d);

      const vpd = vpdByDay.get(key) ?? [];
      const moisture = moistureByDay.get(key) ?? [];
      const dli = dliByDay.get(key) ?? null;

      totalReadings += vpd.length + moisture.length;

      dailyHealth.push({
        day: i + 1,
        date: key,
        health: classifyDay(vpd, moisture, dli),
      });
    }

    // Data completeness: assume ~every 15 min = 96 readings/day for core sensors
    const expectedReadings = maxDay * 96;
    const completeness = expectedReadings > 0
      ? Math.min(100, (totalReadings / expectedReadings) * 100)
      : 0;

    // Battery will survive trial?
    const batteryOk = daysRemaining === null
      ? null
      : daysRemaining >= (trialDurationDays - dayNumber);

    // Count health stats
    const healthCounts = { optimal: 0, warning: 0, critical: 0, no_data: 0 };
    for (const d of dailyHealth) healthCounts[d.health]++;

    return {
      startDate,
      dayNumber,
      progress,
      isComplete,
      dailyHealth,
      completeness,
      batteryOk,
      healthCounts,
    };
  }, [deployment, dliHistory, vpdHistory30, moistureHistory, daysRemaining, trialDurationDays]);

  if (!deployment || !trialData) {
    return null;
  }

  const {
    startDate,
    dayNumber,
    progress,
    isComplete,
    dailyHealth,
    completeness,
    batteryOk,
    healthCounts,
  } = trialData;

  return (
    <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-xl overflow-hidden shadow-lg">
      <div className="px-6 py-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-violet-500/10 rounded-xl border border-violet-500/20">
              {isComplete ? (
                <Trophy className="w-5 h-5 text-violet-400" />
              ) : (
                <CalendarDays className="w-5 h-5 text-violet-400" />
              )}
            </div>
            <div>
              <h3 className="text-sm font-semibold text-white">
                {isComplete ? "Trial Complete!" : `Viability Trial`}
              </h3>
              <p className="text-xs text-zinc-500 mt-0.5">
                {trialDurationDays}-day observation period · Started{" "}
                {startDate.toLocaleDateString()}
              </p>
            </div>
          </div>

          <div className="text-right">
            <p className="text-2xl font-bold text-white">
              Day {Math.min(dayNumber, trialDurationDays)}
              <span className="text-zinc-500 text-lg font-normal">
                /{trialDurationDays}
              </span>
            </p>
          </div>
        </div>

        {/* Main progress bar */}
        <div className="relative">
          <div className="h-3 bg-zinc-800 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700 relative overflow-hidden"
              style={{
                width: `${progress}%`,
                background: isComplete
                  ? "linear-gradient(90deg, #8b5cf6, #a78bfa)"
                  : "linear-gradient(90deg, #10b981, #34d399)",
              }}
            >
              <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-[shimmer_2s_infinite] " />
            </div>
          </div>

          {/* Milestone markers */}
          <div className="relative mt-1">
            {MILESTONES.map((m) => {
              const pos = (m.day / trialDurationDays) * 100;
              const passed = dayNumber >= m.day;
              return (
                <div
                  key={m.day}
                  className="absolute -translate-x-1/2 flex flex-col items-center"
                  style={{ left: `${pos}%` }}
                >
                  <div
                    className={`w-1.5 h-1.5 rounded-full mt-1 ${
                      passed ? "bg-emerald-400" : "bg-zinc-700"
                    }`}
                  />
                  <span
                    className={`text-[10px] mt-0.5 whitespace-nowrap ${
                      passed ? "text-zinc-400" : "text-zinc-600"
                    }`}
                  >
                    {m.label}
                  </span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-3 gap-4 mt-8">
          {/* Battery projection */}
          <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-800/60">
            <div className="flex items-center gap-1.5 mb-2">
              <Battery
                className={`w-3.5 h-3.5 ${
                  batteryOk === null
                    ? "text-zinc-500"
                    : batteryOk
                    ? "text-emerald-400"
                    : "text-orange-400"
                }`}
              />
              <span className="text-xs text-zinc-500">Battery</span>
            </div>
            {batteryOk === null ? (
              <p className="text-sm text-zinc-400">Calculating…</p>
            ) : batteryOk ? (
              <p className="text-sm text-emerald-400 font-medium">
                {currentBatteryPct != null && `${currentBatteryPct}% · `}Will survive
              </p>
            ) : (
              <p className="text-sm text-orange-400 font-medium">
                {currentBatteryPct != null && `${currentBatteryPct}% · `}May need charge
              </p>
            )}
          </div>

          {/* Data completeness */}
          <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-800/60">
            <div className="flex items-center gap-1.5 mb-2">
              <Signal className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-xs text-zinc-500">Data</span>
            </div>
            <p
              className={`text-sm font-medium ${
                completeness > 80
                  ? "text-emerald-400"
                  : completeness > 50
                  ? "text-amber-400"
                  : "text-red-400"
              }`}
            >
              {completeness.toFixed(0)}% complete
            </p>
          </div>

          {/* Health summary */}
          <div className="p-3 rounded-xl bg-zinc-800/40 border border-zinc-800/60">
            <div className="flex items-center gap-1.5 mb-2">
              <CheckCircle2 className="w-3.5 h-3.5 text-zinc-500" />
              <span className="text-xs text-zinc-500">Days</span>
            </div>
            <div className="flex items-center gap-2 text-xs">
              {healthCounts.optimal > 0 && (
                <span className="flex items-center gap-0.5 text-emerald-400">
                  <CheckCircle2 className="w-3 h-3" />
                  {healthCounts.optimal}
                </span>
              )}
              {healthCounts.warning > 0 && (
                <span className="flex items-center gap-0.5 text-amber-400">
                  <AlertTriangle className="w-3 h-3" />
                  {healthCounts.warning}
                </span>
              )}
              {healthCounts.critical > 0 && (
                <span className="flex items-center gap-0.5 text-red-400">
                  <XCircle className="w-3 h-3" />
                  {healthCounts.critical}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Daily health grid */}
        <div className="mt-5">
          <p className="text-xs text-zinc-500 mb-2">Daily Health</p>
          <div className="flex flex-wrap gap-1">
            {dailyHealth.map((d) => (
              <div
                key={d.day}
                title={`Day ${d.day} (${d.date}): ${d.health}`}
                className={`w-5 h-5 rounded-md ${HEALTH_COLORS[d.health]} ring-1 ${HEALTH_RING_COLORS[d.health]} transition-all duration-200 hover:scale-125 cursor-default`}
              />
            ))}
            {/* Remaining unfilled days */}
            {Array.from({ length: Math.max(0, trialDurationDays - dailyHealth.length) }).map(
              (_, i) => (
                <div
                  key={`empty-${i}`}
                  className="w-5 h-5 rounded-md bg-zinc-800/50 ring-1 ring-zinc-800/30"
                />
              )
            )}
          </div>
          <div className="flex items-center gap-4 mt-2 text-[10px] text-zinc-600">
            <span className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm bg-emerald-500" /> Optimal
            </span>
            <span className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm bg-amber-500" /> Warning
            </span>
            <span className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm bg-red-500" /> Critical
            </span>
            <span className="flex items-center gap-1">
              <div className="w-2.5 h-2.5 rounded-sm bg-zinc-700" /> No data
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
