import { supabaseAdmin } from "@/lib/supabase";
import { DashboardClient, TelemetryData } from "./DashboardClient";

// Opt out of static rendering so we fetch fresh data on reload
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  // Fetch the latest 50 records from the view (which includes vpd_kpa)
  // If the view doesn't exist yet, this might fail, so we fallback to the table.
  const { data: logs, error } = await supabaseAdmin
    .from("telemetry_with_vpd")
    .select("*")
    .order("recorded_at", { ascending: false })
    .limit(50);
  
  let dataToUse = logs as TelemetryData[] | null;

  if (error) {
    console.warn("View telemetry_with_vpd not found or error, trying telemetry table:", error);
    // Fallback to regular table
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

  // Ensure dataToUse is at least an empty array if null
  const initialLogs = dataToUse || [];

  return (
    <DashboardClient initialLogs={initialLogs} />
  );
}
