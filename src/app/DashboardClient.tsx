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
} from "lucide-react";
import { createClient } from "@/utils/supabase/client";

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

// ─── Calibration defaults (prototype / debug values) ─────────────────────────

const CALIBRATION_STORAGE_KEY = "viability_node_calibration";

interface CalibrationConfig {
  dryLimit: number;   // ADC reading in air (≈ 1900)
  wetLimit: number;   // ADC reading fully submerged (≈ 1100)
}

const DEFAULT_CALIBRATION: CalibrationConfig = {
  dryLimit: 1910,
  wetLimit: 1100,
};

function loadCalibration(): CalibrationConfig {
  if (typeof window === "undefined") return DEFAULT_CALIBRATION;
  try {
    const raw = localStorage.getItem(CALIBRATION_STORAGE_KEY);
    if (!raw) return DEFAULT_CALIBRATION;
    const parsed = JSON.parse(raw);
    return {
      dryLimit: Number(parsed.dryLimit) || DEFAULT_CALIBRATION.dryLimit,
      wetLimit: Number(parsed.wetLimit) || DEFAULT_CALIBRATION.wetLimit,
    };
  } catch {
    return DEFAULT_CALIBRATION;
  }
}

function saveCalibration(cfg: CalibrationConfig): void {
  localStorage.setItem(CALIBRATION_STORAGE_KEY, JSON.stringify(cfg));
}

// ─── Calculations ─────────────────────────────────────────────────────────────

function calculateVPD(tempC: number, humidityRH: number): number {
  const eSat = 0.61078 * Math.exp((17.27 * tempC) / (tempC + 237.3));
  const eAct = eSat * (humidityRH / 100);
  return eSat - eAct;
}

function calculateMoisturePct(
  rawADC: number,
  { dryLimit, wetLimit }: CalibrationConfig
): number {
  if (dryLimit === wetLimit) return 0;
  const pct = ((dryLimit - rawADC) / (dryLimit - wetLimit)) * 100;
  return Math.max(0, Math.min(100, pct));
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

  const oldest = sorted[0];
  const newest = sorted[sorted.length - 1];
  const pctDrop = (oldest.battery_pct ?? 0) - (newest.battery_pct ?? 0);
  const msElapsed =
    new Date(newest.recorded_at).getTime() -
    new Date(oldest.recorded_at).getTime();
  const daysElapsed = msElapsed / (1000 * 60 * 60 * 24);

  if (pctDrop <= 0 || daysElapsed <= 0) return null; // charging or no data

  const dropPerDay = pctDrop / daysElapsed;
  return currentPct / dropPerDay;
}

// ─── Calibration Modal ────────────────────────────────────────────────────────

