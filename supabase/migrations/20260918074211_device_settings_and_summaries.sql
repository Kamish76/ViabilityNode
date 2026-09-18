-- =============================================================================
-- Migration: 20260918074211_device_settings_and_summaries.sql
-- Description: Centralize device settings (calibration) and pre-calculate daily summaries.
-- =============================================================================

-- 1. Device Settings table
CREATE TABLE IF NOT EXISTS public.device_settings (
    device_id TEXT PRIMARY KEY,
    dry_limit INTEGER NOT NULL DEFAULT 1900,
    wet_limit INTEGER NOT NULL DEFAULT 1000,
    plant_type TEXT,
    placement_type TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Enable RLS (allow all for prototyping)
ALTER TABLE public.device_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on device_settings" ON public.device_settings FOR ALL USING (true);

-- Seed device settings for the default seed device
INSERT INTO public.device_settings (device_id, dry_limit, wet_limit)
VALUES ('plant_node_01', 1900, 1000)
ON CONFLICT (device_id) DO NOTHING;


-- 2. Daily Summary view
CREATE OR REPLACE VIEW public.daily_telemetry_summary AS
SELECT
    device_id,
    DATE(recorded_at AT TIME ZONE 'UTC') AS day,
    COUNT(*) AS reading_count,
    ROUND(AVG(temperature_c)::NUMERIC, 2)::FLOAT AS avg_temperature_c,
    ROUND(AVG(humidity_rh)::NUMERIC, 2)::FLOAT AS avg_humidity_rh,
    ROUND(AVG(illuminance_lux)::NUMERIC, 2)::FLOAT AS avg_illuminance_lux,
    ROUND(AVG(soil_moisture_raw)::NUMERIC, 2)::FLOAT AS avg_soil_moisture_raw,
    ROUND(
        AVG(
            GREATEST(0.0,
                (0.61078 * EXP((17.27 * (temperature_c + CASE WHEN illuminance_lux > 1000 THEN -2.0 ELSE 0.0 END)) / ((temperature_c + CASE WHEN illuminance_lux > 1000 THEN -2.0 ELSE 0.0 END) + 237.3)))
                -
                (0.61078 * EXP((17.27 * temperature_c) / (temperature_c + 237.3)) * (humidity_rh / 100.0))
            )
        )::NUMERIC,
        3
    )::FLOAT AS avg_vpd_kpa
FROM public.telemetry
GROUP BY device_id, DATE(recorded_at AT TIME ZONE 'UTC')
ORDER BY day DESC;
