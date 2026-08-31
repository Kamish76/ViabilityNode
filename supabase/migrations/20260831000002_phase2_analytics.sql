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
-- We approximate Δt as the average interval between readings for the day.
-- Supabase/PostgreSQL approach: sum PPFD readings, multiply by avg interval.
-- For n readings spaced evenly across a day, avg interval ≈ 86400 / n seconds.
-- This gives:  DLI ≈ (Σ PPFD × 86400/n) / 1,000,000
--            = (Σ PPFD / n) × 86400 / 1,000,000
--            = avg(PPFD) × 86400 / 1,000,000
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW daily_dli AS
SELECT
    device_id,
    DATE(recorded_at AT TIME ZONE 'UTC') AS day,
    COUNT(*)                              AS reading_count,
    ROUND(AVG(illuminance_lux * 0.0185)::NUMERIC, 4) AS avg_ppfd,
    -- DLI: avg_ppfd × seconds_in_day / 1,000,000
    ROUND(
        (AVG(illuminance_lux * 0.0185) * 86400.0 / 1000000.0)::NUMERIC,
        4
    ) AS dli_mol_per_m2
FROM telemetry
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
        (0.61078 * EXP((17.27 * temperature_c) / (temperature_c + 237.3)))
        * (1.0 - (humidity_rh / 100.0)),
        3
    ) AS vpd_kpa_calc
FROM telemetry;
