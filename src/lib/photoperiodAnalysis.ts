/**
 * Biophysical Photoperiod & Usable Light Analysis Engine
 *
 * Models 24-hour diurnal light dynamics:
 * 1. Night Cycle (0-Lux / Dark Period):
 *    - Tracks duration of biological darkness (lux <= threshold).
 *    - Essential for CAM plants (succulents/cacti) whose stomata open exclusively
 *      in the dark to fix nocturnal CO2 without daytime evaporative water loss.
 *    - Monitors Artificial Light at Night (ALAN) interruptions that cause premature
 *      stomatal closure and circadian decay.
 *
 * 2. Day Cycle (Usable Photosynthetic Light):
 *    - Calculates duration above the plant-specific Light Compensation Point (LCP).
 *    - Light below LCP is non-productive (respiration exceeds photosynthesis).
 *    - Compares against daily photoperiod targets and alerts for etiolation (succulents)
 *      or photo-inhibition/scorching (tender tropicals).
 */

export interface PhotoperiodReading {
  recorded_at: string;
  illuminance_lux: number;
}

export interface PlantLightConfig {
  plantType: string;
  label: string;
  icon: string;
  usableThresholdLux: number;     // Light compensation point (LCP)
  optimalMinLux: number;          // Minimum for optimal vegetative growth
  saturationLux: number;          // Saturation point (LSP) / scorch risk threshold
  targetUsableHours: number;      // Target daily hours above compensation point
  darkThresholdLux: number;       // Upper bound for biological darkness
  targetDarkHours: number;        // Target daily hours of dark rest
  strictDarkNeeded: boolean;      // True for CAM plants (succulents)
  scorchRisk: boolean;            // True for tender shade plants
  biologyDescription: string;
}

export const PLANT_LIGHT_PROFILES: Record<string, PlantLightConfig> = {
  succulent: {
    plantType: "succulent",
    label: "Succulent / Cactus",
    icon: "🌵",
    usableThresholdLux: 2500,     // High LCP: < 2500 lx leads to etiolation (stretching)
    optimalMinLux: 6000,          // Thrives in bright, direct or intense indirect light
    saturationLux: 35000,         // High light tolerance
    targetUsableHours: 6,         // 6-8 hrs of high light
    darkThresholdLux: 2.0,        // Strict: > 2 lx closes nocturnal CAM stomata
    targetDarkHours: 9,           // 8-12 hrs dark for nocturnal CO2 assimilation
    strictDarkNeeded: true,
    scorchRisk: false,
    biologyDescription:
      "Succulents (CAM plants) open stomata strictly at night to fix CO2 with minimal water loss. Light leaks > 2 lx interrupt this nocturnal cycle. During the day, they require intense light (≥ 2,500 lx) to prevent pale stretching (etiolation).",
  },
  tropical: {
    plantType: "tropical",
    label: "Tropical / Foliage",
    icon: "🌿",
    usableThresholdLux: 800,      // Low LCP: adapted to forest floor / understory shade
    optimalMinLux: 1500,          // Gentle diffused ambient light
    saturationLux: 12000,         // Sensitive: > 12000 lx direct sun scorches foliage
    targetUsableHours: 8,         // 8-12 hrs of gentle light
    darkThresholdLux: 10.0,       // Standard C3 respiration dark rest
    targetDarkHours: 8,           // 8-10 hrs dark for starch translocation
    strictDarkNeeded: false,
    scorchRisk: true,
    biologyDescription:
      "Understory tropicals utilize low-intensity diffused light (≥ 800 lx). Direct unfiltered sun (> 12,000 lx) risks leaf scorch and chlorophyll bleaching. A reliable 8+ hr dark period is required for starch transport.",
  },
  herb: {
    plantType: "herb",
    label: "Herbs / Edibles",
    icon: "🌱",
    usableThresholdLux: 3000,     // High photosynthetic demand for biomass & terpenes
    optimalMinLux: 6000,
    saturationLux: 28000,
    targetUsableHours: 6.5,       // 6-8 hrs full sun
    darkThresholdLux: 15.0,
    targetDarkHours: 7,
    strictDarkNeeded: false,
    scorchRisk: false,
    biologyDescription:
      "Herbs and fruiting edibles require robust photon flux (≥ 3,000 lx) to synthesize essential oils, sugars, and prevent leggy, weak stems.",
  },
  carnivorous: {
    plantType: "carnivorous",
    label: "Carnivorous / Bog",
    icon: "🪰",
    usableThresholdLux: 2000,     // Open bog natives require strong light
    optimalMinLux: 4500,
    saturationLux: 18000,
    targetUsableHours: 8,
    darkThresholdLux: 10.0,
    targetDarkHours: 8,
    strictDarkNeeded: false,
    scorchRisk: false,
    biologyDescription:
      "Carnivorous bog plants thrive in open overhead sun (≥ 2,000 lx). Ample light is essential for vibrant anthocyanin trap coloration and active digestive enzyme production.",
  },
  standard: {
    plantType: "standard",
    label: "General Plant",
    icon: "🪴",
    usableThresholdLux: 1500,
    optimalMinLux: 3500,
    saturationLux: 20000,
    targetUsableHours: 8,
    darkThresholdLux: 10.0,
    targetDarkHours: 8,
    strictDarkNeeded: false,
    scorchRisk: false,
    biologyDescription:
      "Balanced houseplant baseline. Requires a distinct day/night diurnal cycle with ≥ 1,500 lx daylight for steady vegetative growth.",
  },
};

