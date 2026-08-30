-- =============================================================================
-- seed.sql — Local development seed data for ViabilityNode
-- Populates the telemetry table with representative readings so the
-- Next.js dashboard has data to render without needing a live ESP32 node.
-- This file is NEVER applied to production; it runs only via:
--   npx supabase db seed  (or automatically when `supabase start` runs)
-- =============================================================================

INSERT INTO telemetry (
    device_id, recorded_at,
    illuminance_lux, temperature_c, humidity_rh, pressure_hpa,
    soil_moisture_raw, battery_v, battery_pct
) VALUES
    ('plant_node_01', NOW() - INTERVAL '3 hours',  3200.50, 29.10, 68.40, 1011.20, 1750, 4.15, 94),
    ('plant_node_01', NOW() - INTERVAL '2 hours',  4850.00, 30.55, 66.00, 1010.90, 1680, 4.12, 91),
    ('plant_node_01', NOW() - INTERVAL '1 hour',   6100.25, 31.71, 67.68, 1009.73, 1244, 4.10, 89),
    ('plant_node_01', NOW() - INTERVAL '30 minutes', 4200.00, 32.00, 64.50, 1010.00, 1300, 4.08, 86),
    ('plant_node_01', NOW(),                         1800.75, 30.20, 70.10, 1011.50, 1820, 4.05, 83);
