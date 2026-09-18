-- Migration: Add 30-day aggregate fields to node_microclimates

ALTER TABLE public.node_microclimates
ADD COLUMN IF NOT EXISTS avg_v_grav numeric,
ADD COLUMN IF NOT EXISTS avg_v_dry numeric,
ADD COLUMN IF NOT EXISTS avg_phase2_duration numeric,
ADD COLUMN IF NOT EXISTS total_events_analyzed integer DEFAULT 0;
