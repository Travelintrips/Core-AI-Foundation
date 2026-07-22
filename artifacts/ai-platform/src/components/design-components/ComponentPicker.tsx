/**
 * Universal Design Component & Object Library — ComponentPicker (Team 22)
 *
 * Compact inline picker for selecting a single component from the registry.
 * Suitable for embedding in property panels, brief wizards, and form fields.
 *
 * Works with the same ComponentDefinition shape as ComponentBrowser.
 * Domain-neutral — no hardcoded domain names.
 */

import { useState, useMemo, useRef, useEffect } from "react";
import { Search, ChevronDown, X, CheckCircle2, Lock, AlertTriangle } from "lucide-react";
import type { ComponentDefinition } from "./ComponentBrowser";

// ─────────────────────────────────────────────────────────────────────────────
// Props
// ─────────────────────────────────────────────────────────────────────────────

export interface ComponentPickerProps {
  components: ComponentDefinition[];
  /** Currently selected component ID (controlled) */
  value?: string;
  /** Called when the user picks a component */
  onChange?: (def: ComponentDefinition | null) => void;
  /** Restrict to a specific domain */
  domain?: string;
  /** Placeholder text */
  placeholder?: string;
  /** Whether the field is disabled */
  disabled?: boolean;
  /** Caller-held permission keys */
  callerPermissions?: string[];
  /** Show loading skeleton */
  loading?: boolean;
  /** Error message */
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function callerHasPermission(def: ComponentDefinition, perms: string[]): boolean {
  if (!def.permissions || def.permissions.length === 0) return true;
  const permSet = new Set(perms);
  return def.permissions.every((p) => permSet.has(p));
}

function matchesSearch(def: ComponentDefinition, q: string): boolean {
  if (!q) return true;
  const hay = [def.id, def.label, def.description, def.category.label, ...def.tags]
    .join(" ")
    .toLowerCase();
  return hay.includes(q);
}

// ─────────────────────────────────────────────────────────────────────────────
// ComponentPicker
// ─────────────────────────────────────────────────────────────────────────────

export function ComponentPicker({
  components,
  value,
  onChange,
  domain,
  placeholder = "Select a component…",
  disabled = false,
  callerPermissions = [],
  loading = false,
  error,
}: ComponentPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = useMemo(
    () => components.find((c) => c.id === value) ?? null,
    [components, value],
  );

  // Close on outside click
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Focus search when dropdown opens
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    } else {
      setQuery("");
    }
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.toLowerCase().trim();
    return components.filter((def) => {
      if (def.status === "unavailable") return false;
      if (domain && !def.compatibility.domains.includes(domain)) return false;
      return matchesSearch(def, q);
    });
  }, [components, query, domain]);

  function handleSelect(def: ComponentDefinition) {
    const locked = !callerHasPermission(def, callerPermissions);
    if (locked) return;
    onChange?.(def);
    setOpen(false);
  }

  function handleClear(e: React.MouseEvent) {
    e.stopPropagation();
    onChange?.(null);
  }

  return (
    <div ref={containerRef} className="relative w-full">
      {/* Trigger */}
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => !disabled && !loading && setOpen((v) => !v)}
        className={`w-full flex items-center gap-2 px-3 h-9 rounded-md border text-sm transition-colors ${
          disabled || loading
            ? "opacity-50 cursor-not-allowed bg-gray-50 border-gray-200 text-gray-400"
            : open
              ? "border-gray-900 ring-1 ring-gray-900 bg-white text-gray-900"
              : "border-gray-200 bg-white text-gray-700 hover:border-gray-300"
        }`}
      >
        {loading ? (
          <span className="text-gray-400 animate-pulse">Loading…</span>
        ) : selected ? (
          <>
            <span className="flex-1 text-left truncate font-medium text-gray-900">
              {selected.label}
            </span>
            {selected.status === "deprecated" && (
              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 flex-shrink-0" />
            )}
            <span className="text-[10px] text-gray-400 hidden sm:inline flex-shrink-0">
              {selected.category.label}
            </span>
            <button
              type="button"
              onClick={handleClear}
              className="p-0.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
              tabIndex={-1}
            >
              <X className="w-3 h-3" />
            </button>
          </>
        ) : (
          <>
            <span className="flex-1 text-left text-gray-400">{placeholder}</span>
            <ChevronDown
              className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute z-50 top-full mt-1 w-full min-w-[280px] bg-white rounded-lg border border-gray-200 shadow-lg overflow-hidden">
          {/* Search */}
          <div className="p-2 border-b border-gray-100">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                ref={inputRef}
                type="text"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-full pl-8 pr-3 h-7 text-sm border border-gray-200 rounded focus:outline-none focus:border-gray-900 bg-gray-50"
              />
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="px-3 py-4 text-xs text-red-600 text-center">
              {error}
            </div>
          )}

          {/* Empty */}
          {!error && filtered.length === 0 && (
            <div className="px-3 py-4 text-xs text-gray-400 text-center">
              {query
                ? `No results for "${query}"`
                : domain
                  ? `No components available for domain "${domain}"`
                  : "No components available."}
            </div>
          )}

          {/* Results */}
          {!error && filtered.length > 0 && (
            <ul
              className="max-h-60 overflow-y-auto py-1"
              role="listbox"
            >
              {filtered.map((def) => {
                const isSelected = def.id === value;
                const locked = !callerHasPermission(def, callerPermissions);
                const deprecated = def.status === "deprecated";

                return (
                  <li
                    key={def.id}
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelect(def)}
                    className={`flex items-start gap-2.5 px-3 py-2 cursor-pointer transition-colors ${
                      locked
                        ? "opacity-40 cursor-not-allowed"
                        : isSelected
                          ? "bg-gray-100"
                          : "hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span
                          className={`text-sm font-medium ${deprecated ? "text-amber-700" : "text-gray-900"}`}
                        >
                          {def.label}
                        </span>
                        {deprecated && (
                          <AlertTriangle className="w-3 h-3 text-amber-500" />
                        )}
                        {locked && <Lock className="w-3 h-3 text-gray-400" />}
                      </div>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-gray-400">
                          {def.category.label}
                        </span>
                        {def.compatibility.domains.slice(0, 2).map((d) => (
                          <span
                            key={d}
                            className="text-[10px] bg-blue-50 text-blue-600 px-1 py-0.5 rounded"
                          >
                            {d}
                          </span>
                        ))}
                        {def.compatibility.domains.length > 2 && (
                          <span className="text-[10px] text-gray-400">
                            +{def.compatibility.domains.length - 2}
                          </span>
                        )}
                      </div>
                    </div>
                    {isSelected && (
                      <CheckCircle2 className="w-4 h-4 text-gray-900 flex-shrink-0 mt-0.5" />
                    )}
                  </li>
                );
              })}
            </ul>
          )}

          {/* Domain hint */}
          {domain && (
            <div className="px-3 py-1.5 border-t border-gray-100 text-[10px] text-gray-400">
              Showing components compatible with domain:{" "}
              <span className="font-medium text-gray-600">{domain}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
