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

import {
  type MoistureReading,
  type WateringEvent,
  medianFilter,
  detectWateringEvents,
} from "./sensorUtils";

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

  // ── Phase 2 & 3 Alerts (New) ──
  /** True if transit time between 70% and 50% exceeds 96 hours (Waterlogged) */
  phase2Failure: boolean;
  /** True if Phase 3 capillary loss is exceptionally rapid (high atmospheric demand) */
  phase3Warning: boolean;
  /** Transit time between 70% and 50% */
  transit70to50Hours: number | null;

  // ── Backward-compatible mapping ──
  drainClass: "rapid" | "moderate" | "stagnant" | "unknown";

  // ── Existing fields preserved for DrainageCard ──
  retentionHours: number | null;
  wateringEvents: number;
  lastWateringAt: string | null;
  peakMoisture: number | null;
  
  // ── Atmospheric / Light Integration ──
  vpd_kpa?: number | null;
  alan_interference?: boolean;

  // ── Historical Caching (New) ──
  isHistoricalRate?: boolean;
  historicalDrainClass?: "rapid" | "moderate" | "stagnant" | "unknown";
  cachedVGrav?: number | null;
  cachedVDry?: number | null;
  cachedDrainClass?: "rapid" | "moderate" | "stagnant" | "unknown";

  // ── 30-Day Aggregates (New) ──
  avgVGrav: number | null;
  avgVDry: number | null;
  avgPhase2Duration: number | null;
  totalEventsAnalyzed: number;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toMs(iso: string): number {
  return new Date(iso).getTime();
}

