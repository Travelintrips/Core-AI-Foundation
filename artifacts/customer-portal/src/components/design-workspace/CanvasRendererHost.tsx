/**
 * design-workspace/CanvasRendererHost.tsx
 * Resolves the correct renderer for the active artifact and renders it.
 * Contains NO domain-specific switch statements — routing is entirely through
 * the CanvasRendererRegistry.
 */

import React, { useMemo } from 'react';
import { FileQuestion, Archive, Clock, XCircle, Lock, FileWarning } from 'lucide-react';
import type { CanvasArtifact, CanvasTransform, CanvasWorkspaceError } from './types';
import type { CanvasRendererRegistry } from './renderers/registry';
import { LoadingOverlay, ErrorOverlay, GeneratingOverlay } from './overlays/CanvasOverlayHost';

// ── Status state components ───────────────────────────────────────────────────

function StateCard({
  icon: Icon,
  title,
  description,
  role = 'status',
}: {
  icon: React.ElementType;
  title: string;
  description?: string;
  role?: string;
}) {
  return (
    <div
      className="flex flex-col items-center justify-center w-full h-full gap-4 text-center px-8"
      role={role}
      aria-label={title}
    >
      <div className="w-14 h-14 rounded-2xl bg-white/5 border border-white/8 flex items-center justify-center">
        <Icon className="w-7 h-7 text-slate-500" />
      </div>
      <div>
        <p className="text-sm font-medium text-slate-400">{title}</p>
        {description && (
          <p className="text-xs text-slate-600 mt-1 max-w-xs">{description}</p>
        )}
      </div>
    </div>
  );
}

function workspaceErrorMessage(error: CanvasWorkspaceError): { title: string; description?: string } {
  switch (error.kind) {
    case 'no_artifact':
      return { title: 'No artifact selected' };
    case 'unsupported_artifact':
      return {
        title: 'Preview unavailable',
        description: `Artifact type "${error.artifactType}" has no registered renderer.`,
      };
    case 'renderer_unavailable':
      return { title: 'Renderer unavailable', description: error.reason };
    case 'invalid_url':
      return { title: 'Invalid asset URL' };
    case 'load_failed':
      return { title: 'Failed to load', description: error.detail };
    case 'decode_failed':
      return { title: 'Failed to decode artifact' };
    case 'expired_access':
      return { title: 'Access expired', description: 'Request a new link.' };
    case 'permission_denied':
      return { title: 'Access denied' };
    case 'still_generating':
      return { title: 'Generating…', description: 'This artifact is being created.' };
    case 'artifact_failed':
      return { title: 'Generation failed', description: 'This artifact could not be created.' };
    case 'artifact_archived':
      return { title: 'Archived', description: 'This artifact has been archived.' };
    case 'incompatible_version':
      return { title: 'Incompatible version' };
  }
}

// ── Main component ────────────────────────────────────────────────────────────

export interface CanvasRendererHostProps {
  artifact: CanvasArtifact | null;
  registry: CanvasRendererRegistry;
  transform: CanvasTransform;
  isLoading?: boolean;
  error?: CanvasWorkspaceError | null;
  frameId?: string | null;
  isReadOnly?: boolean;
  onRegionSelect?: (regionId: string) => void;
}

export function CanvasRendererHost({
  artifact,
  registry,
  transform,
  isLoading = false,
  error = null,
  frameId,
  isReadOnly = true,
  onRegionSelect,
}: CanvasRendererHostProps) {
  const resolveResult = useMemo(() => {
    if (!artifact) return null;
    return registry.resolve(artifact);
  }, [artifact, registry]);

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) return <LoadingOverlay />;

  // ── Explicit error ─────────────────────────────────────────────────────────
  if (error) {
    const { title, description } = workspaceErrorMessage(error);
    switch (error.kind) {
      case 'still_generating':
        return <GeneratingOverlay label={title} />;
      case 'artifact_archived':
        return <StateCard icon={Archive} title={title} description={description} />;
      case 'permission_denied':
        return <StateCard icon={Lock} title={title} role="alert" />;
      case 'artifact_failed':
        return <StateCard icon={XCircle} title={title} description={description} role="alert" />;
      case 'no_artifact':
        return <StateCard icon={FileQuestion} title={title} />;
      default:
        return <ErrorOverlay message={description ?? title} />;
    }
  }

  // ── No artifact ────────────────────────────────────────────────────────────
  if (!artifact) {
    return (
      <StateCard
        icon={FileQuestion}
        title="No artifact selected"
        description="Select an artifact to preview."
      />
    );
  }

  // ── Status-based early exits ───────────────────────────────────────────────
  if (artifact.status === 'generating') {
    return <GeneratingOverlay label="Generating artifact…" />;
  }
  if (artifact.status === 'failed') {
    return <StateCard icon={XCircle} title="Generation failed" role="alert" />;
  }
  if (artifact.status === 'archived') {
    return <StateCard icon={Archive} title="Archived" />;
  }
  if (artifact.status === 'unavailable') {
    return <StateCard icon={Clock} title="Unavailable" description="This artifact is not available." />;
  }

  // ── No resolver result ─────────────────────────────────────────────────────
  if (!resolveResult) {
    return <StateCard icon={FileWarning} title="Preview unavailable" />;
  }

  // ── Unsupported artifact ───────────────────────────────────────────────────
  if (!resolveResult.adapter) {
    return (
      <StateCard
        icon={FileQuestion}
        title="Preview unavailable"
        description={resolveResult.reason}
      />
    );
  }

  // ── Render via adapter ─────────────────────────────────────────────────────
  const { Component } = resolveResult.adapter;
  return (
    <Component
      artifact={artifact}
      transform={transform}
      frameId={frameId}
      isReadOnly={isReadOnly || resolveResult.adapter.isReadOnly}
      onRegionSelect={onRegionSelect}
    />
  );
}
