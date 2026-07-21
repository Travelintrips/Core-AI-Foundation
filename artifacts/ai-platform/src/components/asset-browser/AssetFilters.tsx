/**
 * AssetFilters.tsx — Filter panel for the Universal Asset Browser (Team 14)
 */

import { cn } from "@/lib/utils";
import { Filter, X } from "lucide-react";
import type { AssetFilter, AssetSort, AssetSortField, AssetType } from "./types";
import { AssetSourceRegistry } from "./AssetSourceRegistry";

const CATEGORY_OPTIONS = [
  { value: "", label: "Semua Kategori" },
  { value: "logo", label: "Logo" },
  { value: "photo", label: "Photo" },
  { value: "illustration", label: "Illustration" },
  { value: "icon", label: "Icon" },
  { value: "document", label: "Document" },
  { value: "brand_guideline", label: "Brand Guideline" },
  { value: "reference", label: "Reference" },
  { value: "generated_image", label: "Generated Image" },
  { value: "uploaded_image", label: "Uploaded Image" },
];

const TYPE_OPTIONS: { value: AssetType | ""; label: string }[] = [
  { value: "", label: "Semua Tipe" },
  { value: "image", label: "Image" },
  { value: "pdf", label: "PDF" },
  { value: "document", label: "Document" },
  { value: "video_preview", label: "Video" },
  { value: "font_reference", label: "Font" },
  { value: "logo", label: "Logo" },
  { value: "icon", label: "Icon" },
  { value: "generated_artifact", label: "Generated Artifact" },
];

const SORT_OPTIONS: { value: AssetSortField; label: string }[] = [
  { value: "newest", label: "Terbaru" },
  { value: "oldest", label: "Terlama" },
  { value: "name", label: "Nama A–Z" },
  { value: "size", label: "Ukuran Terbesar" },
];

interface AssetFiltersProps {
  filter: AssetFilter;
  sort: AssetSort;
  onFilterChange: (patch: Partial<AssetFilter>) => void;
  onSortChange: (sort: AssetSort) => void;
  adminMode?: boolean;
  className?: string;
}

function SelectField({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-medium text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "text-sm rounded-lg border border-border bg-background px-3 py-1.5",
          "focus:outline-none focus:ring-2 focus:ring-ring",
          "transition-colors",
        )}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AssetFilters({
  filter,
  sort,
  onFilterChange,
  onSortChange,
  adminMode = false,
  className,
}: AssetFiltersProps) {
  const sources = AssetSourceRegistry.list({ adminMode });
  const sourceOptions = [
    { value: "", label: "Semua Sumber" },
    ...sources.map((s) => ({ value: s.id, label: s.label })),
  ];

  const hasActiveFilters =
    filter.category !== "" ||
    filter.assetType !== "" ||
    filter.sourceId !== "" ||
    filter.tags.length > 0 ||
    filter.showArchived ||
    filter.favoritedOnly;

  function clearFilters() {
    onFilterChange({
      category: "",
      assetType: "",
      sourceId: "",
      tags: [],
      showArchived: false,
      favoritedOnly: false,
    });
  }

  return (
    <div className={cn("flex flex-wrap items-end gap-3", className)}>
      <div className="flex items-center gap-1.5 text-muted-foreground">
        <Filter className="w-3.5 h-3.5" />
        <span className="text-xs font-medium">Filter</span>
      </div>

      <SelectField
        label="Kategori"
        value={filter.category}
        onChange={(v) => onFilterChange({ category: v })}
        options={CATEGORY_OPTIONS}
      />

      <SelectField
        label="Tipe"
        value={filter.assetType}
        onChange={(v) => onFilterChange({ assetType: v as AssetType | "" })}
        options={TYPE_OPTIONS}
      />

      <SelectField
        label="Sumber"
        value={filter.sourceId}
        onChange={(v) => onFilterChange({ sourceId: v })}
        options={sourceOptions}
      />

      <SelectField
        label="Urutkan"
        value={sort.field}
        onChange={(v) => onSortChange({ field: v as AssetSortField })}
        options={SORT_OPTIONS}
      />

      {/* Toggles */}
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium text-muted-foreground">Opsi</label>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={filter.favoritedOnly}
              onChange={(e) => onFilterChange({ favoritedOnly: e.target.checked })}
              className="rounded"
            />
            Favorit
          </label>
          <label className="flex items-center gap-1.5 text-xs cursor-pointer">
            <input
              type="checkbox"
              checked={filter.showArchived}
              onChange={(e) => onFilterChange({ showArchived: e.target.checked })}
              className="rounded"
            />
            Arsip
          </label>
        </div>
      </div>

      {hasActiveFilters && (
        <button
          onClick={clearFilters}
          aria-label="Reset semua filter"
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors mt-auto pb-1.5"
        >
          <X className="w-3 h-3" />
          Reset
        </button>
      )}
    </div>
  );
}
