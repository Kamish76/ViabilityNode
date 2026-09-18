import { supabaseAdmin } from "@/lib/supabase";
import { DashboardClient, TelemetryData, BatterySnapshot } from "./DashboardClient";
import type { DLIDataPoint } from "./components/DLIChart";
import type { VPDDataPoint } from "./components/VPDChart";
import type { Deployment } from "./components/DeploymentPanel";
import type { PrecalculatedProfile } from "./components/MicroclimatProfileCard";

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
  const { data: summaryData } = await supabaseAdmin
    .from("daily_telemetry_summary")
    .select("*")
    .eq("device_id", deviceId ?? "")
    .order("day", { ascending: false })
    .limit(2);

  let currentSummary = null;
  let previousSummary = null;

  if (summaryData && summaryData.length > 0) {
    currentSummary = {
      temp: summaryData[0].avg_temperature_c,
      humidity: summaryData[0].avg_humidity_rh,
      vpd: summaryData[0].avg_vpd_kpa,
      light: summaryData[0].avg_illuminance_lux,
      moistureRaw: summaryData[0].avg_soil_moisture_raw,
    };
    if (summaryData.length > 1) {
      previousSummary = {
        temp: summaryData[1].avg_temperature_c,
        humidity: summaryData[1].avg_humidity_rh,
        vpd: summaryData[1].avg_vpd_kpa,
        light: summaryData[1].avg_illuminance_lux,
        moistureRaw: summaryData[1].avg_soil_moisture_raw,
      };
    }
  }
  
  const dailySummary = { current: currentSummary, previous: previousSummary };




  // ── 2. 7-day battery history for autonomy estimation ──────────────────────
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let batteryRows: { recorded_at: string; battery_pct: number }[] = [];
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

    if (dliError) {
      console.error("Failed to fetch daily_dli view:", dliError);
    } else {
      dliHistory = (dliRows ?? []) as DLIDataPoint[];
    }
  }

  let vpdHistory: VPDDataPoint[] = [];
  if (deviceId) {
    const { data: vpdRows, error: vpdError } = await supabaseAdmin
      .from("telemetry_with_vpd")
      .select("recorded_at, vpd_kpa, temperature_c, humidity_rh")
      .eq("device_id", deviceId)
      .gte("recorded_at", sevenDaysAgo.toISOString())
      .not("vpd_kpa", "is", null)
      .order("recorded_at", { ascending: true })
      .limit(5000);

    if (vpdError) {
      console.error("Failed to fetch vpd from telemetry_with_vpd:", vpdError.message);
    } else {
      vpdHistory = (vpdRows ?? []) as VPDDataPoint[];
    }
  }

  // Thin VPD for the chart
  // eslint-disable-next-line react-hooks/purity
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const vpd7Day = vpdHistory.filter(d => new Date(d.recorded_at).getTime() >= sevenDaysAgoMs);
  const thinFactor = Math.max(1, Math.floor(vpd7Day.length / 300));
  const vpdThinned = vpd7Day.filter((_, i) => i % thinFactor === 0);

  // 7-day avg for VPDChart badge
  const vpdRollingAvg =
    vpdThinned.length > 0
      ? vpdThinned.reduce((s, d) => s + d.vpd_kpa, 0) / vpdThinned.length
      : null;

  // ── 5. Phase 2.2 + 3: Soil drainage — 7-day moisture history ───────────
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

  let deviceSettings = null;

  if (deviceId) {
    // Fetch device settings
    const { data: settingsData } = await supabaseAdmin
      .from("device_settings")
      .select("dry_limit, wet_limit, plant_type, placement_type")
      .eq("device_id", deviceId)
      .single();
    
    if (settingsData) {
      deviceSettings = settingsData;
    }

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

  // ── 7. Fetch precalculated microclimate profile ─────────────────────────
  let microclimateProfile: PrecalculatedProfile | null = null;
  if (deviceId) {
    const { data: profileData, error: profileError } = await supabaseAdmin
      .from("node_microclimates")
      .select("*")
      .eq("device_id", deviceId)
      .single();

    if (profileData) {
      microclimateProfile = profileData as PrecalculatedProfile;
    }
  }

  return (
    <DashboardClient
      initialLogs={dataToUse ?? []}
      batteryHistory={batteryHistory}
      dliHistory={dliHistory}
      vpdHistory={vpdThinned}
      vpdRollingAvg={vpdRollingAvg}
      vpdHistory7={vpdHistory}
      moistureHistory={moistureHistory}
      activeDeployment={activeDeployment}
      deploymentHistory={deploymentHistory}
      dailySummary={dailySummary}
      microclimateProfile={microclimateProfile}
    />
  );
}
