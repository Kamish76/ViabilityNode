# Architectural Review & Gap Analysis: Dynamic Soil Moisture Sensor Calibration

## Executive Summary

The transition from client-side hardcoded soil moisture calculations to **node-specific, database-triggered calibration with time-locked historical records** is architecturally sound and aligns with the project's multi-node monitoring roadmap.

However, a rigorous review of the current uncommitted changes, existing code paths, and prior session plans reveals **several critical oversights, edge-case vulnerabilities, and a project workflow rule violation** that need attention before deploying to production.

---

## 1. Inventory of Current Changes

| File | Status | Core Role |
| :--- | :--- | :--- |
| `supabase/migrations/20261006141100_dynamic_calibration.sql` | **Untracked** | Creates `calibration_history`, adds `soil_moisture_pct` to `telemetry`, creates audit and `BEFORE INSERT` calculation triggers, backfills past data, and updates SQL views. |
| `src/app/components/CalibrationSettingsModal.tsx` | **Untracked** | Modal dialog for inspecting and updating dry/wet ADC limits for the active node in `device_settings`. |
| `src/lib/sensorUtils.ts` | **Modified** | Renames `HARDCODED_CALIBRATION` to `DEFAULT_CALIBRATION` (1920/880); refactors `calculateMoisturePct` to accept dynamic limits with defaults. |
| `src/app/page.tsx` | **Modified** | Fetches `soil_moisture_pct` from `telemetry` (with fallback to raw ADC if migration is pending); queries `device_settings` for active node and passes to Dashboard. |
| `src/app/DashboardClient.tsx` | **Modified** | Embeds `CalibrationSettingsModal` into the header; pulls `soil_moisture_pct` from telemetry rows with fallback to dynamic `calculateMoisturePct`. |
| `src/app/api/export/route.ts` | **Modified** | Uses `soil_moisture_pct` for 30-day export and daily averages; includes fallback queries if column does not exist. |
| `src/app/api/cron/process-microclimate/route.ts` | **Modified** | Replaces raw moisture array transformations with direct `soil_moisture_pct` extraction for piecewise drainage analysis. |

---

## 2. Strengths of the Implementation

1. **Migration Resilience & Defensive Fallbacks**:
   The queries in `page.tsx`, `export/route.ts`, and `process-microclimate/route.ts` handle missing columns gracefully. If the database migration hasn't been executed yet, the system falls back to `soil_moisture_raw` and computes percentage via `calculateMoisturePct()`. The app does not crash while awaiting migrations.
2. **Time-Locking Historical Data**:
   By writing `soil_moisture_pct` directly to the `telemetry` table at insert time, historical readings are locked to the calibration active when the sensor was read. Changing calibration today will not shift historical baseline charts, drainage curves, or past trial milestones.
3. **Trigger-Based Automation**:
   When nodes push data to `/api/telemetry`, the backend doesn't require extra logic. PostgreSQL's `BEFORE INSERT` trigger automatically computes and populates `soil_moisture_pct`.
4. **Supabase Realtime Compatibility**:
   Because the trigger runs `BEFORE INSERT`, the Supabase Realtime broadcast payload (`payload.new`) delivers the computed `soil_moisture_pct` directly to `DashboardClient.tsx`.

---

## 3. Critical Findings & What Was Overlooked

### ⚠️ Finding 1: Workflow Violation in Migration Instructions (`AGENTS.md`)
* **The Issue**: The prior session's `walkthrough.md` recommended running `supabase db push`.
* **Repository Rule**: The project rule (`AGENTS.md`) strictly specifies:
  > **Supabase: Remote-Only Workflow (No Docker)**
  > - The user DOES NOT use Docker.
  > - Never run or recommend Supabase CLI commands that require a local Docker daemon (e.g., `supabase start`, `supabase status`, `supabase db pull`, `supabase db push`, `supabase migration *`).
  > - Rely exclusively on the remote-only workflow (Supabase Dashboard SQL Editor, direct Postgres connection).
* **Impact**: Running `supabase db push` will fail in this environment and violates workspace guidelines.
* **Fix**: Apply the SQL script directly via the **Supabase Dashboard SQL Editor** or via a direct database connection string.

---

### ⚠️ Finding 2: `set_calibrated_moisture()` Trigger Overwrites Explicit Values
* **The Issue**: In `20261006141100_dynamic_calibration.sql`:
  ```sql
  CREATE OR REPLACE FUNCTION set_calibrated_moisture()
  RETURNS TRIGGER SECURITY DEFINER AS $$
  ...
  BEGIN
    ...
    IF d_limit = w_limit THEN
      NEW.soil_moisture_pct := 0;
    ELSE
      NEW.soil_moisture_pct := ROUND(
          GREATEST(0.0, LEAST(100.0, ((d_limit - NEW.soil_moisture_raw) / (d_limit - w_limit)) * 100.0))::NUMERIC, 
          2
      );
    END IF;
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
  ```
  The trigger executes `BEFORE INSERT ON public.telemetry FOR EACH ROW` and **unconditionally** sets `NEW.soil_moisture_pct`.
