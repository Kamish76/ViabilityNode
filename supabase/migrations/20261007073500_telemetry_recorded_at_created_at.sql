-- =============================================================================
-- Migration: 20261007073500_telemetry_recorded_at_created_at.sql
-- Description: Add recorded_at & created_at timestamp separation on telemetry table,
--              backfill legacy NULL recorded_at values, time-series index,
--              and recreate dependent views to include created_at.
-- =============================================================================

-- 1. Ensure recorded_at and created_at columns exist
ALTER TABLE telemetry 
ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Ensure recorded_at has default NOW() for backward compatibility if omitted
ALTER TABLE telemetry 
ALTER COLUMN recorded_at SET DEFAULT NOW();

-- 2. Backfill recorded_at on existing rows if null
UPDATE telemetry 
SET recorded_at = NOW() 
WHERE recorded_at IS NULL;

-- 3. Index for time-series queries (DLI / VPD)
CREATE INDEX IF NOT EXISTS idx_telemetry_device_recorded_at 
ON telemetry (device_id, recorded_at DESC);

-- 4. Recreate dependent views to expose created_at
DROP VIEW IF EXISTS public.telemetry_with_vpd;
CREATE VIEW public.telemetry_with_vpd AS
SELECT
    *,
    ROUND(
        GREATEST(0.0,
            (0.61078 * EXP((17.27 * (temperature_c + CASE WHEN illuminance_lux > 1000 THEN -2.0 ELSE 0.0 END)) / ((temperature_c + CASE WHEN illuminance_lux > 1000 THEN -2.0 ELSE 0.0 END) + 237.3)))
            -
            (0.61078 * EXP((17.27 * temperature_c) / (temperature_c + 237.3)) * (humidity_rh / 100.0))
        )::NUMERIC,
        3
    ) AS vpd_kpa
FROM public.telemetry;

DROP VIEW IF EXISTS public.telemetry_with_moisture;
CREATE VIEW public.telemetry_with_moisture AS
SELECT
    *,
    soil_moisture_pct AS moisture_pct,
    ROUND(
        GREATEST(0.0,
            (0.61078 * EXP((17.27 * (temperature_c + CASE WHEN illuminance_lux > 1000 THEN -2.0 ELSE 0.0 END)) / ((temperature_c + CASE WHEN illuminance_lux > 1000 THEN -2.0 ELSE 0.0 END) + 237.3)))
            -
            (0.61078 * EXP((17.27 * temperature_c) / (temperature_c + 237.3)) * (humidity_rh / 100.0))
        )::NUMERIC,
        3
    ) AS vpd_kpa_calc
FROM public.telemetry;
