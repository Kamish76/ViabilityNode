# ViabilityNode.dev

**ViabilityNode.dev** is an autonomous microclimate profiling platform and telemetry engine designed to evaluate plant viability prior to planting and monitor existing specimen health in real time.

---

## Architecture Overview

```text
+-------------------------------------------------------------+
|                     HARDWARE SENSOR NODE                    |
|  Seeed Studio XIAO ESP32-C6 (Deep Sleep 30m Duty Cycle)     |
|  - VEML7700 (Light / DLI)                                   |
|  - AHT20 + BMP280 (Temp, RH, Barometric Pressure)           |
|  - Capacitive Soil Moisture v1.2 (Switched via GPIO D1)     |
+------------------------------+------------------------------+
| HTTP POST (JSON Payload)
v
+-------------------------------------------------------------+
|                     NEXT.JS BACKEND                         |
|  - Ingestion Route (/api/telemetry)                        |
|  - Validation & Ingestion Handlers                          |
+------------------------------+------------------------------+
|
v
+-------------------------------------------------------------+
|                     SUPABASE POSTGRESQL                     |
|  - telemetry (Raw sensor time-series)                     |
|  - telemetry_with_vpd (Calculated Vapor Pressure Deficit) |
+-------------------------------------------------------------+
```

---

## Key Analytics & Derived Metrics

The platform processes raw time-series telemetry into three predictive environmental indicators:

1. **Daily Light Integral (DLI):**
   * Converts ambient illuminance ($\text{Lux} \to \text{PPFD}$) and integrates over 24-hour windows to classify zones for low-light foliage ($<5\ \text{mol/m}^2/\text{day}$), general tropicals ($5\text{--}15\ \text{mol/m}^2/\text{day}$), or high-light plants ($>15\ \text{mol/m}^2/\text{day}$).
2. **Soil Drainage Velocity:**
   * Tracks post-saturation moisture drop curves ($-\frac{\Delta \text{Moisture}}{\Delta \text{Time}}$) to identify hypoxic, slow-draining soil risk profiles versus rapid-draining zones.
3. **Vapor Pressure Deficit (VPD):**
   * Uses real-time temperature and relative humidity to measure transpiration potential, issuing early warnings for dehydration risk (high VPD) or stagnation/fungal infection danger (low VPD).

---

## Ingest Payload Format

The ESP32 node transmits structured JSON to the `/api/telemetry` endpoint:

```json
{
  "device_id": "plant_node_01",
  "illuminance_lux": 3491.02,
  "temperature_c": 31.71,
  "humidity_rh": 67.68,
  "pressure_hpa": 1009.73,
  "soil_moisture_raw": 1244
}
```

## Tech Stack
- **Framework**: Next.js (App Router, TypeScript)
- **Database**: Supabase (PostgreSQL with time-series indexing and generated views)
- **Hardware**: Seeed Studio XIAO ESP32-C6, VEML7700, AHT20, BMP280, Capacitive Soil Moisture Sensor v1.2  
- **Styling/UI**: Tailwind CSS & Recharts

## License
MIT License.
