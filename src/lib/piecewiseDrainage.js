"use strict";
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
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHASE_3_BOUNDARY = exports.PHASE_2_LOWER = exports.PHASE_2_UPPER = exports.PHASE_1_BOUNDARY = void 0;
exports.analyzePiecewiseDrainage = analyzePiecewiseDrainage;
// ─── Phase Boundary Constants ────────────────────────────────────────────────
/** Upper boundary — above this, gravity is the primary drainage driver */
exports.PHASE_1_BOUNDARY = 70;
/** Field capacity zone — matric potential dominates between these bounds */
exports.PHASE_2_UPPER = 70;
exports.PHASE_2_LOWER = 50;
/** Below this, only capillary tension and evapotranspiration cause loss */
exports.PHASE_3_BOUNDARY = 30;
/** Minimum moisture jump to count as a watering event */
var SPIKE_THRESHOLD = 10;
/** How far ahead (ms) to search for the peak after a detected spike */
var PEAK_SEARCH_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours
/** Analysis window — only consider data within this range */
var ANALYSIS_WINDOW_MS = 5 * 24 * 60 * 60 * 1000; // 5 days
// ─── Types ───────────────────────────────────────────────────────────────────
var sensorUtils_1 = require("./sensorUtils");
// ─── Helpers ─────────────────────────────────────────────────────────────────
function toMs(iso) {
    return new Date(iso).getTime();
}
function hoursElapsed(startMs, endMs) {
    return (endMs - startMs) / (1000 * 60 * 60);
}
/**
 * Determine which phase a moisture reading is in.
 */
