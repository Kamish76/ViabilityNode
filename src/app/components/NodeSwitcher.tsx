"use client";

import { useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Radio,
  Cpu,
  Thermometer,
  Droplets,
  Battery,
  Clock,
  Sparkles,
  ChevronRight,
  PlusCircle,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

export interface NodeSummary {
  nodeId: string;
  status: "online" | "idle" | "offline";
  lastSeen: string | null;
  activeDeploymentLabel: string | null;
  plantType: string | null;
  latestTemp: number | null;
  latestHumidity: number | null;
  latestBattery: number | null;
}

interface NodeSwitcherProps {
  selectedDeviceId: string;
  availableNodes: string[];
  nodeSummaries: NodeSummary[];
  onSelectNode?: (nodeId: string) => void;
}

export function NodeSwitcher({
  selectedDeviceId,
  availableNodes,
  nodeSummaries,
  onSelectNode,
}: NodeSwitcherProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const handleSelect = (nodeId: string) => {
    if (nodeId === selectedDeviceId) return;

    if (onSelectNode) {
      onSelectNode(nodeId);
    }

    startTransition(() => {
      const params = new URLSearchParams(searchParams?.toString() || "");
      params.set("node", nodeId);
      router.push(`/?${params.toString()}`, { scroll: false });
    });
  };

  return (
    <section className="mb-8" aria-label="Surrogate Node Selection">
      <div className="flex items-center justify-between mb-3 px-1">
        <div className="flex items-center gap-2">
          <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span className="text-xs font-semibold text-zinc-400 uppercase tracking-widest">
            Monitored Nodes
          </span>
          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-zinc-800/80 text-zinc-400 border border-zinc-700/50">
            {availableNodes.length} active
          </span>
        </div>
        {isPending && (
          <div className="flex items-center gap-1.5 text-xs text-emerald-400 font-medium animate-pulse">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
            Switching node data…
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        {availableNodes.map((nodeId) => {
          const isSelected = nodeId === selectedDeviceId;
          const summary = nodeSummaries.find((s) => s.nodeId === nodeId);
          const isOnline = summary?.status === "online";
          const isIdle = summary?.status === "idle";
          const hasData = summary?.lastSeen != null;

          return (
            <button
              key={nodeId}
              type="button"
              onClick={() => handleSelect(nodeId)}
              className={`group relative text-left p-4 rounded-2xl border transition-all duration-300 backdrop-blur-xl ${
                isSelected
                  ? "bg-emerald-950/20 border-emerald-500/40 shadow-lg shadow-emerald-950/30 ring-1 ring-emerald-500/20"
                  : "bg-zinc-900/40 border-zinc-800/80 hover:bg-zinc-800/50 hover:border-zinc-700/80 text-zinc-400 hover:text-zinc-200"
              }`}
            >
              {/* Subtle top indicator glow for active node */}
              {isSelected && (
                <div className="absolute top-0 left-6 right-6 h-[1.5px] bg-gradient-to-r from-transparent via-emerald-400/80 to-transparent" />
              )}

              <div className="flex items-start justify-between gap-3 mb-2.5">
                <div className="flex items-center gap-2.5 min-w-0">
                  <div
                    className={`p-2 rounded-xl border transition-colors ${
                      isSelected
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                        : "bg-zinc-800/60 border-zinc-700/40 text-zinc-400 group-hover:text-zinc-200"
                    }`}
                  >
                    <Cpu className="w-4 h-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold tracking-tight text-white">
                        {nodeId}
                      </span>
                      {/* Status indicator dot */}
                      <span className="flex items-center gap-1.5 text-[11px] font-medium">
                        <span
                          className={`w-2 h-2 rounded-full ${
                            isOnline
                              ? "bg-emerald-400 animate-pulse ring-2 ring-emerald-400/20"
                              : isIdle
                              ? "bg-amber-400 ring-2 ring-amber-400/20"
                              : "bg-zinc-600"
                          }`}
                        />
                        <span
                          className={
                            isOnline
                              ? "text-emerald-400"
                              : isIdle
                              ? "text-amber-400"
                              : "text-zinc-500"
                          }
                        >
                          {isOnline ? "Live" : isIdle ? "Idle" : "Awaiting data"}
                        </span>
                      </span>
                    </div>

                    <p className="text-xs text-zinc-400 truncate mt-0.5">
                      {summary?.activeDeploymentLabel ? (
                        <span className="text-zinc-300 font-medium">
                          {summary.activeDeploymentLabel}
                          {summary.plantType && (
                            <span className="text-zinc-500 capitalize ml-1">
                              • {summary.plantType}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-zinc-500 italic">No deployment placement set</span>
                      )}
                    </p>
                  </div>
                </div>

                {/* Right Badge */}
                <div>
                  {isSelected ? (
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-300 bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 rounded-full">
                      <Sparkles className="w-3 h-3" />
                      Active View
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-0.5 text-xs text-zinc-500 group-hover:text-zinc-300 transition-colors">
                      Swap to node
                      <ChevronRight className="w-3.5 h-3.5 group-hover:translate-x-0.5 transition-transform" />
                    </span>
                  )}
                </div>
              </div>

              {/* Node Telemetry Quick Snippet */}
              <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between text-xs text-zinc-400">
                {hasData ? (
                  <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
                    {summary?.latestTemp != null && (
                      <span className="flex items-center gap-1 text-zinc-300">
                        <Thermometer className="w-3.5 h-3.5 text-orange-400" />
                        {summary.latestTemp.toFixed(1)}°C
                      </span>
                    )}
                    {summary?.latestHumidity != null && (
                      <span className="flex items-center gap-1 text-zinc-300">
                        <Droplets className="w-3.5 h-3.5 text-blue-400" />
                        {summary.latestHumidity.toFixed(0)}%
                      </span>
                    )}
                    {summary?.latestBattery != null && (
                      <span className="flex items-center gap-1 text-zinc-300">
                        <Battery className="w-3.5 h-3.5 text-emerald-400" />
                        {summary.latestBattery}%
                      </span>
                    )}
                    {summary?.lastSeen && (
                      <span className="flex items-center gap-1 text-zinc-500 text-[11px] hidden sm:inline-flex">
                        <Clock className="w-3 h-3 text-zinc-600" />
                        {formatDistanceToNow(new Date(summary.lastSeen), { addSuffix: true })}
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-zinc-500 text-[11px]">
                    <PlusCircle className="w-3.5 h-3.5 text-zinc-600" />
                    Ready for telemetry push via ESP32
                  </div>
                )}
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
