-- =============================================================================
-- Migration: 20260919040000_unify_calibration.sql
-- Description: Unifies hardcoded soil moisture calibration limits (1920/880).
--              Updates views to use uniform calibration across the stack.
-- =============================================================================

-- 1. Update telemetry_with_moisture to use 1920 (dry) and 880 (wet)
DROP VIEW IF EXISTS telemetry_with_moisture;
CREATE OR REPLACE VIEW telemetry_with_moisture AS
SELECT
    *,
    ROUND(
        GREATEST(0, LEAST(100,
            ((1920.0 - soil_moisture_raw) / (1920.0 - 880.0)) * 100.0
        ))::NUMERIC,
        2
    ) AS moisture_pct,
    ROUND(
        GREATEST(0.0,
            (0.61078 * EXP((17.27 * (temperature_c + CASE WHEN illuminance_lux > 1000 THEN -2.0 ELSE 0.0 END)) / ((temperature_c + CASE WHEN illuminance_lux > 1000 THEN -2.0 ELSE 0.0 END) + 237.3)))
            -
            (0.61078 * EXP((17.27 * temperature_c) / (temperature_c + 237.3)) * (humidity_rh / 100.0))
        )::NUMERIC,
        3
    ) AS vpd_kpa_calc
FROM telemetry;

-- 2. Update daily_telemetry_summary to include avg_moisture_pct using the same calibration
DROP VIEW IF EXISTS public.daily_telemetry_summary;
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
            GREATEST(0, LEAST(100,
                ((1920.0 - soil_moisture_raw) / (1920.0 - 880.0)) * 100.0
            ))
        )::NUMERIC,
        2
    )::FLOAT AS avg_moisture_pct,
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
