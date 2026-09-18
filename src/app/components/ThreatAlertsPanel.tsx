"use client";

import { AlertTriangle, Droplets, Zap, CheckCircle2, Circle, ShieldAlert, Info, X } from "lucide-react";
import { useState } from "react";
import type { VPDDataPoint } from "./VPDChart";
import type { DLIDataPoint } from "./DLIChart";
import { type DrainageInput, type DrainageResult } from "@/lib/drainageAnalysis";
import { Moon } from "lucide-react";
import {
  analyzePiecewiseDrainage,
  type PiecewiseDrainageResult,
} from "@/lib/piecewiseDrainage";

// ─── Types ────────────────────────────────────────────────────────────────────

export type AlertStatus = "active" | "at-risk" | "clear" | "monitoring";

interface ThreatResult {
  status:      AlertStatus;
  title:       string;
  headline:    string;        // one-liner shown in collapsed state
  detail:      string;        // expanded explanation
  conditions:  { label: string; met: boolean; value: string }[];
}

// ─── Detection helpers ────────────────────────────────────────────────────────

function recentVpdAvg(vpdHistory: VPDDataPoint[], hoursBack: number): number | null {
  const cutoff = Date.now() - hoursBack * 3600 * 1000;
  const recent = vpdHistory.filter(d => new Date(d.recorded_at).getTime() >= cutoff);
  if (!recent.length) return null;
  return recent.reduce((s, d) => s + d.vpd_kpa, 0) / recent.length;
}

