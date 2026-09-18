# ThreatAlertsPanel Component Documentation

## Overview

The `ThreatAlertsPanel` is a critical UI component in the Plant Viability Sensor Node application. It operates as the "Sitter Mode · Active Threat Monitor", providing real-time ecological threat analysis based on sensor telemetry (moisture, VPD, light) and plant-specific biological thresholds.

It evaluates four primary threat/optimization categories:
1. **Root Rot Warning** (Hypoxia risk)
2. **Dehydration Warning** (Drought stress risk)
3. **Night Light Pollution** (Circadian/CAM disruption risk)
4. **Growth Optimization** (Ideal environmental alignment)

## Props (`ThreatAlertsPanel` interface)

| Prop | Type | Description |
| :--- | :--- | :--- |
| `drainageData` | `DrainageInput[]` | Historical array of soil moisture telemetry (used for averages, trends, and deviations). |
| `vpdHistory30` | `VPDDataPoint[]` | Historical array of Vapor Pressure Deficit (VPD) readings over the last 30 days. |
| `dliHistory` | `DLIDataPoint[]` | Historical array of Daily Light Integral (DLI) calculations. |
| `latestMoisture` | `number \| null` | The most recent volumetric water content (VWC) percentage reading. |
| `logs` | `{ recorded_at: string; illuminance_lux: number }[]` | Granular illuminance (lux) logs for evaluating immediate light conditions. |
| `placementType` | `string \| null` | Indicates if the plant is in a pot (`"pot"`) or in the ground, which alters drainage speed expectations. |
| `plantType` | `string \| null` | Specifies the biological category (`"succulent"`, `"carnivorous"`, `"herb"`, `"tropical"`, etc.) for specialized thresholds. |
| `piecewise` | `PiecewiseDrainageResult \| null` | Advanced analytics detailing Phase 1 (gravitational) and Phase 3 (stagnation) drainage rates. |
| `drainageResult` | `DrainageResult` | Standard drainage analytics detailing retention hours and overall drainage class. |

## Threat Evaluation Logic

### 1. Root Rot Warning (`evalRotWarning`)
Detects conditions leading to root-zone hypoxia (oxygen starvation). Root rot occurs when soil remains completely saturated, preventing air from re-entering the macropores, combined with low atmospheric demand (VPD) failing to pull water upward.

**Triggers:**
- **Primary Check:** Leverages `piecewise` data if available. Checks for structurally stagnant drainage through either:
  - **Phase 1 Failure (Macropore Stagnation):** Gravitational clearance fails (`V_grav < 0.5 %/hr`) or moisture sits above 70% for too long.
  - **Phase 2 Failure (Mesopore Stagnation):** The transit time from 70% down to 50% moisture takes an excessively long time (> 96 hours), maintaining chronic sogginess.
- **Fallback Check:** Uses standard deviation (`stdDev < flatThreshold`) on recent moisture history when piecewise data is unavailable.
- **Atmospheric Check:** 48-hour average VPD must be critically low (`< 0.4 kPa`) indicating stagnant air.

**Thresholds by Plant Type:**
- **Standard:** `>85%` sat, `72h` window (`>75%`, `48h` if potted)
- **Succulent:** `>75%` sat, `72h` window (`>75%`, `48h` if potted) — highly susceptible to rot.
- **Carnivorous:** `>95%` sat, `168h` (7 days) window — extreme rot tolerance (bog natives).

### 2. Dehydration Warning (`evalDehydrationWarning`)
Detects severe drought stress that leads to tissue damage and stomatal closure.

**Triggers:**
- **Primary Check:** Current soil moisture drops below the critical `dryThreshold`.
- **Atmospheric Check:** 7-day average VPD exceeds `vpdDanger` threshold (atmospheric drought).
- **Phase 3 Stagnation (Advanced):** If piecewise data shows `V_dry < 0.1 %/hr`, it indicates the plant has proactively closed its stomata to survive, acting as an early warning even if absolute moisture isn't at rock bottom. *(Note: This check is completely disabled for succulents, as their CAM physiology inherently involves daytime stomatal closure, making a near-zero `V_dry` a normal daytime state rather than a sign of drought stress).*

**Thresholds by Plant Type:**
- **Standard:** `<15%` moisture (`<20%` if potted), VPD `>1.6 kPa`
- **Succulent:** `<10%` moisture, VPD `>2.0 kPa` — highly drought-tolerant. Phase 3 plateau early warning does not apply.
- **Carnivorous:** `<40%` moisture, VPD `>1.2 kPa` — rapid dehydration risk.
- **Herb:** `<20%` moisture (`<25%` if potted).

### 3. Night Light Pollution (`evalNightLightWarning`)
Monitors for Artificial Light at Night (ALAN) that disrupts biological photoperiods and respiration.

**Triggers:**
- **Time Check:** Evaluates only during the night cycle (21:00 - 06:00).
- **Sustained Duration Check:** Light must remain above the threshold continuously for **>30 minutes** to ignore brief interruptions (like flashlights or car headlights).

**Thresholds by Plant Type:**
- **Standard:** `>40 lux` (Active), `>20 lux` (At-risk)
- **Succulent (CAM):** `>2 lux` (Active), `>0.5 lux` (At-risk) — CAM plants open stomata at night to absorb CO2; even minimal light halts this process.
- **Carnivorous:** `>30 lux` (Active), `>10 lux` (At-risk).
- **Tropical:** `>25 lux` (Active), `>12 lux` (At-risk).

### 4. Growth Optimization (`evalGrowthOptimization`)
Unlike the others, this is a positive indicator. It checks if the "holy trinity" of vegetative growth conditions are perfectly aligned. Because growth is a long-term ecological metric, this evaluator explicitly relies on historical aggregates.

**Triggers (All three must be met for 'Active' / 'Optimal' status):**
1. **Light:** Recent Daily Light Integral (DLI) is within the plant's target range.
2. **Soil:** Evaluates the 30-day soil structure "fingerprint". The `piecewise.drainClass` (a 30-day average) must be "rapid" or "moderate". If insufficient historical data exists (< 2 events), it seamlessly falls back to grading the single most recent watering event. *(Note: For succulents, being currently in an "optimal dry" state of `<30%` moisture also fulfills this requirement regardless of the 30-day drainage speed).*
3. **Atmosphere:** 7-day VPD average is stable in the ideal vegetative zone (`0.8 – 1.2 kPa`).

**DLI Ranges by Plant Type:**
- **Standard:** 5–15 mol/m²
- **Succulent:** 10–25 mol/m² (high light requirement)
- **Carnivorous:** 10–15 mol/m²
- **Herb:** 12–20 mol/m²
- **Tropical:** 3–8 mol/m² (understory/shade plants)

## UI Rendering & States

The component visually represents the status of the ecosystem using `STATUS_CONFIG`.
There are four visual states:
- **ACTIVE (Red/Pulse):** Immediate threat requiring intervention (or "OPTIMAL" green for growth).
- **AT RISK (Orange/Pulse):** Partial conditions met; early warning sign.
- **CLEAR (Emerald):** Conditions are safe; no threats detected.
- **MONITORING (Zinc/Grey):** Insufficient data or neutral state.

Alert rows auto-expand to show detailed scientific explanations and checklist conditions when they enter the `active` or `at-risk` states, providing transparent reasoning for the alert.
