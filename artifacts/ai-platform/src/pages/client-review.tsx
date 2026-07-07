/**
 * Phase 6 — Public Client Review Page
 * Accessible at /review/creative/:token — no admin key required.
 * Clean, mobile-friendly interface for non-technical clients.
 */
import { useState } from "react";
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  CheckCircle2,
  XCircle,
  RotateCcw,
  MessageSquare,
  Loader2,
  ImageOff,
  Sparkles,
  Clock,
  AlertCircle,
} from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

// ── Types ──────────────────────────────────────────────────────────────────────

interface PublicAsset {
  id: number;
  imageUrl?: string | null;
  thumbnailUrl?: string | null;
  aspectRatio?: string | null;
  status: string;
}

interface ClientComment {
  id: number;
  reviewId: number;
  projectId: string;
  assetId?: number | null;
  stepId?: number | null;
  parentCommentId?: number | null;
  authorName: string;
  authorType: "client" | "admin";
  comment: string;
  status: "open" | "resolved" | "archived";
  createdAt: string;
  updatedAt: string;
}

interface PublicProjectReview {
  reviewId: number;
  projectId: string;
  clientName: string;
  reviewStatus: string;
  brandName: string;
  businessType: string;
  targetMarket: string;
  productOrService: string;
  stylePreference?: string | null;
  goal: string;
  status: string;
  copyOutput?: Record<string, unknown> | null;
  creativeDirection?: Record<string, unknown> | null;
  assets: PublicAsset[];
  comments: ClientComment[];
  createdAt: string;
}

// ── API helpers (no admin key — public endpoints) ──────────────────────────────

const API_BASE = "/api/public/creative-review";