function hoursElapsed(startMs: number, endMs: number): number {
  return (endMs - startMs) / (1000 * 60 * 60);
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
  event: WateringEvent,
  nextEventSpikeIdx?: number
): {
  vGrav: number | null;
  vDry: number | null;
  phase1DurationHours: number | null;
  phase2DurationHours: number | null;
  phase3DurationHours: number | null;
  retentionHours: number | null;
  transit70to50Hours: number | null;
  phase2Completed: boolean;
} {
  const peakTimeMs = toMs(data[event.peakIdx].recorded_at);
  const peakMoisture = event.peakMoisture;
  const endLimitIdx = nextEventSpikeIdx !== undefined ? nextEventSpikeIdx : (data.length - 1);

  let crossedTo70Idx: number | null = peakMoisture <= PHASE_1_BOUNDARY ? event.peakIdx : null;
  let crossedTo50Idx: number | null = peakMoisture <= PHASE_2_LOWER ? event.peakIdx : null;
  let crossedTo30Idx: number | null = peakMoisture <= PHASE_3_BOUNDARY ? event.peakIdx : null;

  const retentionThreshold = peakMoisture - 10;
  let retentionCrossIdx: number | null = null;

  for (let j = event.peakIdx + 1; j <= endLimitIdx; j++) {
    const m = data[j].moisture_pct;
    if (crossedTo70Idx === null && m <= PHASE_1_BOUNDARY) crossedTo70Idx = j;
    if (crossedTo50Idx === null && m <= PHASE_2_LOWER) crossedTo50Idx = j;
    if (crossedTo30Idx === null && m <= PHASE_3_BOUNDARY) crossedTo30Idx = j;
    if (retentionCrossIdx === null && m <= retentionThreshold) retentionCrossIdx = j;
  }

  // ── Phase 1 ($V_{grav}$): Peak → 70% ──
  let vGrav: number | null = null;
  let phase1DurationHours: number | null = null;

  if (peakMoisture > PHASE_1_BOUNDARY && crossedTo70Idx !== null) {
    const t70Ms = toMs(data[crossedTo70Idx].recorded_at);
    const hours = hoursElapsed(peakTimeMs, t70Ms);
    const safeHours = Math.max(hours, 0.5); // Prevent astronomical numbers for near-instant drops
    vGrav = (peakMoisture - PHASE_1_BOUNDARY) / safeHours;
    phase1DurationHours = hours;
  }

  // ── Phase 2 (Transit): 70% → 30% ──
  let phase2DurationHours: number | null = null;
  if (crossedTo70Idx !== null || peakMoisture <= PHASE_1_BOUNDARY) {
    const entryMs = crossedTo70Idx !== null ? toMs(data[crossedTo70Idx].recorded_at) : peakTimeMs;
    if (crossedTo30Idx !== null) {
       const exitMs = toMs(data[crossedTo30Idx].recorded_at);
       phase2DurationHours = hoursElapsed(entryMs, exitMs);
    }
  }

  // Transit 70% to 50% (kept for alerts)
  let transit70to50Hours: number | null = null;
  if (crossedTo70Idx !== null && crossedTo50Idx !== null) {
    const t70Ms = toMs(data[crossedTo70Idx].recorded_at);
    const t50Ms = toMs(data[crossedTo50Idx].recorded_at);
    transit70to50Hours = hoursElapsed(t70Ms, t50Ms);
  }

  // ── Phase 3 ($V_{dry}$): 30% → minimum ──
  let vDry: number | null = null;
  let phase3DurationHours: number | null = null;

  if (crossedTo30Idx !== null) {
    const t30Ms = toMs(data[crossedTo30Idx].recorded_at);
    const latestMs = toMs(data[endLimitIdx].recorded_at);
    const hours = hoursElapsed(t30Ms, latestMs);
    phase3DurationHours = hours;
    
    // Find minimum moisture reached in Phase 3
    let minMoisture = data[crossedTo30Idx].moisture_pct;
    for (let i = crossedTo30Idx + 1; i <= endLimitIdx; i++) {
        if (data[i].moisture_pct < minMoisture) {
            minMoisture = data[i].moisture_pct;
        }
    }
    
    // Need at least 1 hour of Phase 3 data for stable ET rate
    if (hours >= 1) { 
       vDry = (PHASE_3_BOUNDARY - minMoisture) / hours;
    }
  } else if (peakMoisture <= PHASE_3_BOUNDARY) {
      const hours = hoursElapsed(peakTimeMs, toMs(data[endLimitIdx].recorded_at));
      phase3DurationHours = hours;
      const endMoisture = data[endLimitIdx].moisture_pct;
      if (hours >= 1 && peakMoisture - endMoisture >= 0) {
          vDry = (peakMoisture - endMoisture) / hours;
      }
  }

  // ── Retention ──
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
    transit70to50Hours: transit70to50Hours !== null ? +transit70to50Hours.toFixed(1) : null,
    retentionHours,
    phase2Completed: crossedTo30Idx !== null,
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
  hoursAbove50: number | null;
} {
  if (data.length === 0) {
    return { currentPhase: null, currentPhaseSince: null, hoursAbove70: null, hoursAbove50: null };
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

  // Hours above 70% & 50% — continuous count backward from latest, regardless of watering spikes
  let hoursAbove70: number | null = null;
  let hoursAbove50: number | null = null;
  const latestMs = toMs(latest.recorded_at);

  if (latest.moisture_pct > PHASE_1_BOUNDARY) {
    let crossed70Idx = data.length - 1;
    for (let i = data.length - 2; i >= 0; i--) {
      if (data[i].moisture_pct <= PHASE_1_BOUNDARY) break;
      crossed70Idx = i;
    }
    hoursAbove70 = hoursElapsed(toMs(data[crossed70Idx].recorded_at), latestMs);
  }

  if (latest.moisture_pct > PHASE_2_LOWER) {
    let crossed50Idx = data.length - 1;
    for (let i = data.length - 2; i >= 0; i--) {
      if (data[i].moisture_pct <= PHASE_2_LOWER) break;
      crossed50Idx = i;
    }
    hoursAbove50 = hoursElapsed(toMs(data[crossed50Idx].recorded_at), latestMs);
  }

  return { currentPhase, currentPhaseSince, hoursAbove70, hoursAbove50 };
}

// ─── drainClass mapping ──────────────────────────────────────────────────────

/**
 * Map piecewise velocities to backward-compatible drain classes.
 * Phase-dependent evaluation: Phase 1 & 2 evaluated on macropores/gravity, Phase 3 evaluated on Capillary ET.
 */
function mapDrainClass(
  avgVGrav: number | null,
  avgVDry: number | null,
  avgPhase2Duration: number | null
): "rapid" | "moderate" | "stagnant" | "unknown" {
  // Phase 1 (Gravitational) evaluates macropores. This is the primary indicator of soil structure health.
  if (avgVGrav !== null) {
    if (avgVGrav > 3.0) return "rapid";
    if (avgVGrav >= 0.8) return "moderate";
    return "stagnant";
  }

  // If no Phase 1 happened (never reached >70%), evaluate Phase 3 ET rate
  if (avgVDry !== null) {
    if (avgVDry > 0.5) return "rapid";
    if (avgVDry >= 0.1) return "moderate";
    return "stagnant";
  }

  // Fallback to Phase 2 Transit Time
  if (avgPhase2Duration !== null) {
    if (avgPhase2Duration < 24) return "rapid";
    if (avgPhase2Duration <= 72) return "moderate";
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
    phase2Failure: false,
    phase3Warning: false,
    transit70to50Hours: null,
    drainClass: "unknown",
    retentionHours: null,
    wateringEvents: 0,
    lastWateringAt: null,
    peakMoisture: null,
    vpd_kpa: null,
    alan_interference: false,
    isHistoricalRate: false,
    historicalDrainClass: "unknown",
    cachedVGrav: null,
    cachedVDry: null,
    cachedDrainClass: "unknown",
    avgVGrav: null,
    avgVDry: null,
    avgPhase2Duration: null,
    totalEventsAnalyzed: 0,
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

  // 1. Calculate 30-day averages across all detected events first
  let totalVGrav = 0, countVGrav = 0;
  let totalVDry = 0, countVDry = 0;
  let totalPhase2 = 0, countPhase2 = 0;
  let totalEventsAnalyzed = 0;

  for (let i = 0; i < allEvents.length; i++) {
    const nextSpikeIdx = i < allEvents.length - 1 ? allEvents[i + 1].spikeIdx : undefined;
    const vels = computeVelocities(filtered, allEvents[i], nextSpikeIdx);
    
    let counted = false;
    if (vels.vGrav !== null) {
      totalVGrav += vels.vGrav;
      countVGrav++;
      counted = true;
    }
    if (vels.vDry !== null) {
      totalVDry += vels.vDry;
      countVDry++;
      counted = true;
    }
    if (vels.phase2DurationHours !== null && vels.phase2Completed) {
      totalPhase2 += vels.phase2DurationHours;
      countPhase2++;
      counted = true;
    }
    if (counted) totalEventsAnalyzed++;
  }

  const avgVGrav = countVGrav > 0 ? +(totalVGrav / countVGrav).toFixed(3) : null;
  const avgVDry = countVDry > 0 ? +(totalVDry / countVDry).toFixed(3) : null;
  const avgPhase2Duration = countPhase2 > 0 ? +(totalPhase2 / countPhase2).toFixed(1) : null;

  // 2. Classify the overall drainage health based on 30-day averages
  const overallDrainClass = mapDrainClass(avgVGrav, avgVDry, avgPhase2Duration);

  // 3. Current Event Fallback (for < 2 events)
  const currentEvent = allEvents[allEvents.length - 1];
  const currentVelocities = computeVelocities(filtered, currentEvent);
  const currentDrainClass = mapDrainClass(currentVelocities.vGrav, currentVelocities.vDry, currentVelocities.phase2DurationHours);
  
  const finalDrainClass = totalEventsAnalyzed >= 2 ? overallDrainClass : currentDrainClass;

  // Determine HISTORICAL cached values (if current is unknown)
  let bestVelocities = currentVelocities;
  let bestDrainClass = finalDrainClass;
  let bestEvent = currentEvent;

  if (finalDrainClass === "unknown" && allEvents.length > 1) {
    for (let i = allEvents.length - 2; i >= 0; i--) {
      const nextSpikeIdx = allEvents[i + 1].spikeIdx;
      const hVels = computeVelocities(filtered, allEvents[i], nextSpikeIdx);
      const hClass = mapDrainClass(hVels.vGrav, hVels.vDry, hVels.phase2DurationHours);
      if (hClass !== "unknown") {
        bestVelocities = hVels;
        bestDrainClass = hClass;
        bestEvent = allEvents[i];
        break;
      }
    }
  }

  const isHistoricalRate = toMs(bestEvent.peakTimestamp) < cutoff || bestEvent !== currentEvent;

  // 4. Phase 1 Failure detection (Report Section 5, Trigger 1):
  // Moisture stays >70% for extended period without adequate V_grav (Uses CURRENT velocities)
  const phase1Failure =
    phaseInfo.currentPhase === 1 &&
    phaseInfo.hoursAbove70 !== null &&
    phaseInfo.hoursAbove70 > 24 &&
    (currentVelocities.vGrav === null || currentVelocities.vGrav < 0.5);

  const latestMoisture = filtered.length > 0 ? filtered[filtered.length - 1].moisture_pct : 0;
  const hoursSincePeak = filtered.length > 0 ? hoursElapsed(toMs(currentEvent.peakTimestamp), toMs(filtered[filtered.length - 1].recorded_at)) : 0;

  // Phase 2 Failure: transit time between 70% and 50% > 96h
  // Triggers if:
  // 1. It completed the transit and it took >96h
  // 2. OR it's currently stuck >50% for >96h since the current watering peak
  // 3. OR it has been continuously >50% for >96h across multiple waterings without a dry breath
  const phase2Failure = 
    (currentVelocities.transit70to50Hours !== null && currentVelocities.transit70to50Hours > 96) ||
    (currentVelocities.transit70to50Hours === null && latestMoisture > 50 && hoursSincePeak > 96) ||
    (phaseInfo.hoursAbove50 !== null && phaseInfo.hoursAbove50 > 96);
  // Phase 3 Warning: rapid loss > 0.5%/hr indicates high demand (Uses CURRENT velocities)
  const phase3Warning = currentVelocities.vDry !== null && currentVelocities.vDry > 0.5;

  return {
    vGrav: currentVelocities.vGrav,
    vDry: currentVelocities.vDry,
    phase1DurationHours: currentVelocities.phase1DurationHours,
    phase2DurationHours: currentVelocities.phase2DurationHours,
    phase3DurationHours: currentVelocities.phase3DurationHours,
    currentPhase: phaseInfo.currentPhase,
    currentPhaseSince: phaseInfo.currentPhaseSince,
    phase1Failure,
    hoursAbove70: phaseInfo.hoursAbove70,
    phase2Failure,
    phase3Warning,
    transit70to50Hours: currentVelocities.transit70to50Hours,
    drainClass: finalDrainClass,
    retentionHours: currentVelocities.retentionHours,
    wateringEvents: eventsInWindow.length,
    lastWateringAt: currentEvent.peakTimestamp,
    peakMoisture: currentEvent.peakMoisture,
    vpd_kpa: null,
    alan_interference: false,
    isHistoricalRate,
    historicalDrainClass: bestDrainClass,
    cachedVGrav: bestVelocities.vGrav,
    cachedVDry: bestVelocities.vDry,
    cachedDrainClass: bestDrainClass,
    avgVGrav,
    avgVDry,
    avgPhase2Duration,
    totalEventsAnalyzed,
  };
}