function recentMoistureStats(
  drainageData: DrainageInput[],
  hoursBack: number
): { avg: number; min: number; max: number; stdDev: number } | null {
  const cutoff = Date.now() - hoursBack * 3600 * 1000;
  const recent = drainageData.filter(d => new Date(d.recorded_at).getTime() >= cutoff);
  if (recent.length < 2) return null;
  const values = recent.map(d => d.moisture_pct);
  const avg = values.reduce((s, v) => s + v, 0) / values.length;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const variance = values.reduce((s, v) => s + (v - avg) ** 2, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  return { avg, min, max, stdDev };
}



// ─── Alert evaluation ─────────────────────────────────────────────────────────

export function evalRotWarning(
  drainageData: DrainageInput[],
  vpdHistory: VPDDataPoint[],
  latestMoisture: number | null,
  isPot: boolean,
  plantType: string | null,
  piecewise?: PiecewiseDrainageResult | null,
): ThreatResult {
  // Base thresholds
  let satThreshold = isPot ? 75 : 85;
  const flatThreshold = isPot ? 6 : 8;
  let windowHours = isPot ? 48 : 72;

  // Plant-specific adjustments
  if (plantType === "succulent") {
    // Succulents rot very easily, lower tolerance
    satThreshold = isPot ? 75 : 75;
    windowHours = isPot ? 48 : 72; 
  } else if (plantType === "carnivorous") {
    // Carnivorous/bog plants naturally live in bogs, extremely high rot tolerance
    satThreshold = 95;
    windowHours = 168; // 7 days of complete stagnation required
  }

  const moisture = recentMoistureStats(drainageData, windowHours);
  const vpd48hAvg   = recentVpdAvg(vpdHistory, 48);

  // ── Enhanced Phase 1 & 2 Failure detection (Report Section 5) ──
  // If piecewise data is available, use V_grav and transit times to detect macropore/mesopore stagnation.
  let highAndFlat: boolean;
  let phase2Failed = false;
  let phase1Failed = false;

  if (piecewise && piecewise.wateringEvents > 0) {
    // Phase 1 Failure: moisture is high AND gravitational clearance is inadequate
    phase1Failed = piecewise.phase1Failure ||
      (piecewise.vGrav !== null && piecewise.vGrav < 0.5) ||
      (piecewise.hoursAbove70 !== null && piecewise.hoursAbove70 > windowHours);
    
    // Phase 2 Failure: transit time from 70% to 50% takes >96h (mesopore stagnation)
    phase2Failed = !!piecewise.phase2Failure;
    
    // Trigger if Phase 1 failed (while saturated) OR if Phase 2 transit failed (chronic sogginess)
    highAndFlat = (moisture !== null && moisture.avg >= satThreshold && phase1Failed) || phase2Failed;
  } else {
    // Fallback: original stdDev-based flatness check when piecewise data unavailable
    highAndFlat =
      moisture !== null &&
      moisture.avg >= satThreshold &&
      moisture.stdDev < flatThreshold;
  }

  const lowVPD = vpd48hAvg !== null && vpd48hAvg < 0.4;

  const atRisk = (highAndFlat && !lowVPD) || (!highAndFlat && lowVPD);
  const active  = highAndFlat && lowVPD;

  const status: AlertStatus = active ? "active" : atRisk ? "at-risk" : "clear";

  // Condition labels — use piecewise terminology when available
  const moistureConditionLabel = (() => {
    if (piecewise && piecewise.wateringEvents > 0) {
      if (phase2Failed) return `Phase 2 transit failure (>96h between 70%–50%) — mesopore stagnation`;
      return `Phase 1 gravitational clearance < 0.5 %/hr (macropore failure, ${plantType || 'standard'})`;
    }
    return `Soil ≥ ${satThreshold}% moisture, flat for ${windowHours}h (${plantType || 'standard'} adjusted)`;
  })();

  const moistureConditionValue = (() => {
    if (piecewise && piecewise.wateringEvents > 0) {
      const parts: string[] = [];
      if (phase2Failed && piecewise.transit70to50Hours !== null) {
        parts.push(`transit: ${piecewise.transit70to50Hours.toFixed(1)}h`);
      } else {
        if (piecewise.vGrav !== null) parts.push(`V_grav: ${piecewise.vGrav.toFixed(2)} %/hr`);
        if (piecewise.hoursAbove70 !== null) parts.push(`${piecewise.hoursAbove70.toFixed(1)}h >70%`);
      }
      if (moisture) parts.push(`avg ${moisture.avg.toFixed(1)}%`);
      return parts.length > 0 ? parts.join(' · ') : "Insufficient data";
    }
    return moisture ? `avg ${moisture.avg.toFixed(1)}% · σ ${moisture.stdDev.toFixed(1)}%` : "Insufficient data";
  })();

  return {
    status,
    title: "Rot Warning",
    headline: active
      ? "Soil structurally stagnant & air stagnant — root-zone hypoxia imminent"
      : atRisk
      ? "One of two rot conditions detected — monitor closely"
      : "No rot risk detected",
    detail: piecewise && piecewise.wateringEvents > 0
      ? "Root rot triggers when either Phase 1 (macropore clearance) or Phase 2 (mesopore transit) structurally fails, cutting off root oxygen, while chronically low VPD prevents upward transpiration. Both soil stagnation and atmospheric stagnation must persist simultaneously."
      : "Root rot triggers when soil stays saturated (no oxygen replenishment) while chronically low VPD prevents the plant from transpiring water upward. Both conditions must persist simultaneously.",
    conditions: [
      {
        label: moistureConditionLabel,
        met:   highAndFlat,
        value: moistureConditionValue,
      },
      {
        label: "48h VPD < 0.4 kPa (stagnant air)",
        met:   lowVPD,
        value: vpd48hAvg !== null ? `${vpd48hAvg.toFixed(3)} kPa` : "Insufficient data",
      },
    ],
  };
}

export function evalDehydrationWarning(
  drainageData: DrainageInput[],
  vpdHistory: VPDDataPoint[],
  latestMoisture: number | null,
  isPot: boolean,
  plantType: string | null,
  piecewise?: PiecewiseDrainageResult | null,
): ThreatResult {
  // Base thresholds
  let dryThreshold = isPot ? 20 : 15;
  let vpdDanger = 1.6; // Updated from 1.5 per Report Section 5

  if (plantType === "succulent") {
    // Succulents thrive in dry conditions, but dropping below 10% risks tissue damage under high VPD
    dryThreshold = 10;
    vpdDanger = 2.0;
  } else if (plantType === "carnivorous") {
    // Bog plants dry out extremely fast and die
    dryThreshold = 40;
    vpdDanger = 1.2;
  } else if (plantType === "herb") {
    dryThreshold = isPot ? 25 : 20;
  }

  const isDry   = latestMoisture !== null && latestMoisture < dryThreshold;
  const vpd7d   = recentVpdAvg(vpdHistory, 7 * 24);
  const highVPD = vpd7d !== null && vpd7d > vpdDanger;

  // ── Enhanced Phase 3 Plateau detection (Report Section 5, Trigger 2) ──
  // If V_dry drops below a critical threshold, the soil is in a capillary stagnation zone.
  // The plant has likely stopped transpiring (stomatal closure) — a sign of drought stress.
  const vDryStagnation = 0.1;
  let phase3Plateau = false;

  if (plantType !== "succulent") {
    // CAM plants (succulents) naturally keep stomata closed during the day (near-zero V_dry).
    // The Phase 3 plateau early warning does not apply to them.
    phase3Plateau = piecewise?.vDry !== null && piecewise?.vDry !== undefined && piecewise.vDry < vDryStagnation;
  }
  
  const phase3StressDetected = phase3Plateau && highVPD;

  // Original trigger: dry soil + high VPD
  // Enhanced trigger: Phase 3 plateau (stomatal closure) + high VPD
  const atRisk = (isDry && !highVPD) || (!isDry && highVPD) || (phase3Plateau && !highVPD && !isDry);
  const active  = (isDry && highVPD) || phase3StressDetected;

  const status: AlertStatus = active ? "active" : atRisk ? "at-risk" : "clear";

  const conditions = [
    {
      label: `Current soil moisture < ${dryThreshold}% (${plantType || 'standard'} adjusted)`,
      met:   isDry,
      value: latestMoisture !== null ? `${latestMoisture.toFixed(1)}%` : "No reading",
    },
    {
      label: `7-day VPD avg > ${vpdDanger.toFixed(1)} kPa (atmospheric drought)`,
      met:   highVPD,
      value: vpd7d !== null ? `${vpd7d.toFixed(3)} kPa` : "Insufficient data",
    },
  ];

  // Add Phase 3 plateau condition when piecewise data is available and vDry is calculated
  if (piecewise && piecewise.vDry !== null && plantType !== "succulent") {
    conditions.push({
      label: `Phase 3 plateau: V_dry < ${vDryStagnation} %/hr (stomatal closure suspected)`,
      met: phase3Plateau,
      value: `${piecewise.vDry.toFixed(3)} %/hr`,
    });
  }

  return {
    status,
    title: "Dehydration Warning",
    headline: active
      ? phase3StressDetected && !isDry
        ? "Phase 3 stagnation with high VPD — stomatal closure detected"
        : "Soil critically dry with high atmospheric demand — leaf tissue loss risk"
      : atRisk
      ? phase3Plateau
        ? "Transpiration rate near zero — early drought stress signal"
        : "One of two dehydration conditions present"
      : "Hydration status normal",
    detail: phase3StressDetected
      ? "The soil drying rate (V_dry) has dropped below 0.1 %/hr, indicating the plant has closed its stomata in response to drought stress. Combined with high atmospheric VPD, the plant cannot regulate its temperature through transpiration."
      : "Dehydration stress occurs when soil water reserves are depleted (low moisture) while high VPD drives rapid transpiration from leaves faster than roots can supply. Stomata close, halting photosynthesis.",
    conditions,
  };
}

export function evalGrowthOptimization(
  dliHistory: DLIDataPoint[],
  vpdHistory: VPDDataPoint[],
  plantType: string | null,
  drainResult: DrainageResult,
  piecewise?: PiecewiseDrainageResult | null
): ThreatResult {
  // Latest DLI (today or most recent day)
  const latestDLI = dliHistory.length > 0
    ? [...dliHistory].sort((a, b) => b.day.localeCompare(a.day))[0].dli_mol_per_m2
    : null;

  // Base optimal DLI
  let minDli = 5;
  let maxDli = 15;

  if (plantType === "succulent") {
    minDli = 10; maxDli = 25;
  } else if (plantType === "carnivorous") {
    minDli = 10; maxDli = 15;
  } else if (plantType === "herb") {
    minDli = 12; maxDli = 20;
  } else if (plantType === "tropical") {
    minDli = 3; maxDli = 8;
  }

  const dliOptimal = latestDLI !== null && latestDLI >= minDli && latestDLI <= maxDli;
  const dliTooLow  = latestDLI !== null && latestDLI < minDli;
  const dliTooHigh = latestDLI !== null && latestDLI > maxDli;

  let drainGood = false;
  let drainLabel = "30-day soil structure optimal (not stagnant)";
  let drainValue = "Monitoring...";

  const isSucculent = plantType === "succulent" || plantType === "cactus";
  const isOptimalDry = isSucculent && (drainResult.category === "no-event" || (drainResult.currentMoisture !== null && drainResult.currentMoisture < 30));

  if (isOptimalDry) {
    drainGood = true;
    drainLabel = "30-day soil structure optimal or in dry phase";
    drainValue = `Optimal dry state (${drainResult.currentMoisture?.toFixed(0) ?? 0}%)`;
  } else if (piecewise && piecewise.drainClass !== "unknown") {
    drainGood = piecewise.drainClass === "rapid" || piecewise.drainClass === "moderate";
    drainLabel = isSucculent ? "30-day soil structure optimal or in dry phase" : "30-day soil structure optimal (not stagnant)";
    drainValue = piecewise.drainClass === "rapid" ? "Rapid drainage (30-day avg)" : 
                 piecewise.drainClass === "moderate" ? "Moderate drainage (30-day avg)" :
                 "Stagnant drainage (30-day avg)";
  } else {
    drainGood = drainResult.drainClass === "rapid" || drainResult.drainClass === "moderate";
    drainLabel = isSucculent ? "Soil properly draining or in optimal dry phase" : "Soil draining properly (not stagnant)";
    if (drainResult.retentionHours !== null) {
      drainValue = `${drainResult.retentionHours.toFixed(1)}h retention`;
    } else if (drainResult.category === "no-event") {
      drainValue = "No watering event detected";
    } else {
      drainValue = "Still retaining — monitoring";
    }
  }

  const vpd7d = recentVpdAvg(vpdHistory, 7 * 24);
  const vpdOptimal = vpd7d !== null && vpd7d >= 0.8 && vpd7d <= 1.2;

  const allGood = dliOptimal && drainGood === true && vpdOptimal;
  const anyGood = dliOptimal || drainGood === true || vpdOptimal;

  const status: AlertStatus = allGood ? "active" : anyGood ? "at-risk" : "monitoring";

  return {
    status,
    title: "Growth Optimization",
    headline: allGood
      ? "All three growth conditions are optimal — ideal growing conditions"
      : anyGood
      ? "Partial growth conditions met — some factors outside optimal range"
      : "Growth conditions not yet in optimal range",
    detail: "Peak vegetative growth requires all three factors to align simultaneously: sufficient but not excessive light (DLI), well-oxygenated soil (drainage), and moderate atmospheric drying power (VPD).",
    conditions: [
      {
        label: `DLI in optimal range (${minDli}–${maxDli} mol/m²)`,
        met:   dliOptimal,
        value: latestDLI !== null
          ? `${latestDLI.toFixed(2)} mol/m² — ${dliTooLow ? "too low" : dliTooHigh ? "too high" : "✓"}`
          : "No DLI data yet",
      },
      {
        label: drainLabel,
        met:   drainGood,
        value: drainValue,
      },
      {
        label: "VPD in stable zone (0.8–1.2 kPa)",
        met:   vpdOptimal,
        value: vpd7d !== null ? `${vpd7d.toFixed(3)} kPa 7-day avg` : "Insufficient VPD data",
      },
    ],
  };
}

export function evalNightLightWarning(
  logs: { recorded_at: string; illuminance_lux: number }[],
  plantType: string | null,
): ThreatResult {
  // ── CAM-specific ALAN thresholds (Report Section 2, Table 1) ──
  // Succulents (CAM plants): 2–8 lux causes stomatal closure & circadian decay.
  // Previous thresholds (15 lux disruption / 8 lux at-risk) were too lenient.
  let luxThreshold = 40;     // Disruption: confirmed biological impact
  let atRiskThreshold = 20;  // At-risk: elevated but not yet disruptive

  if (plantType === "succulent") {
    // CAM plants require strict dark periods for nocturnal CO2 assimilation.
    // Even 2 lux of artificial light triggers phytochrome and cryptochrome photoreceptors,
    // causing immediate stomatal closure.
    luxThreshold = 2; 
    atRiskThreshold = 0.5;
  } else if (plantType === "carnivorous") {
    luxThreshold = 30;
    atRiskThreshold = 10;
  } else if (plantType === "tropical") {
    luxThreshold = 25;
    atRiskThreshold = 12;
  }

  const isNight = logs.length > 0 && (new Date(logs[0].recorded_at).getHours() >= 21 || new Date(logs[0].recorded_at).getHours() < 6);

  // ── Sustained duration check ──
  // The report notes that 11–13 lux is harmless if temporary (<30 min).
  // Only flag if light has been above threshold for > 30 continuous minutes.
  const cutoff = Date.now() - 3600 * 1000; // Last hour of data
  const recentLogs = logs.filter(l => new Date(l.recorded_at).getTime() >= cutoff);
  
  const avgLux = recentLogs.length > 0 
    ? recentLogs.reduce((s, l) => s + l.illuminance_lux, 0) / recentLogs.length
    : null;

  // Calculate how many continuous minutes the light has been above threshold
  let sustainedMinutes = 0;
  if (recentLogs.length > 1) {
    // Walk backward from the most recent reading to find continuous duration above threshold
    const sortedRecent = [...recentLogs].sort(
      (a, b) => new Date(b.recorded_at).getTime() - new Date(a.recorded_at).getTime()
    );
    
    let prevTime = new Date(sortedRecent[0].recorded_at).getTime();
    for (let i = 0; i < sortedRecent.length; i++) {
      if (sortedRecent[i].illuminance_lux <= atRiskThreshold) break;
      const t = new Date(sortedRecent[i].recorded_at).getTime();
      if (i > 0 && prevTime - t > 3600 * 1000) break; // Gap too large
      sustainedMinutes = (new Date(sortedRecent[0].recorded_at).getTime() - t) / (1000 * 60);
      prevTime = t;
    }
  }

  // Require >30 minutes sustained to trigger (Report Section 2: "Safe Twilight Window")
  const isSustained = sustainedMinutes > 30;

  const isPolluted = avgLux !== null && avgLux > luxThreshold && isSustained;
  const isAtRisk = avgLux !== null && avgLux > atRiskThreshold && !isPolluted && isSustained;

  const active = isNight && isPolluted;
  const atRisk = isNight && isAtRisk;

  const status: AlertStatus = active ? "active" : atRisk ? "at-risk" : "clear";

  return {
    status,
    title: "Night Light Pollution",
    headline: active
      ? "Excessive light detected during night cycle — dark period interrupted"
      : atRisk
      ? "Elevated light levels detected during night cycle"
      : isNight 
        ? "Dark period optimal" 
        : "Currently day cycle — N/A",
    detail: plantType === "succulent" 
      ? "Succulents (CAM plants) open their stomata exclusively at night to absorb CO2, minimising daytime water loss. Even 2–8 lux of artificial light triggers phytochrome and cryptochrome photoreceptors, causing immediate stomatal closure. This stalls nocturnal carbon assimilation, prevents circadian entrainment, and disrupts interactions with nocturnal pollinators like moths and bats."
      : "Plants require a dark period for respiration and rest. Significant light pollution during the night cycle can disrupt their photoperiod, stressing the plant and stunting growth.",
    conditions: [
      {
        label: "Night cycle active (21:00 - 06:00)",
        met: isNight,
        value: logs.length > 0 ? `${new Date(logs[0].recorded_at).getHours().toString().padStart(2, '0')}:00` : "No data",
      },
      {
        label: `1h Avg Light > ${luxThreshold} lx (${plantType || 'standard'} tolerance)`,
        met: isPolluted,
        value: avgLux !== null ? `${avgLux.toFixed(1)} lx` : "No data",
      },
      {
        label: "Sustained > 30 min above threshold",
        met: isSustained,
        value: sustainedMinutes > 0 ? `${Math.round(sustainedMinutes)} min continuous` : "< 1 min",
      },
    ],
  };
}

// ─── Status config ────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<AlertStatus, {
  dot: string;
  badge: string;
  badgeBg: string;
  badgeBorder: string;
  rowBorder: string;
  rowBg: string;
  label: string;
}> = {
  active: {
    dot:         "bg-red-500 animate-pulse",
    badge:       "text-red-400",
    badgeBg:     "#450a0a33",
    badgeBorder: "#ef444450",
    rowBorder:   "border-red-500/25",
    rowBg:       "bg-red-950/15",
    label:       "ACTIVE",
  },
  "at-risk": {
    dot:         "bg-orange-400 animate-pulse",
    badge:       "text-orange-400",
    badgeBg:     "#43150033",
    badgeBorder: "#f9731650",
    rowBorder:   "border-orange-500/25",
    rowBg:       "bg-orange-950/10",
    label:       "AT RISK",
  },
  clear: {
    dot:         "bg-emerald-500",
    badge:       "text-emerald-400",
    badgeBg:     "#06402033",
    badgeBorder: "#10b98140",
    rowBorder:   "border-zinc-800/60",
    rowBg:       "bg-transparent",
    label:       "CLEAR",
  },
  monitoring: {
    dot:         "bg-zinc-500",
    badge:       "text-zinc-400",
    badgeBg:     "#27272a33",
    badgeBorder: "#52525b50",
    rowBorder:   "border-zinc-800/60",
    rowBg:       "bg-transparent",
    label:       "MONITORING",
  },
};