function CalibrationModal({
  calibration,
  liveRaw,
  onSave,
  onClose,
}: {
  calibration: CalibrationConfig;
  liveRaw: number | null;
  onSave: (cfg: CalibrationConfig) => void;
  onClose: () => void;
}) {
  const [dry, setDry] = useState(calibration.dryLimit);
  const [wet, setWet] = useState(calibration.wetLimit);

  const preview =
    liveRaw !== null
      ? calculateMoisturePct(liveRaw, { dryLimit: dry, wetLimit: wet })
      : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-md rounded-3xl border border-zinc-700/80 bg-zinc-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-500/10 rounded-xl border border-amber-500/20">
              <FlaskConical className="w-5 h-5 text-amber-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                Soil Sensor Calibration
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                Debug mode — values stored in browser localStorage
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-6">
          {/* Debug badge */}
          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
            <p className="text-xs text-amber-300 leading-snug">
              Prototype calibration — capture real wet/dry ADC readings from the
              sensor before finalising these values.
            </p>
          </div>

          {/* Dry Limit */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium text-zinc-300">
                Dry Limit{" "}
                <span className="text-zinc-500 font-normal">(Air / Empty)</span>
              </label>
              <span className="text-sm font-mono font-semibold text-zinc-100">
                {dry}
              </span>
            </div>
            <input
              type="range"
              min={1500}
              max={2100}
              step={5}
              value={dry}
              onChange={(e) => setDry(Number(e.target.value))}
              className="w-full accent-amber-400"
            />
            <div className="flex justify-between text-xs text-zinc-600">
              <span>1500</span>
              <span>2100</span>
            </div>
            <input
              type="number"
              value={dry}
              onChange={(e) => setDry(Number(e.target.value))}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:border-amber-500 transition-colors"
            />
          </div>

          {/* Wet Limit */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="text-sm font-medium text-zinc-300">
                Wet Limit{" "}
                <span className="text-zinc-500 font-normal">
                  (Submerged in Water)
                </span>
              </label>
              <span className="text-sm font-mono font-semibold text-zinc-100">
                {wet}
              </span>
            </div>
            <input
              type="range"
              min={800}
              max={1500}
              step={5}
              value={wet}
              onChange={(e) => setWet(Number(e.target.value))}
              className="w-full accent-emerald-400"
            />
            <div className="flex justify-between text-xs text-zinc-600">
              <span>800</span>
              <span>1500</span>
            </div>
            <input
              type="number"
              value={wet}
              onChange={(e) => setWet(Number(e.target.value))}
              className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-xl text-sm text-white focus:outline-none focus:border-emerald-500 transition-colors"
            />
          </div>

          {/* Live Preview */}
          {liveRaw !== null && (
            <div className="rounded-2xl bg-zinc-800/60 border border-zinc-700/50 px-4 py-4">
              <p className="text-xs text-zinc-500 mb-3 font-medium uppercase tracking-wider">
                Live Preview
              </p>
              <div className="flex items-end justify-between">
                <div>
                  <p className="text-xs text-zinc-500 mb-1">
                    Raw ADC: <span className="text-zinc-300 font-mono">{liveRaw}</span>
                  </p>
                  <p className="text-3xl font-bold text-white">
                    {preview !== null ? `${preview.toFixed(1)}%` : "—"}
                  </p>
                  <p className="text-xs text-zinc-500 mt-1">Volumetric Water Content</p>
                </div>
                {/* Mini moisture bar */}
                <div className="w-8 h-24 bg-zinc-700 rounded-full overflow-hidden flex items-end">
                  <div
                    className="w-full rounded-full transition-all duration-500"
                    style={{
                      height: `${preview ?? 0}%`,
                      background: `hsl(${140 + (preview ?? 0) * 0.8}, 70%, 45%)`,
                    }}
                  />
                </div>
              </div>
            </div>
          )}

          {/* Reset to defaults notice */}
          <p className="text-xs text-zinc-600 text-center">
            Default: Dry={DEFAULT_CALIBRATION.dryLimit}, Wet={DEFAULT_CALIBRATION.wetLimit}
          </p>
        </div>

        {/* Footer actions */}
        <div className="px-6 py-4 border-t border-zinc-800 flex gap-3">
          <button
            onClick={() => {
              setDry(DEFAULT_CALIBRATION.dryLimit);
              setWet(DEFAULT_CALIBRATION.wetLimit);
            }}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"
          >
            Reset Defaults
          </button>
          <button
            onClick={() => {
              onSave({ dryLimit: dry, wetLimit: wet });
              onClose();
            }}
            className="flex-1 px-4 py-2.5 text-sm font-semibold text-black bg-emerald-400 hover:bg-emerald-300 rounded-xl transition-colors"
          >
            Save Calibration
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

export function DashboardClient({
  initialLogs,
  batteryHistory,
}: {
  initialLogs: TelemetryData[];
  batteryHistory: BatterySnapshot[];
}) {
  const [logs, setLogs] = useState<TelemetryData[]>(initialLogs);
  const [calibration, setCalibration] = useState<CalibrationConfig>(DEFAULT_CALIBRATION);
  const [showCalibration, setShowCalibration] = useState(false);
  const supabase = createClient();

  // Load calibration from localStorage on mount (client-only)
  useEffect(() => {
    setCalibration(loadCalibration());
  }, []);

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
            newLog.vpd_kpa = calculateVPD(newLog.temperature_c, newLog.humidity_rh);
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

  const handleSaveCalibration = useCallback((cfg: CalibrationConfig) => {
    setCalibration(cfg);
    saveCalibration(cfg);
  }, []);

  const latest = logs.length > 0 ? logs[0] : null;

  // Derived values
  const moisturePct = latest
    ? calculateMoisturePct(latest.soil_moisture_raw, calibration)
    : null;

  const daysRemaining =
    latest?.battery_pct != null
      ? estimateBatteryDays(latest.battery_pct, batteryHistory)
      : null;

  const batteryWarning = daysRemaining !== null && daysRemaining < 7;

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 selection:bg-emerald-500/30 font-sans">
      {/* Background gradients */}
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-900/20 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-emerald-900/20 blur-[120px]" />
      </div>

      {/* Calibration Modal */}
      {showCalibration && (
        <CalibrationModal
          calibration={calibration}
          liveRaw={latest?.soil_moisture_raw ?? null}
          onSave={handleSaveCalibration}
          onClose={() => setShowCalibration(false)}
        />
      )}

      <main className="max-w-6xl mx-auto px-6 py-12 md:py-20">

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
            {/* Calibration button */}
            <button
              id="calibration-modal-trigger"
              onClick={() => setShowCalibration(true)}
              className="flex items-center gap-2 px-4 py-2 bg-amber-500/10 border border-amber-500/20 hover:bg-amber-500/20 text-amber-400 hover:text-amber-300 rounded-full text-sm font-medium transition-all duration-200"
            >
              <Settings2 className="w-4 h-4" />
              Calibrate Sensor
            </button>

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
          <div className="space-y-8">

            {/* Battery warning banner */}
            {batteryWarning && (
              <div className="flex items-center gap-3 px-5 py-3.5 rounded-2xl bg-orange-500/10 border border-orange-500/30">
                <AlertTriangle className="w-5 h-5 text-orange-400 shrink-0" />
                <p className="text-sm text-orange-300">
                  <span className="font-semibold">Low Battery Warning</span> — estimated{" "}
                  <span className="font-semibold">{daysRemaining?.toFixed(1)} days</span>{" "}
                  remaining before BMS cutout. Consider recharging.
                </p>
              </div>
            )}

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

            {/* Calibration info strip */}
            <div className="flex items-center justify-between px-5 py-3 rounded-2xl bg-zinc-900/60 border border-zinc-800/60 text-xs text-zinc-500">
              <div className="flex items-center gap-2">
                <FlaskConical className="w-3.5 h-3.5 text-amber-500/70" />
                <span>
                  Soil calibration:{" "}
                  <span className="text-zinc-400 font-mono">
                    Dry={calibration.dryLimit} / Wet={calibration.wetLimit}
                  </span>
                </span>
              </div>
              <button
                onClick={() => setShowCalibration(true)}
                className="text-amber-500/70 hover:text-amber-400 transition-colors underline underline-offset-2"
              >
                Adjust
              </button>
            </div>

            {/* Log Table */}
            <div className="mt-4 rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-xl overflow-hidden shadow-2xl">
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
                      <th className="px-6 py-4 font-medium text-right">Soil %</th>
                      <th className="px-6 py-4 font-medium text-right">Light</th>
                      <th className="px-6 py-4 font-medium text-right">Battery</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-zinc-800/50">
                    {logs.map((log) => {
                      const mPct = calculateMoisturePct(log.soil_moisture_raw, calibration);
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
