import {
  type MoistureReading,
  type WateringEvent,
  medianFilter,
  detectWateringEvents,
} from "./sensorUtils";

export interface DrainageInput extends MoistureReading {
  raw: number;
}

export type DrainCategory =
  | "fast-draining"   // Retention < 6h  — water leaves quickly
  | "well-draining"   // Retention 6–48h — healthy for most plants
  | "slow-draining"   // Retention 48–96h — moisture-loving plants
  | "waterlogged"     // Retention > 96h or no drop detected
  | "evaluating"      // Water hasn't drained enough to classify yet
  | "no-event"        // No watering event detected in window
  | "insufficient"    // Not enough data
  | "optimal-dry";    // Plant reached safe low-moisture state

export interface DrainageResult {
  category: DrainCategory;
  label: string;

  // Core observed metrics
  retentionHours: number | null;
  currentMoisture: number | null;
  moistureMin: number;
  moistureMax: number;
  netChange24h: number | null;
  wateringEvents: number;

  // Last watering details
  lastWateringAt: string | null;
  peakMoisture: number | null;
  peakDroppedTo: number | null;
  daysToLowest: number | null;

  // Downstream compat
  drainClass: "rapid" | "moderate" | "stagnant" | "unknown";

  description: string;
  plantHint: string;
  color: string;
  textColor: string;
  bgColor: string;
}

const FIVE_DAYS_MS = 5 * 24 * 60 * 60 * 1000;
const TWENTY_FOUR_H = 24 * 60 * 60 * 1000;
const RETENTION_DROP = 10;

function makeInsufficient(msg: string, hint: string): DrainageResult {
  return {
    category: "insufficient",
    label: "Insufficient Data",
    retentionHours: null,
    currentMoisture: null,
    moistureMin: 0,
    moistureMax: 0,
    netChange24h: null,
    wateringEvents: 0,
    lastWateringAt: null,
    peakMoisture: null,
    peakDroppedTo: null,
    daysToLowest: null,
    drainClass: "unknown",
    description: msg,
    plantHint: hint,
    color: "#71717a",
    textColor: "text-zinc-400",
    bgColor: "bg-zinc-800/40",
  };
}

