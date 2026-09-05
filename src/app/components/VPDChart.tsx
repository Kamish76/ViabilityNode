"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from "recharts";
import { Wind, TrendingUp } from "lucide-react";

export interface VPDDataPoint {
  recorded_at: string;
  vpd_kpa: number;
}

// VPD zones (kPa)
const ZONES = {
  fungalRisk:  { max: 0.4,  color: "#8b5cf6", label: "Fungal Risk" },
  optimal:     { min: 0.4, max: 1.6, color: "#10b981", label: "Optimal" },
  droughtRisk: { min: 1.6,  color: "#ef4444", label: "Drought Risk" },
};

function classifyVPD(vpd: number): { label: string; color: string; textColor: string } {
  if (vpd < 0.4)  return { label: "Low · Fungal Risk",    color: "#8b5cf6", textColor: "text-purple-400" };
  if (vpd <= 1.6) return { label: "Optimal Transpiration", color: "#10b981", textColor: "text-emerald-400" };
  return               { label: "High · Drought Risk",    color: "#ef4444", textColor: "text-red-400" };
}

interface TooltipPayload {
  value: number;
  payload: VPDDataPoint;
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: TooltipPayload[] }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const cls = classifyVPD(d.vpd_kpa);
  return (
    <div className="rounded-2xl border border-zinc-700 bg-zinc-900/95 backdrop-blur px-4 py-3 shadow-xl text-sm">
      <p className="text-zinc-400 text-xs mb-1">
        {new Date(d.recorded_at).toLocaleString(undefined, {
          month: "short", day: "numeric",
          hour: "2-digit", minute: "2-digit",
        })}
      </p>
      <p className="text-white font-semibold">{d.vpd_kpa.toFixed(3)} kPa</p>
      <p className={`text-xs mt-0.5 ${cls.textColor}`}>{cls.label}</p>
    </div>
  );
}

export function VPDChart({ data, rollingAvg }: { data: VPDDataPoint[]; rollingAvg: number | null }) {
  const sorted = [...data].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  const cls = rollingAvg !== null ? classifyVPD(rollingAvg) : null;

  // Determine Y axis max
  const maxVPD = Math.max(...sorted.map((d) => d.vpd_kpa), 2);
  const yMax = Math.ceil(maxVPD * 10) / 10 + 0.2;

  return (
    <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-teal-500/10 rounded-xl border border-teal-500/20">
            <Wind className="w-5 h-5 text-teal-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Vapor Pressure Deficit</h3>
            <p className="text-xs text-zinc-500 mt-0.5">7-day rolling · leaf-surface drying power (daytime offset applied)</p>
          </div>
        </div>
        {cls && (
          <span
            className="text-xs font-medium px-3 py-1.5 rounded-full border"
            style={{ color: cls.color, borderColor: cls.color + "60", backgroundColor: cls.color + "18" }}
          >
            {cls.label}
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 divide-x divide-zinc-800 border-b border-zinc-800">
        {[
          {
            label: "7-Day Avg",
            value: rollingAvg !== null ? `${rollingAvg.toFixed(3)}` : "—",
            unit: "kPa",
          },
          {
            label: "Readings",
            value: sorted.length.toString(),
            unit: "pts",
          },
          {
            label: "Latest",
            value: sorted.length ? sorted[sorted.length - 1].vpd_kpa.toFixed(3) : "—",
            unit: "kPa",
          },
        ].map(({ label, value, unit }) => (
          <div key={label} className="px-5 py-4">
            <p className="text-xs text-zinc-500 mb-1">{label}</p>
            <p className="text-xl font-semibold text-white">
              {value} <span className="text-sm text-zinc-400 font-normal">{unit}</span>
            </p>
          </div>
        ))}
      </div>

      {/* Chart */}
      <div className="px-4 pt-4 pb-2">
        {sorted.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-zinc-600 text-sm">
            <TrendingUp className="w-5 h-5 mr-2" /> Accumulating VPD data…
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={sorted} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              {/* Danger zone fills */}
              <ReferenceArea y2={ZONES.fungalRisk.max}  fill="#8b5cf620" fillOpacity={1} ifOverflow="hidden" />
              <ReferenceArea y1={ZONES.droughtRisk.min} fill="#ef444420" fillOpacity={1} ifOverflow="hidden" />

              {/* Zone boundary lines */}
              <ReferenceLine
                y={0.4}
                stroke="#8b5cf660"
                strokeDasharray="5 3"
                label={{ value: "0.4", fill: "#8b5cf6", fontSize: 9, position: "right" }}
              />
              <ReferenceLine
                y={1.6}
                stroke="#ef444460"
                strokeDasharray="5 3"
                label={{ value: "1.6", fill: "#ef4444", fontSize: 9, position: "right" }}
              />

              {/* Rolling avg line */}
              {rollingAvg !== null && (
                <ReferenceLine
                  y={rollingAvg}
                  stroke="#14b8a6"
                  strokeDasharray="6 3"
                  strokeWidth={1.5}
                  label={{ value: `avg ${rollingAvg.toFixed(2)}`, fill: "#14b8a6", fontSize: 9, position: "insideTopLeft" }}
                />
              )}

              <XAxis
                dataKey="recorded_at"
                tickFormatter={(v: string) =>
                  new Date(v).toLocaleDateString(undefined, { month: "numeric", day: "numeric" })
                }
                tick={{ fill: "#71717a", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                interval={Math.floor(sorted.length / 6)}
              />
              <YAxis
                domain={[0, yMax]}
                tick={{ fill: "#71717a", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v: number) => v.toFixed(1)}
              />
              <Tooltip content={<CustomTooltip />} />
              <Line
                type="monotone"
                dataKey="vpd_kpa"
                stroke="#2dd4bf"
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, fill: "#2dd4bf", stroke: "#0f172a", strokeWidth: 2 }}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Zone legend */}
      <div className="px-6 pb-5 flex items-center gap-5 text-xs text-zinc-500">
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-purple-500 inline-block" /> &lt;0.4 Fungal risk
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> 0.4–1.6 Optimal
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> &gt;1.6 Drought
        </span>
      </div>
    </div>
  );
}
