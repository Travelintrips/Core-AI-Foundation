/**
 * PropertySection — collapsible section containing field renderers.
 * Accessible: accordion uses proper ARIA attributes.
 * Labels rendered as text — no dangerouslySetInnerHTML.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { sanitizeLabel } from "./security";
import { PropertyFieldRendererHost } from "./PropertyFieldRendererHost";
import { usePropertyPanelCtx } from "./context";
import type { PropertySectionDefinition } from "./types";

interface Props {
  section: PropertySectionDefinition;
}

export function PropertySection({ section }: Props) {
  const { editingState, panelContext } = usePropertyPanelCtx();
  const [open, setOpen] = useState(section.defaultOpen ?? true);

  // Section-level read-only
  const sectionReadOnly =
    typeof section.readOnly === "function"
      ? section.readOnly(panelContext)
      : section.readOnly;
  const isReadOnly = editingState.isReadOnly || !!sectionReadOnly;

  // Filter visible fields
  const visibleFields = section.fields.filter((f) => {
    const vis = typeof f.visible === "function" ? f.visible(panelContext) : f.visible;
    if (vis === false) return false;
    if (f.capabilities?.length) {
      return f.capabilities.every((c) => panelContext.capabilities.includes(c));
    }
    return true;
  });

  if (visibleFields.length === 0) return null;

  const sectionId = `prop-section-${section.id}`;
  const contentId = `${sectionId}-content`;

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-muted/50 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
        aria-controls={contentId}
        aria-expanded={open}
      >
        <ChevronDown
          className={cn(
            "size-3 text-muted-foreground transition-transform duration-150",
            !open && "-rotate-90",
          )}
          aria-hidden="true"
        />
        <span className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground flex-1 text-left">
          {/* Label as text — safe */}
          {sanitizeLabel(section.label)}
        </span>
        {section.stability && section.stability !== "stable" && (
          <Badge variant="outline" className="text-[9px] h-3.5 px-1">
            {section.stability}
          </Badge>
        )}
        {isReadOnly && (
          <Badge variant="secondary" className="text-[9px] h-3.5 px-1">
            read-only
          </Badge>
        )}
      </CollapsibleTrigger>

      <CollapsibleContent id={contentId}>
        <div className="px-3 pb-3 space-y-3">
          {visibleFields.map((field) => (
            <PropertyFieldRendererHost
              key={field.id}
              sectionId={section.id}
              fieldDef={field}
            />
          ))}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
