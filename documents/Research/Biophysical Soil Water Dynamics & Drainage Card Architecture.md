Technical Specification: Biophysical Soil Water Dynamics & Drainage Card Architecture

1. Architectural Purpose and System Scope

In high-fidelity agritech modeling, soil drainage analysis serves as a critical predictive layer for plant viability, moving beyond simple moisture presence to characterize the temporal kinetics of water clearance. For drought-tolerant species, particularly succulents and cacti, the rate of water clearance is as vital as the hydration itself; prolonged saturation in the root zone is the primary precursor to substrate anoxia. The DrainageCard architecture transforms raw sensor telemetry into a diagnostic tool that segments the drainage curve into biophysically relevant phases, allowing the ViabilityNode system to predict root stress long before visual symptoms manifest.

Dual-Engine Architecture

The system employs two distinct analysis engines to process time-series data, providing both a high-level classification and a granular biophysical breakdown.

Feature	Retention Engine (analyzeDrainage)	Biophysical Engine (analyzePiecewiseDrainage)
Primary Function	Measures total hours from moisture peak to a 10% absolute drop.	Segments curve into Gravitational, Field Capacity, and Capillary phases.
File Location	DrainageCard.tsx	piecewiseDrainage.ts
UI Outputs	Retention Time (Hero), 24h Net Change, Drainage Category.	Phase Indicator Bar, V_{grav} and V_{dry} Velocities, Anoxia Alerts.
Logic Type	Threshold-based classification (Observed Retention).	Three-phase biophysical segmented model.

Input Contract

The system consumes data via the DrainageInput interface. To ensure statistical significance and temporal relevance, the module enforces a guard of at least 6 readings total, with a minimum of 2 readings occurring within the last 5 days.

* recorded_at: ISO 8601 timestamp for chronological sorting and velocity calculations.
* moisture_pct: Calibrated soil moisture (0–100%), the primary analysis signal.
* raw: Raw ADC integer from the hardware sensor, utilized for chart tooltips to provide hardware-level context.

By synthesizing these engines, the architecture transforms messy telemetry into actionable insights, characterizing how specific microclimates and substrates handle hydration events.

2. The Three-Phase Biophysical Model & Physical Principles

A piecewise approach to drainage is architecturally superior to linear slope analysis because water movement in soil is governed by shifting physical forces that dominate at specific moisture thresholds. The analyzePiecewiseDrainage engine captures these transitions by segmenting the curve into three biophysically distinct zones:

1. Phase 1: Free Gravitational Drainage (>70% Moisture)
  * Dominant Force: Gravity (Macropore clearance).
  * So What? In this phase, water occupies the macropores, displacing essential oxygen. The system monitors for "Macropore Failure"—defined as a duration >24 hours with a clearance rate (V_{grav}) < 0.5%/hr. This state triggers root hypoxia and ATP starvation, as the lack of gas exchange halts cellular respiration.
2. Phase 2: Field Capacity Transition (30%–70% Moisture)
  * Dominant Force: Matric Potential (Capillary Action).
  * So What? This is the "Available Water Capacity" zone where water is held by surface tension. The system categorizes soil quality based on the transit time between 70% and 50%:
    * <6h: Rapid/Excellent drainage.
    * 6–48h: Moderate/Well-draining.
    * 48–96h: Slow/Stagnant.
    * >96h: Waterlogged/Critical.
3. Phase 3: Capillary & Evapotranspiration Zone (<30% Moisture)
  * Dominant Force: Capillary Tension + Evapotranspiration (ET).
  * So What? Moisture loss here is driven by Vapor Pressure Deficit (VPD) and plant uptake. Unlike the stagnation of Phase 1, slow movement here represents a safe, aerated baseline. Rapid loss indicates high atmospheric demand or intense transpiration.

3. Mathematical Formulations & Signal Processing

High-integrity signal processing is essential to prevent hardware noise from triggering false agronomic events.

Signal Filtering & Event Detection

The system applies a size-3 non-linear median filter to the data stream. This specific window size is chosen to strip isolated ADC glitches (single-sample spikes) while minimizing phase lag and preserving the sharp step-changes characteristic of watering events.

A Watering Event is detected by a moisture spike delta of \ge 10\%. Upon detection, the system executes a 4-hour forward peak search. This window is critical as it accounts for the substrate "absorption period," where moisture continues to rise as the medium saturates before drainage begins.

Velocity Calculations

The model calculates localized velocities to characterize the physical clearance of water.

