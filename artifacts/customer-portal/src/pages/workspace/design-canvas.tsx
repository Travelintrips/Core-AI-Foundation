/**
 * pages/workspace/design-canvas.tsx
 * Minimal integration page for the Canvas Workspace Foundation (Team 11).
 *
 * This page wires the DesignWorkspaceShell to real artifact data from the
 * customer workspace API. It sits behind a feature flag
 * (VITE_CANVAS_WORKSPACE_ENABLED) so it can be deployed alongside the
 * existing project pages without replacing them.
 *
 * Existing artifact preview pages are NOT removed — this page is additive.
 */

import { useMemo } from 'react';
import { useParams, Link } from 'wouter';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { DesignWorkspaceShell } from '@/components/design-workspace/DesignWorkspaceShell';
import { CanvasRendererRegistry } from '@/components/design-workspace/renderers/registry';
import { IMAGE_RENDERER } from '@/components/design-workspace/renderers/ImageRenderer';
import { FALLBACK_RENDERER } from '@/components/design-workspace/renderers/FallbackRenderer';
import type { CanvasArtifact } from '@/components/design-workspace/types';
import type { CWDeliverable } from '@/hooks/creative-workspace/types';

// ── Feature flag ──────────────────────────────────────────────────────────────

const FEATURE_ENABLED = import.meta.env.VITE_CANVAS_WORKSPACE_ENABLED === 'true';

// ── Registry (singleton per page mount) ──────────────────────────────────────

function buildRegistry(): CanvasRendererRegistry {
  const registry = new CanvasRendererRegistry();
  registry.register(IMAGE_RENDERER);
  registry.register(FALLBACK_RENDERER);
  return registry;
}

// ── Adapter: CWDeliverable → CanvasArtifact ───────────────────────────────────

function deliverableToArtifact(d: CWDeliverable, signedUrl?: string): CanvasArtifact {
  let status: CanvasArtifact['status'] = 'ready';
  if (d.status === 'pending' || d.status === 'generating') status = 'generating';
  else if (d.status === 'failed') status = 'failed';
  else if (d.status === 'archived') status = 'archived';
  else if (d.status === 'waiting_review') status = 'review';

  return {
    id: String(d.id),
    type: d.assetType ?? 'image',
    title: d.title,
    url: signedUrl,
    status,
    version: d.version,
    metadata: {
      category: d.category,
      locked: d.locked,
      downloadAvailable: d.downloadAvailable,
    },
  };
}

// ── API ───────────────────────────────────────────────────────────────────────

const API_BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

async function fetchDeliverables(token: string): Promise<{ deliverables: CWDeliverable[] }> {
  const res = await fetch(`${API_BASE}/api/customer-workspace/${token}/deliverables`);
  if (!res.ok) throw new Error(`Failed to fetch deliverables: ${res.statusText}`);
  return res.json();
}

async function fetchSignedUrl(endpoint: string): Promise<{ url: string }> {
  const res = await fetch(`${API_BASE}${endpoint}`);
  if (!res.ok) throw new Error('Failed to get signed URL');
  return res.json();
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DesignCanvasPage() {
  const { token } = useParams<{ token: string }>();

  // Feature-flag gate — show clear internal label during preview
  if (!FEATURE_ENABLED) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center text-center px-6">
        <div>
          <p className="text-sm text-slate-500 mb-2">
            Canvas Workspace Preview
          </p>
          <p className="text-xs text-slate-600">
            Enable with <code className="text-slate-500">VITE_CANVAS_WORKSPACE_ENABLED=true</code>
          </p>
          <Link
            href={`/workspace/projects`}
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-indigo-400 hover:text-indigo-300 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to projects
          </Link>
        </div>
      </div>
    );
  }

  if (!token) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <p className="text-sm text-slate-500">Missing workspace token.</p>
      </div>
    );
  }

  return <DesignCanvasInner token={token} />;
}

function DesignCanvasInner({ token }: { token: string }) {
  const registry = useMemo(() => buildRegistry(), []);

  const {
    data,
    isLoading,
    error: fetchError,
  } = useQuery({
    queryKey: ['design-canvas-deliverables', token],
    queryFn: () => fetchDeliverables(token),
    retry: 1,
  });

  // Convert deliverables to canvas artifacts (no signed URL fetch here — done lazily by renderer)
  const artifacts: CanvasArtifact[] = useMemo(() => {
    if (!data?.deliverables) return [];
    return data.deliverables
      .filter((d) => d.downloadAvailable && !d.locked)
      .map((d) => deliverableToArtifact(d));
  }, [data]);

  const workspaceError = fetchError
    ? ({ kind: 'load_failed', detail: 'Could not load project files.' } as const)
    : null;

  return (
    <div className="w-screen h-screen flex flex-col bg-slate-950">
      {/* Back nav — minimal, doesn't replace existing project page */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-white/6 bg-slate-950/80 shrink-0 lg:hidden">
        <Link
          href={`/workspace/projects`}
          className="flex items-center gap-1.5 text-sm text-slate-400 hover:text-white transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Projects
        </Link>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        <DesignWorkspaceShell
          projectTitle="Design Canvas"
          artifacts={artifacts}
          activeArtifactId={artifacts[0]?.id ?? null}
          rendererRegistry={registry}
          isLoading={isLoading}
          error={workspaceError}
          permissions={{ canEdit: false, canAnnotate: false, canExport: true, canSelectVersion: false }}
        />
      </div>
    </div>
  );
}
