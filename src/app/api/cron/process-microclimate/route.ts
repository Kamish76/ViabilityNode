import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { analyzePiecewiseDrainage } from '@/lib/piecewiseDrainage';

// In-memory rate limiting map for manual recalculations
// Map of device_id -> timestamp (ms)
const rateLimitMap = new Map<string, number>();
const RATE_LIMIT_MS = 60 * 1000; // 1 minute per device

function classifyDLI(avg: number | null): string {
  if (avg === null) return "unknown";
  if (avg < 5)      return "low";
  if (avg <= 15)    return "moderate";
  return "high";
}

function classifyVPD(avg: number | null): string {
  if (avg === null) return "unknown";
  if (avg < 0.4)    return "low";
  if (avg <= 1.6)   return "optimal";
  return "high";
}

export async function POST(req: Request) {
  return handleRequest(req);
}

export async function GET(req: Request) {
  return handleRequest(req);
}

async function handleRequest(req: Request) {
  try {
    const url = new URL(req.url);
    const deviceId = url.searchParams.get('device_id');
    const authHeader = req.headers.get('authorization');
    
    // For Vercel Cron, you can verify a CRON_SECRET if set.
    // If not set, we'll allow it for now, but require device_id for manual triggers.
    const isCron = authHeader === `Bearer ${process.env.CRON_SECRET}` || req.headers.get('user-agent')?.includes('vercel-cron');

    if (!isCron && !deviceId) {
      return NextResponse.json({ error: 'Unauthorized or missing device_id' }, { status: 401 });
    }

    if (deviceId) {
      const lastRequest = rateLimitMap.get(deviceId);
      if (lastRequest && Date.now() - lastRequest < RATE_LIMIT_MS) {
        return NextResponse.json({ error: 'Rate limit exceeded. Please wait 1 minute.' }, { status: 429 });
      }
      rateLimitMap.set(deviceId, Date.now());
    }

    // Determine which devices to process
    let devicesToProcess: string[] = [];
    if (deviceId) {
      devicesToProcess = [deviceId];
    } else {
      // Find all active devices (those with at least one active deployment)
      const { data: activeDeployments, error: depError } = await supabaseAdmin
        .from('node_deployments')
        .select('device_id')
        .is('ended_at', null);

      if (depError) throw depError;
      devicesToProcess = Array.from(new Set((activeDeployments || []).map(d => d.device_id)));
    }

    if (devicesToProcess.length === 0) {
      return NextResponse.json({ message: 'No active devices to process.' });
    }

    // Scope to the end of yesterday (midnight today)
    const endOfYesterday = new Date();
    endOfYesterday.setHours(0, 0, 0, 0);
    const endOfYesterdayIso = endOfYesterday.toISOString();
    const endOfYesterdayDay = endOfYesterdayIso.slice(0, 10);

    const thirtyDaysAgo = new Date(endOfYesterday);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const thirtyDaysAgoIso = thirtyDaysAgo.toISOString();
    const thirtyDaysAgoDay = thirtyDaysAgoIso.slice(0, 10);

    const results = [];

    for (const dId of devicesToProcess) {
      // 1. Fetch DLI (30 days)
      const { data: dliRows } = await supabaseAdmin
        .from('daily_dli')
        .select('dli_mol_per_m2')
        .eq('device_id', dId)
        .gte('day', thirtyDaysAgoDay)
        .lt('day', endOfYesterdayDay);
      
      const dliHistory = dliRows || [];
      const dliAvg = dliHistory.length > 0
        ? dliHistory.reduce((sum, row) => sum + row.dli_mol_per_m2, 0) / dliHistory.length
        : null;

      // 2. Fetch VPD (30 days)
      const { data: vpdRows } = await supabaseAdmin
        .from('telemetry_with_vpd')
        .select('vpd_kpa')
        .eq('device_id', dId)
        .gte('recorded_at', thirtyDaysAgoIso)
        .lt('recorded_at', endOfYesterdayIso)
        .not('vpd_kpa', 'is', null);
      
      const vpdHistory = vpdRows || [];
      const vpdAvg = vpdHistory.length > 0
        ? vpdHistory.reduce((sum, row) => sum + row.vpd_kpa, 0) / vpdHistory.length
        : null;

      // 3. Fetch Moisture for piecewise drainage (30 days)
      const { data: moistureRows } = await supabaseAdmin
        .from('telemetry')
        .select('recorded_at, soil_moisture_raw')
        .eq('device_id', dId)
        .gte('recorded_at', thirtyDaysAgoIso)
        .lt('recorded_at', endOfYesterdayIso)
        .order('recorded_at', { ascending: true });

      const drainageInput = (moistureRows || []).map(r => ({
        recorded_at: r.recorded_at,
        moisture_pct: r.soil_moisture_raw,
      }));

      // Apply fixed hardware calibration limits (1920=dry, 880=wet)
      const DRY_LIMIT = 1920;
      const WET_LIMIT = 880;
      const calibratedMoisture = drainageInput.map(d => {
        let pct = ((DRY_LIMIT - d.moisture_pct) / (DRY_LIMIT - WET_LIMIT)) * 100;
        return {
          recorded_at: d.recorded_at,
          moisture_pct: Math.max(0, Math.min(100, pct)),
        };
      });

      const piecewise = analyzePiecewiseDrainage(calibratedMoisture);

      // Calculate days of data
      const dliDays = dliHistory.length;
      const moistureDays = calibratedMoisture.length > 0
        ? Math.round(
            (new Date(calibratedMoisture[calibratedMoisture.length - 1].recorded_at).getTime() -
              new Date(calibratedMoisture[0].recorded_at).getTime()) /
              86400000
          )
        : 0;
      const daysOfData = Math.max(dliDays, moistureDays, 1);

      // Upsert to node_microclimates
      const record = {
        device_id: dId,
        dli_avg: dliAvg,
        dli_class: classifyDLI(dliAvg),
        vpd_avg: vpdAvg,
        vpd_class: classifyVPD(vpdAvg),
        v_grav: piecewise.cachedVGrav ?? piecewise.vGrav,
        v_dry: piecewise.cachedVDry ?? piecewise.vDry,
        drain_class: piecewise.cachedDrainClass ?? piecewise.drainClass ?? 'unknown',
        retention_hours: piecewise.retentionHours,
        is_historical_rate: piecewise.isHistoricalRate || false,
        last_watered_at: piecewise.lastWateringAt,
        current_phase: piecewise.currentPhase,
        days_of_data: daysOfData
      };

      const { error: upsertError } = await supabaseAdmin
        .from('node_microclimates')
        .upsert(record, { onConflict: 'device_id' });

      if (upsertError) {
        console.error(`Failed to upsert microclimate for ${dId}:`, upsertError);
      } else {
        results.push(record);
      }
    }

    return NextResponse.json({ message: 'Success', processed: results.length, results });

  } catch (err) {
    console.error('[cron/process-microclimate] Error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
