"use client";

import {
  ComposedChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  CartesianGrid,
  Legend
} from "recharts";
import { CloudRainWind, TrendingUp } from "lucide-react";
import { TelemetryData } from "../DashboardClient";

interface Props {
  logs: TelemetryData[];
}

export function AtmosphericCorrelationChart({ logs }: Props) {
  // Sort from oldest to newest
  const sorted = [...logs].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  const data = sorted.map((log) => {
    const tempC = log.temperature_c;
    // Calculate actual vapor pressure
    const eSatAir = 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
    const eActAir = eSatAir * (log.humidity_rh / 100);
    
    return {
      recorded_at: log.recorded_at,
      avp: eActAir,
      pressure: log.pressure_hpa,
      lux: log.illuminance_lux,
      isDaytime: log.illuminance_lux > 1000,
    };
  });

  if (data.length === 0) {
    return (
      <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-xl shadow-2xl overflow-hidden p-6">
         <div className="h-52 flex items-center justify-center text-zinc-600 text-sm">
            <TrendingUp className="w-5 h-5 mr-2" /> Waiting for telemetry data…
          </div>
      </div>
    );
  }

  // To draw reference areas for daytime, we can find contiguous chunks where isDaytime is true
  const daytimeAreas: { start: string; end: string }[] = [];
  let currentArea: { start: string; end: string } | null = null;

  for (let i = 0; i < data.length; i++) {
    const d = data[i];
    if (d.isDaytime && !currentArea) {
      currentArea = { start: d.recorded_at, end: d.recorded_at };
    } else if (d.isDaytime && currentArea) {
      currentArea.end = d.recorded_at;
    } else if (!d.isDaytime && currentArea) {
      daytimeAreas.push(currentArea);
      currentArea = null;
    }
  }
  if (currentArea) daytimeAreas.push(currentArea);

  return (
    <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-500/10 rounded-xl border border-indigo-500/20">
            <CloudRainWind className="w-5 h-5 text-indigo-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">Atmospheric Correlation</h3>
            <p className="text-xs text-zinc-500 mt-0.5">Actual Vapor Pressure vs Barometric Pressure</p>
          </div>
        </div>
      </div>

      <div className="px-4 pt-6 pb-2">
        <ResponsiveContainer width="100%" height={260}>
          <ComposedChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            {daytimeAreas.map((area, idx) => (
              <ReferenceArea
                key={idx}
                x1={area.start}
                x2={area.end}
                fill="#fde047"
                fillOpacity={0.05}
                ifOverflow="hidden"
              />
            ))}
            
            <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" vertical={false} />
            
            <XAxis
              dataKey="recorded_at"
              tickFormatter={(v: string) =>
                new Date(v).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })
              }
              tick={{ fill: "#71717a", fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              minTickGap={30}
            />
            
            <YAxis
              yAxisId="left"
              domain={['auto', 'auto']}
              tick={{ fill: "#818cf8", fontSize: 10 }} // Indigo
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => v.toFixed(2)}
              width={50}
            />
            
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={['auto', 'auto']}
              tick={{ fill: "#34d399", fontSize: 10 }} // Emerald
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => Math.round(v).toString()}
              width={50}
            />

            <Tooltip
              contentStyle={{ backgroundColor: "#18181b", borderColor: "#27272a", borderRadius: "1rem", color: "#e4e4e7" }}
              itemStyle={{ fontSize: "12px" }}
              labelStyle={{ fontSize: "12px", color: "#a1a1aa", marginBottom: "4px" }}
              labelFormatter={(label) => new Date(label as string).toLocaleString()}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={(value: any, name: any) => {
                if (name === "avp" && typeof value === "number") return [value.toFixed(3) + " kPa", "Actual Vapor Pressure"];
                if (name === "pressure" && typeof value === "number") return [value.toFixed(1) + " hPa", "Barometric Pressure"];
                return [value, name];
              }}
            />
            
            <Legend wrapperStyle={{ fontSize: '12px', paddingTop: '10px' }} />

            <Line
              yAxisId="left"
              type="monotone"
              dataKey="avp"
              name="avp"
              stroke="#818cf8"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
            
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="pressure"
              name="pressure"
              stroke="#34d399"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      
      {/* Footer Info */}
      <div className="px-6 pb-4 pt-2 text-xs text-zinc-500">
        <p>Shaded yellow regions indicate daytime (Sunlight &gt; 1000 lux). Observe if pressure drops and vapor pressure spikes correlate strongly with sun exposure heating the Stevenson screen.</p>
      </div>
    </div>
  );
}
