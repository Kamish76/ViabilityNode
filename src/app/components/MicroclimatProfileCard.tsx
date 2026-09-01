"use client";

import { Leaf, Droplets, Sun, Wind, Clock, AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import type { DLIDataPoint } from "./DLIChart";
import type { VPDDataPoint } from "./VPDChart";
import type { DrainageInput } from "./DrainageCard";

// ─── Types ────────────────────────────────────────────────────────────────────

type DLIClass    = "low" | "moderate" | "high" | "unknown";
type DrainClass  = "rapid" | "moderate" | "stagnant" | "unknown";
type VPDClass    = "low" | "optimal" | "high" | "unknown";

interface MicroclimatProfile {
  dliAvg:       number | null;
  dliClass:     DLIClass;
  drainVelocity: number | null;
  drainClass:   DrainClass;
  vpdAvg:       number | null;
  vpdClass:     VPDClass;
  daysOfData:   number;
  isNature:     boolean; // true when ≥ 14 days accumulated (enough for a meaningful profile)
}

// ─── Plant Lookup Table ───────────────────────────────────────────────────────

interface PlantSuggestion {
  category:  string;
  examples:  string[];
  emoji:     string;
  vpdNote?:  string;
}

const PLANT_LOOKUP: Record<DLIClass, Record<DrainClass, PlantSuggestion>> = {
  low: {
    rapid:    { category: "Low-light drought-tolerant",  emoji: "🪴", examples: ["Cast iron plant", "ZZ plant", "Haworthia"] },
    moderate: { category: "Low-light foliage",           emoji: "🌿", examples: ["Pothos", "Philodendron", "Snake plant", "Peace lily"] },
    stagnant: { category: "Bog & understory shade",      emoji: "🌿", examples: ["Moss", "Maidenhair fern", "Selaginella"] },
    unknown:  { category: "Low-light general",           emoji: "🌿", examples: ["Pothos", "Snake plant", "ZZ plant"] },
  },
  moderate: {
    rapid:    { category: "Mediterranean herbs & succulents", emoji: "🌱", examples: ["Rosemary", "Lavender", "Thyme", "Aloe vera"] },
    moderate: { category: "Common tropical houseplants",      emoji: "🏡", examples: ["Monstera", "Orchid", "Bird of paradise", "Spider plant", "Calathea"] },
    stagnant: { category: "Moisture-loving tropicals",        emoji: "🌴", examples: ["Ferns", "Calathea", "Peace lily", "Anthurium"] },
    unknown:  { category: "General houseplants",              emoji: "🏡", examples: ["Monstera", "Pothos", "Fiddle-leaf fig"] },
  },
  high: {
    rapid:    { category: "Desert & Mediterranean",  emoji: "🌵", examples: ["Cacti", "Succulents", "Lavender", "Agave", "Fruit trees"] },
    moderate: { category: "Fruiting crops & herbs",  emoji: "🍅", examples: ["Tomatoes", "Peppers", "Basil", "Citrus (potted)"] },
    stagnant: { category: "Tropical water-lovers",   emoji: "🌾", examples: ["Taro", "Canna lily", "Elephant ear"] },
    unknown:  { category: "High-light general",      emoji: "🌵", examples: ["Succulents", "Cacti", "Herbs"] },
  },
  unknown: {
    rapid:    { category: "Drought-tolerant",  emoji: "🌵", examples: ["Succulents", "Cacti", "ZZ plant"] },
    moderate: { category: "General houseplants", emoji: "🏡", examples: ["Pothos", "Monstera", "Snake plant"] },
    stagnant: { category: "Moisture-lovers",    emoji: "🌿", examples: ["Ferns", "Calathea", "Peace lily"] },
    unknown:  { category: "Awaiting profile",   emoji: "🌱", examples: ["Accumulating data…"] },
  },
};

const VPD_MODIFIER: Record<VPDClass, { note: string; color: string; icon: typeof AlertTriangle } | null> = {
  low:     { note: "⚠ Chronically low VPD — high fungal & mildew risk. Prioritise plants with strong disease resistance.", color: "#a855f7", icon: AlertTriangle },
  optimal: null,
  high:    { note: "⚠ Chronically high VPD — atmospheric drought stress. Choose plants with tough, waxy, or succulent leaves.", color: "#ef4444", icon: AlertTriangle },
  unknown: null,
};

// ─── Classification helpers ───────────────────────────────────────────────────

function classifyDLI(avg: number | null): DLIClass {
  if (avg === null) return "unknown";
  if (avg < 5)      return "low";
  if (avg <= 15)    return "moderate";
  return "high";
}

function classifyVPD(avg: number | null): VPDClass {
  if (avg === null) return "unknown";
  if (avg < 0.4)    return "low";
  if (avg <= 1.6)   return "optimal";
  return "high";
}

function classifyDrain(velocity: number | null): DrainClass {
  if (velocity === null) return "unknown";
  if (velocity > 0.5)    return "rapid";
  if (velocity > 0.1)    return "moderate";
  return "stagnant";
}

// ─── Drainage slope from moisture history ─────────────────────────────────────

function computeDrainageVelocity(data: DrainageInput[]): number | null {
  const SATURATION_THRESHOLD = 70;
  const WINDOW_H = 48;
  if (data.length < 6) return null;
  const sorted = [...data].sort(
    (a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()
  );
  let peakIdx = -1;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].moisture_pct >= SATURATION_THRESHOLD) { peakIdx = i; break; }
  }
  if (peakIdx === -1) return null;
  const peakTime = new Date(sorted[peakIdx].recorded_at).getTime();
  const windowEnd = peakTime + WINDOW_H * 3600 * 1000;
  const window = sorted.slice(peakIdx).filter(d => new Date(d.recorded_at).getTime() <= windowEnd);
  if (window.length < 2) return null;
  const times = window.map(d => (new Date(d.recorded_at).getTime() - peakTime) / 3600000);
  const moistures = window.map(d => d.moisture_pct);
  const n = times.length;
  const sumX  = times.reduce((a, b) => a + b, 0);
  const sumY  = moistures.reduce((a, b) => a + b, 0);
  const sumXY = times.reduce((s, x, i) => s + x * moistures[i], 0);
  const sumX2 = times.reduce((s, x) => s + x * x, 0);
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  return slope < 0 ? Math.abs(slope) : null;
}

