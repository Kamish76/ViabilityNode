import { supabaseAdmin } from "@/lib/supabase";
import { DashboardClient, TelemetryData, BatterySnapshot } from "./DashboardClient";

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
  // Fetch one reading per day (the earliest per day) over the last 7 days.
  // We pull raw records and group client-side to keep the query simple.
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

  const { data: batteryRows } = await supabaseAdmin
    .from("telemetry")
    .select("recorded_at, battery_pct")
    .gte("recorded_at", sevenDaysAgo.toISOString())
    .not("battery_pct", "is", null)
    .order("recorded_at", { ascending: true })
    .limit(500); // enough granularity without over-fetching

  // Deduplicate to one sample per calendar day (earliest reading of each day)
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

  return (
    <DashboardClient
      initialLogs={dataToUse ?? []}
      batteryHistory={batteryHistory}
    />
  );
}
