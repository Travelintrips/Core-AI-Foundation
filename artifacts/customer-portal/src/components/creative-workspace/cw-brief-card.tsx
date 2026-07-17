/**
 * cw-brief-card.tsx — Brief status display card (Team 2).
 */
import { motion } from "framer-motion";
import { CheckCircle2, Circle, AlertCircle } from "lucide-react";
import type { BriefField, BriefStatus } from "@/hooks/creative-workspace";

function FieldRow({ field }: { field: BriefField }) {
  return (
    <div className={`flex items-start gap-3 py-2.5 border-b border-white/5 last:border-0 ${!field.filled && field.required ? "opacity-80" : ""}`}>
      <div className="mt-0.5 shrink-0">
        {field.filled ? (
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
        ) : field.required ? (
          <AlertCircle className="w-4 h-4 text-amber-400" />
        ) : (
          <Circle className="w-4 h-4 text-slate-600" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <span className="text-xs font-medium text-slate-400 block mb-0.5">{field.label}</span>
        {field.filled ? (
          <p className="text-sm text-white break-words">{field.value}</p>
        ) : (
          <p className="text-sm text-slate-600 italic">{field.required ? "Diperlukan" : "Belum diisi"}</p>
        )}
      </div>
    </div>
  );
}

export function CWBriefCard({ brief }: { brief: BriefStatus }) {
  const pct = brief.briefCompletionPercent;
  const color = pct >= 80 ? "text-emerald-400" : pct >= 50 ? "text-amber-400" : "text-red-400";
  const barColor = pct >= 80 ? "#34D399" : pct >= 50 ? "#FBBF24" : "#F87171";

  const required = brief.fields.filter((f) => f.required);
  const optional = brief.fields.filter((f) => !f.required && f.filled);

  return (
    <div className="space-y-4">
      {/* Completion header */}
      <div className="p-4 rounded-2xl border border-white/8 bg-white/3">
        <div className="flex items-center justify-between mb-3">
          <div>
            <span className="text-sm font-semibold text-white">Brief Completion</span>
            {brief.serviceType && (
              <span className="ml-2 text-xs text-slate-400">— {brief.serviceType}</span>
            )}
          </div>
          <span className={`text-lg font-bold ${color}`}>{pct}%</span>
        </div>
        <div className="h-2 rounded-full bg-white/8 overflow-hidden">
          <motion.div
            className="h-full rounded-full"
            style={{ background: barColor }}
            initial={{ width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          />
        </div>
        {brief.summary && (
          <p className="mt-3 text-sm text-slate-400 leading-relaxed">{brief.summary}</p>
        )}
      </div>

      {/* Required fields */}
      {required.length > 0 && (
        <div className="rounded-2xl border border-white/8 bg-white/3 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/6">
            <h3 className="text-sm font-semibold text-white">Field Utama</h3>
          </div>
          <div className="px-4 divide-y divide-white/5">
            {required.map((f) => <FieldRow key={f.key} field={f} />)}
          </div>
        </div>
      )}

      {/* Optional fields */}
      {optional.length > 0 && (
        <div className="rounded-2xl border border-white/8 bg-white/3 overflow-hidden">
          <div className="px-4 py-3 border-b border-white/6">
            <h3 className="text-sm font-semibold text-slate-300">Informasi Tambahan</h3>
          </div>
          <div className="px-4 divide-y divide-white/5">
            {optional.map((f) => <FieldRow key={f.key} field={f} />)}
          </div>
        </div>
      )}
    </div>
  );
}
