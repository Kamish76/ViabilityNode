export const HARDCODED_CALIBRATION = {
  dryLimit: 1920,
  wetLimit: 810,
};

export function calculateMoisturePct(rawADC: number): number {
  const { dryLimit, wetLimit } = HARDCODED_CALIBRATION;
  if (dryLimit === wetLimit) return 0;
  const pct = ((dryLimit - rawADC) / (dryLimit - wetLimit)) * 100;
  return Math.max(0, Math.min(100, pct));
}

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

/**
 * Apply a lightweight median filter (window size 3) to strip ADC glitches.
 */
export function medianFilter<T extends MoistureReading>(data: T[]): T[] {
  return data.map((d, i) => {
    const win = data.slice(Math.max(0, i - 1), Math.min(data.length, i + 2));
    const vals = win.map((w) => w.moisture_pct).sort((a, b) => a - b);
    return { ...d, moisture_pct: vals[Math.floor(vals.length / 2)] };
  });
}

/**
 * Detect watering events — significant moisture spikes.
 */
export function detectWateringEvents(
  data: MoistureReading[],
  spikeThreshold: number = 10,
  searchWindowMs: number = 4 * 60 * 60 * 1000 // 4 hours
): WateringEvent[] {
  const events: WateringEvent[] = [];

  for (let i = 1; i < data.length; i++) {
    const delta = data[i].moisture_pct - data[i - 1].moisture_pct;
    if (delta >= spikeThreshold) {
      const spikeTime = new Date(data[i].recorded_at).getTime();
      const searchEnd = spikeTime + searchWindowMs;

      let peakIdx = i;
      let peakVal = data[i].moisture_pct;

      for (let j = i; j < data.length; j++) {
        const t = new Date(data[j].recorded_at).getTime();
        if (t > searchEnd) break;
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
