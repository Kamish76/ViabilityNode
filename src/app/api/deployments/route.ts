import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';

// ── Types ──────────────────────────────────────────────────────────────────
export interface DeploymentPayload {
  device_id: string;
  placement_type: 'pot' | 'raised_bed' | 'flower_bed' | 'ground' | 'indoor' | 'greenhouse';
  label?: string;
  notes?: string;
  pot_material?: string | null;
  pot_size_cm?: number | null;
  has_drainage?: boolean;
}

// ── GET /api/deployments?device_id=xxx ─────────────────────────────────────
// Returns all deployments for a device, active (ended_at IS NULL) first.
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const deviceId = searchParams.get('device_id');

    if (!deviceId) {
      return NextResponse.json(
        { error: 'device_id query parameter is required.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('node_deployments')
      .select('*')
      .eq('device_id', deviceId)
      .order('started_at', { ascending: false });

    if (error) {
      console.error('[deployments] Supabase query error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ deployments: data ?? [] });
  } catch (err) {
    console.error('[deployments] GET error:', err);
    return NextResponse.json(
      { error: 'Internal server error.' },
      { status: 500 }
    );
  }
}

// ── POST /api/deployments ──────────────────────────────────────────────────
// Creates a new deployment. Automatically ends the previous active deployment
// for the same device (if any) by setting ended_at = now().
export async function POST(req: Request) {
  try {
    const payload: DeploymentPayload = await req.json();

    const {
      device_id,
      placement_type,
      label,
      notes,
      pot_material,
      pot_size_cm,
      has_drainage,
    } = payload;

    // Validation
    if (!device_id || !placement_type) {
      return NextResponse.json(
        { error: 'device_id and placement_type are required.' },
        { status: 400 }
      );
    }

    const validTypes = ['pot', 'raised_bed', 'flower_bed', 'ground', 'indoor', 'greenhouse'];
    if (!validTypes.includes(placement_type)) {
      return NextResponse.json(
        { error: `Invalid placement_type. Must be one of: ${validTypes.join(', ')}` },
        { status: 400 }
      );
    }

    // End the current active deployment (if any)
    const { error: endError } = await supabaseAdmin
      .from('node_deployments')
      .update({ ended_at: new Date().toISOString() })
      .eq('device_id', device_id)
      .is('ended_at', null);

    if (endError) {
      console.error('[deployments] Error ending previous deployment:', endError);
      // Non-fatal — continue to create the new one
    }

    // Create the new deployment
    const insertData: Record<string, unknown> = {
      device_id,
      placement_type,
      ...(label !== undefined && { label }),
      ...(notes !== undefined && { notes }),
      ...(has_drainage !== undefined && { has_drainage }),
    };

    // Only include pot-specific fields for pot placements
    if (placement_type === 'pot') {
      if (pot_material !== undefined) insertData.pot_material = pot_material;
      if (pot_size_cm !== undefined) insertData.pot_size_cm = pot_size_cm;
    }

    const { data, error } = await supabaseAdmin
      .from('node_deployments')
      .insert([insertData])
      .select()
      .single();

    if (error) {
      console.error('[deployments] Supabase insertion error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ status: 'created', deployment: data }, { status: 201 });
  } catch (err) {
    console.error('[deployments] POST error:', err);
    return NextResponse.json(
      { error: 'Malformed JSON or internal server error.' },
      { status: 500 }
    );
  }
}

// ── PATCH /api/deployments ─────────────────────────────────────────────────
// Ends the current active deployment for a device (sets ended_at = now).
// Body: { device_id: string }
export async function PATCH(req: Request) {
  try {
    const { device_id } = await req.json();

    if (!device_id) {
      return NextResponse.json(
        { error: 'device_id is required.' },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from('node_deployments')
      .update({ ended_at: new Date().toISOString() })
      .eq('device_id', device_id)
      .is('ended_at', null)
      .select()
      .single();

    if (error) {
      console.error('[deployments] PATCH error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json(
        { error: 'No active deployment found for this device.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ status: 'ended', deployment: data });
  } catch (err) {
    console.error('[deployments] PATCH error:', err);
    return NextResponse.json(
      { error: 'Malformed JSON or internal server error.' },
      { status: 500 }
    );
  }
}
