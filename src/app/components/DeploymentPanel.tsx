"use client";

import { useState, useCallback } from "react";
import {
  MapPin,
  Plus,
  X,
  ChevronDown,
  ChevronUp,
  Clock,
  Flower2,
  TreePine,
  Home,
  Warehouse,
  Shrub,
  Container,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Deployment {
  id: number;
  device_id: string;
  started_at: string;
  ended_at: string | null;
  placement_type: string;
  label: string | null;
  notes: string | null;
  pot_material: string | null;
  pot_size_cm: number | null;
  has_drainage: boolean;
  plant_type: string | null;
}

export type PlantType = "tropical" | "succulent" | "carnivorous" | "herb";

export const PLANT_TYPE_CONFIG: Record<PlantType, { label: string; icon: string }> = {
  tropical: { label: "Tropical / Foliage", icon: "🌿" },
  succulent: { label: "Succulent / Cactus", icon: "🌵" },
  carnivorous: { label: "Carnivorous / Bog", icon: "🪰" },
  herb: { label: "Herbs / Edibles", icon: "🌱" },
};

type PlacementType = "pot" | "raised_bed" | "flower_bed" | "ground" | "indoor" | "greenhouse";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PLACEMENT_CONFIG: Record<
  PlacementType,
  { label: string; icon: React.ReactNode; color: string; bgColor: string; borderColor: string }
> = {
  pot: {
    label: "Pot",
    icon: <Container className="w-4 h-4" />,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-500/20",
  },
  raised_bed: {
    label: "Raised Bed",
    icon: <Shrub className="w-4 h-4" />,
    color: "text-lime-400",
    bgColor: "bg-lime-500/10",
    borderColor: "border-lime-500/20",
  },
  flower_bed: {
    label: "Flower Bed",
    icon: <Flower2 className="w-4 h-4" />,
    color: "text-pink-400",
    bgColor: "bg-pink-500/10",
    borderColor: "border-pink-500/20",
  },
  ground: {
    label: "Ground",
    icon: <TreePine className="w-4 h-4" />,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-500/20",
  },
  indoor: {
    label: "Indoor",
    icon: <Home className="w-4 h-4" />,
    color: "text-blue-400",
    bgColor: "bg-blue-500/10",
    borderColor: "border-blue-500/20",
  },
  greenhouse: {
    label: "Greenhouse",
    icon: <Warehouse className="w-4 h-4" />,
    color: "text-teal-400",
    bgColor: "bg-teal-500/10",
    borderColor: "border-teal-500/20",
  },
};

const POT_MATERIALS = [
  { value: "terracotta", label: "Terracotta" },
  { value: "plastic", label: "Plastic" },
  { value: "ceramic", label: "Ceramic" },
  { value: "fabric", label: "Fabric" },
  { value: "concrete", label: "Concrete" },
  { value: "metal", label: "Metal" },
  { value: "wood", label: "Wood" },
];

function getPlacementConfig(type: string) {
  return PLACEMENT_CONFIG[type as PlacementType] ?? PLACEMENT_CONFIG.ground;
}

// ─── Move Node Modal ──────────────────────────────────────────────────────────

function DeploymentFormModal({
  deviceId,
  onClose,
  onCreated,
  onUpdated,
  deploymentToEdit,
}: {
  deviceId: string;
  onClose: () => void;
  onCreated?: (d: Deployment) => void;
  onUpdated?: (d: Deployment) => void;
  deploymentToEdit?: Deployment;
}) {
  const [placement, setPlacement] = useState<PlacementType>((deploymentToEdit?.placement_type as PlacementType) || "pot");
  const [label, setLabel] = useState(deploymentToEdit?.label || "");
  const [notes, setNotes] = useState(deploymentToEdit?.notes || "");
  const [plantType, setPlantType] = useState<PlantType>((deploymentToEdit?.plant_type as PlantType) || "tropical");
  const [potMaterial, setPotMaterial] = useState(deploymentToEdit?.pot_material || "terracotta");
  const [potSize, setPotSize] = useState<number | "">(deploymentToEdit?.pot_size_cm || "");
  const [hasDrainage, setHasDrainage] = useState(deploymentToEdit ? deploymentToEdit.has_drainage : true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);

    try {
      const body: Record<string, unknown> = {
        device_id: deviceId,
        placement_type: placement,
        plant_type: plantType,
        has_drainage: hasDrainage,
      };
      if (label.trim()) body.label = label.trim();
      if (notes.trim()) body.notes = notes.trim();
      if (placement === "pot") {
        body.pot_material = potMaterial;
        if (potSize !== "") body.pot_size_cm = potSize;
      }

      let res;
      if (deploymentToEdit) {
        res = await fetch(`/api/deployments/${deploymentToEdit.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      } else {
        res = await fetch("/api/deployments", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
      }

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || (deploymentToEdit ? "Failed to update deployment" : "Failed to create deployment"));
      }

      const { deployment } = await res.json();
      if (deploymentToEdit && onUpdated) {
        onUpdated(deployment);
      } else if (onCreated) {
        onCreated(deployment);
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Modal */}
      <div className="relative w-full max-w-lg rounded-3xl border border-zinc-700/80 bg-zinc-900 shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 rounded-xl border border-emerald-500/20">
              <MapPin className="w-5 h-5 text-emerald-400" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-white">
                {deploymentToEdit ? "Edit Deployment" : "Log Deployment"}
              </h2>
              <p className="text-xs text-zinc-500 mt-0.5">
                {deploymentToEdit ? "Update current node placement details" : "Record where the node is being placed"}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-500 hover:text-white hover:bg-zinc-800 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-5 max-h-[70vh] overflow-y-auto">
          {/* Placement Type Grid */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Placement Type</label>
            <div className="grid grid-cols-3 gap-2">
              {(Object.entries(PLACEMENT_CONFIG) as [PlacementType, typeof PLACEMENT_CONFIG[PlacementType]][]).map(
                ([key, cfg]) => (
                  <button
                    key={key}
                    onClick={() => setPlacement(key)}
                    className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all duration-200 ${
                      placement === key
                        ? `${cfg.bgColor} ${cfg.borderColor} ${cfg.color}`
                        : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                    }`}
                  >
                    {cfg.icon}
                    <span className="text-xs font-medium">{cfg.label}</span>
                  </button>
                )
              )}
            </div>
          </div>

          {/* Plant Type */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Plant Category</label>
            <div className="grid grid-cols-2 gap-2">
              {(Object.entries(PLANT_TYPE_CONFIG) as [PlantType, typeof PLANT_TYPE_CONFIG[PlantType]][]).map(
                ([key, cfg]) => (
                  <button
                    key={key}
                    onClick={() => setPlantType(key)}
                    className={`flex items-center gap-2 p-3 rounded-xl border transition-all duration-200 ${
                      plantType === key
                        ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-300"
                        : "border-zinc-800 text-zinc-500 hover:border-zinc-700 hover:text-zinc-300"
                    }`}
                  >
                    <span className="text-base">{cfg.icon}</span>
                    <span className="text-xs font-medium">{cfg.label}</span>
                  </button>
                )
              )}
            </div>
          </div>

          {/* Label */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">Label</label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Big terracotta pot, Front yard bed"
              className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-600 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/40 transition-all"
            />
          </div>

          {/* Pot-specific fields */}
          {placement === "pot" && (
            <div className="space-y-4 p-4 rounded-xl bg-amber-500/5 border border-amber-500/10">
              <p className="text-xs text-amber-400/70 font-medium uppercase tracking-wider">
                Pot Details
              </p>

              {/* Material */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">Material</label>
                <div className="flex flex-wrap gap-2">
                  {POT_MATERIALS.map((mat) => (
                    <button
                      key={mat.value}
                      onClick={() => setPotMaterial(mat.value)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                        potMaterial === mat.value
                          ? "bg-amber-500/20 border-amber-500/30 text-amber-300"
                          : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                      }`}
                    >
                      {mat.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Size */}
              <div className="space-y-2">
                <label className="text-sm font-medium text-zinc-300">
                  Diameter{" "}
                  <span className="text-zinc-500 font-normal">(cm, optional)</span>
                </label>
                <input
                  type="number"
                  value={potSize}
                  onChange={(e) => setPotSize(e.target.value ? Number(e.target.value) : "")}
                  placeholder="e.g. 25"
                  className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-600 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500/40 focus:border-amber-500/40 transition-all"
                />
              </div>

              {/* Drainage */}
              <label className="flex items-center gap-3 cursor-pointer group">
                <div
                  className={`relative w-10 h-6 rounded-full transition-colors duration-200 ${
                    hasDrainage ? "bg-emerald-500" : "bg-zinc-700"
                  }`}
                  onClick={() => setHasDrainage(!hasDrainage)}
                >
                  <div
                    className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform duration-200 ${
                      hasDrainage ? "translate-x-[18px]" : "translate-x-0.5"
                    }`}
                  />
                </div>
                <span className="text-sm text-zinc-300 group-hover:text-white transition-colors">
                  Has drainage holes
                </span>
              </label>
            </div>
          )}

          {/* Notes */}
          <div className="space-y-2">
            <label className="text-sm font-medium text-zinc-300">
              Notes <span className="text-zinc-500 font-normal">(optional)</span>
            </label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="e.g. Testing drainage with new cactus soil mix"
              rows={2}
              className="w-full px-4 py-2.5 rounded-xl bg-zinc-800 border border-zinc-700 text-white placeholder:text-zinc-600 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500/40 transition-all resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="px-4 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-sm text-red-400">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-zinc-800 flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 px-4 py-2.5 text-sm font-medium text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-xl transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-5 py-2.5 bg-white text-zinc-900 text-sm font-semibold rounded-xl hover:bg-zinc-200 disabled:opacity-50 transition-colors"
          >
            {submitting ? "Saving..." : deploymentToEdit ? "Save Changes" : "Log Deployment"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Deployment Panel ─────────────────────────────────────────────────────────

export function DeploymentPanel({
  activeDeployment,
  deploymentHistory,
  deviceId,
  onDeploymentCreated,
  onDeploymentUpdated,
}: {
  activeDeployment: Deployment | null;
  deploymentHistory: Deployment[];
  deviceId: string;
  onDeploymentCreated: (d: Deployment) => void;
  onDeploymentUpdated: (d: Deployment) => void;
}) {
  const [showMoveModal, setShowMoveModal] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const handleCreated = useCallback(
    (d: Deployment) => {
      onDeploymentCreated(d);
    },
    [onDeploymentCreated]
  );

  const cfg = activeDeployment
    ? getPlacementConfig(activeDeployment.placement_type)
    : null;

  const pastDeployments = deploymentHistory.filter((d) => d.ended_at !== null);

  return (
    <>
      {showMoveModal && (
        <DeploymentFormModal
          deviceId={deviceId}
          onClose={() => setShowMoveModal(false)}
          onCreated={onDeploymentCreated}
        />
      )}

      {isEditing && activeDeployment && (
        <DeploymentFormModal
          deviceId={deviceId}
          deploymentToEdit={activeDeployment}
          onClose={() => setIsEditing(false)}
          onUpdated={onDeploymentUpdated}
        />
      )}

      <div className="rounded-3xl border border-zinc-800/80 bg-zinc-900/40 backdrop-blur-xl overflow-hidden shadow-lg">
        <div className="px-6 py-5">
          <div className="flex items-center justify-between">
            {/* Current deployment */}
            <div className="flex items-center gap-4">
              {cfg && activeDeployment ? (
                <>
                  <div
                    className={`p-2.5 rounded-xl ${cfg.bgColor} border ${cfg.borderColor}`}
                  >
                    <MapPin className={`w-5 h-5 ${cfg.color}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span
                        className={`text-xs font-semibold uppercase tracking-wider ${cfg.color}`}
                      >
                        {cfg.label}
                      </span>
                      {activeDeployment.plant_type && (
                        <span className="text-xs font-medium text-emerald-400">
                          · {PLANT_TYPE_CONFIG[activeDeployment.plant_type as PlantType]?.label ?? activeDeployment.plant_type}
                        </span>
                      )}
                      {activeDeployment.placement_type === "pot" &&
                        activeDeployment.pot_material && (
                          <span className="text-xs text-zinc-500">
                            · {activeDeployment.pot_material}
                            {activeDeployment.pot_size_cm
                              ? ` · ${activeDeployment.pot_size_cm}cm`
                              : ""}
                            {!activeDeployment.has_drainage && " · no drainage"}
                          </span>
                        )}
                    </div>
                    <p className="text-sm text-white font-medium mt-0.5">
                      {activeDeployment.label || "Unnamed location"}
                    </p>
                    <div className="flex items-center gap-1.5 mt-1 text-xs text-zinc-500">
                      <Clock className="w-3 h-3" />
                      <span>
                        Deployed{" "}
                        {formatDistanceToNow(new Date(activeDeployment.started_at), {
                          addSuffix: true,
                        })}
                      </span>
                    </div>
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="p-2.5 rounded-xl bg-zinc-800 border border-zinc-700">
                    <MapPin className="w-5 h-5 text-zinc-500" />
                  </div>
                  <div>
                    <p className="text-sm text-zinc-400">No active deployment</p>
                    <p className="text-xs text-zinc-600 mt-0.5">
                      Log where the node is placed to start tracking
                    </p>
                  </div>
                </div>
              )}
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2">
              {pastDeployments.length > 0 && (
                <button
                  onClick={() => setShowHistory(!showHistory)}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-zinc-400 hover:text-white bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 rounded-xl transition-all"
                >
                  History
                  {showHistory ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
              )}
              <div className="flex gap-2">
                {activeDeployment && (
                  <button
                    onClick={() => setIsEditing(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-zinc-700 bg-zinc-800/50 hover:bg-zinc-800 hover:border-zinc-600 transition-colors"
                  >
                    <span className="text-xs font-semibold text-zinc-300">Edit Details</span>
                  </button>
                )}
                <button
                  onClick={() => setShowMoveModal(true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/10 hover:bg-emerald-500/20 transition-colors"
                >
                  <span className="text-xs font-semibold text-emerald-400">
                    {activeDeployment ? "Move Node / Reset Trial" : "Log Deployment"}
                  </span>
                </button>
              </div>
            </div>
          </div>

          {/* Notes (if any) */}
          {activeDeployment?.notes && (
            <div className="mt-3 px-4 py-2.5 rounded-xl bg-zinc-800/40 border border-zinc-800/60">
              <p className="text-xs text-zinc-400">{activeDeployment.notes}</p>
            </div>
          )}
        </div>

        {/* History timeline */}
        {showHistory && pastDeployments.length > 0 && (
          <div className="border-t border-zinc-800 px-6 py-4 space-y-3">
            <p className="text-xs font-medium text-zinc-500 uppercase tracking-wider">
              Deployment History
            </p>
            <div className="space-y-2">
              {pastDeployments.map((d) => {
                const pastCfg = getPlacementConfig(d.placement_type);
                const startDate = new Date(d.started_at);
                const endDate = d.ended_at ? new Date(d.ended_at) : null;
                const durationMs = endDate
                  ? endDate.getTime() - startDate.getTime()
                  : 0;
                const durationDays = Math.round(durationMs / (1000 * 60 * 60 * 24));

                return (
                  <div
                    key={d.id}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl bg-zinc-800/30 border border-zinc-800/50"
                  >
                    <div
                      className={`p-1.5 rounded-lg ${pastCfg.bgColor} border ${pastCfg.borderColor}`}
                    >
                      {pastCfg.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold ${pastCfg.color}`}>
                          {pastCfg.label}
                        </span>
                        {d.label && (
                          <span className="text-xs text-zinc-400 truncate">
                            — {d.label}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-zinc-600 mt-0.5">
                        {startDate.toLocaleDateString()} →{" "}
                        {endDate?.toLocaleDateString() ?? "now"}
                        {durationDays > 0 && (
                          <span className="text-zinc-500 ml-1">
                            ({durationDays}d)
                          </span>
                        )}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
