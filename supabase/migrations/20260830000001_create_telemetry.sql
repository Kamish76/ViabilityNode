-- =============================================================================
-- Migration: 20260830000001_create_telemetry.sql
-- Description: Baseline schema for the ViabilityNode telemetry pipeline.
--              Creates the core telemetry table, time-series index,
--              automated VPD view, and battery monitoring columns.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Telemetry table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS telemetry (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id        TEXT        NOT NULL,
    recorded_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Environmental sensors (VEML7700, AHT20, BMP280)
    illuminance_lux  NUMERIC(10, 2) NOT NULL,
    temperature_c    NUMERIC(5,  2) NOT NULL,
    humidity_rh      NUMERIC(5,  2) NOT NULL,
    pressure_hpa     NUMERIC(7,  2) NOT NULL,

    -- Capacitive soil sensor (D0/A0, GPIO D1-switched power)
    soil_moisture_raw INTEGER     NOT NULL,

    -- Battery monitor — external 2:1 voltage divider on D2/A2
    --   Two matched 205 kΩ resistors (0603 SMD, marked 30D)
    --   Total divider impedance: 410 kΩ  (~10.24 µA parasitic drain at 4.20 V)
    --   pin_voltage = battery_voltage / 2  →  max 2.10 V at full charge (safe for 3.3 V GPIO)
    --   NULL is allowed to remain backward-compatible with nodes that predate this circuit.
    battery_v        NUMERIC(4,  2),   -- Actual cell voltage (V); 3.30–4.20 V typical range
    battery_pct      INTEGER           -- 0–100; linear interpolation across 3.30 V–4.20 V
);

-- -----------------------------------------------------------------------------
-- 2. Time-series index
-- Optimises ORDER BY recorded_at DESC and per-device range queries.
-- -----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_telemetry_device_time
    ON telemetry (device_id, recorded_at DESC);

-- -----------------------------------------------------------------------------
-- 3. Vapor Pressure Deficit (VPD) computed view
--
-- Formula:
--   VP_sat  = 0.61078 × exp( (17.27 × T) / (T + 237.3) )   [kPa]
--   VP_act  = VP_sat × (RH / 100)
--   VPD     = VP_sat - VP_act  =  VP_sat × (1 - RH/100)
--
-- Thresholds (approximate, tropical reference):
--   VPD < 0.4 kPa  → Low VPD; fungal / stagnation risk
--   VPD 0.4–1.6    → Optimal transpiration window
--   VPD > 1.6 kPa  → High VPD; dehydration / stomatal closure risk
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW telemetry_with_vpd AS
SELECT
    *,
    ROUND(
        (0.61078 * EXP((17.27 * temperature_c) / (temperature_c + 237.3)))
        * (1.0 - (humidity_rh / 100.0)),
        3
    ) AS vpd_kpa
FROM telemetry;