export interface DayPhotoperiod {
  day: string;                     // "YYYY-MM-DD"
  totalTrackedHours: number;
  readingCount: number;

  // Dark metrics
  zeroLuxHours: number;            // Lux <= 1.0 (true 0 lx / near-zero sensor noise)
  biologicalDarkHours: number;     // Lux <= darkThresholdLux
  twilightHours: number;           // darkThresholdLux < Lux < usableThresholdLux
  nightInterruptions: number;      // Reading count during night cycle (21:00-06:00) with Lux > darkThresholdLux

  // Usable light metrics
  usableLightHours: number;        // Lux >= usableThresholdLux
  optimalLightHours: number;       // usableThresholdLux <= Lux <= saturationLux
  intenseLightHours: number;       // Lux > saturationLux
  peakLux: number;
  avgDaylightLux: number;

  // Evaluation
  usablePctOfTarget: number;
  usableTargetMet: boolean;
  darkPctOfTarget: number;
  darkTargetMet: boolean;
}

export type DarkStatus = "optimal" | "interrupted" | "insufficient" | "monitoring";
export type UsableStatus = "optimal" | "adequate" | "sub-optimal" | "scorch-risk" | "monitoring";

export interface PhotoperiodAnalysisResult {
  config: PlantLightConfig;
  placementNote: string | null;

  // Key day benchmarks
  yesterday: DayPhotoperiod | null; // Completed baseline (gold standard for full 24h cycle)
  today: DayPhotoperiod | null;     // Current live intraday progress

  // Rolling averages (calculated across up to 7 completed days)
  avgDailyDarkHours: number;
  avgDailyZeroLuxHours: number;
  avgDailyUsableHours: number;
  avgNightInterruptions: number;
  completedDaysCount: number;

  // Qualitative statuses
  darkStatus: DarkStatus;
  darkHeadline: string;
  darkDetail: string;

  usableStatus: UsableStatus;
  usableHeadline: string;
  usableDetail: string;

  // History for charts
  history: DayPhotoperiod[];
}

/**
 * Calculates photoperiod metrics using time-interval integration
 * over telemetry light records.
 */