export function analyzeDrainage(data: DrainageInput[], plantType?: string | null): DrainageResult {
  if (data.length < 6) {
    return makeInsufficient(
      "Need at least 6 calibrated soil moisture readings.",
      "Continue collecting data."
    );
  }

  const isSucculent = plantType === "succulent" || plantType === "cactus";
  const WINDOW_MS = isSucculent ? 30 * 24 * 60 * 60 * 1000 : FIVE_DAYS_MS;

  const sorted = [...data].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );

  // 1. Lightweight median filter
  const filtered = medianFilter(sorted);

  // 2. Restrict to the analysis window
  const latestTime = new Date(filtered[filtered.length - 1].recorded_at).getTime();
  const cutoff = latestTime - WINDOW_MS;
  const windowData = filtered.filter(
    (d) => new Date(d.recorded_at).getTime() >= cutoff
  );

  if (windowData.length < 2) {
    return makeInsufficient(
      `Not enough readings in the last ${isSucculent ? "30" : "5"} days.`,
      "Check back once more data has been collected."
    );
  }

  const currentMoisture = windowData[windowData.length - 1].moisture_pct;
  const moistureValues = windowData.map((d) => d.moisture_pct);
  const moistureMin = Math.min(...moistureValues);
  const moistureMax = Math.max(...moistureValues);

  const cutoff24h = latestTime - TWENTY_FOUR_H;
  const reading24hAgo = windowData.find(
    (d) => new Date(d.recorded_at).getTime() >= cutoff24h
  );
  const netChange24h = reading24hAgo
    ? +(currentMoisture - reading24hAgo.moisture_pct).toFixed(1)
    : null;

  // 4. Detect watering events using shared util
  const wateringEvents = detectWateringEvents(windowData);

  let retentionHours: number | null = null;
  let lastWateringAt: string | null = null;
  let peakMoisture: number | null = null;
  let peakDroppedTo: number | null = null;
  let daysToLowest: number | null = null;

  const lastEvent = wateringEvents.length > 0
    ? wateringEvents[wateringEvents.length - 1]
    : null;

  if (lastEvent) {
    lastWateringAt = lastEvent.peakTimestamp;
    peakMoisture = lastEvent.peakMoisture;
    const retentionThreshold = peakMoisture - RETENTION_DROP;

    const peakTime = new Date(windowData[lastEvent.peakIdx].recorded_at).getTime();

    for (let j = lastEvent.peakIdx + 1; j < windowData.length; j++) {
      if (windowData[j].moisture_pct <= retentionThreshold) {
        const dropTime = new Date(windowData[j].recorded_at).getTime();
        retentionHours = +((dropTime - peakTime) / (1000 * 60 * 60)).toFixed(1);
        peakDroppedTo = windowData[j].moisture_pct;
        break;
      }
    }

    if (isSucculent) {
      let minValAfterPeak = peakMoisture;
      let minTimeAfterPeak = peakTime;
      for (let j = lastEvent.peakIdx + 1; j < windowData.length; j++) {
        if (windowData[j].moisture_pct < minValAfterPeak) {
          minValAfterPeak = windowData[j].moisture_pct;
          minTimeAfterPeak = new Date(windowData[j].recorded_at).getTime();
        }
      }
      daysToLowest = +((minTimeAfterPeak - peakTime) / (1000 * 60 * 60 * 24)).toFixed(1);
    }
  }

  const shared = {
    currentMoisture,
    moistureMin,
    moistureMax,
    netChange24h,
    wateringEvents: wateringEvents.length,
    lastWateringAt,
    peakMoisture,
    peakDroppedTo,
    daysToLowest,
  };

  if (wateringEvents.length === 0) {
    return {
      ...shared,
      category: "no-event",
      label: isSucculent ? "Optimal Dry Cycle" : "Dry Cycle",
      retentionHours: null,
      drainClass: "unknown",
      description: isSucculent
        ? `In drought phase. Moisture range: ${moistureMin.toFixed(0)}–${moistureMax.toFixed(0)}%.`
        : `No watering events detected in the last 5 days. Moisture range: ${moistureMin.toFixed(0)}–${moistureMax.toFixed(0)}%.`,
      plantHint: isSucculent
        ? "Succulents thrive in extended dry periods. Water only if visually needed."
        : "Water the plant or wait for rain to measure soil retention.",
      color: isSucculent ? "#10b981" : "#71717a",
      textColor: isSucculent ? "text-emerald-400" : "text-zinc-400",
      bgColor: isSucculent ? "bg-emerald-950/20" : "bg-zinc-800/40",
    };
  }

  if (retentionHours === null) {
    const elapsedSincePeak = lastEvent
      ? (latestTime - new Date(windowData[lastEvent.peakIdx].recorded_at).getTime()) / (1000 * 60 * 60)
      : 0;

    const isOptimalDry = isSucculent && (currentMoisture !== null && currentMoisture < 30);

    if (isOptimalDry) {
      return {
        ...shared,
        category: "optimal-dry",
        label: "Optimal Dry State",
        retentionHours: null,
        drainClass: "rapid",
        description: `Soil reached optimal dry conditions (${currentMoisture?.toFixed(0)}%) via capillary drainage.`,
        plantHint: "Perfect moisture state for succulents. Water only when visually necessary.",
        color: "#10b981",
        textColor: "text-emerald-400",
        bgColor: "bg-emerald-950/20",
      };
    }

    if (elapsedSincePeak > 96) {
      return {
        ...shared,
        category: "waterlogged",
        label: "Waterlogged",
        retentionHours: null,
        drainClass: "stagnant",
        description: `Soil hasn't dropped ${RETENTION_DROP}% from peak (${peakMoisture?.toFixed(0)}%) after ${Math.round(elapsedSincePeak)}h. Possible waterlogging.`,
        plantHint: "Danger for most plants. Only bog plants, mosses, or aquatics tolerate this.",
        color: "#ef4444",
        textColor: "text-red-400",
        bgColor: "bg-red-950/20",
      };
    }

    if (elapsedSincePeak <= 4) {
      return {
        ...shared,
        category: "evaluating",
        label: "Absorbing",
        retentionHours: null,
        drainClass: "unknown",
        description: `Soil was recently watered ${Math.round(elapsedSincePeak)}h ago. Waiting for drainage to evaluate.`,
        plantHint: "Soil is currently absorbing water.",
        color: "#3b82f6",
        textColor: "text-blue-400",
        bgColor: "bg-blue-950/20",
      };
    }

    return {
      ...shared,
      category: "evaluating",
      label: "Still Retaining",
      retentionHours: null,
      drainClass: "unknown",
      description: `Soil is still holding above ${(peakMoisture! - RETENTION_DROP).toFixed(0)}% after ${Math.round(elapsedSincePeak)}h since watering.`,
      plantHint: "Good for moisture-loving plants. Monitor for waterlogging if this persists.",
      color: "#8b5cf6",
      textColor: "text-violet-400",
      bgColor: "bg-violet-950/20",
    };
  }

  if (retentionHours < 6) {
    const isSucculent = plantType === "succulent" || plantType === "cactus";
    const succulentDescription = daysToLowest !== null
      ? `Water retained for ${retentionHours}h, taking ${daysToLowest}d to drop to its current low.`
      : `Water retained for only ${retentionHours}h before dropping ${RETENTION_DROP}% from peak.`;

    return {
      ...shared,
      category: "fast-draining",
      label: "Fast Draining",
      retentionHours,
      drainClass: "rapid",
      description: isSucculent ? succulentDescription : `Water retained for only ${retentionHours}h before dropping ${RETENTION_DROP}% from peak.`,
      plantHint: isSucculent ? "Excellent drainage for succulents." : "Best for: Succulents, cacti, herbs, lavender. May need frequent watering for others.",
      color: "#10b981",
      textColor: "text-emerald-400",
      bgColor: "bg-emerald-950/20",
    };
  }

  if (retentionHours <= 48) {
    return {
      ...shared,
      category: "well-draining",
      label: "Well Draining",
      retentionHours,
      drainClass: "moderate",
      description: `Water retained for ${retentionHours}h before dropping ${RETENTION_DROP}% from peak. Healthy drainage.`,
      plantHint: "Ideal for: Most houseplants, tomatoes, herbs, pothos, monstera.",
      color: "#3b82f6",
      textColor: "text-blue-400",
      bgColor: "bg-blue-950/20",
    };
  }

  if (retentionHours <= 96) {
    return {
      ...shared,
      category: "slow-draining",
      label: "Slow Draining",
      retentionHours,
      drainClass: "stagnant",
      description: `Water retained for ${retentionHours}h — slow to release. Soil stays wet for extended periods.`,
      plantHint: "Good for: Ferns, calathea, peace lily. Risk zone for succulents and cacti.",
      color: "#f59e0b",
      textColor: "text-amber-400",
      bgColor: "bg-amber-950/20",
    };
  }

  return {
    ...shared,
    category: "waterlogged",
    label: "Waterlogged",
    retentionHours,
    drainClass: "stagnant",
    description: `Water retained for ${retentionHours}h — soil barely drained. High root rot risk.`,
    plantHint: "Danger for most plants. Only bog plants, mosses, or aquatics tolerate this.",
    color: "#ef4444",
    textColor: "text-red-400",
    bgColor: "bg-red-950/20",
  };
}
