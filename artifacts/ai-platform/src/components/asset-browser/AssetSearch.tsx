/**
 * AssetSearch.tsx — Search input for the Universal Asset Browser (Team 14)
 */

import { useRef, useCallback } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface AssetSearchProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
}

export function AssetSearch({
  value,
  onChange,
  placeholder = "Cari asset...",
  className,
  disabled,
}: AssetSearchProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClear = useCallback(() => {
    onChange("");
    inputRef.current?.focus();
  }, [onChange]);

  return (
    <div className={cn("relative flex items-center", className)}>
      <Search className="absolute left-3 w-4 h-4 text-muted-foreground pointer-events-none" aria-hidden />
      <input
        ref={inputRef}
        type="search"
        role="searchbox"
        aria-label="Cari asset"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        className={cn(
          "w-full pl-9 pr-8 py-2 text-sm rounded-lg border border-border bg-background",
          "placeholder:text-muted-foreground",
          "focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent",
          "disabled:opacity-50 disabled:cursor-not-allowed",
          "transition-colors",
        )}
      />
      {value && !disabled && (
        <button
          onClick={handleClear}
          aria-label="Hapus pencarian"
          className="absolute right-2 p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      )}
    </div>
  );
}
