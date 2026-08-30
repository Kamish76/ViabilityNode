# ViabilityNode.dev — Setup Guide

Step-by-step setup instructions for configuring the Supabase database backend and Next.js frontend ingestion pipeline.

---

## 1. Supabase Database Configuration

1. Log in to your [Supabase Dashboard](https://supabase.com/dashboard) and navigate to your project.
2. Open the **SQL Editor** from the left-hand menu.
3. Run the following SQL script to create the `telemetry` table, query index, and the automated Vapor Pressure Deficit (VPD) view:

```sql
-- 1. Create the telemetry table
CREATE TABLE telemetry (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    device_id TEXT NOT NULL,
    recorded_at TIMESTAMPTZ DEFAULT NOW(),
    illuminance_lux NUMERIC(10, 2) NOT NULL,
    temperature_c NUMERIC(5, 2) NOT NULL,
    humidity_rh NUMERIC(5, 2) NOT NULL,
    pressure_hpa NUMERIC(7, 2) NOT NULL,
    soil_moisture_raw INTEGER NOT NULL,
    battery_v NUMERIC(4, 2),      -- External 2:1 divider sense; NULL for legacy nodes
    battery_pct INTEGER            -- Linear interpolation 3.30V=0% → 4.20V=100%
);

-- 2. Index for time-series queries by node
CREATE INDEX idx_telemetry_device_time 
ON telemetry (device_id, recorded_at DESC);

-- 3. Pre-compute Vapor Pressure Deficit (VPD in kPa)
-- VPD = VP_sat - VP_actual
-- VP_sat = 0.61078 * exp((17.27 * T) / (T + 237.3))
-- VP_actual = VP_sat * (RH / 100)
CREATE OR REPLACE VIEW telemetry_with_vpd AS
SELECT 
    *,
    ROUND(
        (0.61078 * EXP((17.27 * temperature_c) / (temperature_c + 237.3))) * (1.0 - (humidity_rh / 100.0)), 
        3
    ) AS vpd_kpa
FROM telemetry;

-- 4. Migration: add battery columns to an existing telemetry table
-- (skip if creating fresh from the CREATE TABLE above)
ALTER TABLE telemetry
ADD COLUMN IF NOT EXISTS battery_v NUMERIC(4, 2),
ADD COLUMN IF NOT EXISTS battery_pct INTEGER;
```

## 2. Next.js Environment Configuration
In your Next.js project root, create a `.env.local` file:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://your-project-id.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```
Note: Retrieve your Project URL and API Keys from Project Settings > API in your Supabase dashboard.

## 3. Telemetry Ingestion API Route
Create `app/api/telemetry/route.ts` to ingest JSON payloads pushed from the ESP32-C6 node:

```typescript
import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

export async function POST(req: Request) {
  try {
    const payload = await req.json();

    const {
      device_id,
      illuminance_lux,
      temperature_c,
      humidity_rh,
      pressure_hpa,
      soil_moisture_raw,
      battery_v,
      battery_pct,
    } = payload;

    if (!device_id || illuminance_lux === undefined || temperature_c === undefined) {
      return NextResponse.json({ error: 'Invalid payload schema' }, { status: 400 });
    }

    const { data, error } = await supabase.from('telemetry').insert([
      {
        device_id,
        illuminance_lux,
        temperature_c,
        humidity_rh,
        pressure_hpa,
        soil_moisture_raw,
        ...(battery_v !== undefined && { battery_v }),
        ...(battery_pct !== undefined && { battery_pct }),
      },
    ]);

    if (error) {
      console.error('Supabase insertion error:', error);
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ status: 'success', inserted: data }, { status: 201 });
  } catch (err) {
    console.error('API Error:', err);
    return NextResponse.json({ error: 'Malformed JSON or server error' }, { status: 500 });
  }
}
```

## 4. Local Development & Testing
Install project dependencies:

```bash
npm install @supabase/supabase-js
```
Start the development server:

```bash
npm run dev
```
Test ingestion locally via curl:

```bash
curl -X POST http://localhost:3000/api/telemetry \
  -H "Content-Type: application/json" \
  -d '{
    "device_id": "plant_node_01",
    "illuminance_lux": 4200.50,
    "temperature_c": 28.40,
    "humidity_rh": 65.20,
    "pressure_hpa": 1012.30,
    "soil_moisture_raw": 1820,
    "battery_v": 4.12,
    "battery_pct": 91
  }'
```

---

## 5. Supabase Migrations

Schema changes are managed through the Supabase CLI and live under `supabase/migrations/`.

### Local development

```bash
# First-time: start the full local Supabase stack (Postgres + Studio)
npx supabase start

# Apply all pending migrations + run seed.sql
npx supabase db reset

# Open local Supabase Studio
open http://localhost:54323
```

### Creating a new migration

Always generate migrations via the CLI so the timestamp prefix is correct:

```bash
npx supabase migration new <descriptive_name>
# e.g. npx supabase migration new add_dli_aggregates
# → creates supabase/migrations/YYYYMMDDHHMMSS_add_dli_aggregates.sql
```

Write your DDL inside the generated file, then verify locally:

```bash
npx supabase db reset   # re-applies all migrations from scratch
npx supabase db lint    # static SQL analysis
npx supabase db diff    # confirm no uncommitted drift
```

### Migration naming convention

| Part | Format | Example |
|---|---|---|
| Timestamp | `YYYYMMDDHHMMSS` | `20260830000001` |
| Separator | `_` | — |
| Description | `snake_case`, imperative verb | `create_telemetry` |

### PR auto-validation

The workflow at `.github/workflows/supabase-migration-check.yml` runs automatically on every PR that touches `supabase/`:

| Job | What it checks |
|---|---|
| **Lint** | SQL syntax and undefined-reference errors via `supabase db lint` |
| **Diff** | Boots a local stack, applies all migrations, confirms no uncommitted schema drift |
| **Comment** | Posts a ✅/❌ summary table directly on the PR |

PRs that fail either job are blocked from merging until the errors are resolved.

### Deploying to production

After a PR merges, push the migration to the hosted Supabase project:

```bash
# One-time: link this repo to your Supabase project
npx supabase link --project-ref <your-project-ref>

# Push all pending migrations to production
npx supabase db push
```

Retrieve `<your-project-ref>` from **Project Settings → General** in the Supabase dashboard.
