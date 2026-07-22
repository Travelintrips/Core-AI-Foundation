/**
 * PropertyPanelShell — the top-level container for the Universal Property Panel.
 *
 * Responsibilities:
 *   - Provides PropertyPanelProvider context (registries + editing state).
 *   - Evaluates selection context → renders sections from the registry.
 *   - Shows ValidationSummary + SaveStatus.
 *   - Handles empty selection and read-only artifact states.
 *   - Accessible: scroll area, keyboard navigation, live regions.
 *   - Domain-neutral: knows nothing about Fashion, Interior, etc.
 *
 * Usage:
 *   <PropertyPanelShell
 *     context={panelContext}
 *     sectionRegistry={mySectionRegistry}   // optional, uses global by default
 *     rendererRegistry={myRendererRegistry} // optional, uses global by default
 *     initialValues={currentValues}
 *     onSave={handleSave}
 *   />
 */

import { useReducer, useCallback } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";
import { PropertyPanelProvider } from "./context";
import { PropertySection } from "./PropertySection";
import { ValidationSummary } from "./ValidationSummary";
import { SaveStatus } from "./SaveStatus";
import { editingModelReducer, makeInitialEditingState } from "./editing-model";
import {
  globalSectionRegistry,
  globalRendererRegistry,
  PropertySectionRegistry,
  PropertyFieldRendererRegistry,
} from "./registry";
import type { PropertyPanelContext, PropertyValue } from "./types";
import "../renderers/index"; // ensure built-in renderers are registered

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PropertyPanelShellProps {
  /** Selection and permission context — must be server-resolved */
  context: PropertyPanelContext;
  /** Override section registry (default: globalSectionRegistry) */
  sectionRegistry?: PropertySectionRegistry;
  /** Override renderer registry (default: globalRendererRegistry) */
  rendererRegistry?: PropertyFieldRendererRegistry;
  /** Initial canonical values */
  initialValues?: Record<string, PropertyValue>;
  /** Concurrency token from last server save */
  concurrencyToken?: string;
  /**
   * Called with dirty patches when explicit save fires.
   * Return { token } for the new concurrency token.
   */
  onSave?: (
    patches: Array<{
      sectionId: string;
      fieldId: string;
      value: PropertyValue;
      concurrencyToken?: string;
    }>,
  ) => Promise<{ token?: string } | void>;
  /** Class name for the outer container */
  className?: string;
}

// ── Shell ─────────────────────────────────────────────────────────────────────

export function PropertyPanelShell({
  context,
  sectionRegistry = globalSectionRegistry,
  rendererRegistry = globalRendererRegistry,
  initialValues = {},
  concurrencyToken,
  onSave,
  className,
}: PropertyPanelShellProps) {
  const [editingState, dispatch] = useReducer(
    editingModelReducer,
    { isReadOnly: context.isReadOnly, concurrencyToken },
    (o) => makeInitialEditingState(initialValues, o),
  );

  // Explicit save
  const handleSave = useCallback(async () => {
    if (!onSave) return;
    dispatch({ type: "BEGIN_SAVE" });
    const patches = Array.from(editingState.dirtyFields).map((fieldId) => ({
      sectionId: "__panel__",
      fieldId,
      value: editingState.draft[fieldId],
      concurrencyToken: editingState.concurrencyToken,
    }));
    try {
      const result = await onSave(patches);
      dispatch({
        type: "SAVE_SUCCESS",
        token: result && "token" in result ? result.token : undefined,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Save failed";
      if (msg.toLowerCase().includes("permission") || msg.includes("403")) {
        dispatch({ type: "PERMISSION_DENIED", error: msg });
      } else if (msg.toLowerCase().includes("conflict") || msg.includes("409")) {
        dispatch({
          type: "STALE_VERSION_CONFLICT",
          serverValues: editingState.canonicalValues,
          token: editingState.concurrencyToken ?? "",
        });
      } else {
        dispatch({ type: "SAVE_FAILED", error: msg });
      }
    }
  }, [onSave, editingState]);

  const handleReset = useCallback(() => {
    dispatch({ type: "RESET" });
  }, []);

  // Resolve visible sections for current context
  const sections = sectionRegistry.getSections(context);

  // ── Empty state ────────────────────────────────────────────────────────────

  const hasSelection =
    context.selectedArtifactId ||
    context.selectedElementId ||
    context.selectedFrameId ||
    context.selectedRegionId ||
    context.selectedLayerId;

  if (!hasSelection) {
    return (
      <aside
        className={cn(
          "flex flex-col items-center justify-center text-muted-foreground text-xs select-none",
          className,
        )}
        aria-label="Property panel — nothing selected"
      >
        <span>Select an element to see its properties</span>
      </aside>
    );
  }

  if (sections.length === 0) {
    return (
      <aside
        className={cn(
          "flex flex-col items-center justify-center text-muted-foreground text-xs select-none",
          className,
        )}
        aria-label="Property panel — no properties"
      >
        <span>No properties available for this selection</span>
      </aside>
    );
  }

  // ── Main render ────────────────────────────────────────────────────────────

  return (
    <PropertyPanelProvider
      value={{
        sectionRegistry,
        rendererRegistry,
        editingState,
        dispatch,
        panelContext: context,
        onImmediateSave: undefined, // explicit save model by default
      }}
    >
      <aside
        className={cn("flex flex-col", className)}
        aria-label="Property panel"
      >
        {/* Read-only banner */}
        {context.isReadOnly && (
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 bg-muted/50 text-muted-foreground text-xs border-b border-border"
            role="status"
            aria-label="Panel is read-only"
          >
            <Lock className="size-3" aria-hidden="true" />
            <span>Read-only</span>
          </div>
        )}

        {/* Sections */}
        <ScrollArea className="flex-1">
          <div className="py-1">
            <ValidationSummary />
            {sections.map((section, idx) => (
              <div key={section.id}>
                <PropertySection section={section} />
                {idx < sections.length - 1 && (
                  <Separator className="mx-3" />
                )}
              </div>
            ))}
          </div>
        </ScrollArea>

        {/* Save status footer */}
        {!context.isReadOnly && (
          <SaveStatus onSave={onSave ? handleSave : undefined} onReset={handleReset} />
        )}
      </aside>
    </PropertyPanelProvider>
  );
}
