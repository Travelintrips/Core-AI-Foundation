/**
 * WorkspaceDensity — Context and hook for comfortable / compact density modes.
 * Teams 11–19 should wrap their workspace roots in <WorkspaceDensityProvider>
 * and consume useDensity() to adapt spacing. No new CSS framework introduced.
 */
import * as React from "react";

export type WorkspaceDensity = "comfortable" | "compact";

interface DensityContextValue {
  density: WorkspaceDensity;
  setDensity: (d: WorkspaceDensity) => void;
  /** Utility: pick a value per density mode */
  pick: <T>(comfortable: T, compact: T) => T;
}

const DensityContext = React.createContext<DensityContextValue>({
  density: "comfortable",
  setDensity: () => undefined,
  pick: (comfortable) => comfortable,
});

export function WorkspaceDensityProvider({
  children,
  defaultDensity = "comfortable",
}: {
  children: React.ReactNode;
  defaultDensity?: WorkspaceDensity;
}) {
  const [density, setDensity] = React.useState<WorkspaceDensity>(defaultDensity);

  const pick = React.useCallback(
    <T,>(comfortable: T, compact: T): T =>
      density === "compact" ? compact : comfortable,
    [density],
  );

  return (
    <DensityContext.Provider value={{ density, setDensity, pick }}>
      <div data-density={density}>{children}</div>
    </DensityContext.Provider>
  );
}

export function useDensity(): DensityContextValue {
  return React.useContext(DensityContext);
}

/**
 * Utility class maps for density-aware spacing.
 * Use these in className expressions for consistent density behaviour.
 */
export const DENSITY_PADDING = {
  comfortable: "p-4",
  compact: "p-2",
} as const;

export const DENSITY_GAP = {
  comfortable: "gap-3",
  compact: "gap-1.5",
} as const;

export const DENSITY_TEXT = {
  comfortable: "text-sm",
  compact: "text-xs",
} as const;
