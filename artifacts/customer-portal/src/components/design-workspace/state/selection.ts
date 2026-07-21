/**
 * design-workspace/state/selection.ts
 * Pure selection state utilities.
 * Canvas core uses only opaque IDs — semantic meaning lives in renderer/plugin.
 */

import type { CanvasSelection } from '../types';
import { EMPTY_SELECTION } from '../types';

export type SelectionAction =
  | { type: 'SELECT_ARTIFACT'; artifactId: string }
  | { type: 'SELECT_FRAME'; frameId: string }
  | { type: 'SELECT_REGION'; regionId: string }
  | { type: 'CLEAR' };

export function selectionReducer(
  state: CanvasSelection,
  action: SelectionAction,
): CanvasSelection {
  switch (action.type) {
    case 'SELECT_ARTIFACT':
      return {
        artifactId: action.artifactId,
        frameId: null,
        regionId: null,
        source: 'user',
      };
    case 'SELECT_FRAME':
      return {
        ...state,
        frameId: action.frameId,
        regionId: null,
        source: 'user',
      };
    case 'SELECT_REGION':
      return {
        ...state,
        regionId: action.regionId,
        source: 'user',
      };
    case 'CLEAR':
      return { ...EMPTY_SELECTION };
    default:
      return state;
  }
}

export function initialSelection(artifactId: string | null): CanvasSelection {
  return {
    artifactId,
    frameId: null,
    regionId: null,
    source: 'programmatic',
  };
}
