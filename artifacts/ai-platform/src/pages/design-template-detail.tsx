/**
 * Design Template Detail — /design-templates/:id
 *
 * Tabs: Overview | Versions | Preview
 *
 * Overview:  metadata, variable list, action buttons
 * Versions:  version history table, publish confirmation
 * Preview:   inline variable form + rendered image
 */

import { useState } from "react";
import { useParams, useLocation, Link } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, LayoutTemplate, Copy, Archive, RotateCcw, ExternalLink,
  Loader2, AlertCircle, CheckCircle2, Lock, FileJson, Clock, User,
  ChevronDown, ChevronUp, Tag, Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip, TooltipContent, TooltipTrigger,
} from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  getTemplate, listVersions, publishVersion, duplicateTemplate, updateTemplate,
} from "@/services/design-template-api";
import type {
  DesignTemplate, DesignTemplateVersion, TemplateVariable,
} from "@/types/design-template-ui";
import PreviewModal from "./design-template-preview-modal";

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  draft: "bg-yellow-100 text-yellow-700 border-yellow-200",
  published: "bg-green-100 text-green-700 border-green-200",
  archived: "bg-gray-100 text-gray-500 border-gray-200",
};

const VAR_TYPE_COLOR: Record<string, string> = {
  text: "bg-blue-50 text-blue-600",
  number: "bg-purple-50 text-purple-600",
  currency: "bg-green-50 text-green-700",
  image: "bg-orange-50 text-orange-600",
  color: "bg-pink-50 text-pink-600",
  url: "bg-indigo-50 text-indigo-600",
  date: "bg-teal-50 text-teal-600",
  boolean: "bg-gray-100 text-gray-600",
};

