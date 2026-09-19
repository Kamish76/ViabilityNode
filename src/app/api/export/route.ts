import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────────────

interface ExportMeta {
  device_id: string | null;
  exported_at: string;
  range_days: number;
  schema_version: string;
}

interface DaySummary {
  temp: number;
  humidity: number;
  vpd: number;
  light: number;
  moisture_pct: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function computeDayAvg(rows: Record<string, unknown>[]): DaySummary | null {
  if (rows.length === 0) return null;
  let temp = 0, hum = 0, vpd = 0, lux = 0, moisture = 0;
  for (const r of rows) {
    temp += r.temperature_c as number;
    hum += r.humidity_rh as number;
    lux += r.illuminance_lux as number;
    moisture += r.soil_moisture_raw as number;
    const eSat = 0.61078 * Math.exp((17.27 * (r.temperature_c as number)) / ((r.temperature_c as number) + 237.3));
    vpd += eSat * (1 - (r.humidity_rh as number) / 100);
  }
  const avgMoistureRaw = moisture / rows.length;
  let moisturePct = ((1920.0 - avgMoistureRaw) / (1920.0 - 880.0)) * 100.0;
  moisturePct = Math.max(0, Math.min(100, moisturePct));

  return {
    temp: +(temp / rows.length).toFixed(2),
    humidity: +(hum / rows.length).toFixed(2),
    vpd: +(vpd / rows.length).toFixed(3),
    light: +(lux / rows.length).toFixed(2),
    moisture_pct: +moisturePct.toFixed(1),
  };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

// ── OPTIONS (CORS preflight) ───────────────────────────────────────────────────

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

// ── GET /api/export ────────────────────────────────────────────────────────────
// Returns a comprehensive JSON snapshot of all project data for the last 30 days.
// Designed for LLM consumption, analytics tools, or any programmatic data pull.

export async function GET() {
  const errors: string[] = [];

  try {
    // ── 1. Discover device_id from most recent telemetry ───────────────────
    const { data: latestRow, error: latestError } = await supabaseAdmin
      .from('telemetry')
      .select('device_id')
      .order('recorded_at', { ascending: false })
      .limit(1)
      .single();

    if (latestError || !latestRow) {
      return NextResponse.json(
        { error: 'No telemetry data found. Is the node reporting?' },
        { status: 404, headers: CORS_HEADERS }
      );
    }

    const deviceId = latestRow.device_id as string;
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysIso = thirtyDaysAgo.toISOString();
    const thirtyDaysDate = thirtyDaysIso.slice(0, 10);

    // ── 2. Fetch all data domains in parallel ─────────────────────────────
    const [
      telemetryResult,
      deploymentsResult,
      dliResult,
      moistureResult,
      summaryResult,
    ] = await Promise.allSettled([
      // Telemetry with computed VPD (last 30 days, up to 5000 rows)
      supabaseAdmin
        .from('telemetry_with_vpd')
        .select('*')
        .eq('device_id', deviceId)
        .gte('recorded_at', thirtyDaysIso)
        .order('recorded_at', { ascending: false })
        .limit(5000),

      // All deployments for this device
      supabaseAdmin
        .from('node_deployments')
        .select('*')
        .eq('device_id', deviceId)
        .order('started_at', { ascending: false }),

      // Daily DLI for the last 30 days
      supabaseAdmin
        .from('daily_dli')
        .select('day, dli_mol_per_m2, reading_count')
        .eq('device_id', deviceId)
        .gte('day', thirtyDaysDate)
        .order('day', { ascending: false })
        .limit(30),

      // Moisture with calibrated % (last 30 days, up to 5000 rows)
      supabaseAdmin
        .from('telemetry_with_moisture')
        .select('recorded_at, soil_moisture_raw, moisture_pct, vpd_kpa_calc')
        .eq('device_id', deviceId)
        .gte('recorded_at', thirtyDaysIso)
        .order('recorded_at', { ascending: false })
        .limit(5000),

      // Recent telemetry for today/yesterday summary
      supabaseAdmin
        .from('telemetry')
        .select('recorded_at, temperature_c, humidity_rh, illuminance_lux, soil_moisture_raw')
        .eq('device_id', deviceId)
        .gte('recorded_at', new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString())
        .order('recorded_at', { ascending: false }),
    ]);

    // ── 3. Extract results (resilient — nulls on failure) ─────────────────

    let telemetry = null;
    if (telemetryResult.status === 'fulfilled') {
      if (telemetryResult.value.error) {
        errors.push(`telemetry: ${telemetryResult.value.error.message}`);
      } else {
        telemetry = telemetryResult.value.data;
      }
    } else {
      errors.push(`telemetry: ${telemetryResult.reason}`);
    }

    let deployments = null;
    if (deploymentsResult.status === 'fulfilled') {
      if (deploymentsResult.value.error) {
        errors.push(`deployments: ${deploymentsResult.value.error.message}`);
      } else {
        deployments = deploymentsResult.value.data;
      }
    } else {
      errors.push(`deployments: ${deploymentsResult.reason}`);
    }

    let daily_dli = null;
    if (dliResult.status === 'fulfilled') {
      if (dliResult.value.error) {
        errors.push(`daily_dli: ${dliResult.value.error.message}`);
      } else {
        daily_dli = dliResult.value.data;
      }
    } else {
      errors.push(`daily_dli: ${dliResult.reason}`);
    }

    let moisture = null;
    if (moistureResult.status === 'fulfilled') {
      if (moistureResult.value.error) {
        errors.push(`moisture: ${moistureResult.value.error.message}`);
      } else {
        moisture = moistureResult.value.data;
      }
    } else {
      errors.push(`moisture: ${moistureResult.reason}`);
    }

    // ── 4. Compute today vs yesterday summary ─────────────────────────────

    let summary: { today: DaySummary | null; yesterday: DaySummary | null } = {
      today: null,
      yesterday: null,
    };

    if (summaryResult.status === 'fulfilled' && !summaryResult.value.error) {
      const rows = summaryResult.value.data ?? [];
      const now = new Date();
      const todayStr = now.toISOString().slice(0, 10);
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      const yesterdayStr = yesterday.toISOString().slice(0, 10);

      const todayRows = rows.filter((r: Record<string, unknown>) =>
        (r.recorded_at as string).startsWith(todayStr)
      );
      const yesterdayRows = rows.filter((r: Record<string, unknown>) =>
        (r.recorded_at as string).startsWith(yesterdayStr)
      );

      summary = {
        today: computeDayAvg(todayRows),
        yesterday: computeDayAvg(yesterdayRows),
      };
    } else {
      errors.push(
        `summary: ${summaryResult.status === 'fulfilled' ? summaryResult.value.error?.message : summaryResult.reason}`
      );
    }

    // ── 5. Build the export payload ───────────────────────────────────────

    const meta: ExportMeta = {
      device_id: deviceId,
      exported_at: new Date().toISOString(),
      range_days: 30,
      schema_version: '1.0.0',
    };

    const payload: Record<string, unknown> = {
      meta,
      telemetry,
      deployments,
      daily_dli,
      moisture,
      summary,
    };

    // Only include _errors if something actually failed
    if (errors.length > 0) {
      payload._errors = errors;
    }

    return NextResponse.json(payload, {
      status: 200,
      headers: CORS_HEADERS,
    });
  } catch (err) {
    console.error('[export] API error:', err);
    return NextResponse.json(
      { error: 'Internal server error during export.' },
      { status: 500, headers: CORS_HEADERS }
    );
  }
}
