"use client";

import { useEffect, useState, useCallback } from "react";
import { formatDistanceToNow } from "date-fns";
import {
  Droplets,
  Thermometer,
  Sun,
  Wind,
  Battery,
  Activity,
  Leaf,
  Settings2,
  X,
  FlaskConical,
  AlertTriangle,
  Clock,
  Copy,
  Check,
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { DLIChart, type DLIDataPoint } from "./components/DLIChart";
import { VPDChart, type VPDDataPoint } from "./components/VPDChart";
import { AtmosphericCorrelationChart } from "./components/AtmosphericCorrelationChart";
import { DrainageCard } from "./components/DrainageCard";
import { MicroclimatProfileCard, type PrecalculatedProfile } from "./components/MicroclimatProfileCard";
import {
  ThreatAlertsPanel,
  evalRotWarning,
  evalDehydrationWarning,
  evalGrowthOptimization
} from "./components/ThreatAlertsPanel";
import { analyzePiecewiseDrainage } from "@/lib/piecewiseDrainage";
import { DeploymentPanel, type Deployment } from "./components/DeploymentPanel";
import { TrialProgressCard } from "./components/TrialProgressCard";
import { SideNav } from "./components/SideNav";
import { SummaryDashboard, type DailySummaryData } from "./components/SummaryDashboard";
import { calculateMoisturePct } from "@/lib/sensorUtils";
import { analyzeDrainage, type DrainageInput, type DrainageResult } from "@/lib/drainageAnalysis";

// ─── Types ────────────────────────────────────────────────────────────────────

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

export interface BatterySnapshot {
  recorded_at: string;
  battery_pct: number;
}




// ─── Calculations ─────────────────────────────────────────────────────────────

function calculateVPD(tempC: number, humidityRH: number, lux: number = 0): number {
  // During daytime (lux > 1000), transpiring leaves cool themselves. 
  // We use a -2°C offset to calculate true Leaf VPD, preventing artificial daytime spikes.
  const isDaytime = lux > 1000;
  const leafTempOffsetC = isDaytime ? -2 : 0;
  const leafTempC = tempC + leafTempOffsetC;

  // Saturation vapor pressure at the leaf surface (using leaf temperature)
  const eSatLeaf = 0.61078 * Math.exp((17.27 * leafTempC) / (leafTempC + 237.3));

  // Actual vapor pressure in the air (using ambient air temperature and humidity)
  const eSatAir = 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const eActAir = eSatAir * (humidityRH / 100);

  // VPD is the difference between leaf saturation pressure and actual air pressure.
  // We clamp to 0 in case extreme cooling/humidity causes a negative theoretical value.
  return Math.max(0, eSatLeaf - eActAir);
}



/**
 * Estimate days of battery remaining using a 7-day rolling drop rate.
 * Returns null if there's insufficient history to compute a rate.
 */
function estimateBatteryDays(
  currentPct: number,
  snapshots: BatterySnapshot[]
): number | null {
  if (snapshots.length < 2) return null;

  // Sort ascending by time
  const sorted = [...snapshots].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  // Add current live point for the most up-to-date calculation
  const lastTime = new Date(sorted[sorted.length - 1].recorded_at).getTime();
  if (Date.now() - lastTime > 1000 * 60 * 60) {
    sorted.push({ recorded_at: new Date().toISOString(), battery_pct: currentPct });
  }

  let currentCycle: BatterySnapshot[] = [];
  let bestCycle: BatterySnapshot[] = [];

  for (let i = sorted.length - 1; i >= 0; i--) {
    const pt = sorted[i];
    if (currentCycle.length === 0) {
      currentCycle.push(pt);
    } else {
      const prevPt = currentCycle[currentCycle.length - 1]; // chronologically newer point
      // If the older point (pt) has a higher or roughly equal battery, it's part of the discharge cycle.
      // We allow a small 2% margin for temperature fluctuations or ADC noise.
      if (pt.battery_pct >= prevPt.battery_pct - 2) {
        currentCycle.push(pt);
      } else {
        // A recharge or battery swap happened! The battery percentage went UP significantly between `pt` and `prevPt`.
        const chronologicalCycle = [...currentCycle].reverse();
        const cycleDays = (new Date(chronologicalCycle[chronologicalCycle.length - 1].recorded_at).getTime() - new Date(chronologicalCycle[0].recorded_at).getTime()) / (1000 * 60 * 60 * 24);
        
        // If this post-recharge cycle is long enough (> 12 hours) and has a valid drop, we use it!
        if (cycleDays >= 0.5 && chronologicalCycle[0].battery_pct - chronologicalCycle[chronologicalCycle.length - 1].battery_pct > 0) {
          bestCycle = chronologicalCycle;
          break;
        }
        
        // Otherwise, it's too short to get a good rate, so we skip it and look at the PREVIOUS cycle.
        currentCycle = [pt];
      }
    }
  }

  if (bestCycle.length === 0) {
    const chronologicalCycle = [...currentCycle].reverse();
    if (chronologicalCycle.length >= 2) {
      bestCycle = chronologicalCycle;
    }
  }

  if (bestCycle.length < 2) return null;

  const oldest = bestCycle[0];
  const newest = bestCycle[bestCycle.length - 1];
  const pctDrop = oldest.battery_pct - newest.battery_pct;
  const msElapsed = new Date(newest.recorded_at).getTime() - new Date(oldest.recorded_at).getTime();
  const daysElapsed = msElapsed / (1000 * 60 * 60 * 24);

  if (pctDrop <= 0 || daysElapsed <= 0) return null;

  const dropPerDay = pctDrop / daysElapsed;
  return currentPct / dropPerDay;
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function CopyLogsButton({ logs }: { logs: TelemetryData[] }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(JSON.stringify(logs, null, 2));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <button
      onClick={handleCopy}
      className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-zinc-400 bg-zinc-800/50 hover:bg-zinc-800 hover:text-zinc-200 rounded-lg transition-colors border border-zinc-700/50"
    >
      {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
      {copied ? "Copied" : "Copy JSON"}
    </button>
  );
}

export function DashboardClient({
  initialLogs,
  batteryHistory,
  dliHistory,
  vpdHistory,
  vpdRollingAvg,
  vpdHistory7,
  moistureHistory,
  activeDeployment: initialActiveDeployment,
  deploymentHistory: initialDeploymentHistory,
  dailySummary,
  microclimateProfile,
}: {
  initialLogs: TelemetryData[];
  batteryHistory: BatterySnapshot[];
  dliHistory: DLIDataPoint[];
  vpdHistory: VPDDataPoint[];
  vpdRollingAvg: number | null;
  vpdHistory7: VPDDataPoint[];
  moistureHistory: { recorded_at: string; soil_moisture_raw: number }[];
  activeDeployment: Deployment | null;
  deploymentHistory: Deployment[];
  dailySummary: DailySummaryData;
  microclimateProfile: PrecalculatedProfile | null;
}) {
  const [logs, setLogs] = useState<TelemetryData[]>(initialLogs);
  const [currentDeployment, setCurrentDeployment] = useState<Deployment | null>(initialActiveDeployment);
  const [allDeployments, setAllDeployments] = useState<Deployment[]>(initialDeploymentHistory);
  const supabase = createClient();

  // Real-time subscription
  useEffect(() => {
    const channel = supabase
      .channel("realtime:telemetry")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "telemetry" },
        (payload) => {
          const newLog = payload.new as TelemetryData;
          if (newLog.vpd_kpa === undefined) {
            newLog.vpd_kpa = calculateVPD(newLog.temperature_c, newLog.humidity_rh, newLog.illuminance_lux);
          }
          setLogs((current) => {
            if (current.some((l) => l.id === newLog.id)) return current;
            return [newLog, ...current].slice(0, 50);
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [supabase]);

  const latest = logs.length > 0 ? logs[0] : null;

  // Derived values
  const moisturePct = latest
    ? calculateMoisturePct(latest.soil_moisture_raw)
    : null;

  const daysRemaining =
    latest?.battery_pct != null
      ? estimateBatteryDays(latest.battery_pct, batteryHistory)
      : null;

  const batteryWarning = daysRemaining !== null && daysRemaining < 7;

  // Phase 2.2: convert raw moisture history to calibrated % for drainage analysis
  const drainageData: DrainageInput[] = moistureHistory.map((r) => ({
    recorded_at: r.recorded_at,
    moisture_pct: calculateMoisturePct(r.soil_moisture_raw),
    raw: r.soil_moisture_raw,
  }));

  // Deployment management
  const handleDeploymentCreated = useCallback((d: Deployment) => {
    setCurrentDeployment(d);
    setAllDeployments((prev) => {
      const updated = prev.map((existing) =>
        existing.ended_at === null && existing.id !== d.id
          ? { ...existing, ended_at: new Date().toISOString() }
          : existing
      );
      return [d, ...updated];
    });
  }, []);

  const handleDeploymentUpdated = useCallback((d: Deployment) => {
    setCurrentDeployment(d);
    setAllDeployments((prev) =>
      prev.map((existing) => (existing.id === d.id ? d : existing))
    );
  }, []);

  const placementType = currentDeployment?.placement_type ?? null;

  // Calibrated moisture for the TrialProgressCard
  const calibratedMoistureHistory = moistureHistory.map((r) => ({
    recorded_at: r.recorded_at,
    moisture_pct: calculateMoisturePct(r.soil_moisture_raw),
  }));

  // ── 5. Historical filtering for Sitter Mode and Microclimate Profile ──
  // Ensures findings only rely on complete past days, preventing partial/inaccurate intraday false alarms.
  const endOfYesterdayMs = new Date().setHours(0, 0, 0, 0);

  const historicalDrainageData = drainageData.filter(d => new Date(d.recorded_at).getTime() < endOfYesterdayMs);
  const historicalVpd = vpdHistory7.filter(d => new Date(d.recorded_at).getTime() < endOfYesterdayMs);
  const historicalDli = dliHistory.filter(d => new Date(d.day).getTime() < endOfYesterdayMs);
  const historicalLogs = logs.filter(l => new Date(l.recorded_at).getTime() < endOfYesterdayMs);
  
  const historicalLatestMoisture = historicalDrainageData.length > 0 
    ? historicalDrainageData[historicalDrainageData.length - 1].moisture_pct 
    : null;

  // Phase 4.5: Piecewise segmented drainage analysis
  const piecewiseResult = analyzePiecewiseDrainage(historicalDrainageData);

  // Calculate overall viability status
  const currentPlantType = currentDeployment?.plant_type || null;
  const isPot = placementType === "pot";
  const drainageResult = analyzeDrainage(historicalDrainageData, currentPlantType);
  const rot = evalRotWarning(historicalDrainageData, historicalVpd, historicalLatestMoisture, isPot, currentPlantType, piecewiseResult);
  const dehy = evalDehydrationWarning(historicalDrainageData, historicalVpd, historicalLatestMoisture, isPot, currentPlantType, piecewiseResult);
  const growth = evalGrowthOptimization(historicalDli, historicalVpd, currentPlantType, drainageResult);

  const hasActiveThreat = rot.status === "active" || dehy.status === "active";
  const hasRisk = rot.status === "at-risk" || dehy.status === "at-risk";
  const isOptimal = growth.status === "active";

  const viabilityStatus = hasActiveThreat ? "critical" : hasRisk ? "warning" : isOptimal ? "optimal" : "monitoring";

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-emerald-500/30 font-sans">
      {/* Background gradients */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-900/20 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-900/20 blur-[120px]" />
      </div>

      {/* Layout Wrapper */}
      <div className="w-full max-w-[1920px] mx-auto flex flex-col lg:flex-row items-start gap-4 lg:gap-8 px-4 sm:px-6 lg:px-8 2xl:px-12">
        {/* Navigation */}
        <SideNav />

        <main className="flex-1 min-w-0 w-full py-12 md:py-20 pb-[50vh] transition-all duration-300">

          {/* Header */}
          <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
                  <Leaf className="w-6 h-6 text-emerald-400" />
                </div>
                <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-white">
                  ViabilityNode
                </h1>
              </div>
              <p className="text-zinc-400 text-lg">
                Real-time telemetry dashboard for plant surrogate monitors.
              </p>
            </div>

            <div className="flex items-center gap-3">
              {latest && (
                <div className="flex items-center gap-3 px-4 py-2 bg-zinc-900/50 border border-zinc-800 rounded-full backdrop-blur-md">
                  <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span className="text-sm font-medium text-zinc-300">
                    {formatDistanceToNow(new Date(latest.recorded_at), { addSuffix: true })}
                  </span>
                </div>
              )}
            </div>
          </header>

          {!latest ? (
            <div className="p-12 text-center rounded-3xl border border-zinc-800/50 bg-zinc-900/20 backdrop-blur-sm">
              <Activity className="w-12 h-12 text-zinc-600 mx-auto mb-4" />
              <h2 className="text-xl font-medium text-white mb-2">No data available</h2>
              <p className="text-zinc-400">
                Waiting for telemetry logs from the surrogate node...
              </p>
            </div>
          ) : (
            <div className="space-y-16 lg:space-y-24">
              <div className="space-y-6">
                {/* Microclimate Profile Summary */}
                <SummaryDashboard
                  data={dailySummary}
                  viabilityStatus={viabilityStatus}
                  plantType={currentPlantType}
                  drainageData={historicalDrainageData}
                  piecewiseResult={piecewiseResult}
                />

                {/* Sitter Mode: Active Threat Alerts */}
                <ThreatAlertsPanel
                  drainageData={historicalDrainageData}
                  vpdHistory30={historicalVpd}
                  dliHistory={historicalDli}
                  latestMoisture={historicalLatestMoisture}
                  logs={historicalLogs}
                  placementType={placementType}
                  plantType={currentDeployment?.plant_type || null}
                  piecewise={piecewiseResult}
                  drainageResult={drainageResult}
                />
              </div>

              {latest?.battery_pct != null && batteryWarning && (
                <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-orange-500/10 border border-orange-500/30">
                  <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0" />
                  <p className="text-sm text-orange-300">
                    <span className="font-semibold">Low Battery Warning</span> — estimated{" "}
                    <span className="font-semibold">{daysRemaining?.toFixed(1)} days</span>{" "}
                    remaining before BMS cutout. Consider recharging.
                  </p>
                </div>
              )}

              {/* Deployment Panel */}
              {latest && (
                <DeploymentPanel
                  activeDeployment={currentDeployment}
                  deploymentHistory={allDeployments}
                  deviceId={latest.device_id}
                  onDeploymentCreated={handleDeploymentCreated}
                  onDeploymentUpdated={handleDeploymentUpdated}
                />
              )}

              {/* Trial Progress Card */}
              {currentDeployment && (
                <div id="trial-progress" className="scroll-mt-32">
                  <TrialProgressCard
                    deployment={currentDeployment}
                    daysRemaining={daysRemaining}
                    currentBatteryPct={latest?.battery_pct ?? null}
                    dliHistory={dliHistory}
                    vpdHistory30={vpdHistory7}
                    moistureHistory={calibratedMoistureHistory}
                  />
                </div>
              )}

              {/* Metrics Grid */}
              <div id="live-metrics" className="scroll-mt-32">
                <div className="grid grid-cols-2 md:grid-cols-3 2xl:grid-cols-6 gap-4 md:gap-6">

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
                    subtitle={dailySummary.previous?.vpd != null ? `Prev Day Avg: ${dailySummary.previous.vpd.toFixed(2)} kPa` : undefined}
                    icon={<Wind className="w-5 h-5 text-teal-400" />}
                    trend={null}
                  />

                  {/* ── Phase 1.1: Calibrated Soil Moisture ── */}
                  <MetricCard
                    title="Soil Moisture"
                    value={moisturePct !== null ? `${moisturePct.toFixed(1)}%` : "—"}
                    subtitle={`Raw ADC: ${latest.soil_moisture_raw}`}
                    icon={<Droplets className="w-5 h-5 text-emerald-400" />}
                    trend={null}
                    accentColor="emerald"
                    barValue={moisturePct ?? 0}
                  />

                  <MetricCard
                    title="Illuminance"
                    value={`${latest.illuminance_lux} lx`}
                    icon={<Sun className="w-5 h-5 text-yellow-400" />}
                    trend={null}
                  />

                  {/* ── Phase 1.2: Battery Autonomy ── */}
                  <BatteryCard
                    pct={latest.battery_pct}
                    voltage={latest.battery_v}
                    daysRemaining={daysRemaining}
                    warning={batteryWarning}
                  />

                </div>
              </div>



              {/* ════════════════════════════════════════
                 PHASE 2 — Biophysical Analytics
                ════════════════════════════════════════ */}
              <div id="analytics" className="space-y-6 scroll-mt-32">
                <div className="flex items-center gap-3 pt-2">
                  <div className="h-px flex-1 bg-zinc-800" />
                  <span className="text-xs font-medium text-zinc-500 uppercase tracking-widest px-3">
                    Biophysical Analytics
                  </span>
                  <div className="h-px flex-1 bg-zinc-800" />
                </div>

                {/* 3.0 — Microclimate Profile Card (Phase 3) */}
                <MicroclimatProfileCard
                  profile={microclimateProfile}
                  placementType={placementType}
                  deviceId={latest?.device_id}
                />

                {/* 2.1 — Daily Light Integral */}
                <DLIChart data={dliHistory} />

                {/* 2-col row: VPD trend + Drainage */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* 2.3 — VPD 7-day rolling */}
                  <VPDChart data={vpdHistory} rollingAvg={vpdRollingAvg} />

                  {/* 2.2 — Soil Drainage Velocity */}
                  <DrainageCard data={drainageData} plantType={currentPlantType} precalculatedResult={analyzeDrainage(drainageData, currentPlantType)} precalculatedPiecewise={analyzePiecewiseDrainage(drainageData)} />
                </div>

                {/* 2.4 — Atmospheric Correlation */}
                <AtmosphericCorrelationChart logs={logs} />
              </div>

              {/* Log Table */}
              <div id="live-logs" className="mt-4 rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-xl overflow-hidden shadow-2xl scroll-mt-32">
                <div className="px-6 py-5 border-b border-zinc-800 flex items-center justify-between">
                  <h3 className="text-lg font-medium text-white flex items-center gap-2">
                    <Activity className="w-5 h-5 text-zinc-400" />
                    Live Telemetry Logs
                  </h3>
                  <CopyLogsButton logs={logs} />
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
                        <th className="px-6 py-4 font-medium text-right">Soil %</th>
                        <th className="px-6 py-4 font-medium text-right">Light</th>
                        <th className="px-6 py-4 font-medium text-right">Battery</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-zinc-800/50">
                      {logs.map((log) => {
                        const mPct = calculateMoisturePct(log.soil_moisture_raw);
                        return (
                          <tr key={log.id} className="hover:bg-zinc-800/30 transition-colors">
                            <td className="px-6 py-3 text-zinc-300 whitespace-nowrap">
                              {new Date(log.recorded_at).toLocaleTimeString([], {
                                hour: "2-digit",
                                minute: "2-digit",
                                second: "2-digit",
                              })}
                              <span className="text-zinc-600 text-xs ml-2 hidden md:inline">
                                {new Date(log.recorded_at).toLocaleDateString()}
                              </span>
                            </td>
                            <td className="px-6 py-3 text-zinc-500 font-mono text-xs">
                              {log.device_id.split("-")[0] || log.device_id}
                            </td>
                            <td className="px-6 py-3 text-right text-zinc-200">
                              {log.temperature_c.toFixed(1)}°
                            </td>
                            <td className="px-6 py-3 text-right text-zinc-200">
                              {log.humidity_rh.toFixed(1)}%
                            </td>
                            <td className="px-6 py-3 text-right text-teal-400/80">
                              {log.vpd_kpa ? log.vpd_kpa.toFixed(2) : "-"}
                            </td>
                            <td className="px-6 py-3 text-right">
                              <span
                                className="font-medium"
                                style={{
                                  color: `hsl(${140 + mPct * 0.8}, 65%, 55%)`,
                                }}
                              >
                                {mPct.toFixed(1)}%
                              </span>
                              <span className="text-zinc-600 text-xs ml-1">
                                ({log.soil_moisture_raw})
                              </span>
                            </td>
                            <td className="px-6 py-3 text-right text-zinc-200">
                              {log.illuminance_lux}
                            </td>
                            <td className="px-6 py-3 text-right text-zinc-400">
                              {log.battery_pct != null ? `${log.battery_pct}%` : "-"}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

// ─── Components ───────────────────────────────────────────────────────────────

function MetricCard({
  title,
  value,
  subtitle,
  icon,
  trend,
  accentColor,
  barValue,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend: "up" | "down" | "stable" | null;
  accentColor?: string;
  barValue?: number;
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
          <span className="text-3xl md:text-4xl font-semibold text-white tracking-tight">
            {value}
          </span>
        </div>

        {subtitle && (
          <p className="mt-2 text-xs text-zinc-500 font-medium uppercase tracking-wider">
            {subtitle}
          </p>
        )}

        {/* Moisture bar for soil card */}
        {barValue !== undefined && (
          <div className="mt-3 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${barValue}%`,
                background: `hsl(${140 + barValue * 0.8}, 70%, 45%)`,
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function BatteryCard({
  pct,
  voltage,
  daysRemaining,
  warning,
}: {
  pct: number | null;
  voltage: number | null;
  daysRemaining: number | null;
  warning: boolean;
}) {
  const color = warning
    ? "text-orange-400"
    : pct != null && pct < 30
      ? "text-yellow-400"
      : "text-green-400";

  return (
    <div
      className={`relative group overflow-hidden p-6 rounded-3xl border backdrop-blur-xl transition-all duration-300 shadow-lg
        ${warning
          ? "border-orange-500/30 bg-orange-950/20 hover:bg-orange-950/30"
          : "border-zinc-800/80 bg-zinc-900/40 hover:bg-zinc-800/60"
        }`}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-white/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

      <div className="relative z-10">
        <div className="flex items-center justify-between mb-4">
          <span className="text-zinc-400 font-medium text-sm tracking-wide">Battery</span>
          <div className="p-2 bg-zinc-800/50 rounded-xl group-hover:scale-110 transition-transform duration-300">
            <Battery className={`w-5 h-5 ${color}`} />
          </div>
        </div>

        <div className="flex items-baseline gap-2">
          <span className={`text-3xl md:text-4xl font-semibold tracking-tight ${color}`}>
            {pct != null ? `${pct}%` : "N/A"}
          </span>
        </div>

        {voltage && (
          <p className="mt-1 text-xs text-zinc-500 font-medium uppercase tracking-wider">
            {voltage.toFixed(2)} V
          </p>
        )}

        {/* Days remaining */}
        {daysRemaining !== null ? (
          <div className={`mt-3 flex items-center gap-1.5 text-xs font-medium ${warning ? "text-orange-400" : "text-zinc-400"}`}>
            <Clock className="w-3.5 h-3.5" />
            <span>Est. {daysRemaining.toFixed(1)} days remaining</span>
          </div>
        ) : (
          <p className="mt-3 text-xs text-zinc-600">
            Gathering 7-day history…
          </p>
        )}

        {/* Battery bar */}
        {pct != null && (
          <div className="mt-3 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-700"
              style={{
                width: `${pct}%`,
                backgroundColor: warning
                  ? "rgb(251 146 60)"
                  : pct < 30
                    ? "rgb(250 204 21)"
                    : "rgb(74 222 128)",
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
