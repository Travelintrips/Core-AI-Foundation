/**
 * design-workspace/types/index.ts
 * Core TypeScript types for the Universal Design Canvas Workspace.
 *
 * DOMAIN-NEUTRAL: No fashion, interior, packaging, or other domain fields here.
 * Domain-specific data flows through CanvasArtifact.metadata and renderer adapters.
 */

// ── Transform ─────────────────────────────────────────────────────────────────

/** Viewport transform: scale + 2D pan offset (px). Pure data — no DOM refs. */
export interface CanvasTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

// ── Artifact ──────────────────────────────────────────────────────────────────

export type CanvasArtifactStatus =
  | 'ready'
  | 'generating'
  | 'failed'
  | 'archived'
  | 'review'
  | 'unavailable';

export interface CanvasFrame {
  /** Stable opaque ID — not an array index. */
  id: string;
  label: string;
  index: number;
}

/**
 * Domain-neutral artifact descriptor.
 * `type` is opaque to canvas core; only renderer adapters interpret it.
 * `metadata` is a pass-through bag — canvas core must NOT read domain fields.
 * `url` must be a presigned/authenticated URL resolved by the caller; canvas
 *  core never constructs storage paths.
 */
export interface CanvasArtifact {
  /** Stable opaque ID. */
  id: string;
  /** Opaque type string — e.g. "image", "pdf", "fashion_sketch". Renderer decides. */
  type: string;
  title: string;
  /** Resolved, authenticated URL — never a raw storage path. */
  url?: string;
  /** Domain metadata pass-through — canvas core must not read or render raw values. */
  metadata?: Record<string, unknown>;
  status: CanvasArtifactStatus;
  version?: number;
  frames?: CanvasFrame[];
}

// ── Selection ─────────────────────────────────────────────────────────────────

/**
 * Canvas selection state.
 * Canvas core uses only opaque IDs — it never interprets what a region/element
 * means semantically (no "sleeve", "wall", "box-panel" etc.).
 */
export interface CanvasSelection {
  artifactId: string | null;
  frameId: string | null;
  /** Opaque region ID provided by the renderer/plugin. */
  regionId: string | null;
  source: 'user' | 'programmatic' | 'clear';
}

export const EMPTY_SELECTION: CanvasSelection = {
  artifactId: null,
  frameId: null,
  regionId: null,
  source: 'clear',
};

// ── Renderer adapter ──────────────────────────────────────────────────────────

export interface RendererIntrinsicSize {
  width: number;
  height: number;
}

export interface RendererProps {
  artifact: CanvasArtifact;
  transform: CanvasTransform;
  frameId?: string | null;
  isReadOnly?: boolean;
  onRegionSelect?: (regionId: string) => void;
}

/**
 * Contract every renderer adapter must implement.
 * Adapters are compiled modules — never loaded from arbitrary URLs.
 */
export interface CanvasRendererAdapter {
  /** Globally unique. Duplicate registration throws. */
  readonly rendererId: string;
  /** Types this adapter can render (may overlap; priority breaks ties). */
  readonly supportedArtifactTypes: string[];
  /** Higher value wins when multiple adapters match. Default: 0. */
  readonly priority?: number;
  /** Whether this renderer only supports viewing (no edit interactions). */
  readonly isReadOnly?: boolean;
  /** Returns true if this adapter can render the given artifact. */
  canRender(artifact: CanvasArtifact): boolean;
  /** React component that renders the artifact content. */
  Component: React.ComponentType<RendererProps>;
  /** Intrinsic size for fit-to-screen calculation. Return null if unknown. */
  getIntrinsicSize(artifact: CanvasArtifact): RendererIntrinsicSize | null;
  supportsFrames?: boolean;
  supportsOverlays?: boolean;
  supportsSelection?: boolean;
  capabilityMetadata?: Record<string, unknown>;
}

// ── Overlay ───────────────────────────────────────────────────────────────────

export interface CanvasOverlayProps {
  transform: CanvasTransform;
  artifact: CanvasArtifact | null;
}

export interface CanvasOverlayDefinition {
  /** Stable ID — used to toggle/identify overlays. */
  id: string;
  label: string;
  /** Higher z-order renders on top. */
  zOrder: number;
  enabled: boolean;
  /** Whether the overlay layer captures pointer events. */
  pointerEvents: boolean;
  Component: React.ComponentType<CanvasOverlayProps>;
  'aria-label'?: string;
}

// ── Errors ────────────────────────────────────────────────────────────────────

export type CanvasWorkspaceError =
  | { kind: 'no_artifact' }
  | { kind: 'unsupported_artifact'; artifactType: string }
  | { kind: 'renderer_unavailable'; reason: string }
  | { kind: 'invalid_url' }
  | { kind: 'load_failed'; detail?: string }
  | { kind: 'decode_failed' }
  | { kind: 'expired_access' }
  | { kind: 'permission_denied' }
  | { kind: 'still_generating' }
  | { kind: 'artifact_failed' }
  | { kind: 'artifact_archived' }
  | { kind: 'incompatible_version' };

// ── Permissions ───────────────────────────────────────────────────────────────

export interface WorkspacePermissions {
  canEdit: boolean;
  canAnnotate: boolean;
  canExport: boolean;
  canSelectVersion: boolean;
}

export const READ_ONLY_PERMISSIONS: WorkspacePermissions = {
  canEdit: false,
  canAnnotate: false,
  canExport: false,
  canSelectVersion: false,
};