async function fetchReview(token: string): Promise<PublicProjectReview> {
  const res = await fetch(`${API_BASE}/${token}`);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function postAction(token: string, action: "approve" | "reject" | "request-revision", notes?: string) {
  const res = await fetch(`${API_BASE}/${token}/${action}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ notes: notes ?? null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function postComment(token: string, comment: string, authorName: string, assetId?: number | null) {
  const res = await fetch(`${API_BASE}/${token}/comment`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ comment, authorName, assetId: assetId ?? null }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<ClientComment>;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function reviewStatusColor(status: string) {
  switch (status) {
    case "approved":           return "bg-green-500/15 text-green-700 border-green-500/30 dark:text-green-400";
    case "rejected":           return "bg-red-500/15 text-red-700 border-red-500/30 dark:text-red-400";
    case "revision_requested": return "bg-yellow-500/15 text-yellow-700 border-yellow-500/30 dark:text-yellow-400";
    case "viewed":             return "bg-blue-500/15 text-blue-700 border-blue-500/30 dark:text-blue-400";
    default:                   return "bg-gray-500/15 text-gray-600 border-gray-500/30 dark:text-gray-400";
  }
}

function reviewStatusLabel(status: string) {
  switch (status) {
    case "approved":           return "Approved";
    case "rejected":           return "Rejected";
    case "revision_requested": return "Revision Requested";
    case "viewed":             return "In Review";
    case "shared":             return "Awaiting Review";
    default:                   return status.replace(/_/g, " ");
  }
}

function renderCopyOutput(output: Record<string, unknown> | null | undefined) {
  if (!output || Object.keys(output).length === 0) return null;
  const entries = Object.entries(output).filter(([, v]) => v !== null && v !== undefined);
  return (
    <div className="space-y-4">
      {entries.map(([key, value]) => {
        const label = key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
        if (Array.isArray(value)) {
          return (
            <div key={key}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{label}</p>
              <ul className="space-y-2">
                {(value as unknown[]).map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
                    <span className="text-blue-500 mt-0.5 shrink-0">•</span>
                    <span>{typeof item === "string" ? item : JSON.stringify(item)}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        }
        if (typeof value === "string") {
          return (
            <div key={key}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">{label}</p>
              <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed whitespace-pre-wrap">{value}</p>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

// ── Asset Card ─────────────────────────────────────────────────────────────────

function AssetCard({
  asset,
  onComment,
}: {
  asset: PublicAsset;
  onComment: (assetId: number) => void;
}) {
  return (
    <div className="rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden bg-white dark:bg-gray-800 shadow-sm">
      <div className="aspect-square bg-gray-100 dark:bg-gray-900 relative">
        {asset.imageUrl ? (
          <img
            src={asset.imageUrl}
            alt="Creative concept"
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center">
            <ImageOff className="size-8 text-gray-400" />
          </div>
        )}
      </div>
      <div className="p-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onComment(asset.id)}
          className="w-full text-xs gap-1.5 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
        >
          <MessageSquare className="size-3.5" />
          Comment on this image
        </Button>
      </div>
    </div>
  );
}

// ── Comment Item ───────────────────────────────────────────────────────────────

function CommentItem({ comment }: { comment: ClientComment }) {
  const isAdmin = comment.authorType === "admin";
  return (
    <div className={cn("flex gap-3 py-3", isAdmin ? "opacity-90" : "")}>
      <div
        className={cn(
          "size-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 mt-0.5",
          isAdmin
            ? "bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400"
            : "bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300",
        )}
      >
        {comment.authorName[0]?.toUpperCase()}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{comment.authorName}</span>
          {isAdmin && (
            <Badge variant="outline" className="text-[10px] px-1.5 h-4 border-blue-300 text-blue-600 dark:text-blue-400">
              Team
            </Badge>
          )}
          <span className="text-xs text-gray-400">{format(new Date(comment.createdAt), "MMM d, HH:mm")}</span>
        </div>
        <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">{comment.comment}</p>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function ClientReviewPage() {
  const params = useParams<{ token: string }>();
  const token = params.token ?? "";
  const queryClient = useQueryClient();

  const [actionNotes, setActionNotes] = useState("");
  const [showNotesFor, setShowNotesFor] = useState<"approve" | "reject" | "revision" | null>(null);
  const [commentText, setCommentText] = useState("");
  const [commentAssetId, setCommentAssetId] = useState<number | null>(null);
  const [actionDone, setActionDone] = useState<string | null>(null);

  const { data: review, isLoading, error } = useQuery({
    queryKey: ["public-review", token],
    queryFn: () => fetchReview(token),
    enabled: !!token,
    retry: false,
  });

  const actionMutation = useMutation({
    mutationFn: ({ action, notes }: { action: "approve" | "reject" | "request-revision"; notes?: string }) =>
      postAction(token, action, notes),
    onSuccess: (_, { action }) => {
      const label =
        action === "approve" ? "approved" : action === "reject" ? "rejected" : "revision_requested";
      setActionDone(label);
      setShowNotesFor(null);
      setActionNotes("");
      queryClient.invalidateQueries({ queryKey: ["public-review", token] });
    },
  });

  const commentMutation = useMutation({
    mutationFn: (vars: { text: string; assetId: number | null }) =>
      postComment(token, vars.text, review?.clientName ?? "Client", vars.assetId),
    onSuccess: () => {
      setCommentText("");
      setCommentAssetId(null);
      queryClient.invalidateQueries({ queryKey: ["public-review", token] });
    },
  });

  // ── Loading / error states ────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center">
        <Loader2 className="size-8 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (error || !review) {
    const msg = error instanceof Error ? error.message : "Review link not found or has expired.";
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-gray-950 flex items-center justify-center px-4">
        <div className="max-w-md w-full text-center space-y-4">
          <div className="size-16 rounded-2xl bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto">
            <AlertCircle className="size-8 text-red-500" />
          </div>
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">Link Unavailable</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{msg}</p>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            Please contact the team if you believe this is an error.
          </p>
        </div>
      </div>
    );
  }

  const isTerminal = ["approved", "rejected", "revision_requested"].includes(review.reviewStatus);
  const terminalStatus = actionDone ?? (isTerminal ? review.reviewStatus : null);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 sticky top-0 z-10">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles className="size-5 text-blue-500" />
            <span className="font-semibold text-gray-900 dark:text-gray-100">Creative Review</span>
          </div>
          <Badge className={cn("text-xs border", reviewStatusColor(terminalStatus ?? review.reviewStatus))}>
            {reviewStatusLabel(terminalStatus ?? review.reviewStatus)}
          </Badge>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-8 space-y-8">

        {/* Project info */}
        <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
          <div className="space-y-1 mb-4">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{review.brandName}</h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm">
              {review.businessType} · {review.productOrService}
            </p>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Target Market</p>
              <p className="text-gray-700 dark:text-gray-300">{review.targetMarket}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Goal</p>
              <p className="text-gray-700 dark:text-gray-300">{review.goal}</p>
            </div>
            {review.stylePreference && (
              <div className="col-span-2">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-0.5">Style Preference</p>
                <p className="text-gray-700 dark:text-gray-300">{review.stylePreference}</p>
              </div>
            )}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-gray-400 mt-4">
            <Clock className="size-3.5" />
            Submitted {format(new Date(review.createdAt), "MMMM d, yyyy")}
          </div>
        </div>

        {/* Creative Direction */}
        {review.creativeDirection && Object.keys(review.creativeDirection).length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Creative Direction</h2>
            {renderCopyOutput(review.creativeDirection)}
          </div>
        )}

        {/* Copy & Captions */}
        {review.copyOutput && Object.keys(review.copyOutput).length > 0 && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">Copy & Captions</h2>
            {renderCopyOutput(review.copyOutput)}
          </div>
        )}

        {/* Image Concepts */}
        {review.assets.length > 0 && (
          <div>
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-4">
              Image Concepts
              <span className="ml-2 text-sm font-normal text-gray-400">({review.assets.length})</span>
            </h2>
            <div className="grid grid-cols-2 sm:grid-cols-2 gap-4">
              {review.assets.map((asset) => (
                <AssetCard
                  key={asset.id}
                  asset={asset}
                  onComment={(assetId) => {
                    setCommentAssetId(assetId);
                    setCommentText("");
                    document.getElementById("comment-box")?.scrollIntoView({ behavior: "smooth" });
                  }}
                />
              ))}
            </div>
          </div>
        )}

        {/* Approval Actions */}
        {!terminalStatus && (
          <div className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
            <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">Your Decision</h2>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-5">
              Let the team know what you think. You can also leave comments below.
            </p>

            {showNotesFor ? (
              <div className="space-y-3">
                <Textarea
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  placeholder={
                    showNotesFor === "approve"
                      ? "Any final notes? (optional)"
                      : showNotesFor === "reject"
                      ? "Please tell us why you're rejecting this..."
                      : "What changes would you like to see?"
                  }
                  className="resize-none text-sm"
                  rows={3}
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    onClick={() =>
                      actionMutation.mutate({
                        action:
                          showNotesFor === "approve"
                            ? "approve"
                            : showNotesFor === "reject"
                            ? "reject"
                            : "request-revision",
                        notes: actionNotes || undefined,
                      })
                    }
                    disabled={actionMutation.isPending}
                    className={cn(
                      "flex-1 gap-2",
                      showNotesFor === "approve"
                        ? "bg-green-600 hover:bg-green-700 text-white"
                        : showNotesFor === "reject"
                        ? "bg-red-600 hover:bg-red-700 text-white"
                        : "bg-yellow-500 hover:bg-yellow-600 text-white",
                    )}
                  >
                    {actionMutation.isPending ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : showNotesFor === "approve" ? (
                      <CheckCircle2 className="size-4" />
                    ) : showNotesFor === "reject" ? (
                      <XCircle className="size-4" />
                    ) : (
                      <RotateCcw className="size-4" />
                    )}
                    Confirm{" "}
                    {showNotesFor === "approve"
                      ? "Approval"
                      : showNotesFor === "reject"
                      ? "Rejection"
                      : "Revision Request"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => { setShowNotesFor(null); setActionNotes(""); }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-3">
                <Button
                  onClick={() => setShowNotesFor("approve")}
                  className="gap-2 bg-green-600 hover:bg-green-700 text-white"
                >
                  <CheckCircle2 className="size-4" />
                  <span className="hidden sm:inline">Approve</span>
                  <span className="sm:hidden">OK</span>
                </Button>
                <Button
                  onClick={() => setShowNotesFor("revision")}
                  className="gap-2 bg-yellow-500 hover:bg-yellow-600 text-white"
                >
                  <RotateCcw className="size-4" />
                  <span className="hidden sm:inline">Request Revision</span>
                  <span className="sm:hidden">Revise</span>
                </Button>
                <Button
                  onClick={() => setShowNotesFor("reject")}
                  variant="outline"
                  className="gap-2 border-red-300 text-red-600 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                >
                  <XCircle className="size-4" />
                  Reject
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Terminal status banner */}
        {terminalStatus && (
          <div
            className={cn(
              "rounded-2xl border p-6 text-center",
              terminalStatus === "approved"
                ? "bg-green-50 border-green-200 dark:bg-green-900/20 dark:border-green-800"
                : terminalStatus === "rejected"
                ? "bg-red-50 border-red-200 dark:bg-red-900/20 dark:border-red-800"
                : "bg-yellow-50 border-yellow-200 dark:bg-yellow-900/20 dark:border-yellow-800",
            )}
          >
            {terminalStatus === "approved" ? (
              <CheckCircle2 className="size-10 text-green-500 mx-auto mb-3" />
            ) : terminalStatus === "rejected" ? (
              <XCircle className="size-10 text-red-500 mx-auto mb-3" />
            ) : (
              <RotateCcw className="size-10 text-yellow-500 mx-auto mb-3" />
            )}
            <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">
              {terminalStatus === "approved"
                ? "Project Approved!"
                : terminalStatus === "rejected"
                ? "Project Rejected"
                : "Revision Requested"}
            </h3>
            <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
              {terminalStatus === "approved"
                ? "Thank you! The team has been notified."
                : terminalStatus === "rejected"
                ? "The team has been notified of your decision."
                : "Your revision request has been sent to the team."}
            </p>
          </div>
        )}

        {/* Comments */}
        <div id="comment-box" className="bg-white dark:bg-gray-900 rounded-2xl border border-gray-200 dark:border-gray-800 p-6 shadow-sm">
          <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100 mb-1">
            Comments
            {review.comments.length > 0 && (
              <span className="ml-2 text-sm font-normal text-gray-400">({review.comments.length})</span>
            )}
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
            Leave notes for the team. Comments on specific images are visible above.
          </p>

          {commentAssetId && (
            <div className="mb-3 flex items-center gap-2 text-xs text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 rounded-lg px-3 py-2">
              <MessageSquare className="size-3.5" />
              Commenting on image #{commentAssetId}
              <button
                className="ml-auto text-blue-400 hover:text-blue-600"
                onClick={() => setCommentAssetId(null)}
              >
                Clear
              </button>
            </div>
          )}

          <div className="flex flex-col gap-2 mb-4">
            <Textarea
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder="Share your thoughts, feedback, or questions..."
              className="resize-none text-sm"
              rows={3}
            />
            <Button
              size="sm"
              onClick={() => commentMutation.mutate({ text: commentText, assetId: commentAssetId })}
              disabled={!commentText.trim() || commentMutation.isPending}
              className="self-end gap-2"
            >
              {commentMutation.isPending ? <Loader2 className="size-4 animate-spin" /> : <MessageSquare className="size-4" />}
              Add Comment
            </Button>
          </div>

          {review.comments.length > 0 && (
            <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {review.comments.map((c) => (
                <CommentItem key={c.id} comment={c} />
              ))}
            </div>
          )}

          {review.comments.length === 0 && !commentMutation.isPending && (
            <p className="text-sm text-gray-400 text-center py-4">No comments yet — be the first!</p>
          )}
        </div>

        {/* Footer */}
        <div className="text-center text-xs text-gray-400 pb-8">
          This review link is private and secure. Do not share it with others.
        </div>
      </div>
    </div>
  );
}
