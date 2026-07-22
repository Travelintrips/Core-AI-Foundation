/**
 * MaterialCard — grid card for the Material Browser.
 */
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { MaterialDefinition } from "./types";

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  inactive: "bg-muted text-muted-foreground",
  deprecated: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  unavailable: "bg-destructive/10 text-destructive border-destructive/20",
  draft: "bg-blue-500/10 text-blue-400 border-blue-500/20",
};

const SOURCE_LABELS: Record<string, string> = {
  platform: "Platform",
  tenant: "Custom",
  plugin: "Plugin",
  uploaded: "Uploaded",
  external: "External",
};

interface Props {
  material: MaterialDefinition;
  selected?: boolean;
  onClick?: () => void;
  categoryName?: string;
}

export function MaterialCard({ material, selected, onClick, categoryName }: Props) {
  const { preview, name, status, source, tags } = material;
  const isUnavailable = status === "deprecated" || status === "unavailable" || status === "inactive";

  return (
    <button
      onClick={onClick}
      className={cn(
        "group relative flex flex-col rounded-xl border text-left transition-all",
        "hover:border-primary/50 hover:shadow-md focus:outline-none focus:ring-2 focus:ring-primary/30",
        selected ? "border-primary bg-primary/5 shadow-md" : "border-border bg-card",
        isUnavailable && "opacity-60",
      )}
    >
      {/* Preview area */}
      <div className="relative aspect-square w-full overflow-hidden rounded-t-xl bg-muted">
        {preview.previewUrl ? (
          <img
            src={preview.previewUrl}
            alt={preview.altText}
            className="h-full w-full object-cover transition-transform group-hover:scale-105"
            loading="lazy"
          />
        ) : preview.swatchColor ? (
          <div
            className="h-full w-full"
            style={{ backgroundColor: preview.swatchColor }}
            aria-label={preview.altText}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted-foreground">
            <span className="text-2xl">🎨</span>
          </div>
        )}

        {/* Status badge overlay */}
        {status !== "active" && (
          <span className={cn(
            "absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-medium border",
            STATUS_COLORS[status] ?? "bg-muted",
          )}>
            {status}
          </span>
        )}

        {/* Read-only badge */}
        {material.readOnly && (
          <span className="absolute top-2 left-2 px-1.5 py-0.5 rounded text-[10px] font-medium bg-[#1E3057]/80 text-[#7BA3D4] border border-[#1E3057]">
            Read-only
          </span>
        )}
      </div>

      {/* Info area */}
      <div className="flex flex-col gap-1 p-3">
        <span className="text-sm font-medium text-foreground line-clamp-1">{name}</span>

        {categoryName && (
          <span className="text-[11px] text-muted-foreground">{categoryName}</span>
        )}

        <div className="flex items-center gap-1 flex-wrap mt-0.5">
          <span className="text-[10px] text-muted-foreground border border-border rounded px-1.5 py-0.5">
            {SOURCE_LABELS[source] ?? source}
          </span>
          {tags.slice(0, 2).map((tag) => (
            <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 border-border">
              {tag}
            </Badge>
          ))}
          {tags.length > 2 && (
            <span className="text-[10px] text-muted-foreground">+{tags.length - 2}</span>
          )}
        </div>
      </div>

      {/* Selected indicator */}
      {selected && (
        <div className="absolute inset-0 rounded-xl ring-2 ring-primary pointer-events-none" />
      )}
    </button>
  );
}
