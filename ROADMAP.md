# ViabilityNode — Predictive Analytics Roadmap

> **Usage:** This file must be reviewed at the start of every development session.
> Check each item against the **actual code** (primarily `DashboardClient.tsx`, `page.tsx`, and Supabase views/migrations) and update the status accordingly.
>
> **Status Legend:**
> - `[ ]` — Not yet implemented
> - `[/]` — Partially implemented / in progress
> - `[x]` — Fully implemented & verified in production code

---

## ⚠️ Known Infrastructure Notes

> These are confirmed production behaviours that must be kept in mind during all future phases.

### Supabase RLS — Telemetry Table is Intentionally Unrestricted

**Status:** Confirmed working configuration (as of 2026-08-31)

The Supabase **`telemetry` table has RLS disabled / all policies removed.** This was the only configuration under which the real-time subscription (`postgres_changes` channel in `DashboardClient.tsx`) reliably delivered live inserts to the browser.

- **Why:** Supabase Realtime respects RLS for `postgres_changes` events. If a row doesn't pass the policy for the requesting role (anon), the event is silently dropped — the subscription appears connected but no data arrives.
- **Current state:** Table is fully open (no RLS policies). This is acceptable for a local/prototype deployment but **must be revisited before any public exposure.**
- **Future fix options (when needed):**
  - Add a permissive `SELECT` policy for the `anon` role on `telemetry`
  - Or switch to using Supabase Realtime **Broadcast** / **Presence** channels (not RLS-gated) for the live feed
  - Or proxy the real-time feed through a server-sent events (SSE) API route that uses the service-role key

> **During Phase 3 & 4 development:** Do not add RLS policies back without also fixing the real-time subscription. If you do need to enable RLS, add the anon SELECT policy first and verify the live dashboard still updates before continuing.

---

## Phase 1 — Calibration & Standardization (The Raw Baseline)

> Goal: Turn raw sensor readings into real physical values before any advanced math is attempted.

### 1.1 Soil Moisture Calibration

Convert raw ADC soil moisture values into a **% Volumetric Water Content (VWC)** scale.

- [x] Define and store calibration constants:
  - `DRY_LIMIT` — air baseline (expected ≈ 1900–1910 ADC)
  - `WET_LIMIT` — fully-submerged water reading (expected ≈ 1000–1200 ADC)
- [x] Implement the calibration formula in the Next.js frontend (or as a Supabase computed column / view):

  ```
  Moisture % = (Dry_Limit - Raw_ADC) / (Dry_Limit - Wet_Limit) × 100
  ```

- [x] Replace the raw ADC display in `DashboardClient.tsx` (`soil_moisture_raw`) with the calculated `%` value
- [x] Add a calibration settings UI / config constant so limits can be updated without code changes

**Current state:** ✅ Implemented. `DashboardClient.tsx` now calculates `Moisture %` using `calculateMoisturePct()` with `dryLimit`/`wetLimit` constants stored in `localStorage`. The raw ADC is shown as a subtitle for debug transparency. A `CalibrationModal` (amber debug badge, sliders + number inputs, live preview bar) is accessible via the "Calibrate Sensor" button in the header.

---

### 1.2 Battery Autonomy Estimation

Project how many **days remain** before the BMS trips its low-voltage cutout (~3.0 V).

- [x] Fetch at least 7 days of historical `battery_pct` readings from Supabase
- [x] Calculate the **7-day rolling daily drop rate** (% per day)
- [x] Derive: `Days Remaining = current_battery_pct / daily_drop_rate`
- [x] Display an "Estimated Days of Autonomy" stat card on the dashboard
- [x] Add a low-battery warning indicator when days remaining < threshold (e.g. 7 days)

**Current state:** ✅ Implemented. `page.tsx` fetches 7 days of `battery_pct` history (one sample per calendar day). `estimateBatteryDays()` in `DashboardClient.tsx` calculates the rolling drop rate and projects days remaining. The `BatteryCard` component displays the estimate with a `Clock` icon, a progress bar, and turns orange with a banner warning when < 7 days remain.

---

## Phase 2 — Derived Biophysical Analytics (The Science)

> Goal: Evaluate environmental factors cumulatively over time, not as snapshots.

### 2.1 Daily Light Integral (DLI)

Measure cumulative photon exposure per 24-hour cycle (unit: mol/m²/day).

- [x] Convert VEML7700 lux readings → PPFD (μmol/m²/s):
  ```
  PPFD = Lux × 0.0185   (sunlight coefficient; adjust for indoor LED if needed)
  ```
- [x] Integrate PPFD over each full 24-hour day:
  ```
  DLI (mol/m²/day) = Σ(PPFD × interval_seconds) ÷ 1,000,000
  ```
- [x] Implement as a Supabase SQL view or materialized view aggregating by calendar day
- [x] Build a **30-Day DLI chart** (Recharts BarChart or LineChart) in the frontend
- [x] Classify daily DLI:
  - `< 5 mol` → Low (shade / understory plants)
  - `5–15 mol` → Moderate (common houseplants)
  - `> 15 mol` → High (cacti, succulents, fruit trees)

**Current state:** `DashboardClient.tsx` displays `illuminance_lux` as an instantaneous reading. No PPFD conversion, no DLI accumulation, no historical chart.

---

### 2.2 Soil Drainage Velocity

Measure how quickly the soil sheds excess water after a saturation event.

- [x] Detect a **saturation event**: soil moisture spikes rapidly to > 90%
- [x] Track the downward slope of moisture % over the subsequent 24–48 hours:
  ```
  Drainage Velocity = -ΔMoisture% / ΔTime(hours)
  ```
