# Microclimate Profile Card & Drainage Architecture Documentation

The `MicroclimatProfileCard` is a vital diagnostic component of the ViabilityNode ecosystem. It translates raw, time-series capacitive soil moisture telemetry into an actionable, biophysical understanding of a specific substrate's water clearance characteristics.

## Core Philosophy: Phase-Dependent Drainage
Water movement in soil is not uniform; it is governed by shifting physical forces that dominate at specific moisture thresholds. Rather than using a simple linear average to determine how fast soil drains, the system segments drainage into a **Three-Phase Biophysical Model**.

> [!NOTE]
> The drainage classification (Rapid, Moderate, Stagnant) of a soil is explicitly tied to the **peak phase** reached during a watering event. A torrential downpour behaves physically differently than a light misting, and the system judges them accordingly.

---

## 1. Phase 1: Free Gravitational Drainage (>70% Moisture)
**Dominant Force:** Gravity / Macropore Clearance
**Velocity Metric:** $V_{grav}$ (%/hr)

When soil is heavily saturated (e.g., from a deep watering), water fills the large macropores, displacing essential oxygen. The primary driver of moisture loss here is simple gravity pulling water downward.
- **Evaluation Criteria:**
  - **Rapid:** $> 3.0$ %/hr
  - **Moderate:** $0.8$ – $3.0$ %/hr
  - **Stagnant:** $< 0.8$ %/hr

> [!WARNING]
> **Macropore Failure:** If the soil remains in Phase 1 for >24 hours with a $V_{grav}$ of $<0.5$ %/hr, it triggers a critical hypoxia alert. Roots are starved of ATP due to a lack of gas exchange.

---

## 2. Phase 2: Field Capacity Transition (30%–70% Moisture)
**Dominant Force:** Matric Potential (Capillary Action)
**Velocity Metric:** $V_{grav}$ (partial) / Retention Time

This is the "Available Water Capacity" zone where water is held by surface tension. Gravity ceases to be the dominant force as moisture levels drop, and the soil begins to stabilize toward its field capacity.
- **Evaluation Criteria:** Evaluated similarly to Phase 1 (via partial $V_{grav}$ or time to drop 10%).

---

## 3. Phase 3: Capillary & Evapotranspiration (<30% Moisture)
**Dominant Force:** Capillary Tension + ET (Evapotranspiration)
**Velocity Metric:** $V_{dry}$ (%/hr)

Below 30% moisture, the substrate enters the Capillary plateau. Gravity has no effect here. Moisture is lost exclusively through atmospheric demand (VPD - Vapor Pressure Deficit) drawing moisture from the soil surface, or via active root uptake by the plant.

- **Evaluation Criteria (For events peaking in Phase 3):**
  - **Rapid:** $> 0.5$ %/hr (Indicates high atmospheric demand or vigorous active ET)
  - **Moderate:** $\ge 0.1$ %/hr (Normal baseline capillary drying)
  - **Stagnant:** $< 0.1$ %/hr (Very slow drying; usually indicates high humidity, dense shade, or dormant roots)

> [!TIP]
> By evaluating Phase 3 independently via $V_{dry}$, light showers or mists aren't unfairly classified as "stagnant" just because Capillary/ET drying is inherently slower than Gravitational clearance.

---

## Edge Cases & Hardware Integration

### The "Light Shower" Scenario
If a user lightly waters a plant, causing a moisture spike from 22% to 32%, the system recognizes this as a valid watering event. However, because it peaked in Phase 3, it never triggered gravitational drainage.
**Handling:** The system intelligently uses $V_{dry}$ to classify the event. If $V_{dry}$ is >0.1%/hr, it is classified as "Moderate" (normal for Phase 3), preventing a false-negative "Stagnant" classification.

### The "Pending Watering" (Unknown) State
If a watering event has just occurred and hasn't yet dropped enough to calculate a reliable velocity (e.g., currently absorbing), or if the sensor is brand new with no deep historical watering events, the drainage class defaults to `unknown`. 
**Historical Caching Fallback:** To maintain UI stability and continuous microclimate profiling, if the *current* event is "Pending", the backend engine will automatically iterate backward through the last 30 days of telemetry to find the most recent *completed* watering event and use its known drainage profile instead.

### Hardware Calibration Limits
To prevent UI glitches or negative percentages, the system applies hardcoded limits to raw ADC values from the Capacitive Soil Moisture Sensor v1.2:
- **Dry Baseline (0%):** 1920 ADC
- **Wet Baseline (100%):** 880 ADC
