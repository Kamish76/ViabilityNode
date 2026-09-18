# Piecewise Drainage Algorithm (`piecewiseDrainage.ts`)

## Overview

`piecewiseDrainage.ts` is the core biophysical mathematical engine for the ViabilityNode system. It replaces naive linear averaging with a segmented, three-phase model that isolates gravitational clearance from capillary evapotranspiration loss. It operates strictly as a logic module (no UI) and is consumed by `DrainageCard`, `ThreatAlertsPanel`, and `MicroclimatProfileCard`.

## The Three-Phase Model

The system categorizes soil moisture into three distinct biophysical states:

1. **Phase 1 (Free Gravitational Drainage): > 70% Moisture**
   - **Driver:** Gravity pulling water through macropores.
   - **Metric:** $V_{grav}$ (Velocity of gravitational clearance in %/hr).
   - **Failure Risk:** Anoxia (root drowning due to lack of oxygen).

2. **Phase 2 (Field Capacity Transition): 70% – 50% Moisture**
   - **Driver:** Matric potential (surface tension) stabilizing the soil toward field capacity.
   - **Metric:** Transit Time (Hours taken to drop from 70% to 50%).
   - **Failure Risk:** Mesopore stagnation (chronic sogginess taking >96 hours).

3. **Phase 3 (Capillary & Evapotranspiration Zone): < 30% Moisture**
   - **Driver:** Vapor pressure deficit (VPD) and plant root uptake.
   - **Metric:** $V_{dry}$ (Velocity of drying in %/hr).
   - **Failure Risk:** Extreme dehydration stress if the rate exceeds 0.5%/hr.

## Real-time vs Historical Analysis

The engine provides two distinct sets of data:
- **30-Day Aggregates:** Filters multiple watering events over time to build a stable historical profile (used by the Microclimate Profile Card).
- **Current / Live Tracking:** Evaluates the *most recent* ongoing watering event in real-time, providing immediate data to the Threat Alerts Panel without waiting for the 30-day window to close.

---

## Edge Case Handling & Protections

The algorithm includes deep protections against common environmental anomalies and user behaviors.

### 1. Phantom Swings and Diurnal Jitter
Capacitive soil sensors fluctuate slightly (±3% to ±5%) as soil temperatures drop at night.
- **Protection:** The system employs a 10% `SPIKE_THRESHOLD` to register a watering event, and a median filter (window size 3) to smooth ADC glitches.
- **Result:** Small nightly bumps (e.g., 29.5% to 30.5%) are completely ignored and do not reset timers or spawn false watering events. For $V_{dry}$, it anchors to the first cross into Phase 3 and calculates the rate using the absolute minimum moisture reached, bypassing all intermediate noise.

### 2. Partial Waterings (Watering into Phase 2)
If a user waters a plant slightly (e.g., from 20% to 65%), the soil never enters Phase 1.
- **Protection:** The algorithm identifies the spike's peak (65%), recognizes it is inside Phase 2, and anchors the Phase 2 transit timer to the exact moment of the peak.
- **Result:** If the soil sits at 65% for >96 hours without draining to 50%, the Phase 2 Failure triggers normally.

### 3. Chronic Sogginess (Sipping Water)
If a user waters the plant every single day from 60% to 75% (creating multiple real watering events >10%), the standard "time since watering" or "time since peak" timers reset constantly. The soil never drops below 50%, but individual event timers never hit 96 hours.
- **Protection:** The engine includes continuous, backwards-crawling trackers (`hoursAbove70` and `hoursAbove50`). These crawlers completely ignore watering spikes and simply measure the continuous, unbroken time the soil has spent above those critical thresholds.
- **Result:** If the soil bounces between 60% and 75% for 4 days, the `hoursAbove50` tracker crosses 96 hours and immediately triggers a Root Rot Warning.
