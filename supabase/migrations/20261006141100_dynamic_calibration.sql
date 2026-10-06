-- =============================================================================
-- Migration: 20261006141100_dynamic_calibration.sql
-- Description: Dynamic, node-specific capacitive soil moisture sensor calibration
--              without altering historical telemetry data.
-- =============================================================================

-- 1. Create a table to trail calibration changes
CREATE TABLE IF NOT EXISTS public.calibration_history (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    device_id TEXT NOT NULL,
    dry_limit INTEGER NOT NULL,
    wet_limit INTEGER NOT NULL,
    changed_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- Ensure RLS is active
ALTER TABLE public.calibration_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow read access to authenticated users" ON public.calibration_history FOR SELECT TO authenticated USING (true);
CREATE POLICY "Allow all operations for service role" ON public.calibration_history FOR ALL USING (auth.jwt() ->> 'role' = 'service_role');

-- 2. Add trigger to automatically log changes in device_settings
-- Note: SECURITY DEFINER ensures the audit trigger can write to calibration_history
-- even when called by the client anon role.
CREATE OR REPLACE FUNCTION log_calibration_change()
RETURNS TRIGGER 
SECURITY DEFINER
AS $$
BEGIN
  -- Log the initial setting or if limits have changed
  IF (TG_OP = 'INSERT') OR 
     (TG_OP = 'UPDATE' AND (NEW.dry_limit IS DISTINCT FROM OLD.dry_limit OR NEW.wet_limit IS DISTINCT FROM OLD.wet_limit)) THEN
    INSERT INTO public.calibration_history (device_id, dry_limit, wet_limit)
    VALUES (NEW.device_id, NEW.dry_limit, NEW.wet_limit);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_log_calibration_change ON public.device_settings;
CREATE TRIGGER trg_log_calibration_change
AFTER INSERT OR UPDATE ON public.device_settings
FOR EACH ROW
EXECUTE FUNCTION log_calibration_change();

-- 3. Add physical column to store time-locked calibration result in telemetry
ALTER TABLE public.telemetry 
ADD COLUMN IF NOT EXISTS soil_moisture_pct NUMERIC(5,2);

-- 4. Backfill existing data using the agreed 1920/880 default fallback
UPDATE public.telemetry
SET soil_moisture_pct = ROUND(
    GREATEST(0, LEAST(100,
        ((1920.0 - soil_moisture_raw) / (1920.0 - 880.0)) * 100.0
    ))::NUMERIC, 2
)
WHERE soil_moisture_pct IS NULL;

-- 5. Create a trigger to calculate moisture pct dynamically on future inserts
CREATE OR REPLACE FUNCTION set_calibrated_moisture()
RETURNS TRIGGER 
SECURITY DEFINER
AS $$
DECLARE
  d_limit NUMERIC;
  w_limit NUMERIC;
BEGIN
  -- Fetch current calibration for this specific node
  SELECT dry_limit, wet_limit INTO d_limit, w_limit 
  FROM public.device_settings 
  WHERE device_id = NEW.device_id;
  
  -- Fallback defaults to 1920/880 if no settings found
  d_limit := COALESCE(d_limit, 1920); 
  w_limit := COALESCE(w_limit, 880);
  
  IF d_limit = w_limit THEN
    NEW.soil_moisture_pct := 0;
  ELSE
    NEW.soil_moisture_pct := ROUND(
        GREATEST(0.0, LEAST(100.0, ((d_limit - NEW.soil_moisture_raw) / (d_limit - w_limit)) * 100.0))::NUMERIC, 
        2
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_set_calibrated_moisture ON public.telemetry;
CREATE TRIGGER trg_set_calibrated_moisture
BEFORE INSERT ON public.telemetry
FOR EACH ROW
EXECUTE FUNCTION set_calibrated_moisture();

-- 6. Recreate Views to expose new soil_moisture_pct column
-- In PostgreSQL, views defined with SELECT * do not auto-expand when new columns are added.
DROP VIEW IF EXISTS public.telemetry_with_vpd;
CREATE OR REPLACE VIEW public.telemetry_with_vpd AS
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
    ROUND(AVG(soil_moisture_pct)::NUMERIC, 2)::FLOAT AS avg_moisture_pct,
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
