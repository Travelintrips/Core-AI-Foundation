/**
 * cp-review.tsx — Company Profile V4.2C
 * Enterprise-grade PDF review experience: Canva/Figma-level for Company Profile.
 *
 * Features:
 *  - Inline PDF viewer (iframe + object fallback + download)
 *  - Per-page + per-section comments with threading
 *  - Version history panel
 *  - Version compare (section-level diff)
 *  - Approval flow with checkbox confirmation
 *  - Review dashboard KPIs
 *  - Watermark indication (server-rendered, no CSS overlay)
 *  - Mobile-friendly responsive layout
 */

import { useState, useCallback, useRef } from "react";
import { Link } from "wouter";
import { Layout } from "@/components/layout";
import { StatusBadge } from "@/components/status-badge";
import { useToast } from "@/hooks/use-toast";
import { useTranslation } from "@/lib/i18n";
import {
  Loader2,
  MessageSquare,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Download,
  CheckCircle2,
  RefreshCcw,
  Clock,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Send,
  Layers,
  BarChart3,
  History,
  GitCompare,
  ArrowLeft,
  FileText,
  Shield,
  Flag,
  X,
  Plus,
} from "lucide-react";
import { format } from "date-fns";
import { useGetPublicCpReview, useAddCpPageComment, usePatchCpPageComment, useDeleteCpPageComment, useApproveCpReview, useRequestCpRevision, useGetCpVersions, useCompareCpVersions, useGetCpReviewDashboard } from "@/hooks/use-cp-review";

// ── Types ─────────────────────────────────────────────────────────────────────

interface CpComment {
  id:              number;
  reviewId:        number;
  projectId:       string;
  parentCommentId?: number;
  pageNumber?:     number;
  sectionId?:      string;
  positionX?:      number;
  positionY?:      number;
  comment:         string;
  authorName:      string;
  authorType:      "client" | "admin";
  priority:        string;
  status:          string;
  resolvedBy?:     string;
  resolvedAt?:     string;
  createdAt:       string;
  replies?:        CpComment[];
}

interface CpVersion {
  id:               number;
  version:          number;
  versionLabel:     string;
  reason?:          string;
  revisionNotes?:   string;
  sectionsIncluded: string[];
  qcScore?:         number;
  qcPassed?:        boolean;
  approved:         boolean;
  approvedAt?:      string;
  sentForReviewAt?: string;
}

// ── Section label map ─────────────────────────────────────────────────────────

const SECTION_LABELS: Record<string, string> = {
  "about":                 "About",
  "vision-mission":        "Vision & Mission",
  "vision":                "Vision",
  "mission":               "Mission",
  "core-values":           "Core Values",
  "services":              "Services",
  "services-detail":       "Services Detail",
  "competitive-advantages":"Competitive Advantages",
  "industries":            "Industries Served",
  "operational":           "Operational Capabilities",
  "milestones":            "Company Milestones",
  "team":                  "Team",
  "certifications":        "Certifications",
  "key-people":            "Key People",
  "org-structure":         "Org Structure",
  "clients-partners":      "Clients & Partners",
  "quality-assurance":     "Quality Assurance",
  "sustainability":        "Sustainability",
  "contact":               "Contact",
};

const PRIORITY_COLORS: Record<string, string> = {
  low:    "text-muted-foreground",
  normal: "text-blue-600",
  high:   "text-orange-500",
  urgent: "text-destructive",
};

