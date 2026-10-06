/* eslint-disable react-hooks/purity */
import { supabaseAdmin } from "@/lib/supabase";
import { DashboardClient, TelemetryData, BatterySnapshot } from "./DashboardClient";
import type { DLIDataPoint } from "./components/DLIChart";
import type { VPDDataPoint } from "./components/VPDChart";
import type { Deployment } from "./components/DeploymentPanel";
import type { PrecalculatedProfile } from "./components/MicroclimatProfileCard";
import type { NodeSummary } from "./components/NodeSwitcher";
import { getNodeStatus } from "@/lib/nodeStatus";

// Opt out of static rendering so we fetch fresh data on reload
export const dynamic = "force-dynamic";

export default async function DashboardPage(props: {
  searchParams: Promise<{ node?: string }>;
}) {
  const searchParams = await props.searchParams;
  const requestedNode = searchParams?.node;

  // ── 0. Multi-Node Discovery & Metadata ────────────────────────────────────
  const [deploymentsRes, recentTelemetryRes] = await Promise.all([
    supabaseAdmin
      .from("node_deployments")
      .select("device_id, label, plant_type, ended_at"),
    supabaseAdmin
      .from("telemetry")
      .select("device_id, recorded_at, temperature_c, humidity_rh, battery_pct")
      .order("recorded_at", { ascending: false })
      .limit(200),
  ]);

  const nodeSet = new Set<string>(["plant_node_01", "plant_node_02"]);
  deploymentsRes.data?.forEach((d) => {
    if (d.device_id) nodeSet.add(d.device_id);
  });
  recentTelemetryRes.data?.forEach((t) => {
    if (t.device_id) nodeSet.add(t.device_id);
  });

  const availableNodes = Array.from(nodeSet).sort();

  const nodeSummaries: NodeSummary[] = availableNodes.map((id) => {
    const latestReading = recentTelemetryRes.data?.find((t) => t.device_id === id);
    const activeDep = deploymentsRes.data?.find(
      (d) => d.device_id === id && d.ended_at === null
    );
    const lastSeen = latestReading?.recorded_at ?? null;

    const status = getNodeStatus(lastSeen);

    return {
      nodeId: id,
      status,
      lastSeen,
      activeDeploymentLabel: activeDep?.label ?? null,
      plantType: activeDep?.plant_type ?? null,
      latestTemp: latestReading?.temperature_c ?? null,
      latestHumidity: latestReading?.humidity_rh ?? null,
      latestBattery: latestReading?.battery_pct ?? null,
    };
  });

  // Selected device: use requested URL param if valid, or default to plant_node_01
  const selectedDeviceId =
    requestedNode && availableNodes.includes(requestedNode)
      ? requestedNode
      : availableNodes[0] || "plant_node_01";

  // ── 1. Latest 50 telemetry records for selected node (with VPD) ───────────
  const { data: logs, error } = await supabaseAdmin
    .from("telemetry_with_vpd")
    .select("*")
    .eq("device_id", selectedDeviceId)
    .order("recorded_at", { ascending: false })
    .limit(50);

  let dataToUse = logs as TelemetryData[] | null;

  if (error) {
    console.warn("View telemetry_with_vpd not found, trying telemetry table:", error);
    const { data: fallbackLogs, error: fallbackError } = await supabaseAdmin
      .from("telemetry")
      .select("*")
      .eq("device_id", selectedDeviceId)
      .order("recorded_at", { ascending: false })
      .limit(50);

    if (fallbackError) {
      console.error("Failed to fetch telemetry:", fallbackError?.message || fallbackError);
    } else {
      dataToUse = fallbackLogs as TelemetryData[];
    }
  }

  // ── 2. Daily Summary Data (Current vs Previous Day) for selected node ─────
  const { data: summaryData } = await supabaseAdmin
    .from("daily_telemetry_summary")
    .select("*")
    .eq("device_id", selectedDeviceId)
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
      moisturePct: summaryData[0].avg_moisture_pct,
    };
    if (summaryData.length > 1) {
      previousSummary = {
        temp: summaryData[1].avg_temperature_c,
        humidity: summaryData[1].avg_humidity_rh,
        vpd: summaryData[1].avg_vpd_kpa,
        light: summaryData[1].avg_illuminance_lux,
        moisturePct: summaryData[1].avg_moisture_pct,
      };
    }
  }

  const dailySummary = { current: currentSummary, previous: previousSummary };

  // ── 3. 7-day battery history for autonomy estimation ──────────────────────
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  let batteryRows: { recorded_at: string; battery_pct: number }[] = [];
  const { data: batteryData } = await supabaseAdmin
    .from("telemetry")
    .select("recorded_at, battery_pct")
    .eq("device_id", selectedDeviceId)
    .gte("recorded_at", sevenDaysAgo.toISOString())
    .not("battery_pct", "is", null)
    .order("recorded_at", { ascending: true })
    .limit(500);
  batteryRows = batteryData ?? [];

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

  // ── 4. Phase 2.1: Daily Light Integral — last 30 days ────────────────────
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  let dliHistory: DLIDataPoint[] = [];
  const { data: dliRows, error: dliError } = await supabaseAdmin
    .from("daily_dli")
    .select("day, dli_mol_per_m2, reading_count")
    .eq("device_id", selectedDeviceId)
    .gte("day", thirtyDaysAgo.toISOString().slice(0, 10))
    .order("day", { ascending: false })
    .limit(30);

  if (dliError) {
    console.error("Failed to fetch daily_dli view:", dliError);
  } else {
    dliHistory = (dliRows ?? []) as DLIDataPoint[];
  }

  // ── 4.5. Light telemetry history for photoperiod analysis (last 7 days) ───
  let lightHistory: { recorded_at: string; illuminance_lux: number }[] = [];
  const { data: lightRows, error: lightError } = await supabaseAdmin
    .from("telemetry")
    .select("recorded_at, illuminance_lux")
    .eq("device_id", selectedDeviceId)
    .gte("recorded_at", sevenDaysAgo.toISOString())
    .order("recorded_at", { ascending: true })
    .limit(3000);

  if (lightError) {
    console.warn("Failed to fetch light history from telemetry:", lightError.message);
  } else {
    lightHistory = (lightRows ?? []) as { recorded_at: string; illuminance_lux: number }[];
  }

  // ── 5. Phase 2.3: 7-day rolling VPD ──────────────────────────────────────
  let vpdHistory: VPDDataPoint[] = [];
  const { data: vpdRows, error: vpdError } = await supabaseAdmin
    .from("telemetry_with_vpd")
    .select("recorded_at, vpd_kpa, temperature_c, humidity_rh")
    .eq("device_id", selectedDeviceId)
    .gte("recorded_at", sevenDaysAgo.toISOString())
    .not("vpd_kpa", "is", null)
    .order("recorded_at", { ascending: false })
    .limit(5000);

  if (vpdError) {
    console.error("Failed to fetch vpd from telemetry_with_vpd:", vpdError.message);
  } else {
    vpdHistory = ((vpdRows ?? []) as VPDDataPoint[]).reverse();
  }

  // Thin VPD for the chart
  const sevenDaysAgoMs = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const vpd7Day = vpdHistory.filter(
    (d) => new Date(d.recorded_at).getTime() >= sevenDaysAgoMs
  );
  const thinFactor = Math.max(1, Math.floor(vpd7Day.length / 300));
  const vpdThinned = vpd7Day.filter((_, i) => i % thinFactor === 0);

  // 7-day avg for VPDChart badge
  const vpdRollingAvg =
    vpdThinned.length > 0
      ? vpdThinned.reduce((s, d) => s + d.vpd_kpa, 0) / vpdThinned.length
      : null;

  // ── 6. Phase 2.2 + 3: Soil drainage — 30-day moisture history ───────────
  let moistureHistory: { recorded_at: string; soil_moisture_raw: number; soil_moisture_pct?: number }[] = [];
  const { data: moistureRows, error: moistureError } = await supabaseAdmin
    .from("telemetry")
    .select("recorded_at, soil_moisture_raw, soil_moisture_pct")
    .eq("device_id", selectedDeviceId)
    .gte("recorded_at", thirtyDaysAgo.toISOString())
    .order("recorded_at", { ascending: false })
    .limit(5000);

  let rawMoistureData: { recorded_at: string; soil_moisture_raw: number; soil_moisture_pct?: number | null }[] | null = moistureRows;
  if (moistureError) {
    // If migration hasn't been run yet, soil_moisture_pct won't exist in telemetry table
    console.warn("soil_moisture_pct column not available yet, falling back to raw ADC:", moistureError.message);
    const { data: fallbackRows } = await supabaseAdmin
      .from("telemetry")
      .select("recorded_at, soil_moisture_raw")
      .eq("device_id", selectedDeviceId)
      .gte("recorded_at", thirtyDaysAgo.toISOString())
      .order("recorded_at", { ascending: false })
      .limit(5000);
    rawMoistureData = fallbackRows;
  }

  moistureHistory = (rawMoistureData ?? []).reverse().map((r) => ({
    recorded_at: r.recorded_at,
    soil_moisture_raw: r.soil_moisture_raw,
    soil_moisture_pct: r.soil_moisture_pct != null ? (r.soil_moisture_pct as number) : undefined,
  }));

  // ── 7. Deployment tracking — active deployment + history for this device ─
  let activeDeployment: Deployment | null = null;
  let deploymentHistory: Deployment[] = [];

  const { data: deploymentRows, error: deploymentError } = await supabaseAdmin
    .from("node_deployments")
    .select("*")
    .eq("device_id", selectedDeviceId)
    .order("started_at", { ascending: false });

  if (deploymentError) {
    console.warn("node_deployments table not found or error:", deploymentError.message);
  } else {
    deploymentHistory = (deploymentRows ?? []) as Deployment[];
    activeDeployment = deploymentHistory.find((d) => d.ended_at === null) ?? null;
  }

  // ── 8. Fetch precalculated microclimate profile for this device ──────────
  let microclimateProfile: PrecalculatedProfile | null = null;
  const { data: profileData } = await supabaseAdmin
    .from("node_microclimates")
    .select("*")
    .eq("device_id", selectedDeviceId)
    .maybeSingle();

  if (profileData) {
    microclimateProfile = profileData as PrecalculatedProfile;
  }


  // ── 9. Fetch device settings for calibration ──────────────────────────────
  let deviceSettings = null;
  const { data: settingsData } = await supabaseAdmin
    .from("device_settings")
    .select("*")
    .eq("device_id", selectedDeviceId)
    .maybeSingle();
  
  if (settingsData) {
    deviceSettings = settingsData;
  }

  return (
    <DashboardClient
      key={selectedDeviceId}
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
      deviceSettings={deviceSettings}
      selectedDeviceId={selectedDeviceId}
      availableNodes={availableNodes}
      nodeSummaries={nodeSummaries}
      lightHistory={lightHistory}
    />
  );
}
