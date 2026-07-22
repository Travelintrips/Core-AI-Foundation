/**
 * material-library.tsx — Team 21: Material Library admin page
 *
 * Route: /admin/material-library
 * Mounted in App.tsx as a new route.
 */
import { useState } from "react";
import { Layers, Plus, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { MaterialBrowser } from "@/components/material-library/MaterialBrowser";
import type { MaterialDefinition } from "@/components/material-library/types";

export default function MaterialLibraryPage() {
  const [assignedMaterial, setAssignedMaterial] = useState<MaterialDefinition | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);

  function handleAssign(material: MaterialDefinition) {
    setAssignedMaterial(material);
  }

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Page header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary/10 flex items-center justify-center">
            <Layers className="w-4 h-4 text-primary" />
          </div>
          <div>
            <h1 className="text-base font-semibold text-foreground">Material Library</h1>
            <p className="text-xs text-muted-foreground">
              Universal domain-neutral material catalog
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setRefreshKey((k) => k + 1)}
            className="gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </Button>
          <Button size="sm" className="gap-1.5" disabled>
            <Plus className="w-3.5 h-3.5" />
            Add Material
          </Button>
        </div>
      </div>

      {/* Assignment confirmation banner */}
      {assignedMaterial && (
        <div className="flex items-center justify-between px-6 py-2.5 bg-emerald-500/10 border-b border-emerald-500/20">
          <div className="flex items-center gap-2">
            <div
              className="w-5 h-5 rounded border border-emerald-500/30"
              style={{ backgroundColor: assignedMaterial.preview.swatchColor ?? "#10b981" }}
            />
            <span className="text-sm text-emerald-400">
              Material assigned:{" "}
              <strong>{assignedMaterial.name}</strong>
            </span>
            <Badge variant="outline" className="text-[10px] border-emerald-500/30 text-emerald-400">
              v{assignedMaterial.version}
            </Badge>
          </div>
          <button
            onClick={() => setAssignedMaterial(null)}
            className="text-xs text-emerald-400/70 hover:text-emerald-400"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Browser (flex-1, scrolls internally) */}
      <div className="flex-1 min-h-0" key={refreshKey}>
        <MaterialBrowser onAssign={handleAssign} />
      </div>
    </div>
  );
}
