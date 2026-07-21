/**
 * AssetPicker.tsx — Modal picker for embedding Asset Browser in forms (Team 14)
 *
 * Used by Team 12 (asset reference fields) and Team 11 (workspace artifact selection).
 * Wraps AssetBrowserShell in a dialog overlay.
 */

import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { AssetBrowserShell } from "./AssetBrowserShell";
import type { AssetSummary, AssetFilter, AssetSort } from "./types";

export interface AssetPickerProps {
  open: boolean;
  onClose: () => void;
  /** Called when user confirms selection */
  onSelect: (assets: AssetSummary[]) => void;
  mode?: "single" | "multi";
  initialFilter?: Partial<AssetFilter>;
  initialSort?: Partial<AssetSort>;
  adminMode?: boolean;
  title?: string;
  confirmLabel?: string;
  /** Restrict which asset types can be selected */
  allowedCategories?: string[];
}

export function AssetPicker({
  open,
  onClose,
  onSelect,
  mode = "single",
  adminMode = false,
  title = mode === "single" ? "Pilih Asset" : "Pilih Asset",
  confirmLabel = mode === "single" ? "Pilih" : "Pilih Asset",
}: AssetPickerProps) {
  const dialogRef = useRef<HTMLDivElement>(null);

  // Focus trap + Escape
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement as HTMLElement | null;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      prev?.focus();
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-background/80 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={dialogRef}
        className={cn(
          "bg-card border border-border rounded-2xl shadow-2xl flex flex-col",
          "w-full max-w-5xl max-h-[85vh]",
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border shrink-0">
          <h2 className="font-semibold text-base">{title}</h2>
          <button
            onClick={onClose}
            aria-label="Tutup picker"
            className="p-2 rounded-lg hover:bg-muted transition-colors text-muted-foreground"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Browser Shell */}
        <div className="flex-1 overflow-hidden">
          <AssetBrowserShell
            selectionMode={mode}
            adminMode={adminMode}
            onConfirmSelection={onSelect}
            confirmLabel={confirmLabel}
            className="h-full"
            embedded
          />
        </div>
      </div>
    </div>
  );
}
