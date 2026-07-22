/**
 * MaterialDetailPanel — right sidebar showing details of a selected material.
 */
import { X, Copy, ExternalLink } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { MaterialDefinition, MaterialCategory } from "./types";

const STATUS_LABELS: Record<string, string> = {
  active: "Active",
  inactive: "Inactive",
  deprecated: "Deprecated",
  unavailable: "Unavailable",
  draft: "Draft",
};

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-400",
  inactive: "text-muted-foreground",
  deprecated: "text-amber-400",
  unavailable: "text-destructive",
  draft: "text-blue-400",
};

interface Props {
  material: MaterialDefinition;
  category?: MaterialCategory;
  onClose: () => void;
  onAssign?: (material: MaterialDefinition) => void;
}

function PropertyRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <span className="text-[11px] text-muted-foreground w-28 shrink-0 pt-0.5">{label}</span>
      <span className="text-xs text-foreground flex-1 break-all">{value}</span>
    </div>
  );
}

function renderPropertyValue(value: unknown): React.ReactNode {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return <code className="text-[10px] bg-muted px-1 py-0.5 rounded">{JSON.stringify(value)}</code>;
  return String(value);
}

export function MaterialDetailPanel({ material, category, onClose, onAssign }: Props) {
  const hasSwatches = material.preview.additionalSwatches.length > 0;
  const propertyEntries = Object.entries(material.properties);

  return (
    <div className="flex flex-col h-full border-l border-border bg-card w-80 shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="text-sm font-semibold text-foreground">Material Details</h3>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
          aria-label="Close detail panel"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4 space-y-4">
          {/* Preview */}
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
            {material.preview.previewUrl ? (
              <img
                src={material.preview.previewUrl}
                alt={material.preview.altText}
                className="h-full w-full object-cover"
              />
            ) : material.preview.swatchColor ? (
              <div className="h-full w-full" style={{ backgroundColor: material.preview.swatchColor }} />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-3xl">🎨</div>
            )}
          </div>

          {/* Additional swatches */}
          {hasSwatches && (
            <div className="flex gap-2 flex-wrap">
              {material.preview.additionalSwatches.map((swatch, i) => (
                swatch.startsWith("#") ? (
                  <div
                    key={i}
                    className="w-8 h-8 rounded-full border border-border shadow-sm"
                    style={{ backgroundColor: swatch }}
                    title={swatch}
                  />
                ) : (
                  <img key={i} src={swatch} alt="" className="w-8 h-8 rounded-full object-cover border border-border" />
                )
              ))}
            </div>
          )}

          {/* Name + status */}
          <div>
            <div className="flex items-start justify-between gap-2">
              <h4 className="text-sm font-semibold text-foreground leading-snug">{material.name}</h4>
              <span className={cn("text-xs font-medium shrink-0", STATUS_COLORS[material.status])}>
                {STATUS_LABELS[material.status] ?? material.status}
              </span>
            </div>
            {material.description && (
              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{material.description}</p>
            )}
          </div>

          {/* Tags */}
          {material.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {material.tags.map((tag) => (
                <Badge key={tag} variant="outline" className="text-[11px]">{tag}</Badge>
              ))}
            </div>
          )}

          <Separator />

          {/* Core metadata */}
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Details</p>
            {category && <PropertyRow label="Category" value={category.name} />}
            <PropertyRow label="Source" value={material.source} />
            <PropertyRow label="Version" value={`v${material.version}`} />
            <PropertyRow label="Read-only" value={material.readOnly ? "Yes" : "No"} />
            {material.tenantId === null && <PropertyRow label="Scope" value="Platform (shared)" />}
            <PropertyRow label="Created" value={new Date(material.createdAt).toLocaleDateString()} />
            <PropertyRow label="Updated" value={new Date(material.updatedAt).toLocaleDateString()} />
          </div>

          {/* Domain compatibility */}
          {material.compatibility.compatibleDomains.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Domain Compatibility</p>
                <div className="flex flex-wrap gap-1.5">
                  {material.compatibility.compatibleDomains.map((d) => (
                    <Badge key={d} variant="secondary" className="text-[11px]">{d}</Badge>
                  ))}
                </div>
                {material.compatibility.compatibilityNote && (
                  <p className="text-[11px] text-muted-foreground mt-1">{material.compatibility.compatibilityNote}</p>
                )}
              </div>
            </>
          )}

          {/* Properties */}
          {propertyEntries.length > 0 && (
            <>
              <Separator />
              <div>
                <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">Properties</p>
                {propertyEntries.map(([key, val]) => (
                  <PropertyRow key={key} label={key} value={renderPropertyValue(val)} />
                ))}
              </div>
            </>
          )}

          {/* Material ID */}
          <Separator />
          <div>
            <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-1">ID</p>
            <div className="flex items-center gap-2">
              <code className="text-[10px] text-muted-foreground flex-1 break-all font-mono">
                {material.materialId}
              </code>
              <button
                onClick={() => navigator.clipboard.writeText(material.materialId)}
                className="p-1 rounded hover:bg-muted text-muted-foreground"
                title="Copy ID"
              >
                <Copy className="w-3 h-3" />
              </button>
            </div>
          </div>
        </div>
      </ScrollArea>

      {/* Footer actions */}
      <div className="border-t border-border p-4 space-y-2">
        {onAssign && material.status === "active" && (
          <Button
            onClick={() => onAssign(material)}
            size="sm"
            className="w-full"
          >
            Assign Material
          </Button>
        )}
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={() => window.open(`/admin/material-library?id=${material.materialId}`, "_blank")}
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open Full View
        </Button>
      </div>
    </div>
  );
}
