-- =============================================================================
-- Migration: 20260901000003_deployment_tracking.sql
-- Description: Deployment tracking for ViabilityNode.
--              1. node_deployments — tracks each placement of a node
--                 (pot, raised bed, flower bed, ground, indoor, greenhouse)
--              2. telemetry_with_deployment — enriches telemetry with placement context
--
-- Context: The node has no GPS. Every time the user physically moves the node,
-- they log a new deployment from the dashboard. This creates a timestamped
-- timeline of deployments that partitions sensor data into context-aware segments.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. node_deployments table
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS node_deployments (
    id               BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id        TEXT        NOT NULL,
    started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    ended_at         TIMESTAMPTZ,           -- NULL = currently active deployment

    -- Placement context
    placement_type   TEXT        NOT NULL DEFAULT 'pot'
        CHECK (placement_type IN (
            'pot', 'raised_bed', 'flower_bed', 'ground', 'indoor', 'greenhouse'
        )),

    -- Human-readable label & notes
    label            TEXT,                   -- e.g. "Big terracotta pot", "Front yard bed"
    notes            TEXT,                   -- e.g. "Testing drainage with new soil mix"

    -- Pot-specific metadata (NULL for non-pot placements)
    pot_material     TEXT
        CHECK (pot_material IS NULL OR pot_material IN (
            'terracotta', 'plastic', 'ceramic', 'fabric', 'concrete', 'metal', 'wood'
        )),
    pot_size_cm      INTEGER,               -- diameter in cm
    has_drainage     BOOLEAN DEFAULT TRUE
);

-- Fast lookup: active deployment per device, and recent deployments
CREATE INDEX IF NOT EXISTS idx_deployments_device_active
    ON node_deployments (device_id, started_at DESC);

-- Partial index: quickly find the one active deployment per device
CREATE INDEX IF NOT EXISTS idx_deployments_active
    ON node_deployments (device_id)
    WHERE ended_at IS NULL;

-- -----------------------------------------------------------------------------
-- 2. telemetry_with_deployment view
--
-- Enriches each telemetry reading with deployment context by joining on
-- device_id and time range. Uses LEFT JOIN so telemetry without a matching
-- deployment still appears (placement columns will be NULL).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE VIEW telemetry_with_deployment AS
SELECT
    t.*,
    d.id             AS deployment_id,
    d.placement_type,
    d.label          AS deployment_label,
    d.notes          AS deployment_notes,
    d.pot_material,
    d.pot_size_cm,
    d.has_drainage   AS pot_has_drainage,
    d.started_at     AS deployment_started_at,
    d.ended_at       AS deployment_ended_at
FROM telemetry t
LEFT JOIN node_deployments d
    ON  t.device_id = d.device_id
    AND t.recorded_at >= d.started_at
    AND (d.ended_at IS NULL OR t.recorded_at < d.ended_at);
