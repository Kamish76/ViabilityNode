-- Migration: Add 7-day aggregate fields to node_microclimates

ALTER TABLE public.node_microclimates
ADD COLUMN IF NOT EXISTS avg_v_grav_7d numeric,
ADD COLUMN IF NOT EXISTS avg_v_dry_7d numeric,
ADD COLUMN IF NOT EXISTS avg_phase2_duration_7d numeric,
ADD COLUMN IF NOT EXISTS total_events_analyzed_7d integer DEFAULT 0,
ADD COLUMN IF NOT EXISTS drain_class_7d text DEFAULT 'unknown';
 