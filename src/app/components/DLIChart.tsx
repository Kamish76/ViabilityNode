"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
  ReferenceLine,
} from "recharts";
import { Sun, TrendingUp } from "lucide-react";

export interface DLIDataPoint {
  day: string;          // ISO date string e.g. "2026-08-31"
  dli_mol_per_m2: number;
  reading_count: number;
}

function classifyDLI(dli: number): { label: string; color: string; textColor: string } {
  if (dli < 5)  return { label: "Low · Shade Plants",      color: "#1d4ed8", textColor: "text-blue-400" };
  if (dli < 15) return { label: "Moderate · Houseplants",  color: "#10b981", textColor: "text-emerald-400" };
  return             { label: "High · Succulents / Cacti", color: "#f59e0b", textColor: "text-amber-400" };
}

function barColor(dli: number): string {
  if (dli < 5)  return "#3b82f6";   // blue
  if (dli < 15) return "#10b981";   // emerald
  return "#f59e0b";                  // amber
}

interface TooltipPayload {
  value: number;
  payload: DLIDataPoint;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const cls = classifyDLI(d.dli_mol_per_m2);
  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900/95 backdrop-blur px-4 py-3 shadow-xl text-sm">
      <p className="text-zinc-400 text-xs mb-1">
        {new Date(d.day + "T12:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" })}
      </p>
      <p className="text-white font-semibold">{d.dli_mol_per_m2.toFixed(2)} mol/m²</p>
      <p className={`text-xs mt-0.5 ${cls.textColor}`}>{cls.label}</p>
      <p className="text-zinc-600 text-xs mt-1">{d.reading_count} readings</p>
    </div>
  );
}

export function DLIChart({ data }: { data: DLIDataPoint[] }) {
  // Show last 30 days, ascending
  const sorted = [...data]
    .sort((a, b) => a.day.localeCompare(b.day))
    .slice(-30);

  const latest = sorted[sorted.length - 1];
  const avgDLI = sorted.length
    ? sorted.reduce((s, d) => s + d.dli_mol_per_m2, 0) / sorted.length
    : 0;
  const cls = latest ? classifyDLI(latest.dli_mol_per_m2) : null;

  return (
    <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-amber-500/10 rounded-xl border border-amber-500/20">
            <Sun className="w-5 h-5 text-amber-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Daily Light Integral</h3>
            <p className="text-xs text-zinc-500 mt-0.5">30-day cumulative photon exposure · mol/m²/day</p>
          </div>
        </div>
        {cls && (
          <span className={`text-xs font-medium px-3 py-1.5 rounded-full border ${cls.textColor} border-current bg-current/10`}>
            {cls.label}
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 divide-x divide-zinc-800 border-b border-zinc-800">
        {[
          { label: "Today", value: latest ? `${latest.dli_mol_per_m2.toFixed(2)}` : "—", unit: "mol/m²" },
          { label: "30-Day Avg", value: avgDLI.toFixed(2), unit: "mol/m²" },
          { label: "Days Tracked", value: sorted.length.toString(), unit: "days" },
        ].map(({ label, value, unit }) => (
          <div key={label} className="px-5 py-4">
            <p className="text-xs text-zinc-500 mb-1">{label}</p>
            <p className="text-xl font-semibold text-white">{value} <span className="text-sm text-zinc-400 font-normal">{unit}</span></p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="px-4 pt-4 pb-2">
        {sorted.length === 0 ? (
          <div className="h-48 flex items-center justify-center text-zinc-600 text-sm">
            <TrendingUp className="w-5 h-5 mr-2" /> Accumulating light data…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={sorted} margin={{ top: 4, right: 4, left: -20, bottom: 0 }} barCategoryGap="25%">
              <XAxis
                dataKey="day"
                tickFormatter={(v: string) =>
                  new Date(v + "T12:00:00Z").toLocaleDateString(undefined, { month: "numeric", day: "numeric" })
                }
                tick={{ fill: "#71717a", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval={Math.floor(sorted.length / 6)}
              />
              <YAxis
                tick={{ fill: "#71717a", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => `${v}`}
              />
              <Tooltip content={<CustomTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
              {/* Zone reference lines */}
              <ReferenceLine y={5}  stroke="#3b82f680" strokeDasharray="4 3" label={{ value: "5", fill: "#3b82f6", fontSize: 9, position: "right" }} />
              <ReferenceLine y={15} stroke="#f59e0b80" strokeDasharray="4 3" label={{ value: "15", fill: "#f59e0b", fontSize: 9, position: "right" }} />
              <Bar dataKey="dli_mol_per_m2" radius={[4, 4, 0, 0]}>
                {sorted.map((entry) => (
                  <Cell key={entry.day} fill={barColor(entry.dli_mol_per_m2)} opacity={0.85} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Legend */}
      <div className="px-6 pb-5 flex items-center gap-5 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-blue-500 inline-block" /> &lt;5 Shade</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> 5–15 Moderate</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> &gt;15 High</span>
      </div>
    </div>
  );
}