- [x] Categorize soil drainage:
  - **Rapid/Well-Draining** — fast slope (drought-tolerant plants: succulents, herbs)
  - **Moderate**
  - **Stagnant/Hypoxic** — flat slope (bog plants: mosses, ferns)
- [x] Display categorized drainage rating on the dashboard

**Current state:** No soil drainage detection or slope calculation exists anywhere. Requires Phase 1.1 (calibrated moisture %) to be completed first.

---

### 2.3 Vapor Pressure Deficit (VPD)

Measure atmospheric drying power — the gap between current and maximum air moisture capacity.

- [/] **VPD is already calculated** via `calculateVPD()` in `DashboardClient.tsx` and displayed as an instantaneous card value
- [x] Confirm/verify the `telemetry_with_vpd` Supabase view is active and being queried by `page.tsx` (check migration files)
- [x] Build a **7-day rolling VPD average** calculation (query Supabase for last 7 days, average `vpd_kpa`)
- [x] Display the 7-day VPD trend as a line chart
- [x] Highlight "Danger Zone" time bands on the chart:
  - **Chronically High VPD** (> ~1.5 kPa) → atmospheric drought risk
  - **Chronically Low VPD** (< ~0.4 kPa) → fungal infection risk
  - **Optimal VPD** (0.8–1.2 kPa) → stable growth zone

**Current state:** Instantaneous VPD card implemented. No rolling average, no trend chart, no danger-zone visualization.

---

## Phase 3 — Micro-Environment Characterization (The Matcher)

> Goal: After 30 days of data, compile all derived metrics into a single "Microclimate Profile Card" that classifies the placement site.

Requires **Phase 1 and Phase 2 to be fully complete.**

- [x] Query 30-day averages for DLI, Drainage Velocity, and VPD from Supabase
- [x] Build a **Microclimate Profile Card** UI component displaying:

  | Metric | 30-Day Avg | Classification |
  |--------|-----------|----------------|
  | DLI (Light Profile) | `x mol/m²/day` | Low / Moderate / High |
  | Drainage (Soil Profile) | `slope %/hr` | Rapid / Moderate / Stagnant |
  | VPD (Transpiration Profile) | `x kPa` | Optimal / High Risk / Low Risk |

- [x] Map classifications to **plant matcher** suggestions (lookup table):
  - Low DLI + Stagnant Drainage → Ferns, mosses
  - Moderate DLI + Moderate Drainage → Common houseplants
  - High DLI + Rapid Drainage → Cacti, succulents, fruit trees

✅ **Implemented.** `MicroclimatProfileCard.tsx` computes 30-day averages for DLI, VPD, and drainage. Full 12-combination plant lookup table (DLI × Drainage) with VPD risk modifier. Data maturity bar shows progress toward 30-day profile. Placed at the top of the Biophysical Analytics section.

---

## Phase 4 — Active Threat & Optimization Alerts ("Sitter Mode")

> Goal: Real-time ecological threat status for an actively planted specimen.

Requires Phases 1–3 to be complete.

- [x] **Rot Warning** — Triggered when:
  - Calibrated soil moisture remains flat near 100% for > 48–72 hours **AND**
  - VPD is chronically low (< 0.4 kPa)
  - Display: 🔴 Red alert banner

- [x] **Dehydration Warning** — Triggered when:
  - Calibrated soil moisture drops below 10% **AND**
  - VPD is chronically high (> 1.5 kPa) for consecutive days
  - Display: 🟠 Orange alert banner

- [x] **Growth Optimization Status** — Illuminated green when:
  - Daily DLI is within the optimal range for the selected plant **AND**
  - Soil drainage is functioning properly **AND**
  - VPD is within the stable 0.8–1.2 kPa band
  - Display: 🟢 Green status indicator

✅ **Implemented.** `ThreatAlertsPanel.tsx` evaluates all three threat conditions from live 30-day sensor history. Auto-expands rows with condition checklists and scientific explanations when active. AT RISK early-warning state fires when only one of two conditions is met.

---

## Implementation Order (Strict Dependencies)

```
Phase 1.1 (Soil Calibration)
  └─> Phase 2.1 (DLI)
  └─> Phase 2.2 (Drainage Velocity)   ← depends on calibrated moisture %
Phase 1.2 (Battery Autonomy)          ← independent, can be done anytime
Phase 2.3 (VPD rolling avg)           ← already partially done, extend it
  └─> Phase 3 (Microclimate Profile)  ← needs all of Phase 2
        └─> Phase 4 (Alerts)          ← needs Phase 3
```

---

## Key Files to Check During Review

| File | Relevance |
|------|-----------|
| `src/app/DashboardClient.tsx` | All frontend metric cards, VPD calc, real-time subscription |
| `src/app/page.tsx` | Server-side Supabase query, data passed to dashboard |
| `supabase/migrations/` | SQL views (e.g. `telemetry_with_vpd`), computed columns |
| `src/lib/` | Utility/helper functions for calculations |

---

## Session Checklist

When starting a new dev session on ViabilityNode:

1. Open this file (`ROADMAP.md`)
2. Check each `[ ]` item against actual code in the files listed above
3. Update statuses: `[ ]` → `[/]` (in progress) or `[x]` (done)
4. Pick the **next unblocked item** in the dependency chain and implement it
5. Commit with a note referencing the roadmap item number (e.g. `feat: Phase 1.1 soil moisture calibration`)
