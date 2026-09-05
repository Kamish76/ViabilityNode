import { supabaseAdmin } from "@/lib/supabase";
import { DashboardClient, TelemetryData, BatterySnapshot } from "./DashboardClient";
import type { DLIDataPoint } from "./components/DLIChart";
import type { VPDDataPoint } from "./components/VPDChart";
import type { Deployment } from "./components/DeploymentPanel";

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

  const deviceId = dataToUse?.[0]?.device_id ?? null;

  // ── 0. Daily Summary Data (Current vs Previous Day) ───────────────
  const fortyEightHoursAgo = new Date();
  fortyEightHoursAgo.setDate(fortyEightHoursAgo.getDate() - 2);
  
  let recentTelemetry: any[] = [];
  if (deviceId) {
    const { data } = await supabaseAdmin
      .from("telemetry")
      .select("recorded_at, temperature_c, humidity_rh, illuminance_lux, soil_moisture_raw")
      .eq("device_id", deviceId)
      .gte("recorded_at", fortyEightHoursAgo.toISOString())
      .order("recorded_at", { ascending: false });
    recentTelemetry = data ?? [];
  }

  let currentSummary = null;
  let previousSummary = null;

  if (recentTelemetry && recentTelemetry.length > 0) {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const yesterdayStr = yesterday.toISOString().slice(0, 10);

    const todayRows = recentTelemetry.filter(r => (r.recorded_at as string).startsWith(todayStr));
    const yesterdayRows = recentTelemetry.filter(r => (r.recorded_at as string).startsWith(yesterdayStr));

    const computeAvg = (rows: any[]) => {
      if (rows.length === 0) return null;
      let temp = 0, hum = 0, vpd = 0, lux = 0, moisture = 0;
      for (const r of rows) {
        temp += r.temperature_c as number;
        hum += r.humidity_rh as number;
        lux += r.illuminance_lux as number;
        moisture += r.soil_moisture_raw as number;
        const eSat = 0.61078 * Math.exp((17.27 * r.temperature_c) / (r.temperature_c + 237.3));
        vpd += eSat * (1 - r.humidity_rh / 100);
      }
      return {
        temp: temp / rows.length,
        humidity: hum / rows.length,
        vpd: vpd / rows.length,
        light: lux / rows.length,
        moistureRaw: moisture / rows.length,
      };
    };

    currentSummary = computeAvg(todayRows);
    previousSummary = computeAvg(yesterdayRows);
  }
  
  const dailySummary = { current: currentSummary, previous: previousSummary };




  // ── 2. 7-day battery history for autonomy estimation ──────────────────────
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let batteryRows: any[] = [];
  if (deviceId) {
    const { data } = await supabaseAdmin
      .from("telemetry")
      .select("recorded_at, battery_pct")
      .eq("device_id", deviceId)
      .gte("recorded_at", sevenDaysAgo.toISOString())
      .not("battery_pct", "is", null)
      .order("recorded_at", { ascending: true })
      .limit(500);
    batteryRows = data ?? [];
  }

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
  
  if (deviceId) {
    const { data: dliRows, error: dliError } = await supabaseAdmin
      .from("daily_dli")
      .select("day, dli_mol_per_m2, reading_count")
      .eq("device_id", deviceId)
      .gte("day", thirtyDaysAgo.toISOString().slice(0, 10))
      .order("day", { ascending: false })
      .limit(30);

    if (dliError || !dliRows || dliRows.length === 0) {
      // View not yet applied or empty — fall back to computing from raw telemetry with trapezoidal integration
      console.warn("daily_dli view not found or empty, computing from raw telemetry");
      const { data: rawLux } = await supabaseAdmin
        .from("telemetry")
        .select("recorded_at, illuminance_lux")
        .eq("device_id", deviceId)
        .gte("recorded_at", thirtyDaysAgo.toISOString())
        .order("recorded_at", { ascending: true })
        .limit(5000);

      const dayMap = new Map<string, { dli: number; count: number }>();
      let prevTime: number | null = null;
      let prevPPFD: number | null = null;
      
      for (const r of rawLux ?? []) {
        const day = new Date(r.recorded_at).toISOString().slice(0, 10);
        const currTime = new Date(r.recorded_at).getTime();
        const currPPFD = (r.illuminance_lux as number) * 0.0185;
        
        const existing = dayMap.get(day) ?? { dli: 0, count: 0 };
        
        if (prevTime !== null && prevPPFD !== null) {
          const deltaSeconds = (currTime - prevTime) / 1000;
          // Cap the delta to 2 hours (7200 seconds) to avoid massive gaps inflating DLI
          const effectiveDelta = Math.min(deltaSeconds, 7200);
          
          // Trapezoidal integration
          const dliIncrement = ((currPPFD + prevPPFD) / 2) * effectiveDelta / 1_000_000;
          existing.dli += dliIncrement;
        }
        
        existing.count += 1;
        dayMap.set(day, existing);
        
        prevTime = currTime;
        prevPPFD = currPPFD;
      }

      dliHistory = Array.from(dayMap.entries()).map(([day, { dli, count }]) => ({
        day,
        dli_mol_per_m2: parseFloat(dli.toFixed(4)),
        reading_count: count,
      })).sort((a, b) => b.day.localeCompare(a.day));
    } else {
      dliHistory = (dliRows ?? []) as DLIDataPoint[];
    }
  }

  // ── 4. Phase 2.3 + 3: VPD — 30-day readings (chart uses thinned 7-day subset)
  // Fetch 30 days so Phase 3 profile card can compute a proper long-term average.
  let vpdHistory30: VPDDataPoint[] = [];
  if (deviceId) {
    const { data: vpdRows, error: vpdError } = await supabaseAdmin
      .from("telemetry_with_vpd")
      .select("recorded_at, vpd_kpa")
      .eq("device_id", deviceId)
      .gte("recorded_at", thirtyDaysAgo.toISOString())
      .not("vpd_kpa", "is", null)
      .order("recorded_at", { ascending: true })
      .limit(5000);

    if (vpdError) {
      // Compute VPD from raw temp + humidity
      console.warn("vpd from view failed, computing from raw:", vpdError.message);
      const { data: rawTH } = await supabaseAdmin
        .from("telemetry")
        .select("recorded_at, temperature_c, humidity_rh")
        .eq("device_id", deviceId)
        .gte("recorded_at", thirtyDaysAgo.toISOString())
        .order("recorded_at", { ascending: true })
        .limit(5000);

      vpdHistory30 = (rawTH ?? []).map((r) => {
        const temp = r.temperature_c as number;
        const rh   = r.humidity_rh as number;
        const eSat = 0.61078 * Math.exp((17.27 * temp) / (temp + 237.3));
        return {
          recorded_at: r.recorded_at as string,
          vpd_kpa: parseFloat((eSat * (1 - rh / 100)).toFixed(3)),
        };
      });
    } else {
      vpdHistory30 = (vpdRows ?? []) as VPDDataPoint[];
    }
  }

  // Thin VPD to last 7 days, ≤ 300 points for the chart
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const vpd7Day = vpdHistory30.filter(d => new Date(d.recorded_at).getTime() >= sevenDaysAgoMs);
  const thinFactor = Math.max(1, Math.floor(vpd7Day.length / 300));
  const vpdThinned = vpd7Day.filter((_, i) => i % thinFactor === 0);

  // 7-day avg for VPDChart badge
  const vpdRollingAvg =
    vpdThinned.length > 0
      ? vpdThinned.reduce((s, d) => s + d.vpd_kpa, 0) / vpdThinned.length
      : null;

  // ── 5. Phase 2.2 + 3: Soil drainage — 30-day moisture history ───────────
  // Extended to 30 days so the drainage slope and Phase 3 profile card can
  // detect saturation events further back in time.
  let moistureHistory: { recorded_at: string; soil_moisture_raw: number }[] = [];
  if (deviceId) {
    const { data: moistureRows } = await supabaseAdmin
      .from("telemetry")
      .select("recorded_at, soil_moisture_raw")
      .eq("device_id", deviceId)
      .gte("recorded_at", thirtyDaysAgo.toISOString())
      .order("recorded_at", { ascending: true })
      .limit(5000);

    moistureHistory = (moistureRows ?? []).map((r) => ({
      recorded_at: r.recorded_at as string,
      soil_moisture_raw: r.soil_moisture_raw as number,
    }));
  }

  // ── 6. Deployment tracking — active deployment + history ─────────────────

  let activeDeployment: Deployment | null = null;
  let deploymentHistory: Deployment[] = [];

  if (deviceId) {
    // Fetch all deployments for this device (active first)
    const { data: deploymentRows, error: deploymentError } = await supabaseAdmin
      .from("node_deployments")
      .select("*")
      .eq("device_id", deviceId)
      .order("started_at", { ascending: false });

    if (deploymentError) {
      console.warn("node_deployments table not found or error:", deploymentError.message);
    } else {
      deploymentHistory = (deploymentRows ?? []) as Deployment[];
      activeDeployment = deploymentHistory.find((d) => d.ended_at === null) ?? null;
    }
  }

  return (
    <DashboardClient
      initialLogs={dataToUse ?? []}
      batteryHistory={batteryHistory}
      dliHistory={dliHistory}
      vpdHistory={vpdThinned}
      vpdRollingAvg={vpdRollingAvg}
      vpdHistory30={vpdHistory30}
      moistureHistory={moistureHistory}
      activeDeployment={activeDeployment}
      deploymentHistory={deploymentHistory}
      dailySummary={dailySummary}
    />
  );
}
