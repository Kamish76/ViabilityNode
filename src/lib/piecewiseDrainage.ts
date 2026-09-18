// ─── Piecewise Segmented Drainage Velocity Algorithm ─────────────────────────
//
// Implements the three-phase biophysical drainage model from the ViabilityNode
// Technical Research Report (Sections 3–4). Replaces linear averaging with
// piecewise analysis that isolates gravitational clearance (Phase 1) from
// capillary/evapotranspiration loss (Phase 3).
//
// Phase 1 (Free Gravitational Drainage): Moisture >70%
//   → Gravity-driven macropore clearance. Failure here = anoxia risk.
//
// Phase 2 (Field Capacity Transition): Moisture 50–70%
//   → Matric potential dominates. Soil stabilises toward field capacity.
//
// Phase 3 (Capillary & Evapotranspiration Zone): Moisture <30%
//   → Stagnant loss driven by VPD and root uptake only.
//
// Pure logic module — no React, no UI. Consumed by DrainageCard, ThreatAlertsPanel,
// and MicroclimatProfileCard.
// ─────────────────────────────────────────────────────────────────────────────

// ─── Phase Boundary Constants ────────────────────────────────────────────────

/** Upper boundary — above this, gravity is the primary drainage driver */
export const PHASE_1_BOUNDARY = 70;

/** Field capacity zone — matric potential dominates between these bounds */
export const PHASE_2_UPPER = 70;
export const PHASE_2_LOWER = 50;

/** Below this, only capillary tension and evapotranspiration cause loss */
export const PHASE_3_BOUNDARY = 30;

/** Minimum moisture jump to count as a watering event */
const SPIKE_THRESHOLD = 10;

/** How far ahead (ms) to search for the peak after a detected spike */
const PEAK_SEARCH_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours

/** Analysis window — only consider data within this range */
const ANALYSIS_WINDOW_MS = 5 * 24 * 60 * 60 * 1000; // 5 days

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MoistureReading {
  recorded_at: string;
  moisture_pct: number;
}

export interface WateringEvent {
  spikeIdx: number;       // Index where the jump was detected
  peakIdx: number;        // Index of the peak moisture after the spike
  peakMoisture: number;   // The peak % value
  peakTimestamp: string;  // ISO timestamp of the peak
}

export interface PiecewiseDrainageResult {
  // ── Piecewise velocities (Report Section 4) ──
  /** Gravitational clearance rate: (peak − 50%) / time [%/hr]. Null if never reached 50%. */
  vGrav: number | null;
  /** Drying/transpiration rate: (50% − 30%) / time [%/hr]. Null if never reached Phase 3. */
  vDry: number | null;

  // ── Phase timing ──
  /** Hours to transit from peak (>70%) down to 50% */
  phase1DurationHours: number | null;
  /** Hours spent in 50–70% field capacity zone (from first entry to exit) */
  phase2DurationHours: number | null;
  /** Hours spent below 30% (from first entry to latest reading) */
  phase3DurationHours: number | null;

  // ── Current state ──
  /** Which phase the soil is currently in based on latest reading */
  currentPhase: 1 | 2 | 3 | null;
  /** ISO timestamp of when the current phase was entered */
  currentPhaseSince: string | null;

  // ── Phase 1 failure detection (Report Section 5, Trigger 1) ──
  /** True if moisture has been >70% for extended period without adequate V_grav */
  phase1Failure: boolean;
  /** Hours that moisture has been continuously above 70% (null if not in Phase 1) */
  hoursAbove70: number | null;

  // ── Backward-compatible mapping ──
  drainClass: "rapid" | "moderate" | "stagnant" | "unknown";

  // ── Existing fields preserved for DrainageCard ──
  retentionHours: number | null;
  wateringEvents: number;
  lastWateringAt: string | null;
  peakMoisture: number | null;
  
