/**
 * Node connectivity and status utilities.
 *
 * Hardware nodes (ESP32) ping telemetry every 30 minutes.
 * A 35-minute threshold allows a 5-minute buffer for network jitter or sleep variance.
 */

export const NODE_LIVE_BUFFER_MS = 35 * 60 * 1000; // 35 minutes (30 min ping + 5 min buffer)
export const NODE_OFFLINE_THRESHOLD_MS = 24 * 60 * 60 * 1000; // 24 hours

export type NodeStatus = "online" | "idle" | "offline";

/**
 * Calculates current node status based on its latest recorded telemetry timestamp.
 *
 * - "online"  (Live): Pinged within 35 minutes.
 * - "idle"    (Idle): Pinged between 35 minutes and 24 hours ago.
 * - "offline" (Offline / No data): Pinged > 24 hours ago, or has never pinged.
 */
export function getNodeStatus(
  lastSeen: string | null | Date,
  nowMs: number = Date.now()
): NodeStatus {
  if (!lastSeen) return "offline";
  const dateMs =
    typeof lastSeen === "string" ? new Date(lastSeen).getTime() : lastSeen.getTime();
  if (isNaN(dateMs)) return "offline";

  const ageMs = nowMs - dateMs;
  if (ageMs < 0) return "online"; // Safeguard against clock skew
  if (ageMs <= NODE_LIVE_BUFFER_MS) return "online";
  if (ageMs <= NODE_OFFLINE_THRESHOLD_MS) return "idle";
  return "offline";
}
