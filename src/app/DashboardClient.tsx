"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { 
  Droplets, 
  Thermometer, 
  Sun, 
  Wind, 
  Battery,
  Activity,
  Leaf
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";

export interface TelemetryData {
  id: number;
  device_id: string;
  recorded_at: string;
  illuminance_lux: number;
  temperature_c: number;
  humidity_rh: number;
  pressure_hpa: number;
  soil_moisture_raw: number;
  battery_v: number | null;
  battery_pct: number | null;
  vpd_kpa?: number;
}

function calculateVPD(tempC: number, humidityRH: number): number {
  const eSat = 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const eAct = eSat * (humidityRH / 100);
  return eSat - eAct;
}

export function DashboardClient({ initialLogs }: { initialLogs: TelemetryData[] }) {
  const [logs, setLogs] = useState<TelemetryData[]>(initialLogs);
  const supabase = createClient();

  useEffect(() => {
    const channel = supabase
      .channel('realtime:telemetry')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'telemetry',
        },
        (payload) => {
          const newLog = payload.new as TelemetryData;
          // Calculate VPD for the incoming log if missing
          if (newLog.vpd_kpa === undefined) {
            newLog.vpd_kpa = calculateVPD(newLog.temperature_c, newLog.humidity_rh);
          }
          
          setLogs((currentLogs) => {
            // Check if log already exists to avoid duplicates
            if (currentLogs.some(log => log.id === newLog.id)) {
              return currentLogs;
            }
            const updatedLogs = [newLog, ...currentLogs];
            return updatedLogs.slice(0, 50); // Keep max 50 logs on the UI
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase]);

  const latest = logs.length > 0 ? logs[0] : null;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-emerald-500/30 font-sans">
      {/* Background gradients */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-900/20 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-900/20 blur-[120px]" />
      </div>

      <main className="max-w-6xl mx-auto px-6 py-12 md:py-20">
        
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                <Leaf className="w-6 h-6 text-emerald-400" />
              </div>
              <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white">ViabilityNode</h1>
            </div>
            <p className="text-zinc-400 text-lg">Real-time telemetry dashboard for plant surrogate monitors.</p>
          </div>
          
          {latest && (
            <div className="flex items-center gap-3 px-4 py-2 bg-zinc-900/50 border border-zinc-800 rounded-full backdrop-blur-md">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-sm font-medium text-zinc-300">
                Last updated {formatDistanceToNow(new Date(latest.recorded_at), { addSuffix: true })}
              </span>
            </div>
          )}
        </header>

        {!latest ? (
          <div className="p-12 text-center rounded-3xl border border-zinc-800/50 bg-zinc-900/20 backdrop-blur-sm">
            <Activity className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
            <h2 className="text-xl font-medium text-white mb-2">No data available</h2>
            <p className="text-zinc-400">Waiting for telemetry logs from the surrogate node...</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* Metrics Grid */}
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 md:gap-6">
              
              <MetricCard 
                title="Temperature"
                value={`${latest.temperature_c.toFixed(1)}°C`}
                icon={<Thermometer className="w-5 h-5 text-orange-400" />}
                trend={null}
              />
              
              <MetricCard 
                title="Humidity"
                value={`${latest.humidity_rh.toFixed(1)}%`}
                icon={<Droplets className="w-5 h-5 text-blue-400" />}
                trend={null}
              />
              
              <MetricCard 
                title="VPD"
                value={latest.vpd_kpa ? `${latest.vpd_kpa.toFixed(2)} kPa` : "N/A"}
                icon={<Wind className="w-5 h-5 text-teal-400" />}
                trend={null}
              />
              
              <MetricCard 
                title="Soil Moisture"
                value={latest.soil_moisture_raw.toString()}
                subtitle="Raw ADC Value"
                icon={<Droplets className="w-5 h-5 text-emerald-400" />}
                trend={null}
              />

              <MetricCard 
                title="Illuminance"
                value={`${latest.illuminance_lux} lx`}
                icon={<Sun className="w-5 h-5 text-yellow-400" />}
                trend={null}
              />
              
              <MetricCard 
                title="Battery"
                value={latest.battery_pct != null ? `${latest.battery_pct}%` : "N/A"}
                subtitle={latest.battery_v ? `${latest.battery_v.toFixed(2)}V` : undefined}
                icon={<Battery className="w-5 h-5 text-green-400" />}
                trend={null}
              />

            </div>

            {/* Log Table */}
            <div className="mt-12 rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-xl overflow-hidden shadow-2xl">
              <div className="px-6 py-5 border-b border-zinc-800">
                <h3 className="text-lg font-medium text-white flex items-center gap-2">
                  <Activity className="w-5 h-5 text-zinc-400" />
                  Live Telemetry Logs
                </h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead className="text-xs text-zinc-400 uppercase bg-zinc-900/50 border-b border-zinc-800">
                    <tr>
                      <th className="px-6 py-4 font-medium">Time</th>
                      <th className="px-6 py-4 font-medium">Device</th>
                      <th className="px-6 py-4 font-medium text-right">Temp</th>
                      <th className="px-6 py-4 font-medium text-right">Humidity</th>
                      <th className="px-6 py-4 font-medium text-right">VPD</th>
                      <th className="px-6 py-4 font-medium text-right">Soil</th>
                      <th className="px-6 py-4 font-medium text-right">Light</th>
                      <th className="px-6 py-4 font-medium text-right">Battery</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {logs.map((log) => (
                      <tr key={log.id} className="hover:bg-zinc-800/30 transition-colors">
                        <td className="px-6 py-3 text-zinc-300 whitespace-nowrap">
                          {new Date(log.recorded_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                          <span className="text-zinc-600 text-xs ml-2 hidden md:inline">
                            {new Date(log.recorded_at).toLocaleDateString()}
                          </span>
                        </td>
                        <td className="px-6 py-3 text-zinc-500 font-mono text-xs">{log.device_id.split('-')[0] || log.device_id}</td>
                        <td className="px-6 py-3 text-right text-zinc-200">{log.temperature_c.toFixed(1)}°</td>
                        <td className="px-6 py-3 text-right text-zinc-200">{log.humidity_rh.toFixed(1)}%</td>
                        <td className="px-6 py-3 text-right text-teal-400/80">{log.vpd_kpa ? log.vpd_kpa.toFixed(2) : '-'}</td>
                        <td className="px-6 py-3 text-right text-zinc-200">{log.soil_moisture_raw}</td>
                        <td className="px-6 py-3 text-right text-zinc-200">{log.illuminance_lux}</td>
                        <td className="px-6 py-3 text-right text-zinc-400">
                          {log.battery_pct != null ? `${log.battery_pct}%` : '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}

// --- Components ---

function MetricCard({ 
  title, 
  value, 
  subtitle,
  icon, 
  trend 
}: { 
  title: string; 
  value: string | number; 
  subtitle?: string;
  icon: React.ReactNode; 
  trend: "up" | "down" | "stable" | null;
}) {
  return (
    <div className="relative group overflow-hidden p-6 rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-xl hover:bg-zinc-800/60 transition-all duration-300 shadow-lg">
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
      
      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <span className="text-zinc-400 font-medium text-sm tracking-wide">{title}</span>
          <div className="p-2 bg-zinc-800/50 rounded-xl text-zinc-300 group-hover:scale-110 transition-transform duration-300">
            {icon}
          </div>
        </div>
        
        <div className="flex items-baseline gap-2">
          <span className="text-3xl md:text-4xl font-semibold text-white tracking-tight">{value}</span>
        </div>
        
        {subtitle && (
          <p className="mt-2 text-xs text-zinc-500 font-medium uppercase tracking-wider">{subtitle}</p>
        )}
      </div>
    </div>
  );
}
