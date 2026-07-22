/**
 * Universal Property Panel — React Context
 *
 * Provides registry instances, editing model dispatch, and selection context
 * to all child components without prop-drilling.
 */

import { createContext, useContext } from "react";
import type { PropertySectionRegistry, PropertyFieldRendererRegistry } from "./registry";
import type { EditingModelState, EditingModelAction, PropertyPanelContext } from "./types";

export interface PropertyPanelContextValue {
  sectionRegistry: PropertySectionRegistry;
  rendererRegistry: PropertyFieldRendererRegistry;
  editingState: EditingModelState;
  dispatch: React.Dispatch<EditingModelAction>;
  panelContext: PropertyPanelContext;
  /** Called when a field is changed with immediate save semantics */
  onImmediateSave?: (sectionId: string, fieldId: string) => void;
}

const PropertyPanelCtx = createContext<PropertyPanelContextValue | null>(null);

export const PropertyPanelProvider = PropertyPanelCtx.Provider;

export function usePropertyPanelCtx(): PropertyPanelContextValue {
  const ctx = useContext(PropertyPanelCtx);
  if (!ctx) {
    throw new Error(
      "usePropertyPanelCtx must be used inside <PropertyPanelShell>",
    );
  }
  return ctx;
}