export function analyzePhotoperiod(
  readings: PhotoperiodReading[],
  plantTypeInput: string | null | undefined,
  placementTypeInput: string | null | undefined
): PhotoperiodAnalysisResult {
  const plantType = (plantTypeInput || "tropical").toLowerCase();
  const config = PLANT_LIGHT_PROFILES[plantType] || PLANT_LIGHT_PROFILES.standard;

  // Placement intelligence note
  let placementNote: string | null = null;
  const placement = (placementTypeInput || "").toLowerCase();
  if (placement === "indoor") {
    placementNote =
      "Indoor glass filters ~20% PAR and ambient room light (< 400 lx) is below the compensation point. Ensure direct proximity to an unobstructed window.";
  } else if (placement === "greenhouse") {
    placementNote =
      "Greenhouse glazing provides high diffused illumination, ideal for photoperiod accumulation without focal heat stress.";
  }

  if (!readings || readings.length === 0) {
    return makeEmptyResult(config, placementNote);
  }

  // Filter valid readings and sort ascending chronologically
  const sorted = [...readings]
    .filter((r) => r.recorded_at && !isNaN(Number(r.illuminance_lux)))
    .map((r) => ({
      recorded_at: r.recorded_at,
      lux: Math.max(0, Number(r.illuminance_lux)),
      timeMs: new Date(r.recorded_at).getTime(),
    }))
    .sort((a, b) => a.timeMs - b.timeMs);

  if (sorted.length < 2) {
    return makeEmptyResult(config, placementNote);
  }

  // Group readings by calendar day (YYYY-MM-DD local/ISO day)
  const daysMap = new Map<
    string,
    {
      readings: typeof sorted;
    }
  >();

  for (const r of sorted) {
    const day = r.recorded_at.slice(0, 10);
    if (!daysMap.has(day)) {
      daysMap.set(day, { readings: [] });
    }
    daysMap.get(day)!.readings.push(r);
  }

  // Maximum delta between consecutive readings to credit (avoid offline gaps inflating hours)
  // Matching 2-hour cap from DLI SQL definition
  const MAX_DELTA_MS = 2 * 60 * 60 * 1000;

  const daySummaries: DayPhotoperiod[] = [];

  for (const [day, { readings: dayReadings }] of daysMap.entries()) {
    if (dayReadings.length === 0) continue;

    let zeroLuxMs = 0;
    let bioDarkMs = 0;
    let twilightMs = 0;
    let usableMs = 0;
    let optimalMs = 0;
    let intenseMs = 0;
    let totalTrackedMs = 0;

    let peakLux = 0;
    let daylightLuxSum = 0;
    let daylightReadingCount = 0;
    let nightInterruptions = 0;

    for (let i = 0; i < dayReadings.length; i++) {
      const current = dayReadings[i];
      if (current.lux > peakLux) peakLux = current.lux;

      // Track daylight readings (above twilight threshold)
      if (current.lux >= config.darkThresholdLux) {
        daylightLuxSum += current.lux;
        daylightReadingCount++;
      }

      // Check night light interruptions: hours 21:00 to 06:00
      const localHour = new Date(current.recorded_at).getHours();
      const isNightCycle = localHour >= 21 || localHour < 6;
      if (isNightCycle && current.lux > config.darkThresholdLux) {
        nightInterruptions++;
      }

      // Trapezoidal / step time interval
      let dtMs = 0;
      if (i < dayReadings.length - 1) {
        const next = dayReadings[i + 1];
        dtMs = Math.min(next.timeMs - current.timeMs, MAX_DELTA_MS);
      } else if (i > 0) {
        // Last reading: assume duration equals previous step or default 15 mins
        const prev = dayReadings[i - 1];
        dtMs = Math.min(current.timeMs - prev.timeMs, 15 * 60 * 1000);
      } else {
        dtMs = 15 * 60 * 1000;
      }

      if (dtMs <= 0) continue;
      totalTrackedMs += dtMs;

      // Classify interval duration based on current reading lux
      if (current.lux <= 1.0) {
        zeroLuxMs += dtMs;
      }

      if (current.lux <= config.darkThresholdLux) {
        bioDarkMs += dtMs;
      } else if (current.lux < config.usableThresholdLux) {
        twilightMs += dtMs;
      } else {
        usableMs += dtMs;
        if (current.lux <= config.saturationLux) {
          optimalMs += dtMs;
        } else {
          intenseMs += dtMs;
        }
      }
    }

    const totalTrackedHours = totalTrackedMs / (1000 * 60 * 60);
    const zeroLuxHours = zeroLuxMs / (1000 * 60 * 60);
    const biologicalDarkHours = bioDarkMs / (1000 * 60 * 60);
    const twilightHours = twilightMs / (1000 * 60 * 60);
    const usableLightHours = usableMs / (1000 * 60 * 60);
    const optimalLightHours = optimalMs / (1000 * 60 * 60);
    const intenseLightHours = intenseMs / (1000 * 60 * 60);

    const usablePctOfTarget = Math.round((usableLightHours / config.targetUsableHours) * 100);
    const darkPctOfTarget = Math.round((biologicalDarkHours / config.targetDarkHours) * 100);

    daySummaries.push({
      day,
      totalTrackedHours: round1(totalTrackedHours),
      readingCount: dayReadings.length,
      zeroLuxHours: round1(zeroLuxHours),
      biologicalDarkHours: round1(biologicalDarkHours),
      twilightHours: round1(twilightHours),
      nightInterruptions,
      usableLightHours: round1(usableLightHours),
      optimalLightHours: round1(optimalLightHours),
      intenseLightHours: round1(intenseLightHours),
      peakLux: Math.round(peakLux),
      avgDaylightLux: daylightReadingCount > 0 ? Math.round(daylightLuxSum / daylightReadingCount) : 0,
      usablePctOfTarget,
      usableTargetMet: usableLightHours >= config.targetUsableHours,
      darkPctOfTarget,
      darkTargetMet: biologicalDarkHours >= config.targetDarkHours,
    });
  }

  // Sort day summaries ascending
  daySummaries.sort((a, b) => a.day.localeCompare(b.day));

  const todayStr = new Date().toISOString().slice(0, 10);
  const today = daySummaries.find((d) => d.day === todayStr) || null;

  // Completed days (all days prior to today)
  const completedDays = daySummaries.filter((d) => d.day < todayStr);
  const yesterday = completedDays.length > 0 ? completedDays[completedDays.length - 1] : null;

  // Calculate 7-day rolling averages from recent completed days (up to 7)
  const recentCompleted = completedDays.slice(-7);
  const completedDaysCount = recentCompleted.length;

  let avgDailyDarkHours = 0;
  let avgDailyZeroLuxHours = 0;
  let avgDailyUsableHours = 0;
  let avgNightInterruptions = 0;

  if (completedDaysCount > 0) {
    avgDailyDarkHours = round1(
      recentCompleted.reduce((s, d) => s + d.biologicalDarkHours, 0) / completedDaysCount
    );
    avgDailyZeroLuxHours = round1(
      recentCompleted.reduce((s, d) => s + d.zeroLuxHours, 0) / completedDaysCount
    );
    avgDailyUsableHours = round1(
      recentCompleted.reduce((s, d) => s + d.usableLightHours, 0) / completedDaysCount
    );
    avgNightInterruptions = round1(
      recentCompleted.reduce((s, d) => s + d.nightInterruptions, 0) / completedDaysCount
    );
  } else if (today) {
    avgDailyDarkHours = today.biologicalDarkHours;
    avgDailyZeroLuxHours = today.zeroLuxHours;
    avgDailyUsableHours = today.usableLightHours;
    avgNightInterruptions = today.nightInterruptions;
  }

  // ── Dark Cycle Evaluation ──
  const evalDarkDay = yesterday || today;
  let darkStatus: DarkStatus = "monitoring";
  let darkHeadline = "Accumulating dark period telemetry";
  let darkDetail = "Collecting consecutive night readings to measure photoperiod continuity.";

  if (evalDarkDay) {
    if (config.strictDarkNeeded && evalDarkDay.nightInterruptions > 2) {
      darkStatus = "interrupted";
      darkHeadline = "CAM Dark Cycle Interrupted by Light Leaks";
      darkDetail = `Detected ${evalDarkDay.nightInterruptions} artificial light leaks (> ${config.darkThresholdLux} lx) during the night. For succulents, even minimal night light triggers stomatal closure and stops nocturnal CO2 fixation.`;
    } else if (evalDarkDay.biologicalDarkHours >= config.targetDarkHours) {
      darkStatus = "optimal";
      darkHeadline = `Optimal ${config.strictDarkNeeded ? "CAM " : ""}Dark Period (${evalDarkDay.biologicalDarkHours} hrs)`;
      darkDetail = config.strictDarkNeeded
        ? "Excellent continuous darkness. Stomata are able to freely open for nocturnal malic acid accumulation."
        : "Uninterrupted dark rest provides ideal conditions for vegetative respiration and starch translocation.";
    } else if (evalDarkDay.biologicalDarkHours >= config.targetDarkHours * 0.75) {
      darkStatus = "optimal";
      darkHeadline = `Sufficient Dark Period (${evalDarkDay.biologicalDarkHours} hrs)`;
      darkDetail = "The plant receives adequate restorative darkness within biological tolerance.";
    } else {
      darkStatus = "insufficient";
      darkHeadline = `Insufficient Dark Period (${evalDarkDay.biologicalDarkHours} hrs / ${config.targetDarkHours} hrs target)`;
      darkDetail = `The dark period is too short. Plants require at least ${config.targetDarkHours} hrs of darkness for circadian entrainment and metabolic balance.`;
    }
  }

  // ── Usable Light Evaluation ──
  const evalLightDay = yesterday || today;
  let usableStatus: UsableStatus = "monitoring";
  let usableHeadline = "Accumulating daylight telemetry";
  let usableDetail = "Collecting light readings to evaluate effective photosynthetic hours.";

  if (evalLightDay) {
    if (config.scorchRisk && evalLightDay.intenseLightHours > 2.0) {
      usableStatus = "scorch-risk";
      usableHeadline = "High Light Scorch Risk Detected";
      usableDetail = `Received ${evalLightDay.intenseLightHours} hrs exceeding ${config.saturationLux.toLocaleString()} lx. Shade-adapted tropical foliage is susceptible to leaf bleaching and photo-inhibition under direct high sun.`;
    } else if (evalLightDay.usableLightHours >= config.targetUsableHours) {
      usableStatus = "optimal";
      usableHeadline = `Target Usable Photoperiod Reached (${evalLightDay.usableLightHours} hrs)`;
      usableDetail = `Received ${evalLightDay.usableLightHours} hrs above the ${config.usableThresholdLux.toLocaleString()} lx compensation point (${evalLightDay.usablePctOfTarget}% of daily target). Ideal for vegetative growth.`;
    } else if (evalLightDay.usableLightHours >= config.targetUsableHours * 0.7) {
      usableStatus = "adequate";
      usableHeadline = `Adequate Usable Photoperiod (${evalLightDay.usableLightHours} hrs)`;
      usableDetail = `Approaching the ${config.targetUsableHours} hr target. Provides maintenance energy, though higher photon exposure will accelerate growth.`;
    } else {
      usableStatus = "sub-optimal";
      usableHeadline = `Sub-Optimal Usable Light (${evalLightDay.usableLightHours} hrs / ${config.targetUsableHours} hrs target)`;
      usableDetail =
        config.plantType === "succulent"
          ? `Warning: Only ${evalLightDay.usableLightHours} hrs above ${config.usableThresholdLux.toLocaleString()} lx. Low light leads to severe etiolation (stretching, pale rosettes). Consider moving to a brighter spot.`
          : `Light levels were below the photosynthetic compensation point for most of the day. Growth may stall.`;
    }
  }

  return {
    config,
    placementNote,
    yesterday,
    today,
    avgDailyDarkHours,
    avgDailyZeroLuxHours,
    avgDailyUsableHours,
    avgNightInterruptions,
    completedDaysCount,
    darkStatus,
    darkHeadline,
    darkDetail,
    usableStatus,
    usableHeadline,
    usableDetail,
    history: daySummaries.slice(-14), // Last 14 days for history charts
  };
}

function makeEmptyResult(config: PlantLightConfig, placementNote: string | null): PhotoperiodAnalysisResult {
  return {
    config,
    placementNote,
    yesterday: null,
    today: null,
    avgDailyDarkHours: 0,
    avgDailyZeroLuxHours: 0,
    avgDailyUsableHours: 0,
    avgNightInterruptions: 0,
    completedDaysCount: 0,
    darkStatus: "monitoring",
    darkHeadline: "Awaiting light telemetry",
    darkDetail: "No illuminance readings found for this device yet.",
    usableStatus: "monitoring",
    usableHeadline: "Awaiting light telemetry",
    usableDetail: "No illuminance readings found for this device yet.",
    history: [],
  };
}

function round1(num: number): number {
  return Math.round(num * 10) / 10;
}