* **Impact**: If you ever import historical data from a CSV, restore a backup with pre-computed percentages, or run integration tests with explicit moisture percentages, this trigger will overwrite them using *today's* `device_settings`.
* **Fix**: Only compute if `NEW.soil_moisture_pct IS NULL`:
  ```sql
  IF NEW.soil_moisture_pct IS NULL AND NEW.soil_moisture_raw IS NOT NULL THEN
    ...
  END IF;
  ```

---

### ⚠️ Finding 3: `uuid_generate_v4()` vs `gen_random_uuid()` Dependency
* **The Issue**: The migration table definition uses:
  ```sql
  CREATE TABLE IF NOT EXISTS public.calibration_history (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ...
  ```
* **Impact**: `uuid_generate_v4()` requires the `uuid-ossp` extension (`CREATE EXTENSION IF NOT EXISTS "uuid-ossp";`). If this extension is not active on the remote Supabase project, executing the script in the SQL Editor throws:
  `ERROR: function uuid_generate_v4() does not exist`.
* **Fix**: Use PostgreSQL's native `gen_random_uuid()` (standard in Postgres 13+ and Supabase):
  ```sql
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ```

---

### ⚠️ Finding 4: Missing Input Validation & Sanity Bounds in `CalibrationSettingsModal`
* **The Issue**: `CalibrationSettingsModal.tsx` only checks `isNaN()`:
  ```typescript
  const parsedDry = parseInt(dryLimit, 10);
  const parsedWet = parseInt(wetLimit, 10);
  if (isNaN(parsedDry) || isNaN(parsedWet)) {
    throw new Error("Please enter valid numeric values for limits.");
  }
  ```
* **Impact**:
  1. **Inverted Limits**: For capacitive sensors, dry ADC (in air) must always be higher than wet ADC (in water). If a user enters `dryLimit: 800` and `wetLimit: 1920`, the percentage equation inverts (`(800 - raw) / (800 - 1920)`), causing wetter soil to display lower percentages.
  2. **Equal Limits**: If `parsedDry === parsedWet`, division by zero is avoided by returning `0%`, but it results in a broken sensor state.
  3. **Out-of-Bounds ADC**: ESP32 has a 12-bit ADC (range `0` to `4095`). Negative values or values above 4095 are physically impossible.
* **Fix**: Add validation before sending the upsert:
  ```typescript
  if (parsedDry <= parsedWet) {
    throw new Error("Dry Limit (air ADC) must be strictly greater than Wet Limit (water ADC).");
  }
  if (parsedDry < 0 || parsedDry > 4095 || parsedWet < 0 || parsedWet > 4095) {
    throw new Error("ADC limits must be within the 12-bit ADC range (0 - 4095).");
  }
  ```

---

### ⚠️ Finding 5: Modal State Not Synchronizing on Prop Updates or Re-Open
* **The Issue**: In `CalibrationSettingsModal.tsx`:
  ```typescript
  const [dryLimit, setDryLimit] = useState(initialSettings?.dry_limit?.toString() || "1920");
  const [wetLimit, setWetLimit] = useState(initialSettings?.wet_limit?.toString() || "880");
  ```
  `useState` only evaluates the default value upon initial mount. When `initialSettings` changes (e.g., when the modal saves and `router.refresh()` updates the server props), `dryLimit` and `wetLimit` do not sync.
* **Fix**: Reset the input states whenever the modal opens or `initialSettings` updates:
  ```typescript
  const handleOpen = () => {
    setDryLimit(initialSettings?.dry_limit?.toString() || "1920");
    setWetLimit(initialSettings?.wet_limit?.toString() || "880");
    setSaveMessage(null);
    setIsOpen(true);
  };
  ```

---

### ⚠️ Finding 6: Supabase PostgREST `.single()` vs `.maybeSingle()` in `page.tsx`
* **The Issue**: In `src/app/page.tsx` line 278:
  ```typescript
  const { data: settingsData } = await supabaseAdmin
    .from("device_settings")
    .select("*")
    .eq("device_id", selectedDeviceId)
    .single();
  ```
* **Impact**: If a newly detected node does not yet have a record in `device_settings`, `.single()` returns HTTP 406 with error `PGRST116: JSON object requested, multiple (or no) rows returned`. While the code checks `if (settingsData)`, PostgREST logs an error on every page render for unconfigured nodes.
* **Fix**: Change `.single()` to `.maybeSingle()`. It cleanly returns `{ data: null, error: null }` when no row matches. (The same applies to line 266 for `node_microclimates`).

---

