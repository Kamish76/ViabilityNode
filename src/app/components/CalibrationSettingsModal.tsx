"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, X, Save, AlertCircle } from "lucide-react";
import { createClient } from "@/utils/supabase/client";

interface CalibrationSettingsModalProps {
  selectedDeviceId: string;
  initialSettings: any;
}

export function CalibrationSettingsModal({ selectedDeviceId, initialSettings }: CalibrationSettingsModalProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [dryLimit, setDryLimit] = useState(initialSettings?.dry_limit?.toString() || "1920");
  const [wetLimit, setWetLimit] = useState(initialSettings?.wet_limit?.toString() || "880");
  const [isSaving, setIsSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ type: 'success' | 'error', text: string } | null>(null);

  const supabase = createClient();

  const handleSave = async () => {
    setIsSaving(true);
    setSaveMessage(null);
    try {
      const parsedDry = parseInt(dryLimit, 10);
      const parsedWet = parseInt(wetLimit, 10);
      if (isNaN(parsedDry) || isNaN(parsedWet)) {
        throw new Error("Please enter valid numeric values for limits.");
      }

      const { error } = await supabase
        .from('device_settings')
        .upsert({ 
          device_id: selectedDeviceId, 
          dry_limit: parsedDry, 
          wet_limit: parsedWet,
          updated_at: new Date().toISOString()
        });

      if (error) {
        if (
          error.message.includes('calibration_history') ||
          error.message.includes('schema cache') ||
          error.message.includes('row-level security')
        ) {
          throw new Error("Database migration not applied yet. Run the migration script in your Supabase SQL Editor.");
        }
        throw error;
      }
      setSaveMessage({ type: 'success', text: 'Calibration updated successfully.' });
      router.refresh();
      setTimeout(() => setIsOpen(false), 1500);
    } catch (err: any) {
      setSaveMessage({ type: 'error', text: err.message || 'Failed to save settings.' });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <>
      <button
        onClick={() => { setIsOpen(true); setSaveMessage(null); }}
        className="flex items-center gap-2 px-4 py-2 bg-zinc-900/50 border border-zinc-800 rounded-full backdrop-blur-md hover:bg-zinc-800/80 transition-colors"
      >
        <Settings className="w-4 h-4 text-zinc-400" />
        <span className="text-sm font-medium text-zinc-300">Calibration</span>
      </button>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="bg-zinc-950 border border-zinc-800 rounded-2xl w-full max-w-md shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-zinc-800/80 bg-zinc-900/30">
              <h2 className="text-lg font-semibold text-white flex items-center gap-2">
                <Settings className="w-5 h-5 text-emerald-400" />
                Node Calibration
              </h2>
              <button onClick={() => setIsOpen(false)} className="p-1 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="p-6 space-y-6">
              <div className="bg-zinc-900/50 p-4 rounded-xl border border-zinc-800">
                <p className="text-sm text-zinc-400 mb-1">Target Node</p>
                <p className="font-mono text-emerald-400 font-semibold">{selectedDeviceId}</p>
              </div>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">Dry Limit (Air)</label>
                  <input
                    type="number"
                    value={dryLimit}
                    onChange={(e) => setDryLimit(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-white outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 transition-all font-mono"
                  />
                  <p className="text-xs text-zinc-500 mt-1">Raw ADC value when completely dry (e.g. 1920).</p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-zinc-300 mb-1.5">Wet Limit (Water)</label>
                  <input
                    type="number"
                    value={wetLimit}
                    onChange={(e) => setWetLimit(e.target.value)}
                    className="w-full bg-zinc-900 border border-zinc-700 rounded-xl px-4 py-2.5 text-white outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500/50 transition-all font-mono"
                  />
                  <p className="text-xs text-zinc-500 mt-1">Raw ADC value when fully submerged (e.g. 880).</p>
                </div>
              </div>

              <div className="bg-amber-950/20 border border-amber-900/30 rounded-xl p-4 flex gap-3">
                <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
                <p className="text-xs text-amber-200/70 leading-relaxed">
                  Changes apply only to future telemetry records. Historical data will retain its original calculated moisture percentage to preserve data integrity.
                </p>
              </div>

              {saveMessage && (
                <div className={`p-3 rounded-xl text-sm ${saveMessage.type === 'success' ? 'bg-emerald-950/30 text-emerald-400 border border-emerald-900/50' : 'bg-red-950/30 text-red-400 border border-red-900/50'}`}>
                  {saveMessage.text}
                </div>
              )}
            </div>

            <div className="p-4 border-t border-zinc-800/80 bg-zinc-900/30 flex justify-end gap-3">
              <button
                onClick={() => setIsOpen(false)}
                className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-white transition-colors"
                disabled={isSaving}
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="flex items-center gap-2 px-5 py-2 bg-emerald-500 hover:bg-emerald-400 text-zinc-950 text-sm font-bold rounded-xl transition-all disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {isSaving ? "Saving..." : "Save Calibration"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