  // ── Historical Caching (New) ──
  isHistoricalRate?: boolean;
  historicalDrainClass?: "rapid" | "moderate" | "stagnant" | "unknown";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

function hoursElapsed(startMs: number, endMs: number): number {
  return (endMs - startMs) / (1000 * 60 * 60);
}

/**
 * Apply a lightweight median filter (window size 3) to strip ADC glitches.
 * Matches the existing filter in DrainageCard.tsx.
 */
function medianFilter<T extends MoistureReading>(data: T[]): T[] {
  return data.map((d, i) => {
    const win = data.slice(Math.max(0, i - 1), Math.min(data.length, i + 2));
    const vals = win.map(w => w.moisture_pct).sort((a, b) => a - b);
    return { ...d, moisture_pct: vals[Math.floor(vals.length / 2)] };
  });
}

/**
 * Detect watering events — significant moisture spikes.
 * Reuses the same spike detection algorithm from DrainageCard.tsx.
 */
function detectWateringEvents(data: MoistureReading[]): WateringEvent[] {
  const events: WateringEvent[] = [];

  for (let i = 1; i < data.length; i++) {
    const delta = data[i].moisture_pct - data[i - 1].moisture_pct;
    if (delta >= SPIKE_THRESHOLD) {
      const spikeTime = toMs(data[i].recorded_at);
      const searchEnd = spikeTime + PEAK_SEARCH_WINDOW_MS;

      let peakIdx = i;
      let peakVal = data[i].moisture_pct;

      for (let j = i; j < data.length; j++) {
        if (toMs(data[j].recorded_at) > searchEnd) break;
        if (data[j].moisture_pct > peakVal) {
          peakVal = data[j].moisture_pct;
          peakIdx = j;
        }
      }

      // Avoid duplicates for the same event
      const lastEvent = events[events.length - 1];
      if (!lastEvent || peakIdx !== lastEvent.peakIdx) {
        events.push({
          spikeIdx: i,
          peakIdx,
          peakMoisture: peakVal,
          peakTimestamp: data[peakIdx].recorded_at,
        });
      }
    }
  }

  return events;
}

/**
 * Determine which phase a moisture reading is in.
 */
function classifyPhase(moisture: number): 1 | 2 | 3 {
  if (moisture > PHASE_1_BOUNDARY) return 1;
  if (moisture >= PHASE_3_BOUNDARY) return 2;
  return 3;
}

// ─── Piecewise velocity computation ──────────────────────────────────────────

/**
 * For a given watering event, compute V_grav and V_dry from the post-peak
 * drainage curve.
 *
 * V_grav = (Moisture_peak - Moisture_at_50%) / (t_50% - t_peak)  [%/hr]
 * V_dry  = (Moisture_at_50% - Moisture_at_30%) / (t_30% - t_50%) [%/hr]
 *
 * Returns null for each velocity if the moisture never crossed the boundary.
 */
function computeVelocities(
  data: MoistureReading[],
  event: WateringEvent
): {
  vGrav: number | null;
  vDry: number | null;
  phase1DurationHours: number | null;
  phase2DurationHours: number | null;
  phase3DurationHours: number | null;
  retentionHours: number | null;
} {
  const peakTimeMs = toMs(data[event.peakIdx].recorded_at);
  const peakMoisture = event.peakMoisture;

  // Track when we cross each boundary
  let crossedTo50Idx: number | null = null; // First reading ≤ 50% (exiting Phase 1 into Phase 2)
  let crossedTo70Idx: number | null = null; // First reading ≤ 70% (entering Phase 2)
  let crossedTo30Idx: number | null = null; // First reading ≤ 30% (entering Phase 3)

  // Also track retention (10% drop from peak, for backward compat)
  const retentionThreshold = peakMoisture - 10;
  let retentionCrossIdx: number | null = null;

  for (let j = event.peakIdx + 1; j < data.length; j++) {
    const m = data[j].moisture_pct;

    if (crossedTo70Idx === null && m <= PHASE_1_BOUNDARY) {
      crossedTo70Idx = j;
    }
    if (crossedTo50Idx === null && m <= PHASE_2_LOWER) {
      crossedTo50Idx = j;
    }
    if (crossedTo30Idx === null && m <= PHASE_3_BOUNDARY) {
      crossedTo30Idx = j;
    }
    if (retentionCrossIdx === null && m <= retentionThreshold) {
      retentionCrossIdx = j;
    }
  }

  // ── V_grav: peak → 50% ──
  let vGrav: number | null = null;
  let phase1DurationHours: number | null = null;

  if (peakMoisture > PHASE_1_BOUNDARY && crossedTo50Idx !== null) {
    const t50Ms = toMs(data[crossedTo50Idx].recorded_at);
    const hours = hoursElapsed(peakTimeMs, t50Ms);
    if (hours > 0) {
      vGrav = (peakMoisture - PHASE_2_LOWER) / hours;
      phase1DurationHours = hours;
    }
  } else if (peakMoisture <= PHASE_1_BOUNDARY && peakMoisture > PHASE_2_LOWER && crossedTo50Idx !== null) {
    // Peak was in Phase 2 range but above 50%. Still compute a partial rate.
    const t50Ms = toMs(data[crossedTo50Idx].recorded_at);
    const hours = hoursElapsed(peakTimeMs, t50Ms);
    if (hours > 0) {
      vGrav = (peakMoisture - PHASE_2_LOWER) / hours;
      phase1DurationHours = hours;
    }
  }

  // ── V_dry: 50% → 30% ──
  let vDry: number | null = null;
  let phase2DurationHours: number | null = null;
  let phase3DurationHours: number | null = null;

  if (crossedTo50Idx !== null && crossedTo30Idx !== null) {
    const t50Ms = toMs(data[crossedTo50Idx].recorded_at);
    const t30Ms = toMs(data[crossedTo30Idx].recorded_at);
    const hours = hoursElapsed(t50Ms, t30Ms);
    if (hours > 0) {
      vDry = (PHASE_2_LOWER - PHASE_3_BOUNDARY) / hours;
    }
  }

  // ── Phase 2 duration: time spent between 70% and 30% ──
  if (crossedTo70Idx !== null) {
    const entryMs = toMs(data[crossedTo70Idx].recorded_at);
    const exitMs = crossedTo30Idx !== null
      ? toMs(data[crossedTo30Idx].recorded_at)
      : toMs(data[data.length - 1].recorded_at); // Still in Phase 2
    phase2DurationHours = hoursElapsed(entryMs, exitMs);
  }

  // ── Phase 3 duration: time spent below 30% ──
  if (crossedTo30Idx !== null) {
    const entryMs = toMs(data[crossedTo30Idx].recorded_at);
    const latestMs = toMs(data[data.length - 1].recorded_at);
    phase3DurationHours = hoursElapsed(entryMs, latestMs);
  }

  // ── Retention (backward compat) ──
  let retentionHours: number | null = null;
  if (retentionCrossIdx !== null) {
    const dropTimeMs = toMs(data[retentionCrossIdx].recorded_at);
    retentionHours = +hoursElapsed(peakTimeMs, dropTimeMs).toFixed(1);
  }

  return {
    vGrav: vGrav !== null ? +vGrav.toFixed(3) : null,
    vDry: vDry !== null ? +vDry.toFixed(3) : null,
    phase1DurationHours: phase1DurationHours !== null ? +phase1DurationHours.toFixed(1) : null,
    phase2DurationHours: phase2DurationHours !== null ? +phase2DurationHours.toFixed(1) : null,
    phase3DurationHours: phase3DurationHours !== null ? +phase3DurationHours.toFixed(1) : null,
    retentionHours,
  };
}

// ─── Current phase tracking ──────────────────────────────────────────────────

/**
 * Determine the current phase and how long the soil has been in that phase.
 * Also detects sustained time above 70% for Phase 1 failure detection.
 */
function analyzeCurrentPhase(data: MoistureReading[]): {
  currentPhase: 1 | 2 | 3 | null;
  currentPhaseSince: string | null;
  hoursAbove70: number | null;
} {
  if (data.length === 0) {
    return { currentPhase: null, currentPhaseSince: null, hoursAbove70: null };
  }

  const latest = data[data.length - 1];
  const currentPhase = classifyPhase(latest.moisture_pct);

  // Walk backward to find when this phase started
  let phaseSinceIdx = data.length - 1;
  for (let i = data.length - 2; i >= 0; i--) {
    if (classifyPhase(data[i].moisture_pct) !== currentPhase) break;
    phaseSinceIdx = i;
  }

  const currentPhaseSince = data[phaseSinceIdx].recorded_at;

  // Hours above 70% — continuous count backward from latest
  let hoursAbove70: number | null = null;
  if (currentPhase === 1) {
    const latestMs = toMs(latest.recorded_at);
    const sinceMs = toMs(currentPhaseSince);
    hoursAbove70 = hoursElapsed(sinceMs, latestMs);
  }

  return { currentPhase, currentPhaseSince, hoursAbove70 };
}

// ─── drainClass mapping ──────────────────────────────────────────────────────

/**
 * Map piecewise velocities to backward-compatible drain classes.
 *
 * Priority: V_grav (if available) characterises the medium's macro structure.
 * Fallback: retention time (if available).
 * Default: "unknown".
 */
function mapDrainClass(
  vGrav: number | null,
  retentionHours: number | null
): "rapid" | "moderate" | "stagnant" | "unknown" {
  // V_grav is the strongest signal
  if (vGrav !== null) {
    if (vGrav > 3.0) return "rapid";      // Drains Phase 1 very quickly
    if (vGrav > 0.8) return "moderate";    // Reasonable clearance
    return "stagnant";                     // Slow or no clearance
  }

  // Fallback to retention time (existing logic)
  if (retentionHours !== null) {
    if (retentionHours < 6) return "rapid";
    if (retentionHours <= 48) return "moderate";
    return "stagnant";
  }

  return "unknown";
}

// ─── Main entrypoint ─────────────────────────────────────────────────────────

/**
 * Analyze calibrated moisture history using piecewise segmented drainage.
 *
 * Accepts the same input format as DrainageCard.tsx for seamless integration.
 * Returns PiecewiseDrainageResult with both new velocities and backward-compatible fields.
 */
export function analyzePiecewiseDrainage(
  data: MoistureReading[]
): PiecewiseDrainageResult {
  const defaultResult: PiecewiseDrainageResult = {
    vGrav: null,
    vDry: null,
    phase1DurationHours: null,
    phase2DurationHours: null,
    phase3DurationHours: null,
    currentPhase: null,
    currentPhaseSince: null,
    phase1Failure: false,
    hoursAbove70: null,
    drainClass: "unknown",
    retentionHours: null,
    wateringEvents: 0,
    lastWateringAt: null,
    peakMoisture: null,
    isHistoricalRate: false,
    historicalDrainClass: "unknown",
  };

  if (data.length < 6) return defaultResult;

  // Sort ascending by time
  const sorted = [...data].sort(
    (a, b) => toMs(a.recorded_at) - toMs(b.recorded_at)
  );

  // Median filter to strip ADC glitches
  const filtered = medianFilter(sorted);

  // Restrict to analysis window
  const latestTimeMs = toMs(filtered[filtered.length - 1].recorded_at);
  const cutoff = latestTimeMs - ANALYSIS_WINDOW_MS;
  const window = filtered.filter(d => toMs(d.recorded_at) >= cutoff);

  if (window.length < 2) return defaultResult;

  // Detect watering events over the ENTIRE historical dataset, not just the window
  const allEvents = detectWateringEvents(filtered);
  const eventsInWindow = detectWateringEvents(window);

  // Analyze current phase using the recent window
  const phaseInfo = analyzeCurrentPhase(window);

  if (allEvents.length === 0) {
    return {
      ...defaultResult,
      ...phaseInfo,
      wateringEvents: 0,
    };
  }

  // Compute velocities from the most recent historical watering event
  const lastEvent = allEvents[allEvents.length - 1];
  const velocities = computeVelocities(filtered, lastEvent);
  
  // If the last event is outside our 5-day window, flag it as historical
  const isHistoricalRate = toMs(lastEvent.peakTimestamp) < cutoff;

  // Phase 1 Failure detection (Report Section 5, Trigger 1):
  // Moisture stays >70% for extended period without adequate V_grav
  const phase1Failure =
    phaseInfo.currentPhase === 1 &&
    phaseInfo.hoursAbove70 !== null &&
    phaseInfo.hoursAbove70 > 24 &&
    (velocities.vGrav === null || velocities.vGrav < 0.5);

  const drainClass = mapDrainClass(velocities.vGrav, velocities.retentionHours);

  return {
    vGrav: velocities.vGrav,
    vDry: velocities.vDry,
    phase1DurationHours: velocities.phase1DurationHours,
    phase2DurationHours: velocities.phase2DurationHours,
    phase3DurationHours: velocities.phase3DurationHours,
    currentPhase: phaseInfo.currentPhase,
    currentPhaseSince: phaseInfo.currentPhaseSince,
    phase1Failure,
    hoursAbove70: phaseInfo.hoursAbove70,
    drainClass,
    retentionHours: velocities.retentionHours,
    wateringEvents: eventsInWindow.length,
    lastWateringAt: lastEvent.peakTimestamp,
    peakMoisture: lastEvent.peakMoisture,
    isHistoricalRate,
    historicalDrainClass: drainClass,
  };
}
