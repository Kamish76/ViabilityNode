"use client";

import { useState } from "react";
import { Leaf, Droplets, Sun, Wind, Clock, AlertTriangle, CheckCircle2, TrendingUp, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";

// ─── Types ────────────────────────────────────────────────────────────────────

export type DLIClass    = "low" | "moderate" | "high" | "unknown";
export type DrainClass  = "rapid" | "moderate" | "stagnant" | "unknown";
export type VPDClass    = "low" | "optimal" | "high" | "unknown";

export interface PrecalculatedProfile {
  dli_avg: number | null;
  dli_class: DLIClass;
  vpd_avg: number | null;
  vpd_class: VPDClass;
  v_grav: number | null;
  v_dry: number | null;
  drain_class: DrainClass;
  retention_hours: number | null;
  is_historical_rate: boolean;
  last_watered_at: string | null;
  current_phase: number | null;
  days_of_data: number;
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
  unknown:   { label: "Pending watering",  color: "#71717a", bg: "#27272a33", border: "#3f3f4640" },
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
  profile,
  placementType,
  deviceId,
}: {
  profile: PrecalculatedProfile | null;
  placementType?: string | null;
  deviceId?: string;
}) {
  const [isRecalculating, setIsRecalculating] = useState(false);
  const router = useRouter();
  const isPot = placementType === "pot";

  const handleRecalculate = async () => {
    if (!deviceId || isRecalculating) return;
    setIsRecalculating(true);
    try {
      const res = await fetch(`/api/cron/process-microclimate?device_id=${deviceId}`, {
        method: "POST",
      });
      if (res.ok) {
        router.refresh();
      } else {
        const data = await res.json();
        alert(data.error || "Failed to recalculate");
      }
    } catch (e) {
      console.error(e);
      alert("Network error while recalculating.");
    } finally {
      setIsRecalculating(false);
    }
  };

  if (!profile) {
    return (
      <div className="rounded-3xl border border-zinc-700/60 bg-gradient-to-br from-zinc-900/80 via-zinc-900/60 to-zinc-950/80 backdrop-blur-xl shadow-2xl p-6 text-center">
        <div className="flex items-center justify-center mb-4">
          <Leaf className="w-8 h-8 text-zinc-600 animate-pulse" />
        </div>
        <p className="text-sm font-medium text-white">Pending first calculation</p>
        <p className="text-xs text-zinc-500 mt-1 mb-4">Data is waiting to be processed by the backend cron.</p>
        <button
          onClick={handleRecalculate}
          disabled={!deviceId || isRecalculating}
          className="inline-flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm font-medium rounded-xl transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isRecalculating ? 'animate-spin' : ''}`} />
          Calculate Now
        </button>
      </div>
    );
  }

  const suggestion = PLANT_LOOKUP[profile.dli_class][profile.drain_class];
  const vpdMod = VPD_MODIFIER[profile.vpd_class];
  const isNature = profile.days_of_data >= 14;
  const maturityPct = Math.min(100, (profile.days_of_data / 30) * 100);

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

        {/* Maturity indicator & Recalculate */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="text-right">
            {isNature ? (
              <div className="flex items-center justify-end gap-1.5 text-xs font-medium text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                Profile active
              </div>
            ) : (
              <div className="flex items-center justify-end gap-1.5 text-xs font-medium text-zinc-500">
                <Clock className="w-3.5 h-3.5" />
                Accumulating…
              </div>
            )}
            <p className="text-xs text-zinc-600 mt-0.5">{profile.days_of_data} / 30 days</p>
          </div>
          
          <button
            onClick={handleRecalculate}
            disabled={!deviceId || isRecalculating}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-zinc-400 bg-zinc-800/50 hover:bg-zinc-800 hover:text-zinc-200 rounded-lg transition-colors border border-zinc-700/50 disabled:opacity-50"
            title="Recalculate based on latest telemetry"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isRecalculating ? 'animate-spin' : ''}`} />
            Sync
          </button>
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
              background: isNature
                ? "linear-gradient(90deg, #10b981, #34d399)"
                : "linear-gradient(90deg, #3b82f6, #60a5fa)",
            }}
          />
        </div>
        {!isNature && (
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
          value={profile.dli_avg !== null ? profile.dli_avg.toFixed(2) : "—"}
          unit="mol/m²/day"
          meta={DLI_META[profile.dli_class]}
        />
        <MetricRow
          icon={<Droplets className="w-4 h-4 text-emerald-400" />}
          title="Water Retention"
          subtitle={(() => {
            let base = "Time to lose 10% from peak after watering";
            if (profile.drain_class === 'unknown') {
              return "Drainage pending next watering cycle";
            }
            if (profile.is_historical_rate && profile.last_watered_at) {
              const dateStr = new Date(profile.last_watered_at).toLocaleDateString([], { month: 'short', day: 'numeric' });
              base = `Historical Rate (Last watered ${dateStr})`;
            } else if (isPot) {
              base = "Pot drainage — fast is expected, slow = check drainage holes";
            }
            if (profile.current_phase === 3) {
              base += " — Capillary Plateau / Dry";
            }
            
            const parts: string[] = [];
            if (profile.v_grav !== null) parts.push(`V_grav: ${profile.v_grav.toFixed(2)} %/hr`);
            if (profile.v_dry !== null) parts.push(`V_dry: ${profile.v_dry.toFixed(2)} %/hr`);
            return parts.length > 0 ? `${base} · ${parts.join(' · ')}` : base;
          })()}
          value={profile.retention_hours !== null ? (profile.retention_hours < 1 ? `${Math.round(profile.retention_hours * 60)}m` : profile.retention_hours.toFixed(1)) : "—"}
          unit={profile.retention_hours !== null ? (profile.retention_hours < 1 ? "" : "hours") : ""}
          meta={DRAIN_META[profile.drain_class]}
        />
        <MetricRow
          icon={<Wind className="w-4 h-4 text-teal-400" />}
          title="VPD · Transpiration"
          subtitle="30-day atmospheric drying power"
          value={profile.vpd_avg !== null ? profile.vpd_avg.toFixed(3) : "—"}
          unit="kPa"
          meta={VPD_META[profile.vpd_class]}
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
              color: DLI_META[profile.dli_class].color,
              borderColor: DLI_META[profile.dli_class].border,
              backgroundColor: DLI_META[profile.dli_class].bg,
            }}
          >
            {DLI_META[profile.dli_class].label} DLI
          </span>
          <span className="text-zinc-700">+</span>
          <span
            className="px-2 py-0.5 rounded-full border text-xs"
            style={{
              color: DRAIN_META[profile.drain_class].color,
              borderColor: DRAIN_META[profile.drain_class].border,
              backgroundColor: DRAIN_META[profile.drain_class].bg,
            }}
          >
            {DRAIN_META[profile.drain_class].label} Drainage
          </span>
          {profile.vpd_class !== "optimal" && profile.vpd_class !== "unknown" && (
            <>
              <span className="text-zinc-700">+</span>
              <span
                className="px-2 py-0.5 rounded-full border text-xs"
                style={{
                  color: VPD_META[profile.vpd_class].color,
                  borderColor: VPD_META[profile.vpd_class].border,
                  backgroundColor: VPD_META[profile.vpd_class].bg,
                }}
              >
                {VPD_META[profile.vpd_class].label} VPD
              </span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