function fmt(iso: string) {
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function OverviewTab({ template }: { template: DesignTemplate }) {
  const tplJson = template as DesignTemplate & { templateJson?: { variables?: TemplateVariable[]; canvas?: { width: number; height: number } } };
  // The template row itself doesn't include templateJson — show metadata only.

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
      {/* Metadata card */}
      <div className="bg-white border border-gray-200 rounded-xl p-5 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Metadata</h2>

        <dl className="space-y-3 text-sm">
          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-gray-400 flex items-center gap-1.5">
              <Tag className="h-3.5 w-3.5" /> Name
            </dt>
            <dd className="text-gray-900 font-medium">{template.name}</dd>
          </div>

          {template.description && (
            <div className="flex gap-2">
              <dt className="w-28 shrink-0 text-gray-400">Description</dt>
              <dd className="text-gray-600">{template.description}</dd>
            </div>
          )}

          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-gray-400">Category</dt>
            <dd className="text-gray-600">{template.category ?? <span className="italic text-gray-300">—</span>}</dd>
          </div>

          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-gray-400">Status</dt>
            <dd>
              <Badge variant="outline" className={`text-xs ${STATUS_BADGE[template.status]}`}>
                {template.status}
              </Badge>
            </dd>
          </div>

          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-gray-400 flex items-center gap-1.5">
              <Layers className="h-3.5 w-3.5" /> Active version
            </dt>
            <dd className="text-gray-600">
              {template.activeVersionId
                ? <span className="font-mono text-indigo-700">#{template.activeVersionId}</span>
                : <span className="italic text-gray-300">none</span>}
            </dd>
          </div>

          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-gray-400 flex items-center gap-1.5">
              <User className="h-3.5 w-3.5" /> Created by
            </dt>
            <dd className="text-gray-600 font-mono text-xs">{template.createdBy}</dd>
          </div>

          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-gray-400 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Created
            </dt>
            <dd className="text-gray-600">{fmt(template.createdAt)}</dd>
          </div>

          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-gray-400 flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" /> Updated
            </dt>
            <dd className="text-gray-600">{fmt(template.updatedAt)}</dd>
          </div>

          <div className="flex gap-2">
            <dt className="w-28 shrink-0 text-gray-400">Slug</dt>
            <dd className="text-gray-400 font-mono text-xs">{template.slug}</dd>
          </div>
        </dl>
      </div>

      {/* Batch route hint */}
      <div className="space-y-4">
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-3">Start a Batch</h2>
          <p className="text-xs text-gray-500 mb-3">
            Send this template to the batch render queue with a dataset of variable values.
            The CSV mapping UI is provided by the Batch Rendering tool.
          </p>
          {template.activeVersionId ? (
            <Link
              href={`/design-render-batches/new?templateId=${template.id}&versionId=${template.activeVersionId}`}
            >
              <Button variant="outline" size="sm" className="gap-1.5">
                <ExternalLink className="h-3.5 w-3.5" />
                Create Batch
              </Button>
            </Link>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <span>
                  <Button variant="outline" size="sm" disabled className="gap-1.5">
                    <ExternalLink className="h-3.5 w-3.5" />
                    Create Batch
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>Publish a version before creating a batch</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Editor link */}
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl p-5">
          <h2 className="text-sm font-semibold text-indigo-700 mb-1">Canvas Editor</h2>
          <p className="text-xs text-indigo-500 mb-3">
            Open the visual layer editor to add or modify canvas elements.
          </p>
          <Link href={`/design-studio/${template.id}`}>
            <Button size="sm" variant="outline" className="gap-1.5 border-indigo-300 text-indigo-700 hover:bg-indigo-100">
              <ExternalLink className="h-3.5 w-3.5" />
              Open in Design Studio
            </Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

// ── Version row ───────────────────────────────────────────────────────────────

interface VersionRowProps {
  version: DesignTemplateVersion;
  isActive: boolean;
  onPublish: (v: DesignTemplateVersion) => void;
  onPreview: (v: DesignTemplateVersion) => void;
}

function VersionRow({ version, isActive, onPublish, onPreview }: VersionRowProps) {
  const [expanded, setExpanded] = useState(false);
  const isPublished = version.publishedAt != null;

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center gap-3 p-3 bg-white hover:bg-gray-50 transition-colors">
        {/* Version number */}
        <span className="text-sm font-mono font-semibold text-gray-700 w-8 shrink-0">
          v{version.versionNumber}
        </span>

        {/* Badges */}
        <div className="flex items-center gap-1.5">
          {isActive && (
            <Badge className="text-[10px] px-1.5 py-0 bg-indigo-100 text-indigo-700 border-indigo-200">
              Active
            </Badge>
          )}
          {isPublished ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 text-[10px] text-green-600 bg-green-50 border border-green-200 rounded-full px-1.5 py-0.5">
                  <Lock className="h-2.5 w-2.5" /> Published
                </span>
              </TooltipTrigger>
              <TooltipContent>Published versions are immutable</TooltipContent>
            </Tooltip>
          ) : (
            <span className="text-[10px] text-yellow-600 bg-yellow-50 border border-yellow-200 rounded-full px-1.5 py-0.5">
              Draft
            </span>
          )}
        </div>

        {/* Changelog */}
        <p className="flex-1 text-xs text-gray-500 truncate">
          {version.changelog ?? <span className="italic text-gray-300">No changelog</span>}
        </p>

        {/* Meta */}
        <span className="text-[10px] text-gray-400 shrink-0">
          {version.createdBy} · {fmtDate(version.createdAt)}
        </span>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onPreview(version)}
          >
            Preview
          </Button>
          {!isPublished && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onPublish(version)}
            >
              Publish
            </Button>
          )}
          <button
            onClick={() => setExpanded((v) => !v)}
            className="p-1 text-gray-400 hover:text-gray-600"
            aria-label={expanded ? "Collapse" : "Expand version details"}
          >
            {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>

      {/* Expanded metadata */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50 px-4 py-3 text-xs text-gray-500 space-y-1">
          <p><span className="font-medium">Version ID:</span> {version.id}</p>
          <p><span className="font-medium">Schema version:</span> {version.schemaVersion}</p>
          <p><span className="font-medium">Created at:</span> {fmt(version.createdAt)}</p>
          {version.publishedAt && (
            <p><span className="font-medium">Published at:</span> {fmt(version.publishedAt)}</p>
          )}
          {version.changelog && (
            <p><span className="font-medium">Changelog:</span> {version.changelog}</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Versions tab ──────────────────────────────────────────────────────────────

interface VersionsTabProps {
  template: DesignTemplate;
  onVersionPreview: (v: DesignTemplateVersion) => void;
}

function VersionsTab({ template, onVersionPreview }: VersionsTabProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [publishTarget, setPublishTarget] = useState<DesignTemplateVersion | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["design-template-versions", template.id],
    queryFn: () => listVersions(template.id),
  });

  const publishMutation = useMutation({
    mutationFn: (v: DesignTemplateVersion) => publishVersion(template.id, v.id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-template", template.id] });
      qc.invalidateQueries({ queryKey: ["design-template-versions", template.id] });
      toast({ title: "Version published", description: "This version is now active and immutable." });
      setPublishTarget(null);
    },
    onError: (e: Error) => toast({ title: "Publish failed", description: e.message, variant: "destructive" }),
  });

  const versions = data?.versions ?? [];

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-400 py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading versions…
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center gap-2 text-red-600 py-4 text-sm">
        <AlertCircle className="h-4 w-4" /> Failed to load version history.
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2">
        {versions.length === 0 ? (
          <div className="text-center py-12 text-gray-400">
            <FileJson className="h-10 w-10 mx-auto mb-2 opacity-20" aria-hidden />
            <p className="text-sm">No versions yet.</p>
            <p className="text-xs mt-1">Open the Design Studio editor to create the first version.</p>
          </div>
        ) : (
          versions.map((v) => (
            <VersionRow
              key={v.id}
              version={v}
              isActive={v.id === template.activeVersionId}
              onPublish={setPublishTarget}
              onPreview={onVersionPreview}
            />
          ))
        )}
      </div>

      {/* Publish confirmation */}
      <AlertDialog open={publishTarget != null} onOpenChange={(o) => !o && setPublishTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Lock className="h-4 w-4 text-indigo-600" />
              Publish version v{publishTarget?.versionNumber}?
            </AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <p>
                This version will become the <strong>active version</strong> for this template and will be marked as
                <strong> immutable</strong> — it can no longer be edited.
              </p>
              <p>Batch renders will use this version until a newer one is published.</p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => publishTarget && publishMutation.mutate(publishTarget)}
              disabled={publishMutation.isPending}
              className="bg-indigo-600 hover:bg-indigo-700"
            >
              {publishMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Publish
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

// ── Variables tab panel (inside Overview) ─────────────────────────────────────

function VariablesPanel({ variables }: { variables: TemplateVariable[] }) {
  if (variables.length === 0) {
    return (
      <p className="text-xs text-gray-400 italic py-2">No variables defined in the active version.</p>
    );
  }

  return (
    <div className="space-y-2">
      {variables.map((v) => (
        <div key={v.key} className="flex items-start gap-2 text-sm">
          <code className="font-mono text-xs bg-gray-100 px-1.5 py-0.5 rounded text-gray-700">
            {v.key}
          </code>
          <Badge variant="outline" className={`text-[10px] px-1.5 py-0 shrink-0 ${VAR_TYPE_COLOR[v.type] ?? ""}`}>
            {v.type}
          </Badge>
          <span className="text-gray-600 text-xs">{v.label}</span>
          {v.required && (
            <span className="text-red-400 text-[10px] shrink-0">required</span>
          )}
          {v.defaultValue != null && (
            <span className="text-gray-400 text-[10px] ml-auto shrink-0">
              default: {String(v.defaultValue)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Main Detail Page ──────────────────────────────────────────────────────────

type Tab = "overview" | "versions" | "preview";

export default function DesignTemplateDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const templateId = parseInt(id, 10);

  const [tab, setTab] = useState<Tab>("overview");
  const [archiveDialogOpen, setArchiveDialogOpen] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [previewVersionId, setPreviewVersionId] = useState<number | undefined>(undefined);

  const { data: template, isLoading, isError, error } = useQuery({
    queryKey: ["design-template", templateId],
    queryFn: () => getTemplate(templateId),
    enabled: !isNaN(templateId),
  });

  const duplicateMutation = useMutation({
    mutationFn: () => duplicateTemplate(templateId),
    onSuccess: (copy) => {
      qc.invalidateQueries({ queryKey: ["design-templates"] });
      toast({ title: "Duplicated", description: `"${copy.name}" created as a new draft.` });
      navigate(`/design-templates/${copy.id}`);
    },
    onError: (e: Error) => toast({ title: "Duplicate failed", description: e.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: () => updateTemplate(templateId, { status: "archived" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-template", templateId] });
      qc.invalidateQueries({ queryKey: ["design-templates"] });
      toast({ title: "Template archived" });
      setArchiveDialogOpen(false);
    },
    onError: (e: Error) => toast({ title: "Archive failed", description: e.message, variant: "destructive" }),
  });

  const restoreMutation = useMutation({
    mutationFn: () => updateTemplate(templateId, { status: "draft" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["design-template", templateId] });
      qc.invalidateQueries({ queryKey: ["design-templates"] });
      toast({ title: "Template restored to draft" });
    },
    onError: (e: Error) => toast({ title: "Restore failed", description: e.message, variant: "destructive" }),
  });

  function handleVersionPreview(v: DesignTemplateVersion) {
    setPreviewVersionId(v.id);
    setShowPreview(true);
  }

  if (isNaN(templateId)) {
    return (
      <div className="p-6 text-red-600 flex items-center gap-2">
        <AlertCircle className="h-5 w-5" /> Invalid template ID.
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="p-6 flex items-center gap-3 text-gray-400">
        <Loader2 className="h-5 w-5 animate-spin" /> Loading template…
      </div>
    );
  }

  if (isError || !template) {
    return (
      <div className="p-6 space-y-3">
        <div className="flex items-center gap-2 text-red-600">
          <AlertCircle className="h-5 w-5" />
          <span>{(error as Error)?.message ?? "Template not found"}</span>
        </div>
        <Link href="/design-templates">
          <Button variant="outline" size="sm" className="gap-1.5">
            <ArrowLeft className="h-3.5 w-3.5" /> Back to Library
          </Button>
        </Link>
      </div>
    );
  }

  const isArchived = template.status === "archived";
  const isPublished = template.status === "published";

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* ── Breadcrumb ── */}
      <div className="flex items-center gap-2 text-sm text-gray-400 mb-5">
        <Link href="/design-templates" className="hover:text-gray-600 transition-colors flex items-center gap-1">
          <ArrowLeft className="h-3.5 w-3.5" /> Template Library
        </Link>
        <span>/</span>
        <span className="text-gray-700 font-medium truncate max-w-xs">{template.name}</span>
      </div>

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4 mb-6">
        <div className="flex items-start gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg shrink-0">
            <LayoutTemplate className="h-6 w-6 text-indigo-600" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{template.name}</h1>
            {template.description && (
              <p className="text-sm text-gray-500 mt-0.5">{template.description}</p>
            )}
            <div className="flex items-center gap-2 mt-1.5">
              <Badge variant="outline" className={`text-xs ${STATUS_BADGE[template.status] ?? ""}`}>
                {template.status}
              </Badge>
              {template.category && (
                <span className="text-xs text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                  {template.category}
                </span>
              )}
              {isPublished && (
                <span className="flex items-center gap-1 text-xs text-green-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Live
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 shrink-0">
          {template.activeVersionId && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => { setPreviewVersionId(undefined); setShowPreview(true); }}
            >
              Preview
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => duplicateMutation.mutate()}
            disabled={duplicateMutation.isPending}
          >
            {duplicateMutation.isPending
              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
              : <Copy className="h-3.5 w-3.5" />}
            Duplicate
          </Button>

          {isArchived ? (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() => restoreMutation.mutate()}
              disabled={restoreMutation.isPending}
            >
              {restoreMutation.isPending
                ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                : <RotateCcw className="h-3.5 w-3.5" />}
              Restore
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 text-orange-600 border-orange-200 hover:bg-orange-50"
              onClick={() => setArchiveDialogOpen(true)}
            >
              <Archive className="h-3.5 w-3.5" /> Archive
            </Button>
          )}
        </div>
      </div>

      {/* ── Tabs ── */}
      <div className="flex gap-1 border-b border-gray-200 mb-6">
        {(["overview", "versions", "preview"] as Tab[]).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px ${
              tab === t
                ? "border-indigo-600 text-indigo-700"
                : "border-transparent text-gray-500 hover:text-gray-700"
            }`}
            aria-selected={tab === t}
            role="tab"
          >
            {t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      {/* ── Tab content ── */}
      {tab === "overview" && <OverviewTab template={template} />}
      {tab === "versions" && (
        <VersionsTab template={template} onVersionPreview={handleVersionPreview} />
      )}
      {tab === "preview" && (
        <div className="bg-white border border-gray-200 rounded-xl p-5">
          {template.activeVersionId ? (
            <div className="text-center py-6">
              <p className="text-sm text-gray-600 mb-3">
                Open the interactive preview to fill in variables and render the template.
              </p>
              <Button
                onClick={() => { setPreviewVersionId(undefined); setShowPreview(true); }}
                className="gap-2"
              >
                Open Preview
              </Button>
            </div>
          ) : (
            <div className="text-center py-6 text-gray-400">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">No active version to preview.</p>
              <p className="text-xs mt-1">Go to the Versions tab and publish a version first.</p>
            </div>
          )}
        </div>
      )}

      {/* ── Archive confirmation ── */}
      <AlertDialog open={archiveDialogOpen} onOpenChange={setArchiveDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive template?</AlertDialogTitle>
            <AlertDialogDescription>
              "{template.name}" will be archived and hidden from active use. You can restore it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => archiveMutation.mutate()}
              disabled={archiveMutation.isPending}
              className="bg-orange-600 hover:bg-orange-700"
            >
              {archiveMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Archive
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Preview modal ── */}
      {showPreview && (
        <PreviewModal
          templateId={templateId}
          templateName={template.name}
          initialVersionId={previewVersionId}
          onClose={() => { setShowPreview(false); setPreviewVersionId(undefined); }}
        />
      )}
    </div>
  );
}