// ─── Compute profile from data ────────────────────────────────────────────────

function computeProfile(
  dliHistory: DLIDataPoint[],
  vpdHistory: VPDDataPoint[],
  drainageData: DrainageInput[],
): MicroclimatProfile {
  // DLI 30-day avg
  const dliAvg = dliHistory.length > 0
    ? dliHistory.reduce((s, d) => s + d.dli_mol_per_m2, 0) / dliHistory.length
    : null;

  // VPD 30-day avg
  const vpdAvg = vpdHistory.length > 0
    ? vpdHistory.reduce((s, d) => s + d.vpd_kpa, 0) / vpdHistory.length
    : null;

  // Drainage velocity
  const drainVelocity = computeDrainageVelocity(drainageData);

  // Days of data (from earliest DLI or moisture record)
  const dliDays = dliHistory.length;
  const moistureDays = drainageData.length > 0
    ? Math.round(
        (new Date(drainageData[drainageData.length - 1].recorded_at).getTime() -
          new Date(drainageData[0].recorded_at).getTime()) /
          86400000
      )
    : 0;
  const daysOfData = Math.max(dliDays, moistureDays, 1);

  return {
    dliAvg,
    dliClass:     classifyDLI(dliAvg),
    drainVelocity,
    drainClass:   classifyDrain(drainVelocity),
    vpdAvg,
    vpdClass:     classifyVPD(vpdAvg),
    daysOfData,
    isNature:     daysOfData >= 14,
  };
}

// ─── Sub-components ───────────────────────────────────────────────────────────

const DLI_META: Record<DLIClass, { label: string; color: string; bg: string; border: string }> = {
  low:      { label: "Low · Shade",     color: "#60a5fa", bg: "#1e3a5f33", border: "#3b82f640" },
  moderate: { label: "Moderate",        color: "#34d399", bg: "#06402033", border: "#10b98140" },
  high:     { label: "High · Intense",  color: "#fbbf24", bg: "#45230033", border: "#f59e0b40" },
  unknown:  { label: "Awaiting data",   color: "#71717a", bg: "#27272a33", border: "#3f3f4640" },
};

