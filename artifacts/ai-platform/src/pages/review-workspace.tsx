/**
 * ReviewWorkspacePage — Team 16
 *
 * Admin page at /review-workspace/:reviewId
 * Wraps ReviewWorkspaceShell with admin context and navigation.
 *
 * Integration note: lifecycle transitions (approve/reject/revision) via the
 * existing public review token are intentionally NOT wired here since the
 * admin page doesn't have the plaintext token (stored hash-first). Instead,
 * admins use the internal sign-off, due date, checklist, and cancel actions.
 * Client-facing decisions are made by the client on the public review page.
 */

import { useParams, Link } from "wouter";
import { ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ReviewWorkspaceShell } from "@/components/review-workspace";

export default function ReviewWorkspacePage() {
  const params = useParams<{ reviewId: string }>();
  const reviewId = params.reviewId ? parseInt(params.reviewId, 10) : null;

  if (!reviewId || isNaN(reviewId)) {
    return (
      <div className="max-w-2xl mx-auto py-16 px-4 text-center">
        <p className="text-destructive font-medium">Invalid review ID.</p>
        <Link href="/creative-ai">
          <Button variant="outline" size="sm" className="mt-4 gap-2">
            <ArrowLeft className="size-4" />
            Back to Creative AI
          </Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto py-8 px-4 space-y-6">
      {/* Breadcrumb navigation */}
      <nav aria-label="Breadcrumb" className="flex items-center gap-3">
        <Link href="/creative-ai">
          <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden />
            Creative AI
          </Button>
        </Link>
        <span className="text-muted-foreground" aria-hidden>/</span>
        <span className="text-sm font-medium text-foreground">Review Workspace</span>
        <span className="text-muted-foreground text-sm" aria-hidden>#{reviewId}</span>
        <a
          href={`/api/review-workspace/reviews/${reviewId}/summary`}
          target="_blank"
          rel="noreferrer"
          className="ml-auto text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
          aria-label="View raw API response"
        >
          <ExternalLink className="size-3" aria-hidden />
          API
        </a>
      </nav>

      {/* Workspace Shell */}
      <ReviewWorkspaceShell
        reviewId={reviewId}
        adminName="Internal Team"
        // NOTE: onPublicAction is intentionally omitted here.
        // Client decisions (approve/reject/revision) are made by the client
        // via the token-authenticated public review page — not by admins.
        // The workspace provides internal tooling: sign-off, due date, checklist, cancel.
      />
    </div>
  );
}
