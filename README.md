# 🌿 ViabilityNode

**Real-time plant telemetry dashboard** — the web-facing component of the Plant Surrogate Monitoring System.

> **Current Status**: 🚀 **Deployed & Monitoring**
> The node has just been deployed and is currently in a testing phase to observe long-term viability and stability over time. Since it is a simple sensor module, current efforts are focused on monitoring telemetry data and observing if any adjustments or enhancements are needed to maximize utility.

ViabilityNode ingests sensor data pushed over Wi-Fi from an **ESP32-C6** surrogate node and displays it in a live dashboard. It exposes a REST API endpoint for the firmware to POST telemetry into, persists all records in **Supabase**, and renders the latest readings with historical logs.

---

## System Architecture

```
┌─────────────────────────┐        POST /api/telemetry        ┌──────────────────────┐
│   Plant Surrogate Node  │  ─────────────────────────────►  │   ViabilityNode API   │
│   (ESP32-C6 Firmware)   │                                   │   (Next.js Route)     │
│                         │                                   └──────────┬───────────┘
│  Sensors:               │                                              │ INSERT
│  • SHT4x  — Temp/RH     │                                              ▼
│  • BH1750 — Light (lux) │                                   ┌──────────────────────┐
│  • ADC    — Soil Moist. │                                   │   Supabase (Postgres) │
│  • INA219 — Battery V   │                                   │   telemetry table     │
│  • DPS310 — Pressure    │                                   └──────────┬───────────┘
└─────────────────────────┘                                              │ SELECT
                                                                         ▼
                                                             ┌──────────────────────────┐
                                                             │   Dashboard (Next.js SSR) │
                                                             │   localhost:3000           │
                                                             └──────────────────────────┘
```

---

## Features

- 📡 **REST Ingest API** — `POST /api/telemetry` accepts JSON payloads from the ESP32-C6 node
- 📊 **Live Dashboard** — Server-side rendered metrics for temperature, humidity, VPD, soil moisture, light, and battery
- 🧮 **VPD Calculation** — Vapour Pressure Deficit computed via Supabase view (`telemetry_with_vpd`)
- 🔋 **Battery Monitoring** — Voltage and percentage from external voltage-divider sense circuit (205kΩ+205kΩ)
- 🗄️ **Persistent Storage** — All telemetry records stored in Supabase Postgres with timestamps

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | [Next.js 16](https://nextjs.org) (App Router, Turbopack) |
| Database | [Supabase](https://supabase.com) (Postgres + PostgREST) |
| Language | TypeScript |
| Styling | Tailwind CSS |
| Icons | [Lucide React](https://lucide.dev) |
| Deployment | [Vercel](https://vercel.com) |

---

## Getting Started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project with the `telemetry` table set up (see [Database Schema](#database-schema))

### 1. Clone & Install

```bash
git clone https://github.com/Kamish76/ViabilityNode.git
cd ViabilityNode
npm install
```

### 2. Configure Environment Variables

Copy the example and fill in your Supabase credentials:

```bash
cp .env.local.example .env.local
```

```env
# .env.local
NEXT_PUBLIC_SUPABASE_URL=https://<your-project-ref>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SERVICE_ROLE_KEY=eyJ...   # server-only, never expose to the browser
```

> ⚠️ **Never commit `.env.local`** — it contains your service role key which bypasses Row Level Security.

### 3. Run the Dev Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the dashboard.

---

## API Reference

### `POST /api/telemetry`

Ingests a telemetry reading from the surrogate node.

**Headers:**
```
Content-Type: application/json
```

**Body:**
```json
{
  "device_id": "plant-surrogate-01",
  "illuminance_lux": 1420,
  "temperature_c": 24.3,
  "humidity_rh": 58.7,
  "pressure_hpa": 1012.5,
  "soil_moisture_raw": 2048,
  "battery_v": 3.92,
  "battery_pct": 69
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `device_id` | string | ✅ | Unique ID of the sending node |
| `illuminance_lux` | number | ✅ | BH1750 light reading in lux |
| `temperature_c` | number | ✅ | SHT4x temperature in °C |
| `humidity_rh` | number | ✅ | SHT4x relative humidity % |
| `pressure_hpa` | number | ✅ | DPS310 barometric pressure in hPa |
| `soil_moisture_raw` | number | ✅ | Raw ADC value from capacitive soil sensor |
| `battery_v` | number | ❌ | Battery voltage (2:1 divider, actual cell voltage) |
| `battery_pct` | number | ❌ | Battery % (linear: 3.30V=0% → 4.20V=100%) |

**Responses:**
- `201 Created` — Record inserted successfully
- `400 Bad Request` — Missing required fields
- `500 Internal Server Error` — Supabase insertion failure

---

## Database Schema

Run this in your Supabase SQL editor to set up the required table and VPD view:

```sql
-- Core telemetry table
CREATE TABLE telemetry (
  id                 BIGSERIAL PRIMARY KEY,
  device_id          TEXT NOT NULL,
  recorded_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  illuminance_lux    NUMERIC NOT NULL,
  temperature_c      NUMERIC NOT NULL,
  humidity_rh        NUMERIC NOT NULL,
  pressure_hpa       NUMERIC NOT NULL,
  soil_moisture_raw  INTEGER NOT NULL,
  battery_v          NUMERIC,
  battery_pct        NUMERIC
);

-- VPD view (Vapour Pressure Deficit = saturation VP - actual VP)
CREATE OR REPLACE VIEW telemetry_with_vpd AS
SELECT *,
  ROUND(
    CAST(
      0.6108 * EXP((17.27 * temperature_c) / (temperature_c + 237.3))
      * (1 - humidity_rh / 100.0)
    AS NUMERIC), 3
  ) AS vpd_kpa
FROM telemetry;
```

---

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   └── telemetry/
│   │       └── route.ts      # POST /api/telemetry ingest handler
│   ├── layout.tsx             # Root layout
│   ├── page.tsx               # Main dashboard (SSR)
│   └── globals.css
├── lib/
│   └── supabase.ts            # Supabase admin + public clients
└── utils/
    └── supabase/              # @supabase/ssr cookie-based clients
        ├── client.ts          # Browser client
        ├── server.ts          # Server Components / Route Handlers
        └── middleware.ts      # Session refresh middleware
```

---

## Related

- **[Plant Surrogate Firmware](../Plant%20Surrugate%20Project/)** — ESP32-C6 C++ firmware that reads sensors and POSTs to this API
- **[Supabase Project](https://supabase.com/dashboard)** — Database, migrations, and RLS policies

---

## Deployment

Deployed on Vercel. Push to `main` to trigger a production deploy.

```bash
# Merge develop → main via PR (recommended)
gh pr create --base main --head develop
```

Set the same environment variables from `.env.local` in your [Vercel project settings](https://vercel.com/dashboard).
