import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { DeploymentPayload } from '../route';

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    if (!id) {
      return NextResponse.json(
        { error: 'deployment id is required.' },
        { status: 400 }
      );
    }

    const payload: Partial<DeploymentPayload> = await req.json();

    const updateData: Record<string, unknown> = {};

    if (payload.placement_type !== undefined) updateData.placement_type = payload.placement_type;
    if (payload.label !== undefined) updateData.label = payload.label;
    if (payload.notes !== undefined) updateData.notes = payload.notes;
    if (payload.plant_type !== undefined) updateData.plant_type = payload.plant_type;
    if (payload.has_drainage !== undefined) updateData.has_drainage = payload.has_drainage;
    
    // Pot specifics
    if (payload.pot_material !== undefined) updateData.pot_material = payload.pot_material;
    if (payload.pot_size_cm !== undefined) updateData.pot_size_cm = payload.pot_size_cm;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'No fields to update.' }, { status: 400 });
    }

    const { data, error } = await supabaseAdmin
      .from('node_deployments')
      .update(updateData)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('[deployments] PATCH error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!data) {
      return NextResponse.json(
        { error: 'Deployment not found.' },
        { status: 404 }
      );
    }

    return NextResponse.json({ status: 'updated', deployment: data });
  } catch (err) {
    console.error('[deployments] PATCH error:', err);
    return NextResponse.json(
      { error: 'Malformed JSON or internal server error.' },
      { status: 500 }
    );
  }
}