Gravitational Clearance Rate (V_{grav}): V_{grav} = \frac{Moisture_{peak} - 50\%}{t_{50\%} - t_{peak}} \quad [\%/hr]

Transpiration / Drying Rate (V_{dry}): V_{dry} = \frac{50\% - 30\%}{t_{30\%} - t_{50\%}} \quad [\%/hr]

Logic Check: V_{grav} calculation is only initiated if Moisture_{peak} > 70\% and the signal eventually crosses the 50% Field Capacity threshold. This ensures the engine is measuring true macropore clearance rather than simple evaporation from a partially wetted surface.

4. Engineering Edge Cases & Microclimate Integration

To maintain a continuous user experience during dry plateaus or "unknown" states, the architecture caches the last known vGrav and drainClass. This persistence ensures that downstream consumers like the MicroclimatProfileCard can display a soil's inherent characteristics even when current telemetry is static.

Hardware Calibration & Atmospheric Cross-Referencing

For the Capacitive Soil Moisture Sensor v1.2, the system uses specific defaults to ensure UI stability:

* Dry Baseline (0%): 1920 Raw ADC.
* Wet Baseline (100%): 880 Raw ADC. Setting the dry ceiling at 1920 (above the typical 1916 open-air spike) is a critical guard against the UI rendering negative moisture percentages.

Atmospheric data is integrated by cross-referencing V_{dry} with the Vapor Pressure Deficit (VPD). Furthermore, the system incorporates the impact of Botanical Light Pollution (Artificial Light at Night/ALAN). Research by Ian Ashdown (2016) indicates that red (660nm) and far-red (730nm) light from modern LEDs can interfere with the phytochrome switch (P_r to P_{fr} isoforms). This interference can keep stomata open or closed unnaturally, potentially skewing the calculated V_{dry} and signaling false transpiration demand.

Guards and Failsafes

Edge Case	System Behavior
< 6 Total Readings	Returns "insufficient"; prompts for more data.
No Watering (5 Days)	Returns "no-event"; advises watering to initiate analysis.
Peak < 70% Moisture	V_{grav} returns null; system waits for full saturation.
Watered < 4h Ago	Category set to "evaluating (Absorbing)"; defers classification.
Soil > 70% for > 24h	Triggers phase1Failure (Macropore Failure/Anoxia alert).

5. UI Architecture & Downstream Consumption

The DrainageCard translates complex biophysical data into intuitive, color-coded indicators.

Component Hierarchy

1. Retention Hero: Displays total time from peak to a 10% drop (e.g., "12.3h").
2. PhaseIndicatorBar: Maps current moisture to its phase (Blue: Gravity, Teal: Field Cap, Amber: Capillary).
3. PiecewiseVelocities: Technical grid for V_{grav} and V_{dry} with performance badges.

Downstream Integration

* MicroclimatProfileCard: Uses drainClass to cross-reference plant suitability (e.g., matching succulents with "Rapid" drainage).
* ThreatAlertsPanel: Consumes phase1Failure to issue immediate anoxia alerts.

Velocity Performance Mapping: Calculated velocities are mapped to performance badges to provide instant agronomic context:

* Gravitational (V_{grav}):
  * Rapid: > 3.0\%/hr
  * Moderate: 0.8–3.0\%/hr
  * Stagnant: < 0.8\%/hr
* Capillary/ET (V_{dry}):
  * Active ET: > 0.5\%/hr
  * Normal Dry: 0.1–0.5\%/hr
  * Very Slow: < 0.1\%/hr (Indicator of high humidity or shade).

6. Agronomic Grounding & Literature References

The biophysical thresholds and logic used in this architecture are grounded in established soil science and botanical research.

Reference List

* Cornell University CALS (NRCCA): Competency Area 2: Soil Hydrology. Provides the basis for Field Capacity (-1/3 bar matric potential) and Available Water Capacity thresholds.
* FAO (Food and Agriculture Organization): Field Measurements and Infiltration. Infiltration functions based on the Kostiakov-Lewis relationships for cumulative intake and basic infiltration rates (f_o).
* AHDB (Agriculture and Horticulture Development Board): Standards for rootzone management, containerized crop drainage, and anoxia prevention.
* All Things Lighting Association (Ian Ashdown, 2016): Botanical Light Pollution. Details the impact of spectral power distribution (LED red/far-red spikes) on the phytochrome switch and photomorphogenesis.
* Scientific Reports (Correa-Cano et al., 2018): Erosion of natural darkness in the geographic ranges of cacti. Context on the sensitivity of Cactaceae to residential development and the resulting botanical light pollution.
