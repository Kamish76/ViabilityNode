import { supabaseAdmin } from "@/lib/supabase";
import { DashboardClient, TelemetryData, BatterySnapshot } from "./DashboardClient";
import type { DLIDataPoint } from "./components/DLIChart";
import type { VPDDataPoint } from "./components/VPDChart";

// Opt out of static rendering so we fetch fresh data on reload
export const dynamic = "force-dynamic";

export default async function DashboardPage() {

  // ── 1. Latest 50 telemetry records (with VPD) ─────────────────────────────
  const { data: logs, error } = await supabaseAdmin
    .from("telemetry_with_vpd")
    .select("*")
    .order("recorded_at", { ascending: false })
    .limit(50);

  let dataToUse = logs as TelemetryData[] | null;

  if (error) {
    console.warn("View telemetry_with_vpd not found, trying telemetry table:", error);
    const { data: fallbackLogs, error: fallbackError } = await supabaseAdmin
      .from("telemetry")
      .select("*")
      .order("recorded_at", { ascending: false })
      .limit(50);

    if (fallbackError) {
      console.error("Failed to fetch telemetry:", fallbackError?.message || fallbackError);
    } else {
      dataToUse = fallbackLogs as TelemetryData[];
    }
  }

  // ── 2. 7-day battery history for autonomy estimation ──────────────────────
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: batteryRows } = await supabaseAdmin
    .from("telemetry")
    .select("recorded_at, battery_pct")
    .gte("recorded_at", sevenDaysAgo.toISOString())
    .not("battery_pct", "is", null)
    .order("recorded_at", { ascending: true })
    .limit(500);

  // One sample per calendar day (earliest of each day)
  const batteryHistory: BatterySnapshot[] = [];
  const seenDays = new Set<string>();
  for (const row of batteryRows ?? []) {
    const day = new Date(row.recorded_at).toISOString().slice(0, 10);
    if (!seenDays.has(day)) {
      seenDays.add(day);
      batteryHistory.push({
        recorded_at: row.recorded_at,
        battery_pct: row.battery_pct as number,
      });
    }
  }

  // ── 3. Phase 2.1: Daily Light Integral — last 30 days ────────────────────
  // Try the daily_dli view first; fall back to computing from raw telemetry
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  let dliHistory: DLIDataPoint[] = [];
  const { data: dliRows, error: dliError } = await supabaseAdmin
    .from("daily_dli")
    .select("day, dli_mol_per_m2, reading_count")
    .gte("day", thirtyDaysAgo.toISOString().slice(0, 10))
    .order("day", { ascending: false })
    .limit(30);

  if (dliError) {
    // View not yet applied — fall back to aggregating raw telemetry client-side
    console.warn("daily_dli view not found, computing from raw telemetry:", dliError.message);
    const { data: rawLux } = await supabaseAdmin
      .from("telemetry")
      .select("recorded_at, illuminance_lux")
      .gte("recorded_at", thirtyDaysAgo.toISOString())
      .order("recorded_at", { ascending: true })
      .limit(5000);

    // Group by UTC day, compute avg PPFD × 86400 / 1e6
    const dayMap = new Map<string, { sum: number; count: number }>();
    for (const r of rawLux ?? []) {
      const day = new Date(r.recorded_at).toISOString().slice(0, 10);
      const ppfd = (r.illuminance_lux as number) * 0.0185;
      const existing = dayMap.get(day) ?? { sum: 0, count: 0 };
      dayMap.set(day, { sum: existing.sum + ppfd, count: existing.count + 1 });
    }
    dliHistory = Array.from(dayMap.entries()).map(([day, { sum, count }]) => ({
      day,
      dli_mol_per_m2: parseFloat(((sum / count) * 86400 / 1_000_000).toFixed(4)),
      reading_count: count,
    }));
  } else {
    dliHistory = (dliRows ?? []) as DLIDataPoint[];
  }

  // ── 4. Phase 2.3: VPD — 7-day readings for trend chart ───────────────────
  let vpdHistory: VPDDataPoint[] = [];
  const { data: vpdRows, error: vpdError } = await supabaseAdmin
    .from("telemetry_with_vpd")
    .select("recorded_at, vpd_kpa")
    .gte("recorded_at", sevenDaysAgo.toISOString())
    .not("vpd_kpa", "is", null)
    .order("recorded_at", { ascending: true })
    .limit(2000);

  if (vpdError) {
    // Compute VPD from raw temp + humidity
    console.warn("vpd from view failed, computing from raw:", vpdError.message);
    const { data: rawTH } = await supabaseAdmin
      .from("telemetry")
      .select("recorded_at, temperature_c, humidity_rh")
      .gte("recorded_at", sevenDaysAgo.toISOString())
      .order("recorded_at", { ascending: true })
      .limit(2000);

    vpdHistory = (rawTH ?? []).map((r) => {
      const temp = r.temperature_c as number;
      const rh   = r.humidity_rh as number;
      const eSat = 0.61078 * Math.exp((17.27 * temp) / (temp + 237.3));
      return {
        recorded_at: r.recorded_at as string,
        vpd_kpa: parseFloat((eSat * (1 - rh / 100)).toFixed(3)),
      };
    });
  } else {
    vpdHistory = (vpdRows ?? []) as VPDDataPoint[];
  }

  // Thin VPD dataset to ≤ 300 points for rendering performance
  const thinFactor = Math.max(1, Math.floor(vpdHistory.length / 300));
  const vpdThinned = vpdHistory.filter((_, i) => i % thinFactor === 0);

  // 7-day rolling avg
  const vpdRollingAvg =
    vpdThinned.length > 0
      ? vpdThinned.reduce((s, d) => s + d.vpd_kpa, 0) / vpdThinned.length
      : null;

  // ── 5. Phase 2.2: Soil drainage — pass historical calibrated data ─────────
  // We compute moisture_pct on the client using localStorage calibration.
  // Pass raw telemetry rows (already fetched in step 1 + extended lookback)
  // For a better slope analysis we fetch extra historical moisture data here.
  const { data: moistureRows } = await supabaseAdmin
    .from("telemetry")
    .select("recorded_at, soil_moisture_raw")
    .gte("recorded_at", sevenDaysAgo.toISOString())
    .order("recorded_at", { ascending: true })
    .limit(2000);

  const moistureHistory = (moistureRows ?? []).map((r) => ({
    recorded_at: r.recorded_at as string,
    soil_moisture_raw: r.soil_moisture_raw as number,
  }));

  return (
    <DashboardClient
      initialLogs={dataToUse ?? []}
      batteryHistory={batteryHistory}
      dliHistory={dliHistory}
      vpdHistory={vpdThinned}
      vpdRollingAvg={vpdRollingAvg}
      moistureHistory={moistureHistory}
    />
  );
}