// ─── Alert Row ────────────────────────────────────────────────────────────────

function AlertRow({
  result,
  icon,
  isGrowth,
}: {
  result: ThreatResult;
  icon: React.ReactNode;
  isGrowth?: boolean;
}) {
  const cfg = STATUS_CONFIG[result.status];
  const statusStr = result.status as string;
  const isExpanded = statusStr === "active" || statusStr === "at-risk";

  return (
    <div className={`rounded-2xl border ${cfg.rowBorder} ${cfg.rowBg} overflow-hidden transition-all duration-300`}>
      {/* Row header */}
      <div className="flex items-center gap-4 px-5 py-4">
        <div className="shrink-0 p-2 rounded-xl bg-zinc-800/60">{icon}</div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5">
            <span className={`w-2 h-2 rounded-full shrink-0 ${cfg.dot}`} />
            <span className="text-sm font-semibold text-white">{result.title}</span>
          </div>
          <p className="text-xs text-zinc-400 leading-snug truncate">{result.headline}</p>
        </div>

        {/* Status badge */}
        <span
          className={`shrink-0 text-xs font-bold px-2.5 py-1 rounded-full border tracking-wider ${cfg.badge}`}
          style={{ backgroundColor: cfg.badgeBg, borderColor: cfg.badgeBorder }}
        >
          {isGrowth && result.status === "active" ? "OPTIMAL" : isGrowth && result.status === "at-risk" ? "PARTIAL" : cfg.label}
        </span>
      </div>

      {/* Expanded detail */}
      {isExpanded && (
        <div className="px-5 pb-4 space-y-3 border-t border-zinc-800/60 pt-3">
          {/* Condition checklist */}
          <div className="space-y-2">
            {result.conditions.map((c) => (
              <div key={c.label} className="flex items-start gap-2.5 text-xs">
                {c.met
                  ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                  : <Circle      className="w-3.5 h-3.5 text-zinc-600 shrink-0 mt-0.5" />
                }
                <div className="flex-1 min-w-0">
                  <span className={c.met ? "text-zinc-300" : "text-zinc-500"}>{c.label}</span>
                  <span className="ml-2 font-mono text-zinc-500">{c.value}</span>
                </div>
              </div>
            ))}
          </div>
          {/* Scientific explanation */}
          <p className="text-xs text-zinc-500 leading-relaxed border-t border-zinc-800/50 pt-2.5">
            {result.detail}
          </p>
        </div>
      )}
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────

export function ThreatAlertsPanel({
  drainageData,
  vpdHistory30,
  dliHistory,
  latestMoisture,
  logs,
  placementType,
  plantType,
  piecewise,
  drainageResult,
}: {
  drainageData:   DrainageInput[];
  vpdHistory30:   VPDDataPoint[];
  dliHistory:     DLIDataPoint[];
  latestMoisture: number | null;
  logs:           { recorded_at: string; illuminance_lux: number }[];
  placementType?: string | null;
  plantType?:     string | null;
  piecewise?:     PiecewiseDrainageResult | null;
  drainageResult: DrainageResult;
}) {
  const isPot = placementType === "pot";
  const rot          = evalRotWarning(drainageData, vpdHistory30, latestMoisture, isPot, plantType || null, piecewise);
  const dehydration  = evalDehydrationWarning(drainageData, vpdHistory30, latestMoisture, isPot, plantType || null, piecewise);
  const growth       = evalGrowthOptimization(dliHistory, vpdHistory30, plantType || null, drainageResult, piecewise);
  const lightPol     = evalNightLightWarning(logs, plantType || null);

  const hasActive  = rot.status === "active"    || dehydration.status === "active" || lightPol.status === "active";
  const hasAtRisk  = rot.status === "at-risk"   || dehydration.status === "at-risk" || lightPol.status === "at-risk";

  const isOptimal  = growth.status === "active";

  const [showInfo, setShowInfo] = useState(false);

  return (
    <div id="sitter-mode" className="scroll-mt-32 rounded-3xl border border-zinc-700/60 bg-zinc-900/40 backdrop-blur-xl shadow-2xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className={`p-2.5 rounded-xl border ${
            hasActive ? "bg-red-500/10 border-red-500/20"
            : hasAtRisk ? "bg-orange-500/10 border-orange-500/20"
            : isOptimal ? "bg-emerald-500/10 border-emerald-500/20"
            : "bg-zinc-800/60 border-zinc-700/40"
          }`}>
            <ShieldAlert className={`w-5 h-5 ${
              hasActive ? "text-red-400"
              : hasAtRisk ? "text-orange-400"
              : isOptimal ? "text-emerald-400"
              : "text-zinc-400"
            }`} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-semibold text-white">Sitter Mode · Active Threat Monitor</h3>
              <button 
                onClick={() => setShowInfo(!showInfo)} 
                className="p-1 rounded-full hover:bg-zinc-800 text-zinc-400 transition-colors"
                title="How does Sitter Mode work?"
              >
                <Info className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-zinc-500 mt-0.5">Real-time ecological threat status</p>
          </div>
        </div>

        {/* Overall system status pill */}
        <div className={`text-xs font-semibold px-3 py-1.5 rounded-full border flex items-center gap-1.5 ${
          hasActive  ? "text-red-400 border-red-500/40 bg-red-500/10"
          : hasAtRisk ? "text-orange-400 border-orange-500/40 bg-orange-500/10"
          : isOptimal ? "text-emerald-400 border-emerald-500/40 bg-emerald-500/10"
          : "text-zinc-400 border-zinc-700 bg-zinc-800/40"
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            hasActive  ? "bg-red-400 animate-pulse"
            : hasAtRisk ? "bg-orange-400 animate-pulse"
            : isOptimal ? "bg-emerald-400"
            : "bg-zinc-500"
          }`} />
          {hasActive ? "THREAT DETECTED" : hasAtRisk ? "AT RISK" : isOptimal ? "ALL OPTIMAL" : "MONITORING"}
        </div>
      </div>

      {/* Info Card Panel */}
      <div 
        className={`overflow-hidden transition-all duration-300 ease-in-out border-b border-zinc-800 ${
          showInfo ? "max-h-[800px] opacity-100" : "max-h-0 opacity-0 border-transparent"
        }`}
      >
        <div className="px-6 py-6 bg-zinc-900/80 text-sm">
          <div className="flex justify-between items-start mb-5">
            <h4 className="font-semibold text-white flex items-center gap-2 text-base">
              <Info className="w-5 h-5 text-blue-400" />
              Understanding Sitter Mode
            </h4>
            <button onClick={() => setShowInfo(false)} className="text-zinc-500 hover:text-white p-1 bg-zinc-800/50 hover:bg-zinc-700 rounded-full transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
          
          <div className="space-y-5">
            <div>
              <p className="text-zinc-300 mb-3 font-medium text-sm">Status Severities</p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="p-3.5 rounded-xl bg-emerald-500/10 border border-emerald-500/20">
                  <div className="flex items-center gap-2 mb-1.5 text-emerald-400 font-bold text-[11px] tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span> OPTIMAL / CLEAR</div>
                  <p className="text-xs text-zinc-400 leading-relaxed">The best possible state. The environment is perfectly aligned with the plant&apos;s biological needs.</p>
                </div>
                <div className="p-3.5 rounded-xl bg-orange-500/10 border border-orange-500/20">
                  <div className="flex items-center gap-2 mb-1.5 text-orange-400 font-bold text-[11px] tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse"></span> AT RISK / PARTIAL</div>
                  <p className="text-xs text-zinc-400 leading-relaxed">Not ideal. Some thresholds are outside the safe zone. An early warning to monitor conditions closely.</p>
                </div>
                <div className="p-3.5 rounded-xl bg-red-500/10 border border-red-500/20">
                  <div className="flex items-center gap-2 mb-1.5 text-red-400 font-bold text-[11px] tracking-wider"><span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse"></span> ACTIVE THREAT</div>
                  <p className="text-xs text-zinc-400 leading-relaxed">Very bad. Critical thresholds breached. Immediate action is required to prevent rot or severe stress.</p>
                </div>
              </div>
            </div>
            
            <div className="space-y-3 mt-4 pt-5 border-t border-zinc-800/60">
              <p className="text-zinc-300 font-medium text-sm">How Threats are Calculated</p>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className="bg-zinc-800/40 p-3.5 rounded-xl border border-zinc-700/50">
                  <h5 className="text-xs font-bold text-white mb-1.5 flex items-center gap-2"><Droplets className="w-4 h-4 text-blue-400"/> Root Rot</h5>
                  <p className="text-xs text-zinc-400 leading-relaxed">Calculated by measuring structural soil stagnation (Phase 1/2 failure or &gt;75-85% prolonged moisture) combined with stagnant air (VPD &lt; 0.4 kPa). Both must occur to trigger a warning.</p>
                </div>
                
                <div className="bg-zinc-800/40 p-3.5 rounded-xl border border-zinc-700/50">
                  <h5 className="text-xs font-bold text-white mb-1.5 flex items-center gap-2"><AlertTriangle className="w-4 h-4 text-orange-400"/> Dehydration</h5>
                  <p className="text-xs text-zinc-400 leading-relaxed">Calculated when soil is critically dry (&lt;10-20%) OR the plant stomata close (Phase 3 plateau &lt; 0.1 %/hr), combined with high atmospheric drought (VPD &gt; 1.6 kPa).</p>
                </div>
                
                <div className="bg-zinc-800/40 p-3.5 rounded-xl border border-zinc-700/50">
                  <h5 className="text-xs font-bold text-white mb-1.5 flex items-center gap-2"><Moon className="w-4 h-4 text-indigo-400"/> Light Pollution</h5>
                  <p className="text-xs text-zinc-400 leading-relaxed">Calculated by detecting sustained artificial light (&gt;30 mins) during the night cycle (21:00-06:00). Different plants tolerate different lux levels before circadian rhythm breaks.</p>
                </div>
                
                <div className="bg-zinc-800/40 p-3.5 rounded-xl border border-zinc-700/50">
                  <h5 className="text-xs font-bold text-white mb-1.5 flex items-center gap-2"><Zap className="w-4 h-4 text-emerald-400"/> Growth Optimization</h5>
                  <p className="text-xs text-zinc-400 leading-relaxed">Calculates if the "holy trinity" is perfectly aligned for vegetative growth: Ideal DLI range + well-oxygenated rapid drainage + stable VPD (0.8-1.2 kPa).</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Alert rows */}
      <div className="px-6 py-5 space-y-3">
        <AlertRow result={rot}         icon={<Droplets   className="w-4 h-4 text-blue-400" />} />
        <AlertRow result={dehydration} icon={<AlertTriangle className="w-4 h-4 text-orange-400" />} />
        <AlertRow result={lightPol}    icon={<Moon       className="w-4 h-4 text-indigo-400" />} />
        <AlertRow result={growth}      icon={<Zap        className="w-4 h-4 text-emerald-400" />} isGrowth />
      </div>

      {/* Footer note */}
      <div className="px-6 pb-5 -mt-1">
        <p className="text-xs text-zinc-600 leading-relaxed">
          Threat detection uses the past 48–72h of sensor data. Alerts expand automatically when conditions are met.
          All thresholds assume calibrated soil moisture — verify calibration before relying on these readings.
          {isPot && (
            <span className="text-amber-500/70">
              {" "}🪴 Pot-adjusted thresholds are active: rot triggers at lower saturation and shorter duration; dehydration triggers earlier due to smaller soil volume.
            </span>
          )}
        </p>
      </div>
    </div>
  );
}