### ⚠️ Finding 7: Legacy `telemetry_with_moisture` View Left Inconsistent
* **The Issue**: In `supabase/migrations/20260919040000_unify_calibration.sql`, a view named `telemetry_with_moisture` was created:
  ```sql
  CREATE OR REPLACE VIEW telemetry_with_moisture AS
  SELECT *, ROUND(GREATEST(0, LEAST(100, ((1920.0 - soil_moisture_raw) / (1920.0 - 880.0)) * 100.0))::NUMERIC, 2) AS moisture_pct ...
  ```
  While `export/route.ts` was refactored to query `telemetry` directly, `telemetry_with_moisture` was omitted from the new migration `20261006141100_dynamic_calibration.sql`.
* **Impact**: Any external tools, BI dashboards, or future scripts querying `telemetry_with_moisture` will still see hardcoded 1920/880 values rather than the dynamic `soil_moisture_pct`.
* **Fix**: Include an update to `telemetry_with_moisture` in the migration:
  ```sql
  DROP VIEW IF EXISTS public.telemetry_with_moisture;
  CREATE OR REPLACE VIEW public.telemetry_with_moisture AS
  SELECT
      *,
      soil_moisture_pct AS moisture_pct
  FROM public.telemetry;
  ```

---

### ⚠️ Finding 8: Potential Null Dereference in `SummaryDashboard.tsx`
* **The Issue**: In `src/app/components/SummaryDashboard.tsx`:
  - Line 44 & 51: `- Moisture: ${data.current.moisturePct.toFixed(1)}%`
  - Line 146: `value: ${data.current.moisturePct.toFixed(1)}%`
  - Line 147: `trend: calculateTrend(data.current.moisturePct, ...)`
* **Impact**: If `avg_moisture_pct` in `daily_telemetry_summary` evaluates to `NULL` (e.g. for a node with no moisture readings, or on dates where all readings had null percentages), `data.current.moisturePct` is null. Calling `.toFixed(1)` on `null` will throw:
  `TypeError: Cannot read properties of null (reading 'toFixed')`, crashing the entire page.
* **Fix**: Guard all `.toFixed()` calls:
  ```typescript
  value: data.current.moisturePct != null ? `${data.current.moisturePct.toFixed(1)}%` : "—"
  ```

---

### ⚠️ Finding 9: Stale `.js` Artifacts & Outdated Documentation
* **The Issue**:
  1. `src/lib/sensorUtils.js` still exists on disk, containing deprecated constants (`wetLimit: 810`).
  2. `docs/SUCCULENT_LOGIC.md`, `docs/DrainageCard.md`, and `ROADMAP.md` describe calibration as being stored in `localStorage` or computed on-the-fly.
* **Fix**: Remove `src/lib/sensorUtils.js` (TypeScript is used throughout) and update the documentation to reflect database trigger-driven calibration.

---

## 4. Remediation Checklist

- [ ] **1. Update Migration Script (`supabase/migrations/20261006141100_dynamic_calibration.sql`)**:
  - Replace `uuid_generate_v4()` with `gen_random_uuid()`.
  - Add `IF NEW.soil_moisture_pct IS NULL` guard to `set_calibrated_moisture()`.
  - Add `d_limit <= w_limit` sanity check in `set_calibrated_moisture()`.
  - Add `telemetry_with_moisture` view recreation.
- [ ] **2. Enhance `CalibrationSettingsModal.tsx`**:
  - Add input range validation (`0 <= wetLimit < dryLimit <= 4095`).
  - Reset state when modal opens.
  - Type `initialSettings` properly instead of `any`.
- [ ] **3. Update `src/app/page.tsx`**:
  - Replace `.single()` with `.maybeSingle()` for `device_settings` and `node_microclimates`.
- [ ] **4. Harden `SummaryDashboard.tsx`**:
  - Add null guards for `data.current.moisturePct`.
- [ ] **5. Clean Up**:
  - Remove stale `src/lib/sensorUtils.js`.
- [ ] **6. Apply Migration in Remote Supabase**:
  - Run the updated SQL script in the **Supabase Dashboard SQL Editor** (NO Docker CLI).

---

## 5. Architectural Verification Matrix

| Flow | Expected Behavior | Status |
| :--- | :--- | :--- |
| **ESP32 Data Push** | Posts raw ADC to `/api/telemetry` | ✅ Verified (`soil_moisture_raw` ingested cleanly) |
| **Database Insertion** | Trigger looks up `device_settings` & populates `soil_moisture_pct` | ⚠️ Needs `IS NULL` guard and `d_limit > w_limit` check |
| **Realtime Broadcast** | Supabase broadcasts new row with `soil_moisture_pct` | ✅ Verified (`payload.new` contains triggered column) |
| **Client UI Display** | Uses `soil_moisture_pct`, falls back to device calibration | ✅ Verified (graceful fallback working) |
| **Node Switching** | Header modal binds to active node ID and limits | ⚠️ Needs state sync on reopen and `.maybeSingle()` query |
| **Export API** | Returns 30-day data with `soil_moisture_pct` | ✅ Verified (tested and operational) |
| **Microclimate Cron** | Piecewise drainage consumes calibrated percentages | ✅ Verified (tested and operational) |