function classifyPhase(moisture) {
    if (moisture > exports.PHASE_1_BOUNDARY)
        return 1;
    if (moisture >= exports.PHASE_3_BOUNDARY)
        return 2;
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
function computeVelocities(data, event, nextEventSpikeIdx) {
    var peakTimeMs = toMs(data[event.peakIdx].recorded_at);
    var peakMoisture = event.peakMoisture;
    var endLimitIdx = nextEventSpikeIdx !== undefined ? nextEventSpikeIdx : (data.length - 1);
    // Track when we cross each boundary
    var crossedTo50Idx = peakMoisture <= exports.PHASE_2_LOWER ? event.peakIdx : null;
    var crossedTo70Idx = peakMoisture <= exports.PHASE_1_BOUNDARY ? event.peakIdx : null;
    var crossedTo30Idx = peakMoisture <= exports.PHASE_3_BOUNDARY ? event.peakIdx : null;
    // Also track retention (10% drop from peak, for backward compat)
    var retentionThreshold = peakMoisture - 10;
    var retentionCrossIdx = null;
    for (var j = event.peakIdx + 1; j <= endLimitIdx; j++) {
        var m = data[j].moisture_pct;
        if (crossedTo70Idx === null && m <= exports.PHASE_1_BOUNDARY) {
            crossedTo70Idx = j;
        }
        if (crossedTo50Idx === null && m <= exports.PHASE_2_LOWER) {
            crossedTo50Idx = j;
        }
        if (crossedTo30Idx === null && m <= exports.PHASE_3_BOUNDARY) {
            crossedTo30Idx = j;
        }
        if (retentionCrossIdx === null && m <= retentionThreshold) {
            retentionCrossIdx = j;
        }
    }
    // ── V_grav: peak → 50% ──
    var vGrav = null;
    var phase1DurationHours = null;
    if (peakMoisture > exports.PHASE_1_BOUNDARY && crossedTo50Idx !== null) {
        var t50Ms = toMs(data[crossedTo50Idx].recorded_at);
        var hours = hoursElapsed(peakTimeMs, t50Ms);
        if (hours > 0) {
            vGrav = (peakMoisture - exports.PHASE_2_LOWER) / hours;
            phase1DurationHours = hours;
        }
    }
    else if (peakMoisture <= exports.PHASE_1_BOUNDARY && peakMoisture > exports.PHASE_2_LOWER && crossedTo50Idx !== null) {
        // Peak was in Phase 2 range but above 50%. Still compute a partial rate.
        var t50Ms = toMs(data[crossedTo50Idx].recorded_at);
        var hours = hoursElapsed(peakTimeMs, t50Ms);
        if (hours > 0) {
            vGrav = (peakMoisture - exports.PHASE_2_LOWER) / hours;
            phase1DurationHours = hours;
        }
    }
    // ── V_dry: 50% (or peak) → 30% (or end of event) ──
    var vDry = null;
    var phase2DurationHours = null;
    var phase3DurationHours = null;
    if (peakMoisture > exports.PHASE_2_LOWER) {
        if (crossedTo50Idx !== null && crossedTo30Idx !== null) {
            var t50Ms = toMs(data[crossedTo50Idx].recorded_at);
            var t30Ms = toMs(data[crossedTo30Idx].recorded_at);
            var hours = hoursElapsed(t50Ms, t30Ms);
            if (hours > 0) {
                vDry = (exports.PHASE_2_LOWER - exports.PHASE_3_BOUNDARY) / hours;
            }
        }
    }
    else {
        // Peak is in Phase 3 or borderline. Measure ET rate across the whole available window for stability.
        var startMs = peakTimeMs;
        var startMoisture = peakMoisture;
        var endMoisture = data[endLimitIdx].moisture_pct;
        // Only calculate if we've dropped a bit or enough time has passed to establish a stable rate
        var hours = hoursElapsed(startMs, toMs(data[endLimitIdx].recorded_at));
        if (hours >= 2 && (startMoisture - endMoisture) >= 0) {
            vDry = (startMoisture - endMoisture) / hours;
        }
    }
    // ── Transit 70% to 50% ──
    var transit70to50Hours = null;
    if (crossedTo70Idx !== null) {
        var t70Ms = toMs(data[crossedTo70Idx].recorded_at);
        var exitMs = crossedTo50Idx !== null
            ? toMs(data[crossedTo50Idx].recorded_at)
            : toMs(data[endLimitIdx].recorded_at);
        transit70to50Hours = hoursElapsed(t70Ms, exitMs);
    }
    // ── Phase 2 duration: time spent between 70% and 30% ──
    if (crossedTo70Idx !== null) {
        var entryMs = toMs(data[crossedTo70Idx].recorded_at);
        var exitMs = crossedTo30Idx !== null
            ? toMs(data[crossedTo30Idx].recorded_at)
            : toMs(data[endLimitIdx].recorded_at); // Still in Phase 2
        phase2DurationHours = hoursElapsed(entryMs, exitMs);
    }
    // ── Phase 3 duration: time spent below 30% ──
    if (crossedTo30Idx !== null) {
        var entryMs = toMs(data[crossedTo30Idx].recorded_at);
        var latestMs = toMs(data[endLimitIdx].recorded_at);
        phase3DurationHours = hoursElapsed(entryMs, latestMs);
    }
    // ── Retention (backward compat) ──
    var retentionHours = null;
    if (retentionCrossIdx !== null) {
        var dropTimeMs = toMs(data[retentionCrossIdx].recorded_at);
        retentionHours = +hoursElapsed(peakTimeMs, dropTimeMs).toFixed(1);
    }
    return {
        vGrav: vGrav !== null ? +vGrav.toFixed(3) : null,
        vDry: vDry !== null ? +vDry.toFixed(3) : null,
        phase1DurationHours: phase1DurationHours !== null ? +phase1DurationHours.toFixed(1) : null,
        phase2DurationHours: phase2DurationHours !== null ? +phase2DurationHours.toFixed(1) : null,
        phase3DurationHours: phase3DurationHours !== null ? +phase3DurationHours.toFixed(1) : null,
        transit70to50Hours: transit70to50Hours !== null ? +transit70to50Hours.toFixed(1) : null,
        retentionHours: retentionHours,
    };
}
// ─── Current phase tracking ──────────────────────────────────────────────────
/**
 * Determine the current phase and how long the soil has been in that phase.
 * Also detects sustained time above 70% for Phase 1 failure detection.
 */
function analyzeCurrentPhase(data) {
    if (data.length === 0) {
        return { currentPhase: null, currentPhaseSince: null, hoursAbove70: null };
    }
    var latest = data[data.length - 1];
    var currentPhase = classifyPhase(latest.moisture_pct);
    // Walk backward to find when this phase started
    var phaseSinceIdx = data.length - 1;
    for (var i = data.length - 2; i >= 0; i--) {
        if (classifyPhase(data[i].moisture_pct) !== currentPhase)
            break;
        phaseSinceIdx = i;
    }
    var currentPhaseSince = data[phaseSinceIdx].recorded_at;
    // Hours above 70% — continuous count backward from latest
    var hoursAbove70 = null;
    if (currentPhase === 1) {
        var latestMs = toMs(latest.recorded_at);
        var sinceMs = toMs(currentPhaseSince);
        hoursAbove70 = hoursElapsed(sinceMs, latestMs);
    }
    return { currentPhase: currentPhase, currentPhaseSince: currentPhaseSince, hoursAbove70: hoursAbove70 };
}
// ─── drainClass mapping ──────────────────────────────────────────────────────
/**
 * Map piecewise velocities to backward-compatible drain classes.
 * Phase-dependent evaluation: Phase 1 & 2 evaluated on macropores/gravity, Phase 3 evaluated on Capillary ET.
 */
function mapDrainClass(vGrav, retentionHours, vDry, peakMoisture) {
    if (peakMoisture === null)
        return "unknown";
    // Phase 1 / Phase 2 (Peak > 50%) -> Judged by V_grav or retention time
    if (peakMoisture >= exports.PHASE_2_LOWER) {
        // V_grav is the strongest signal
        if (vGrav !== null) {
            if (vGrav > 3.0)
                return "rapid"; // Drains Phase 1 very quickly
            if (vGrav > 0.8)
                return "moderate"; // Reasonable clearance
            return "stagnant"; // Slow or no clearance
        }
        // Fallback to retention time (existing logic)
        if (retentionHours !== null) {
            if (retentionHours < 6)
                return "rapid";
            if (retentionHours <= 48)
                return "moderate";
            return "stagnant";
        }
        return "unknown";
    }
    // Phase 3 (Peak < 50%) -> Judged purely by capillary ET drying rate (vDry)
    if (vDry !== null) {
        if (vDry > 0.5)
            return "rapid"; // Active ET
        if (vDry >= 0.1)
            return "moderate"; // Normal Dry
        return "stagnant"; // Very slow (high humidity / shade)
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
function analyzePiecewiseDrainage(data) {
    var defaultResult = {
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
    };
    if (data.length < 6)
        return defaultResult;
    // Sort ascending by time
    var sorted = __spreadArray([], data, true).sort(function (a, b) { return toMs(a.recorded_at) - toMs(b.recorded_at); });
    // Median filter to strip ADC glitches
    var filtered = (0, sensorUtils_1.medianFilter)(sorted);
    // Restrict to analysis window
    var latestTimeMs = toMs(filtered[filtered.length - 1].recorded_at);
    var cutoff = latestTimeMs - ANALYSIS_WINDOW_MS;
    var window = filtered.filter(function (d) { return toMs(d.recorded_at) >= cutoff; });
    if (window.length < 2)
        return defaultResult;
    // Detect watering events over the ENTIRE historical dataset, not just the window
    var allEvents = (0, sensorUtils_1.detectWateringEvents)(filtered);
    var eventsInWindow = (0, sensorUtils_1.detectWateringEvents)(window);
    // Analyze current phase using the recent window
    var phaseInfo = analyzeCurrentPhase(window);
    if (allEvents.length === 0) {
        return __assign(__assign(__assign({}, defaultResult), phaseInfo), { wateringEvents: 0 });
    }
    // 1. Calculate CURRENT event velocities
    var currentEvent = allEvents[allEvents.length - 1];
    var currentVelocities = computeVelocities(filtered, currentEvent);
    var currentDrainClass = mapDrainClass(currentVelocities.vGrav, currentVelocities.retentionHours, currentVelocities.vDry, currentEvent.peakMoisture);
    // 2. Determine HISTORICAL cached values (if current is unknown)
    var bestVelocities = currentVelocities;
    var bestDrainClass = currentDrainClass;
    var bestEvent = currentEvent;
    if (currentDrainClass === "unknown" && allEvents.length > 1) {
        for (var i = allEvents.length - 2; i >= 0; i--) {
            var nextSpikeIdx = allEvents[i + 1].spikeIdx;
            var hVels = computeVelocities(filtered, allEvents[i], nextSpikeIdx);
            var hClass = mapDrainClass(hVels.vGrav, hVels.retentionHours, hVels.vDry, allEvents[i].peakMoisture);
            if (hClass !== "unknown") {
                bestVelocities = hVels;
                bestDrainClass = hClass;
                bestEvent = allEvents[i];
                break;
            }
        }
    }
    var isHistoricalRate = toMs(bestEvent.peakTimestamp) < cutoff || bestEvent !== currentEvent;
    // 3. Phase 1 Failure detection (Report Section 5, Trigger 1):
    // Moisture stays >70% for extended period without adequate V_grav (Uses CURRENT velocities)
    var phase1Failure = phaseInfo.currentPhase === 1 &&
        phaseInfo.hoursAbove70 !== null &&
        phaseInfo.hoursAbove70 > 24 &&
        (currentVelocities.vGrav === null || currentVelocities.vGrav < 0.5);
    // Phase 2 Failure: transit time between 70% and 50% > 96h (Uses CURRENT velocities)
    var phase2Failure = currentVelocities.transit70to50Hours !== null && currentVelocities.transit70to50Hours > 96;
    // Phase 3 Warning: rapid loss > 0.5%/hr indicates high demand (Uses CURRENT velocities)
    var phase3Warning = currentVelocities.vDry !== null && currentVelocities.vDry > 0.5;
    return {
        vGrav: currentVelocities.vGrav,
        vDry: currentVelocities.vDry,
        phase1DurationHours: currentVelocities.phase1DurationHours,
        phase2DurationHours: currentVelocities.phase2DurationHours,
        phase3DurationHours: currentVelocities.phase3DurationHours,
        currentPhase: phaseInfo.currentPhase,
        currentPhaseSince: phaseInfo.currentPhaseSince,
        phase1Failure: phase1Failure,
        hoursAbove70: phaseInfo.hoursAbove70,
        phase2Failure: phase2Failure,
        phase3Warning: phase3Warning,
        transit70to50Hours: currentVelocities.transit70to50Hours,
        drainClass: currentDrainClass,
        retentionHours: currentVelocities.retentionHours,
        wateringEvents: eventsInWindow.length,
        lastWateringAt: currentEvent.peakTimestamp,
        peakMoisture: currentEvent.peakMoisture,
        vpd_kpa: null,
        alan_interference: false,
        isHistoricalRate: isHistoricalRate,
        historicalDrainClass: bestDrainClass,
        cachedVGrav: bestVelocities.vGrav,
        cachedVDry: bestVelocities.vDry,
        cachedDrainClass: bestDrainClass,
    };
}
