# Microclimate Profile Card & Drainage Architecture Documentation

The `MicroclimatProfileCard` is a vital diagnostic component of the ViabilityNode ecosystem. It translates raw, time-series capacitive soil moisture telemetry into an actionable, biophysical understanding of a specific substrate's water clearance characteristics.

## Core Philosophy: 30-Day Phase-Dependent Aggregate Drainage

Water movement in soil is not uniform; it is governed by shifting physical forces that dominate at specific moisture thresholds. Rather than using a simple linear average across all data, or relying solely on the most recent watering event, the system uses a **30-Day Aggregate Three-Phase Biophysical Model**.

> [!NOTE]
> The drainage classification (Rapid, Moderate, Stagnant) of a soil is explicitly tied to the **30-day averages** across all detected watering cycles. This creates a true, resilient "fingerprint" of the soil structure's health, rather than being skewed by a single anomalous watering event.

---

## 1. Phase 1: Free Gravitational Drainage (>70% Moisture)
**Dominant Force:** Gravity / Macropore Clearance
**Velocity Metric:** $V_{grav}$ (%/hr)

When soil is heavily saturated (e.g., from a deep watering), water fills the large macropores, displacing essential oxygen. The primary driver of moisture loss here is simple gravity pulling water downward. Phase 1 strictly measures the time it takes for moisture to drop from its peak down to the 70% boundary.

- **Evaluation Criteria (30-Day Average):**
  - **Rapid:** $> 3.0$ %/hr
  - **Moderate:** $0.8$ – $3.0$ %/hr
  - **Stagnant:** $< 0.8$ %/hr

> [!WARNING]
> **Macropore Failure:** If the soil remains in Phase 1 for >24 hours with a $V_{grav}$ of $<0.5$ %/hr, it triggers a critical hypoxia alert. Roots are starved of ATP due to a lack of gas exchange.

---

## 2. Phase 2: Field Capacity Transit (70%–30% Moisture)
**Dominant Force:** Matric Potential (Capillary Action)
**Velocity Metric:** Transit Time (Hours)

This is the "Available Water Capacity" zone where water is held by surface tension. Gravity ceases to be the dominant force, and the soil stabilizes toward its field capacity. Phase 2 strictly evaluates the total time spent transiting from the 70% boundary down to the 30% boundary.

---

## 3. Phase 3: Capillary & Evapotranspiration (<30% Moisture)
**Dominant Force:** Capillary Tension + ET (Evapotranspiration)
**Velocity Metric:** $V_{dry}$ (%/hr)

Below 30% moisture, the substrate enters the Capillary plateau. Gravity has no effect. Moisture is lost exclusively through atmospheric demand (VPD - Vapor Pressure Deficit) drawing moisture from the soil surface, or via active root uptake by the plant. Phase 3 evaluates drainage from 30% down to the minimum moisture reached before the next event.

- **Evaluation Criteria (30-Day Average):**
  - **Active ET (Rapid):** $> 0.5$ %/hr (Indicates high atmospheric demand or vigorous active ET)
  - **Normal Dry (Moderate):** $0.1$ – $0.5$ %/hr (Normal baseline capillary drying)
  - **Stagnant:** $< 0.1$ %/hr (Very slow drying; usually indicates high humidity, dense shade, or dormant roots)

---

## Edge Cases & Architectural Robustness

### The "Astronomical Drop" (Divide-by-Zero Prevention)
In cases of extremely loose, fast-draining substrate (like chunky orchid bark), watering can cause a near-instantaneous moisture drop (e.g., passing through Phase 1 in mere minutes). Mathematically, this produces astronomical velocities (e.g., 2000+ %/hr).
**Handling:** The algorithm enforces a hard `0.5 hour` minimum on the time delta used for the denominator when calculating velocities. This safely caps the maximum possible $V_{grav}$ at a sensible ~60 %/hr, maintaining a "Rapid" classification without breaking the UI readability.

### The "Insufficient Data" Fallback
The UI is designed to present the 30-day averages in a detailed 3-column `Drainage Profile` grid.
**Handling:** If there are fewer than 2 completed watering events in the 30-day window, the system falls back to a compact display showing the raw velocities and retention of the *current (or most recent)* single event, marked clearly with an "Accumulating profile data..." notice.

### Hardware Calibration Limits
To prevent UI glitches or negative percentages, the system applies hardcoded limits to raw ADC values from the Capacitive Soil Moisture Sensor v1.2:
- **Dry Baseline (0%):** 1920 ADC
- **Wet Baseline (100%):** 880 ADC
