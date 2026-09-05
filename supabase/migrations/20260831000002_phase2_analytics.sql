-- =============================================================================
-- Migration: 20260831000002_phase2_analytics.sql
-- Description: Phase 2 biophysical analytics views.
--              1. daily_dli     — Daily Light Integral per device per day
--              2. vpd_7day      — 7-day rolling VPD samples (used for rolling avg)
--              3. soil_drainage — Convenience view exposing calibrated-ready data
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Daily Light Integral (DLI) view
--
-- Formula chain:
--   PPFD (µmol/m²/s) = illuminance_lux × 0.0185   (sunlight coefficient)
--   DLI (mol/m²/day) = Σ(PPFD × Δt_seconds) ÷ 1,000,000
--
-- Accurate trapezoidal integration:
--   We calculate the time difference (Δt) from the previous reading.
--   If the gap is excessively large (> 2 hours), we cap it to avoid artificially
--   inflating DLI during offline periods or node reboots.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW daily_dli AS
WITH lagged AS (
    SELECT 
        device_id,
        recorded_at,
        (illuminance_lux * 0.0185) AS ppfd,
        LAG(illuminance_lux * 0.0185) OVER (PARTITION BY device_id ORDER BY recorded_at) AS prev_ppfd,
        LAG(recorded_at) OVER (PARTITION BY device_id ORDER BY recorded_at) AS prev_time
    FROM telemetry
)
SELECT 
    device_id,
    DATE(recorded_at AT TIME ZONE 'UTC') AS day,
    COUNT(*) AS reading_count,
    ROUND(AVG(ppfd)::NUMERIC, 4) AS avg_ppfd,
    ROUND(
        SUM(
            ((ppfd + COALESCE(prev_ppfd, ppfd)) / 2.0) * 
            LEAST(EXTRACT(EPOCH FROM (recorded_at - COALESCE(prev_time, recorded_at))), 7200)
        ) / 1000000.0,
        4
    ) AS dli_mol_per_m2
FROM lagged
GROUP BY device_id, DATE(recorded_at AT TIME ZONE 'UTC')
ORDER BY day DESC;

-- -----------------------------------------------------------------------------
-- 2. Drainage-ready view: telemetry + calibrated moisture %
-- Calibration constants (dry=1910, wet=1100) are baked in as defaults.
-- These match the frontend DEFAULT_CALIBRATION and can be adjusted when
-- the real wet/dry limits are captured.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW telemetry_with_moisture AS
SELECT
    *,
    ROUND(
        GREATEST(0, LEAST(100,
            ((1910.0 - soil_moisture_raw) / (1910.0 - 1100.0)) * 100.0
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