const PRIORITY_BG: Record<string, string> = {
  low:    "bg-muted/50",
  normal: "bg-blue-50 dark:bg-blue-950/30",
  high:   "bg-orange-50 dark:bg-orange-950/30",
  urgent: "bg-destructive/10",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function QcBadge({ score, passed }: { score: number | null; passed: boolean | null }) {
  if (score == null) return null;
  const color = passed ? "bg-green-100 text-green-700 border-green-200" : "bg-orange-100 text-orange-700 border-orange-200";
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${color}`}>
      <BarChart3 className="w-3 h-3" />
      QC {score}/100 {passed ? "✓" : "!"}
    </span>
  );
}

function PriorityIcon({ priority }: { priority: string }) {
  const color = PRIORITY_COLORS[priority] ?? "text-muted-foreground";
  return <Flag className={`w-3.5 h-3.5 ${color}`} />;
}

function CommentCard({
  comment,
  onResolve,
  onDelete,
  currentUser,
}: {
  comment: CpComment;
  onResolve: (id: number, status: "resolved" | "open") => void;
  onDelete: (id: number) => void;
  currentUser: string;
}) {
  const [showReplies, setShowReplies] = useState(false);
  const isResolved = comment.status === "resolved";

  return (
    <div className={`rounded-xl p-3.5 border text-sm ${isResolved ? "opacity-60 bg-muted/30 border-border/50" : PRIORITY_BG[comment.priority] ?? "bg-card border-border"}`}>
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 ${comment.authorType === "admin" ? "bg-primary text-primary-foreground" : "bg-secondary/20 text-secondary-foreground"}`}>
            {comment.authorName.charAt(0).toUpperCase()}
          </span>
          <span className="font-medium truncate">{comment.authorName}</span>
          {comment.authorType === "admin" && (
            <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium shrink-0">Team</span>
          )}
          <PriorityIcon priority={comment.priority} />
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {comment.pageNumber && (
            <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded font-medium">p.{comment.pageNumber}</span>
          )}
          {comment.sectionId && (
            <span className="text-[10px] bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded font-medium">
              {SECTION_LABELS[comment.sectionId] ?? comment.sectionId}
            </span>
          )}
        </div>
      </div>
      <p className="text-foreground leading-relaxed mb-2">{comment.comment}</p>
      <div className="flex items-center justify-between">
        <span className="text-[10px] text-muted-foreground">{format(new Date(comment.createdAt), "d MMM, h:mm a")}</span>
        <div className="flex items-center gap-1">
          {isResolved ? (
            <button onClick={() => onResolve(comment.id, "open")} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
              <RefreshCcw className="w-3 h-3" /> Reopen
            </button>
          ) : comment.authorType === "client" ? (
            <>
              <button onClick={() => onResolve(comment.id, "resolved")} className="text-[10px] text-green-600 hover:text-green-700 transition-colors flex items-center gap-0.5">
                <CheckCircle2 className="w-3 h-3" /> Resolve
              </button>
              <button onClick={() => onDelete(comment.id)} className="text-[10px] text-muted-foreground hover:text-destructive transition-colors ml-1">
                <X className="w-3 h-3" />
              </button>
            </>
          ) : null}
          {(comment.replies?.length ?? 0) > 0 && (
            <button onClick={() => setShowReplies((v) => !v)} className="text-[10px] text-primary hover:underline flex items-center gap-0.5 ml-1">
              {showReplies ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {comment.replies!.length} {comment.replies!.length === 1 ? "reply" : "replies"}
            </button>
          )}
        </div>
      </div>
      {showReplies && comment.replies && comment.replies.length > 0 && (
        <div className="mt-3 ml-4 pl-3 border-l-2 border-border space-y-2">
          {comment.replies.map((r) => (
            <div key={r.id} className="bg-card rounded-lg p-2.5 border border-border/60">
              <div className="flex items-center gap-2 mb-1">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${r.authorType === "admin" ? "bg-primary text-primary-foreground" : "bg-secondary/20 text-secondary-foreground"}`}>
                  {r.authorName.charAt(0).toUpperCase()}
                </span>
                <span className="text-xs font-medium">{r.authorName}</span>
                {r.authorType === "admin" && <span className="text-[9px] bg-primary/10 text-primary px-1 py-0.5 rounded-full">Team</span>}
              </div>
              <p className="text-xs text-foreground">{r.comment}</p>
              <span className="text-[9px] text-muted-foreground mt-1 block">{format(new Date(r.createdAt), "d MMM, h:mm a")}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PdfViewer({ pdfUrl, watermarked, brandName }: { pdfUrl: string | null; watermarked: boolean; brandName: string }) {
  const [fallback, setFallback] = useState(false);

  if (!pdfUrl) {
    return (
      <div className="flex items-center justify-center h-full bg-muted/30 rounded-xl">
        <div className="text-center p-8">
          <FileText className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
          <p className="font-medium text-muted-foreground">Document not ready yet</p>
          <p className="text-sm text-muted-foreground/70 mt-1">Your Company Profile is being prepared.</p>
        </div>
      </div>
    );
  }

  if (fallback) {
    return (
      <div className="flex items-center justify-center h-full bg-muted/20 rounded-xl border border-dashed border-border">
        <div className="text-center p-8">
          <FileText className="w-10 h-10 mx-auto text-muted-foreground/60 mb-3" />
          <p className="font-medium mb-1">PDF viewer unavailable in this browser</p>
          <p className="text-sm text-muted-foreground mb-4">Download the PDF to view it.</p>
          <a
            href={pdfUrl}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-primary text-primary-foreground rounded-full text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <Download className="w-4 h-4" /> Download PDF
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full rounded-xl overflow-hidden border border-border bg-card">
      {watermarked && (
        <div className="absolute top-3 left-3 z-10 flex items-center gap-1.5 bg-orange-500/90 text-white text-[11px] font-semibold px-2.5 py-1.5 rounded-full shadow-md backdrop-blur-sm">
          <Shield className="w-3.5 h-3.5" />
          PREVIEW — Watermarked
        </div>
      )}
      <object
        data={pdfUrl}
        type="application/pdf"
        className="w-full h-full"
        title={`${brandName} — Company Profile`}
        onError={() => setFallback(true)}
      >
        {/* Object fallback → iframe */}
        <iframe
          src={`${pdfUrl}#toolbar=1&navpanes=1&view=FitH`}
          className="w-full h-full border-none"
          title={`${brandName} — Company Profile`}
          onError={() => setFallback(true)}
        >
          {/* iframe fallback → download */}
          <div className="flex items-center justify-center h-full p-8 text-center">
            <div>
              <p className="mb-2 font-medium">Your browser cannot display PDFs inline.</p>
              <a href={pdfUrl} target="_blank" rel="noreferrer" className="underline text-primary">Download PDF</a>
            </div>
          </div>
        </iframe>
      </object>
    </div>
  );
}

function VersionHistoryPanel({ versions }: { versions: CpVersion[] }) {
  const [expanded, setExpanded] = useState(false);

  if (versions.length === 0) {
    return (
      <div className="bg-card border border-card-border rounded-2xl p-4">
        <div className="flex items-center gap-2 mb-2">
          <History className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-medium text-sm">Version History</h3>
        </div>
        <p className="text-xs text-muted-foreground">No version snapshots yet.</p>
      </div>
    );
  }

  const displayed = expanded ? versions : versions.slice(0, 3);

  return (
    <div className="bg-card border border-card-border rounded-2xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <History className="w-4 h-4 text-muted-foreground" />
          <h3 className="font-medium text-sm">Version History</h3>
          <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full font-medium">{versions.length}</span>
        </div>
        {versions.length > 3 && (
          <button onClick={() => setExpanded((v) => !v)} className="text-xs text-primary hover:underline flex items-center gap-0.5">
            {expanded ? <><ChevronUp className="w-3 h-3" />Less</> : <><ChevronDown className="w-3 h-3" />All</>}
          </button>
        )}
      </div>
      <div className="space-y-2">
        {displayed.map((v, i) => (
          <div key={v.id} className={`flex items-start gap-3 p-2.5 rounded-lg border text-xs ${i === 0 ? "border-primary/30 bg-primary/5" : "border-border bg-muted/20"}`}>
            <div className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5 ${i === 0 ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"}`}>
              {v.version}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{v.versionLabel}</span>
                <div className="flex items-center gap-1">
                  {v.qcScore != null && (
                    <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${v.qcPassed ? "bg-green-100 text-green-700" : "bg-orange-100 text-orange-700"}`}>
                      QC {v.qcScore}
                    </span>
                  )}
                  {v.approved && <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />}
                </div>
              </div>
              {v.reason && <p className="text-muted-foreground mt-0.5 truncate">{v.reason}</p>}
              {v.revisionNotes && <p className="text-muted-foreground mt-0.5 line-clamp-2">{v.revisionNotes}</p>}
              {v.sentForReviewAt && (
                <p className="text-[9px] text-muted-foreground/70 mt-1">{format(new Date(v.sentForReviewAt), "d MMM yyyy, h:mm a")}</p>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function VersionComparePanel({ token, versions }: { token: string; versions: CpVersion[] }) {
  const [v1, setV1] = useState<number | "">("");
  const [v2, setV2] = useState<number | "">("");
  const [comparing, setComparing] = useState(false);

  const {
    data: diff,
    isLoading,
    refetch,
  } = useCompareCpVersions(token, v1 !== "" ? v1 : undefined, v2 !== "" ? v2 : undefined, { enabled: comparing && v1 !== "" && v2 !== "" && v1 !== v2 });

  const handleCompare = () => {
    if (v1 !== "" && v2 !== "" && v1 !== v2) setComparing(true);
  };

  if (versions.length < 2) return null;

  return (
    <div className="bg-card border border-card-border rounded-2xl p-4">
      <div className="flex items-center gap-2 mb-3">
        <GitCompare className="w-4 h-4 text-muted-foreground" />
        <h3 className="font-medium text-sm">Compare Versions</h3>
      </div>
      <div className="flex items-center gap-2 mb-3">
        <select
          value={v1}
          onChange={(e) => { setV1(e.target.value === "" ? "" : Number(e.target.value)); setComparing(false); }}
          className="flex-1 text-xs border border-border rounded-lg px-2 py-1.5 bg-background"
        >
          <option value="">Version…</option>
          {versions.map((v) => <option key={v.id} value={v.version}>{v.versionLabel}</option>)}
        </select>
        <span className="text-xs text-muted-foreground shrink-0">vs</span>
        <select
          value={v2}
          onChange={(e) => { setV2(e.target.value === "" ? "" : Number(e.target.value)); setComparing(false); }}
          className="flex-1 text-xs border border-border rounded-lg px-2 py-1.5 bg-background"
        >
          <option value="">Version…</option>
          {versions.map((v) => <option key={v.id} value={v.version}>{v.versionLabel}</option>)}
        </select>
        <button
          onClick={handleCompare}
          disabled={v1 === "" || v2 === "" || v1 === v2}
          className="px-3 py-1.5 bg-primary text-primary-foreground rounded-lg text-xs font-medium disabled:opacity-50 shrink-0"
        >
          Compare
        </button>
      </div>
      {isLoading && <div className="flex items-center gap-2 text-xs text-muted-foreground py-2"><Loader2 className="w-3 h-3 animate-spin" />Comparing…</div>}
      {diff && (
        <div className="space-y-2 text-xs">
          <div className="flex items-center gap-2 text-muted-foreground mb-1">
            <span className="font-medium">{diff.v1?.versionLabel}</span>
            <span>→</span>
            <span className="font-medium">{diff.v2?.versionLabel}</span>
          </div>
          {diff.diff?.added?.length > 0 && (
            <div>
              <p className="font-medium text-green-700 mb-1 flex items-center gap-1"><Plus className="w-3 h-3" />Added ({diff.diff.added.length})</p>
              <div className="flex flex-wrap gap-1">
                {diff.diff.added.map((s: string) => (
                  <span key={s} className="bg-green-100 text-green-700 px-2 py-0.5 rounded-full text-[10px] font-medium">
                    {SECTION_LABELS[s] ?? s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {diff.diff?.removed?.length > 0 && (
            <div>
              <p className="font-medium text-red-700 mb-1 flex items-center gap-1"><X className="w-3 h-3" />Removed ({diff.diff.removed.length})</p>
              <div className="flex flex-wrap gap-1">
                {diff.diff.removed.map((s: string) => (
                  <span key={s} className="bg-red-100 text-red-700 px-2 py-0.5 rounded-full text-[10px] font-medium">
                    {SECTION_LABELS[s] ?? s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {diff.diff?.unchanged?.length > 0 && (
            <div>
              <p className="font-medium text-muted-foreground mb-1 flex items-center gap-1"><CheckCircle2 className="w-3 h-3" />Unchanged ({diff.diff.unchanged.length})</p>
            </div>
          )}
          {diff.diff?.totalChanged === 0 && (
            <p className="text-muted-foreground">Identical section structure between these versions.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function CpReviewPage({ params }: { params: { token: string } }) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const { token } = params;

  const { data: review, isLoading, error, refetch } = useGetPublicCpReview(token);
  const { data: versions = [] } = useGetCpVersions(token);
  const { data: dashboard } = useGetCpReviewDashboard(token);

  const addComment   = useAddCpPageComment();
  const patchComment = usePatchCpPageComment();
  const deleteComment = useDeleteCpPageComment();
  const approveReview = useApproveCpReview();
  const requestRevision = useRequestCpRevision();

  // Comment form state
  const [commentText,   setCommentText]   = useState("");
  const [commentPage,   setCommentPage]   = useState<string>("");
  const [commentSection,setCommentSection]= useState<string>("");
  const [commentPriority, setCommentPriority] = useState("normal");

  // Approval state
  const [showApproveModal, setShowApproveModal]     = useState(false);
  const [approveChecked,   setApproveChecked]       = useState(false);

  // Revision state
  const [showRevisionForm,   setShowRevisionForm]   = useState(false);
  const [revisionNotes,      setRevisionNotes]      = useState("");
  const [revisionPriority,   setRevisionPriority]   = useState("normal");
  const [revisionPages,      setRevisionPages]      = useState<string>("");
  const [revisionSections,   setRevisionSections]   = useState<string[]>([]);

  // Panel state
  const [activePanel, setActivePanel] = useState<"comments" | "versions" | "compare" | "dashboard">("comments");

  // ── Loading / error states ────────────────────────────────────────────────
  if (isLoading) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center min-h-[70vh]">
          <div className="text-center">
            <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto mb-4" />
            <p className="text-lg font-serif animate-pulse">Loading your Company Profile review…</p>
          </div>
        </div>
      </Layout>
    );
  }

  if (error || !review) {
    return (
      <Layout>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="max-w-md text-center">
            <AlertTriangle className="w-12 h-12 text-orange-500 mx-auto mb-4" />
            <h2 className="text-2xl font-serif mb-2">Review Link Not Found</h2>
            <p className="text-muted-foreground">This link may have expired or been revoked. Please contact us for a new link.</p>
          </div>
        </div>
      </Layout>
    );
  }

  // ── Derived state ─────────────────────────────────────────────────────────
  const isTerminal      = review.reviewStatus === "approved" || review.reviewStatus === "rejected";
  const canAct          = !isTerminal;
  const pdfUrl          = review.watermarked
    ? `${import.meta.env.BASE_URL ?? "/"}api/public/cp-review/${token}/pdf`.replace("//", "/")
    : review.documentUrl ?? null;

  const resolvedPdfUrl  = review.documentReady
    ? `${window.location.origin}${import.meta.env.BASE_URL ?? ""}api/public/cp-review/${token}/pdf`
    : null;

  const comments: CpComment[] = review.comments ?? [];

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleAddComment = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commentText.trim()) return;
    addComment.mutate({
      token,
      data: {
        comment:     commentText.trim(),
        authorName:  review.clientName,
        pageNumber:  commentPage    ? Number(commentPage)    : undefined,
        sectionId:   commentSection || undefined,
        priority:    commentPriority,
      },
    }, {
      onSuccess: () => {
        setCommentText("");
        setCommentPage("");
        setCommentSection("");
        setCommentPriority("normal");
        refetch();
        toast({ title: "Comment added" });
      },
    });
  };

  const handleResolve = (id: number, status: "resolved" | "open") => {
    patchComment.mutate({ token, commentId: id, data: { status } }, {
      onSuccess: () => { refetch(); },
    });
  };

  const handleDelete = (id: number) => {
    deleteComment.mutate({ token, commentId: id }, {
      onSuccess: () => { refetch(); toast({ title: "Comment deleted" }); },
    });
  };

  const handleApprove = () => {
    if (!approveChecked) {
      toast({ title: "Please check the confirmation box before approving.", variant: "destructive" });
      return;
    }
    approveReview.mutate({ token, data: { confirmed: true } }, {
      onSuccess: () => {
        setShowApproveModal(false);
        setApproveChecked(false);
        refetch();
        toast({ title: "Company Profile approved!", description: "Thank you! We will finalise your files shortly." });
      },
      onError: (e) => {
        toast({ title: "Approval failed", description: (e as Error).message, variant: "destructive" });
      },
    });
  };

  const handleRevision = () => {
    if (!revisionNotes.trim()) {
      toast({ title: "Please describe the revision needed.", variant: "destructive" });
      return;
    }
    const pages = revisionPages.split(",").map((p) => Number(p.trim())).filter((n) => !isNaN(n) && n > 0);
    requestRevision.mutate({
      token,
      data: {
        notes:            revisionNotes.trim(),
        priority:         revisionPriority,
        selectedPages:    pages.length > 0 ? pages : undefined,
        selectedSections: revisionSections.length > 0 ? revisionSections : undefined,
      },
    }, {
      onSuccess: () => {
        setShowRevisionForm(false);
        setRevisionNotes("");
        setRevisionPages("");
        setRevisionSections([]);
        refetch();
        toast({ title: "Revision requested", description: "Our team will review your feedback and send a revised version." });
      },
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <Layout>
      {/* ── Header ───────────────────────────────────────────────────────────── */}
      <div className="bg-card border-b border-card-border sticky top-16 z-40 shadow-sm">
        <div className="container mx-auto px-4 md:px-8 py-3 max-w-7xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <Link href="/" className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
              <ArrowLeft className="w-4 h-4" />
            </Link>
            <div className="min-w-0">
              <h1 className="text-lg font-serif font-semibold truncate">{review.brandName} — Company Profile</h1>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-xs text-muted-foreground">For {review.clientName}</span>
                <StatusBadge status={review.reviewStatus} type="review" />
                {review.packageLevel && (
                  <span className="text-[10px] bg-secondary/10 text-secondary-foreground px-2 py-0.5 rounded-full font-medium capitalize">
                    {review.packageLevel}
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <QcBadge score={review.qcScore} passed={review.qcPassed} />
            {review.documentReady && (
              <a
                href={resolvedPdfUrl ?? "#"}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 border border-border rounded-lg text-xs font-medium hover:bg-muted transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Download
              </a>
            )}
          </div>
        </div>
      </div>

      {/* ── Main layout ───────────────────────────────────────────────────────── */}
      <div className="container mx-auto px-4 md:px-8 py-6 max-w-7xl">
        <div className="flex flex-col xl:flex-row gap-6">

          {/* ── Left: PDF Viewer ─────────────────────────────────────────────── */}
          <div className="flex-1 min-w-0">
            <div style={{ height: "calc(100vh - 200px)", minHeight: "500px" }}>
              <PdfViewer
                pdfUrl={resolvedPdfUrl}
                watermarked={review.watermarked}
                brandName={review.brandName}
              />
            </div>

            {/* Section list (quick reference) */}
            {(review.sectionsIncluded?.length ?? 0) > 0 && (
              <div className="mt-4 bg-card border border-card-border rounded-2xl p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Layers className="w-4 h-4 text-muted-foreground" />
                  <h3 className="text-sm font-medium">Sections in This Document</h3>
                  <span className="text-[10px] bg-muted px-1.5 py-0.5 rounded-full">{review.sectionsIncluded.length}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {review.sectionsIncluded.map((s: string) => (
                    <button
                      key={s}
                      onClick={() => { setCommentSection(s); setActivePanel("comments"); }}
                      className="text-[11px] bg-primary/8 hover:bg-primary/15 text-primary border border-primary/20 px-2 py-0.5 rounded-full transition-colors font-medium"
                    >
                      {SECTION_LABELS[s] ?? s}
                    </button>
                  ))}
                </div>
                {(review.sectionsSkipped?.length ?? 0) > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {review.sectionsSkipped.map((s: string) => (
                      <span key={s} className="text-[10px] text-muted-foreground/70 border border-border/50 px-2 py-0.5 rounded-full line-through">
                        {SECTION_LABELS[s] ?? s}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* ── Right: Review Panel ───────────────────────────────────────────── */}
          <div className="w-full xl:w-[420px] shrink-0 space-y-4">

            {/* ── Action Card ──────────────────────────────────────────────────── */}
            <div className="bg-card border border-card-border rounded-2xl p-5 shadow-sm sticky top-36">
              {isTerminal ? (
                <div className="text-center py-4">
                  {review.reviewStatus === "approved" ? (
                    <>
                      <div className="w-14 h-14 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
                        <CheckCircle2 className="w-7 h-7" />
                      </div>
                      <h3 className="font-serif text-lg font-semibold mb-1">Approved!</h3>
                      <p className="text-sm text-muted-foreground">Your Company Profile has been approved. We will prepare your final files.</p>
                    </>
                  ) : (
                    <>
                      <div className="w-14 h-14 bg-muted text-muted-foreground rounded-full flex items-center justify-center mx-auto mb-3">
                        <Clock className="w-7 h-7" />
                      </div>
                      <h3 className="font-serif text-lg font-semibold mb-1">Review Closed</h3>
                      <p className="text-sm text-muted-foreground">This review session has ended. Contact us if you need assistance.</p>
                    </>
                  )}
                </div>
              ) : review.reviewStatus === "revision_requested" ? (
                <div className="text-center py-4">
                  <div className="w-14 h-14 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center mx-auto mb-3">
                    <RefreshCcw className="w-7 h-7" />
                  </div>
                  <h3 className="font-serif text-lg font-semibold mb-1">Revision in Progress</h3>
                  <p className="text-sm text-muted-foreground">Our team is working on the requested revisions. We'll notify you when the new version is ready.</p>
                </div>
              ) : showRevisionForm ? (
                <div className="space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-sm">Request Revision</h3>
                    <button onClick={() => setShowRevisionForm(false)} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                  </div>
                  <textarea
                    value={revisionNotes}
                    onChange={(e) => setRevisionNotes(e.target.value)}
                    placeholder="Describe what needs to be changed…"
                    rows={4}
                    className="w-full text-sm px-3 py-2 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none resize-none"
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Pages (optional)</label>
                      <input
                        value={revisionPages}
                        onChange={(e) => setRevisionPages(e.target.value)}
                        placeholder="e.g. 1, 3, 5"
                        className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-input bg-background"
                      />
                    </div>
                    <div>
                      <label className="text-xs text-muted-foreground mb-1 block">Priority</label>
                      <select
                        value={revisionPriority}
                        onChange={(e) => setRevisionPriority(e.target.value)}
                        className="w-full text-xs px-2.5 py-1.5 rounded-lg border border-input bg-background"
                      >
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-muted-foreground mb-1 block">Sections (click to select)</label>
                    <div className="flex flex-wrap gap-1">
                      {(review.sectionsIncluded ?? []).map((s: string) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setRevisionSections((prev) =>
                            prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
                          )}
                          className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${
                            revisionSections.includes(s)
                              ? "bg-primary text-primary-foreground border-primary"
                              : "bg-card border-border hover:border-primary/50"
                          }`}
                        >
                          {SECTION_LABELS[s] ?? s}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={() => setShowRevisionForm(false)}
                      className="flex-1 py-2 rounded-xl text-sm font-medium border border-border hover:bg-muted transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleRevision}
                      disabled={requestRevision.isPending}
                      className="flex-1 py-2 rounded-xl text-sm font-medium bg-orange-500 text-white hover:bg-orange-600 transition-colors flex items-center justify-center gap-1.5"
                    >
                      {requestRevision.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      Submit
                    </button>
                  </div>
                </div>
              ) : showApproveModal ? (
                <div className="space-y-3 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <h3 className="font-medium text-sm">Confirm Approval</h3>
                    <button onClick={() => { setShowApproveModal(false); setApproveChecked(false); }} className="text-muted-foreground hover:text-foreground"><X className="w-4 h-4" /></button>
                  </div>
                  <div className="bg-muted/30 rounded-xl p-3 text-sm text-muted-foreground">
                    <p>You are about to approve <strong className="text-foreground">{review.brandName} — Company Profile</strong>.</p>
                    <p className="mt-1">Once approved, our team will prepare your final, watermark-free files.</p>
                  </div>
                  <label className="flex items-start gap-3 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={approveChecked}
                      onChange={(e) => setApproveChecked(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-border"
                    />
                    <span className="text-sm font-medium">Saya menyetujui hasil ini dan menyatakan Company Profile sudah sesuai.</span>
                  </label>
                  <button
                    onClick={handleApprove}
                    disabled={!approveChecked || approveReview.isPending}
                    className="w-full py-2.5 bg-green-600 text-white rounded-xl font-medium text-sm hover:bg-green-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
                  >
                    {approveReview.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    <CheckCircle2 className="w-4 h-4" /> Approve Company Profile
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  <h3 className="font-medium text-sm mb-3">Your Decision</h3>
                  <button
                    onClick={() => setShowApproveModal(true)}
                    className="w-full py-2.5 bg-green-600 text-white rounded-xl font-semibold text-sm hover:bg-green-700 transition-colors flex items-center justify-center gap-2"
                  >
                    <CheckCircle2 className="w-4 h-4" /> Approve
                  </button>
                  <button
                    onClick={() => setShowRevisionForm(true)}
                    className="w-full py-2.5 bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300 rounded-xl font-medium text-sm hover:bg-orange-200 dark:hover:bg-orange-900/50 transition-colors flex items-center justify-center gap-2"
                  >
                    <RefreshCcw className="w-4 h-4" /> Request Revision
                  </button>
                </div>
              )}
            </div>

            {/* ── Panel Nav ─────────────────────────────────────────────────────── */}
            <div className="bg-card border border-card-border rounded-2xl overflow-hidden">
              <div className="flex border-b border-border">
                {[
                  { id: "comments",  label: "Comments", icon: MessageSquare, count: review.pendingComments },
                  { id: "versions",  label: "Versions",  icon: History },
                  { id: "compare",   label: "Compare",   icon: GitCompare },
                  { id: "dashboard", label: "Stats",     icon: BarChart3 },
                ].map(({ id, label, icon: Icon, count }) => (
                  <button
                    key={id}
                    onClick={() => setActivePanel(id as typeof activePanel)}
                    className={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-medium transition-colors border-b-2 ${
                      activePanel === id
                        ? "border-primary text-primary bg-primary/5"
                        : "border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30"
                    }`}
                  >
                    <div className="relative">
                      <Icon className="w-4 h-4" />
                      {count != null && count > 0 && (
                        <span className="absolute -top-1.5 -right-2 w-3.5 h-3.5 bg-destructive text-destructive-foreground text-[8px] font-bold rounded-full flex items-center justify-center">
                          {count > 9 ? "9+" : count}
                        </span>
                      )}
                    </div>
                    {label}
                  </button>
                ))}
              </div>

              {/* ── Comments panel ─────────────────────────────────────────────── */}
              {activePanel === "comments" && (
                <div className="p-4 space-y-4">
                  {/* Add comment form */}
                  <form onSubmit={handleAddComment} className="space-y-2">
                    <textarea
                      value={commentText}
                      onChange={(e) => setCommentText(e.target.value)}
                      placeholder="Add a comment on this document…"
                      rows={2}
                      className="w-full text-sm px-3 py-2 rounded-xl border border-input bg-background focus:ring-2 focus:ring-primary focus:outline-none resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <input
                        value={commentPage}
                        onChange={(e) => setCommentPage(e.target.value)}
                        placeholder="Page #"
                        type="number"
                        min={1}
                        className="w-20 text-xs px-2 py-1.5 rounded-lg border border-input bg-background"
                      />
                      <select
                        value={commentSection}
                        onChange={(e) => setCommentSection(e.target.value)}
                        className="flex-1 text-xs px-2 py-1.5 rounded-lg border border-input bg-background"
                      >
                        <option value="">Section (optional)</option>
                        {(review.sectionsIncluded ?? []).map((s: string) => (
                          <option key={s} value={s}>{SECTION_LABELS[s] ?? s}</option>
                        ))}
                      </select>
                      <select
                        value={commentPriority}
                        onChange={(e) => setCommentPriority(e.target.value)}
                        className="w-24 text-xs px-2 py-1.5 rounded-lg border border-input bg-background"
                      >
                        <option value="low">Low</option>
                        <option value="normal">Normal</option>
                        <option value="high">High</option>
                        <option value="urgent">Urgent</option>
                      </select>
                    </div>
                    <button
                      type="submit"
                      disabled={!commentText.trim() || addComment.isPending}
                      className="w-full py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors flex items-center justify-center gap-1.5"
                    >
                      {addComment.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                      Add Comment
                    </button>
                  </form>

                  {/* Comment list */}
                  <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                    {comments.length === 0 ? (
                      <div className="text-center py-6 text-muted-foreground text-sm">
                        <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-40" />
                        <p>No comments yet. Click a section above to add one.</p>
                      </div>
                    ) : (
                      comments.map((c) => (
                        <CommentCard
                          key={c.id}
                          comment={c}
                          onResolve={handleResolve}
                          onDelete={handleDelete}
                          currentUser={review.clientName}
                        />
                      ))
                    )}
                  </div>
                </div>
              )}

              {/* ── Versions panel ─────────────────────────────────────────────── */}
              {activePanel === "versions" && (
                <div className="p-4">
                  <VersionHistoryPanel versions={versions} />
                </div>
              )}

              {/* ── Compare panel ──────────────────────────────────────────────── */}
              {activePanel === "compare" && (
                <div className="p-4">
                  <VersionComparePanel token={token} versions={versions} />
                </div>
              )}

              {/* ── Dashboard/Stats panel ──────────────────────────────────────── */}
              {activePanel === "dashboard" && (
                <div className="p-4 space-y-3">
                  <h3 className="text-sm font-medium flex items-center gap-2"><BarChart3 className="w-4 h-4" />Review Stats</h3>
                  {[
                    { label: "Total Comments",   value: dashboard?.totalComments ?? review.totalComments    },
                    { label: "Resolved",          value: dashboard?.resolvedComments ?? review.resolvedComments },
                    { label: "Open",              value: dashboard?.openComments ?? review.pendingComments   },
                    { label: "High Priority",     value: dashboard?.highPriorityPending },
                    { label: "Current Version",   value: review.documentVersion ? `v${review.documentVersion}` : "—" },
                    { label: "Total Versions",    value: dashboard?.totalVersions ?? versions.length },
                    { label: "QC Score",          value: review.qcScore != null ? `${review.qcScore}/100` : "—" },
                    { label: "Approval Status",   value: review.reviewStatus },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-xs font-semibold">{value ?? "—"}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div> {/* end right panel */}
        </div> {/* end main layout */}
      </div>
    </Layout>
  );
}