const DRAIN_META: Record<DrainClass, { label: string; color: string; bg: string; border: string }> = {
  rapid:     { label: "Rapid",              color: "#34d399", bg: "#06402033", border: "#10b98140" },
  moderate:  { label: "Moderate",           color: "#fbbf24", bg: "#45230033", border: "#f59e0b40" },
  stagnant:  { label: "Stagnant/Hypoxic",   color: "#f87171", bg: "#450a0a33", border: "#ef444440" },
  unknown:   { label: "No event detected",  color: "#71717a", bg: "#27272a33", border: "#3f3f4640" },
};

const VPD_META: Record<VPDClass, { label: string; color: string; bg: string; border: string }> = {
  low:      { label: "Low · Fungal risk",  color: "#c084fc", bg: "#3b0764 33", border: "#a855f740" },
  optimal:  { label: "Optimal",            color: "#2dd4bf", bg: "#083344 33", border: "#14b8a640" },
  high:     { label: "High · Drought",     color: "#f87171", bg: "#450a0a33", border: "#ef444440" },
  unknown:  { label: "Awaiting data",      color: "#71717a", bg: "#27272a33", border: "#3f3f4640" },
};

function ClassBadge({ label, color, bg, border }: { label: string; color: string; bg: string; border: string }) {
  return (
    <span
      className="text-xs font-semibold px-2.5 py-1 rounded-full border"
      style={{ color, backgroundColor: bg, borderColor: border }}
    >
      {label}
    </span>
  );
}

