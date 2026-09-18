# ViabilityNode Succulent Optimization Update
This document outlines the architectural and logical updates made to tailor the monitoring ecosystem to the unique biological needs of succulents and cacti.

## 1. Hardware Calibration Standardization
The dynamic calibration UI has been removed to enforce a standardized hardware response curve across the entire application and backend. 
- **Fixed Limits**: Hardcoded limits of `Dry = 1920` and `Wet = 880` are now strictly enforced and centralized in `src/lib/sensorUtils.ts`.
- **Backend Sync**: The `process-microclimate` cron job was updated to actively calculate moisture percentages using these fixed limits, ensuring that the heavy analytical algorithms (like piecewise drainage) process mathematically accurate, globally standardized percentages. All frontend components now use `calculateMoisturePct` from the centralized utility.
- **UI Clean-up**: The `CalibrationModal` and related state variables were completely purged from `DashboardClient.tsx`.

## 2. Expanded Observation Windows
Succulents operate on significantly longer timeframes than typical tropical plants, requiring prolonged "soak-and-dry" cycles.
- **Global Data Fetch**: The system now retrieves **30 days** of telemetry data by default in `page.tsx` and the backend cron.
- **Drainage Logic**: `analyzeDrainage` (now in `src/lib/drainageAnalysis.ts`) dynamically adjusts its analysis window based on the active `plantType`. It enforces a full 30-day lookback for succulents (instead of the standard 5-day window) to accurately capture extended capillary drainage (Phase 3) activity.

## 3. Succulent-Specific Metrics: `daysToLowest`
Due to the slow nature of Phase 3 capillary drainage in succulents, traditional retention metrics (hours to drop 10%) are often insufficient.
- **New Metric**: The `analyzeDrainage` function now calculates `daysToLowest`, measuring the total time (in days) it takes for a succulent to naturally dry out and reach its lowest current moisture state following a watering peak.
- **UI Display**: When rendering a fast-draining or properly draining event for a succulent, the UI intelligently swaps the standard description to highlight this `daysToLowest` metric.

## 4. "Optimal Dry State" Recognition
Previously, the drainage logic aggressively flagged long periods of capillary decay as "Evaluating" or "Still Retaining." This is inaccurate for succulents, which thrive in extended dry phases.
- **State Interception**: If a succulent is currently at < 30% moisture, the `analyzeDrainage` engine bypasses the ambiguous "evaluating" or "waterlogged" warnings.
- **Custom UI Category**: A new strict TypeScript category, `"optimal-dry"`, was added to the `DrainCategory` type. 
- **Visuals**: The drainage card now renders a custom, green-bordered Hero section titled **"Safely dry — capillary phase stabilized"** when the plant reaches this state. Furthermore, standard "no-event" windows are now recognized as a green **"Optimal Dry Cycle"**.

## 5. Sitter Mode: Real-Time Growth Optimization
The active threat monitor (`ThreatAlertsPanel.tsx`) and the Microclimate Profile required recalibration to prevent false-positives caused by intraday fluctuations and the slow decay of succulents.
- **Historical Data Filter**: `DashboardClient.tsx` now uses a strict midnight cutoff (`endOfYesterdayMs`). Sitter Mode and the microclimate profiler only analyze *complete* 24-hour cycles, ensuring findings are stable and preventing partial/incomplete data from triggering false alarms.
- **Growth Optimization Engine**: The `evalGrowthOptimization` function now natively recognizes the biological "soak-and-dry" requirements of succulents. It consumes the pre-calculated `drainageResult` from the parent dashboard. If the soil is properly in an `"Optimal Dry State"` (< 30% moisture) or an `"Optimal Dry Cycle"` (no recent watering events), the Sitter Mode successfully checks off the drainage requirement as met, allowing the overarching growth status to reach an "Optimal" rating instead of being permanently stuck in a "Partial" warning state.

## 6. Biophysical Drainage Phases (Reference)
The system models water dynamics through three distinct biophysical phases, calculated via the `analyzePiecewiseDrainage` engine:

### Phase 1: Gravitational Drainage (Macropore Drainage)
- **What it is**: The rapid drop in moisture immediately following saturation.
- **The Physics**: Gravity physically pulls "free water" down and out of the macropores.
- **Importance**: Critical for oxygenation. As water exits, it pulls fresh air into the soil. We measure this speed as **$V_{grav}$**. If it fails, roots suffocate.

### Phase 2: Field Capacity (Matric Potential)
- **What it is**: The brief stabilization period after gravitational drainage finishes.
- **The Physics**: Remaining water is held tightly in micropores by capillary action against gravity. Roots can easily access this moisture.
- **Importance**: The ideal hydration state for most tropicals. Succulents pass through this phase quickly.

### Phase 3: Capillary / ET (Evapotranspiration)
- **What it is**: The long, slow drying phase spanning days or weeks.
- **The Physics**: Moisture escapes solely via evaporation into the air or transpiration through the plant's leaves.
- **Importance**: The speed of this phase (**$V_{dry}$**) depends entirely on Vapor Pressure Deficit (VPD) and root metabolism. Succulents spend the vast majority of their life cycle safely in Phase 3 as they dry out down to their optimal drought state.
