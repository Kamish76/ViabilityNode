import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────────
interface TelemetryPayload {
  device_id: string;
  recorded_at?: string;  // Optional ISO 8601 timestamp emitted by node RTC/NTP
  illuminance_lux: number;
  temperature_c: number;
  humidity_rh: number;
  pressure_hpa: number;
  soil_moisture_raw: number;
  battery_v?: number;    // External voltage-divider sense (2:1 ratio, 205kΩ+205kΩ)
  battery_pct?: number;  // Linear interpolation: 3.30V=0% → 4.20V=100%
}

// ── POST /api/telemetry ───────────────────────────────────────────────────
// Ingests JSON telemetry pushed from the ESP32 node and writes to Supabase.
export async function POST(req: Request) {
  try {
    const payload: TelemetryPayload = await req.json();

    const {
      device_id,
      recorded_at,
      illuminance_lux,
      temperature_c,
      humidity_rh,
      pressure_hpa,
      soil_moisture_raw,
      battery_v,
      battery_pct,
    } = payload;

    // ── Validation ─────────────────────────────────────────────────────────
    if (
      !device_id ||
      illuminance_lux === undefined ||
      temperature_c === undefined ||
      humidity_rh === undefined ||
      pressure_hpa === undefined ||
      soil_moisture_raw === undefined
    ) {
      return NextResponse.json(
        { error: 'Invalid payload schema — all required sensor fields must be present.' },
        { status: 400 }
      );
    }

    let validRecordedAt: string | undefined = undefined;
    if (recorded_at !== undefined && recorded_at !== null) {
      const parsedDate = new Date(recorded_at);
      if (isNaN(parsedDate.getTime())) {
        return NextResponse.json(
          { error: 'Invalid payload schema — recorded_at must be a valid ISO 8601 timestamp string.' },
          { status: 400 }
        );
      }
      validRecordedAt = parsedDate.toISOString();
    }

    // ── Insert into Supabase ───────────────────────────────────────────────
    // If recorded_at is provided by the node, persist that exact timestamp.
    // If omitted (legacy firmware), fallback to server current time to ensure non-null recorded_at.
    // created_at will automatically default to NOW() via PostgreSQL column default.
    const { data, error } = await supabaseAdmin.from('telemetry').insert([
      {
        device_id,
        illuminance_lux,
        temperature_c,
        humidity_rh,
        pressure_hpa,
        soil_moisture_raw,
        recorded_at: validRecordedAt ?? new Date().toISOString(),
        ...(battery_v !== undefined && { battery_v }),
        ...(battery_pct !== undefined && { battery_pct }),
      },
    ]);

    if (error) {
      console.error('[telemetry] Supabase insertion error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ status: 'success', inserted: data }, { status: 201 });
  } catch (err) {
    console.error('[telemetry] API error:', err);
    return NextResponse.json(
      { error: 'Malformed JSON or internal server error.' },
      { status: 500 }
    );
  }
}