function MetricRow({
  icon,
  title,
  subtitle,
  value,
  unit,
  meta,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  value: string;
  unit: string;
  meta: { label: string; color: string; bg: string; border: string };
}) {
  return (
    <div className="flex items-center gap-4 py-4 border-b border-zinc-800/60 last:border-0">
      <div className="shrink-0 p-2.5 rounded-xl bg-zinc-800/60">{icon}</div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-white">{title}</p>
        <p className="text-xs text-zinc-500 mt-0.5">{subtitle}</p>
      </div>
      <div className="text-right shrink-0 space-y-1.5">
        <p className="text-lg font-bold text-white tabular-nums">
          {value} <span className="text-xs font-normal text-zinc-400">{unit}</span>
        </p>
        <ClassBadge {...meta} />
      </div>
    </div>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export function MicroclimatProfileCard({
  dliHistory,
  vpdHistory30,
  drainageData,
  placementType,
}: {
  dliHistory: DLIDataPoint[];
  vpdHistory30: VPDDataPoint[];
  drainageData: DrainageInput[];
  placementType?: string | null;
}) {
  const isPot = placementType === "pot";
  const profile = computeProfile(dliHistory, vpdHistory30, drainageData);
  const suggestion = PLANT_LOOKUP[profile.dliClass][profile.drainClass];
  const vpdMod = VPD_MODIFIER[profile.vpdClass];
  const maturityPct = Math.min(100, (profile.daysOfData / 30) * 100);

  return (
    <div className="rounded-3xl border border-zinc-700/60 bg-gradient-to-br from-zinc-900/80 via-zinc-900/60 to-zinc-950/80 backdrop-blur-xl shadow-2xl overflow-hidden">

      {/* ── Header ── */}
      <div className="px-6 py-5 border-b border-zinc-800 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
            <Leaf className="w-5 h-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-base font-semibold text-white">
              Microclimate Profile
              {isPot && (
                <span className="ml-2 text-xs font-medium text-amber-400 bg-amber-500/10 border border-amber-500/20 px-2 py-0.5 rounded-full align-middle">
                  🪴 Pot context
                </span>
              )}
            </h3>
            <p className="text-xs text-zinc-500 mt-0.5">
              30-day environmental fingerprint · plant matcher
              {isPot && " · pot-adjusted thresholds"}
            </p>
          </div>
        </div>

        {/* Maturity indicator */}
        <div className="text-right shrink-0">
          {profile.isNature ? (
            <div className="flex items-center gap-1.5 text-xs font-medium text-emerald-400">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Profile active
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-medium text-zinc-500">
              <Clock className="w-3.5 h-3.5" />
              Accumulating…
            </div>
          )}
          <p className="text-xs text-zinc-600 mt-0.5">{profile.daysOfData} / 30 days</p>
        </div>
      </div>

      {/* ── Data maturity bar ── */}
      <div className="px-6 pt-4 pb-1">
        <div className="flex items-center justify-between text-xs text-zinc-500 mb-1.5">
          <span>Data maturity</span>
          <span>{maturityPct.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-700"
            style={{
              width: `${maturityPct}%`,
              background: profile.isNature
                ? "linear-gradient(90deg, #10b981, #34d399)"
                : "linear-gradient(90deg, #3b82f6, #60a5fa)",
            }}
          />
        </div>
        {!profile.isNature && (
          <p className="text-xs text-zinc-600 mt-1.5">
            Profile becomes fully reliable after 14+ days of continuous data.
          </p>
        )}
      </div>

      {/* ── Metric rows ── */}
      <div className="px-6 py-2">
        <MetricRow
          icon={<Sun className="w-4 h-4 text-amber-400" />}
          title="Light · DLI"
          subtitle="30-day cumulative photon avg"
          value={profile.dliAvg !== null ? profile.dliAvg.toFixed(2) : "—"}
          unit="mol/m²/day"
          meta={DLI_META[profile.dliClass]}
        />
        <MetricRow
          icon={<Droplets className="w-4 h-4 text-emerald-400" />}
          title="Drainage Velocity"
          subtitle={isPot
            ? "Pot drainage — rapid is expected, stagnant = check drainage holes"
            : "Post-saturation moisture slope"
          }
          value={profile.drainVelocity !== null ? profile.drainVelocity.toFixed(2) : "—"}
          unit="%/hr"
          meta={DRAIN_META[profile.drainClass]}
        />
        <MetricRow
          icon={<Wind className="w-4 h-4 text-teal-400" />}
          title="VPD · Transpiration"
          subtitle="30-day atmospheric drying power"
          value={profile.vpdAvg !== null ? profile.vpdAvg.toFixed(3) : "—"}
          unit="kPa"
          meta={VPD_META[profile.vpdClass]}
        />
      </div>

      {/* ── Plant Matcher ── */}
      <div className="mx-6 mb-6 mt-2 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 overflow-hidden">
        <div className="px-5 py-3 border-b border-emerald-500/15 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-emerald-400" />
          <span className="text-xs font-semibold text-emerald-400 uppercase tracking-wider">
            Plant Matcher · Recommended Species
          </span>
        </div>

        <div className="px-5 py-4">
          <div className="flex items-start gap-3">
            <span className="text-3xl">{suggestion.emoji}</span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-white">{suggestion.category}</p>
              <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                {suggestion.examples.join(" · ")}
              </p>
            </div>
          </div>

          {/* VPD modifier warning */}
          {vpdMod && (
            <div
              className="mt-3 flex items-start gap-2 px-3 py-2.5 rounded-xl border text-xs leading-snug"
              style={{
                borderColor: vpdMod.color + "40",
                backgroundColor: vpdMod.color + "12",
                color: vpdMod.color,
              }}
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{vpdMod.note}</span>
            </div>
          )}
        </div>

        {/* Combo key */}
        <div className="px-5 py-3 border-t border-emerald-500/15 flex items-center gap-2 text-xs text-zinc-600">
          <span>Basis:</span>
          <span
            className="px-2 py-0.5 rounded-full border text-xs"
            style={{
              color: DLI_META[profile.dliClass].color,
              borderColor: DLI_META[profile.dliClass].border,
              backgroundColor: DLI_META[profile.dliClass].bg,
            }}
          >
            {DLI_META[profile.dliClass].label} DLI
          </span>
          <span className="text-zinc-700">+</span>
          <span
            className="px-2 py-0.5 rounded-full border text-xs"
            style={{
              color: DRAIN_META[profile.drainClass].color,
              borderColor: DRAIN_META[profile.drainClass].border,
              backgroundColor: DRAIN_META[profile.drainClass].bg,
            }}
          >
            {DRAIN_META[profile.drainClass].label} Drainage
          </span>
          {profile.vpdClass !== "optimal" && profile.vpdClass !== "unknown" && (
            <>
              <span className="text-zinc-700">+</span>
              <span
                className="px-2 py-0.5 rounded-full border text-xs"
                style={{
                  color: VPD_META[profile.vpdClass].color,
                  borderColor: VPD_META[profile.vpdClass].border,
                  backgroundColor: VPD_META[profile.vpdClass].bg,
                }}
              >
                {VPD_META[profile.vpdClass].label} VPD
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
