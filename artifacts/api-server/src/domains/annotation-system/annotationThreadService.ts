/**
 * annotationThreadService.ts — Team 18 / Universal Annotation and Comment System
 *
 * Thread and comment management. All actor identity is resolved server-side;
 * body text is sanitized before storage.
 */
import { db } from "@workspace/db";
import { aiAnnotationCommentsTable } from "@workspace/db";
import { eq, and, asc } from "drizzle-orm";
import type { CreateCommentInput, EditCommentInput, AnnotationActorContext } from "./types.js";
import type { AiAnnotationComment } from "@workspace/db";
import {
  sanitizeComment,
  canEditComment,
  canDeleteComment,
  AnnotationPermissionError,
} from "./annotationPermissionService.js";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function mapComment(row: AiAnnotationComment) {
  return {
    id:              row.id,
    annotationId:    row.annotationId,
    parentCommentId: row.parentCommentId ?? null,
    body:            row.body,
    authorType:      row.authorType,
    createdBy:       row.createdBy,
    createdByName:   row.createdByName,
    editedAt:        row.editedAt?.toISOString() ?? null,
    isDeleted:       row.isDeleted,
    createdAt:       row.createdAt.toISOString(),
    updatedAt:       row.updatedAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getThread — all non-deleted comments for an annotation, chronological
// ─────────────────────────────────────────────────────────────────────────────

export async function getThread(annotationId: number) {
  const rows = await db
    .select()
    .from(aiAnnotationCommentsTable)
    .where(
      and(
        eq(aiAnnotationCommentsTable.annotationId, annotationId),
        eq(aiAnnotationCommentsTable.isDeleted, false),
      ),
    )
    .orderBy(asc(aiAnnotationCommentsTable.createdAt));

  return rows.map(mapComment);
}

// ─────────────────────────────────────────────────────────────────────────────
// addComment — add a comment or reply to an annotation thread
// ─────────────────────────────────────────────────────────────────────────────

export async function addComment(
  annotationId: number,
  input: CreateCommentInput,
  ctx: AnnotationActorContext,
) {
  const sanitized = sanitizeComment(input.body);
  if (!sanitized) throw new Error("Comment body must not be empty after sanitization");

  // If this is a reply, verify the parent belongs to the same annotation
  if (input.parentCommentId !== undefined) {
    const [parent] = await db
      .select()
      .from(aiAnnotationCommentsTable)
      .where(
        and(
          eq(aiAnnotationCommentsTable.id, input.parentCommentId),
          eq(aiAnnotationCommentsTable.annotationId, annotationId),
          eq(aiAnnotationCommentsTable.isDeleted, false),
        ),
      );
    if (!parent) {
      throw new AnnotationPermissionError(
        "INVALID_PARENT",
        "Parent comment not found in this annotation thread",
      );
    }
  }

  const [row] = await db
    .insert(aiAnnotationCommentsTable)
    .values({
      annotationId,
      parentCommentId: input.parentCommentId ?? null,
      body:            sanitized,
      authorType:      ctx.authorType,
      // Actor identity always from server context — never from client payload
      createdBy:       ctx.actorId,
      createdByName:   ctx.actorName,
    })
    .returning();

  if (!row) throw new Error("Failed to create comment");
  return mapComment(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// editComment — edit own comment (body only)
// ─────────────────────────────────────────────────────────────────────────────

export async function editComment(
  commentId: number,
  input: EditCommentInput,
  ctx: AnnotationActorContext,
) {
  const [existing] = await db
    .select()
    .from(aiAnnotationCommentsTable)
    .where(eq(aiAnnotationCommentsTable.id, commentId));

  if (!existing) throw new AnnotationPermissionError("NOT_FOUND", "Comment not found");
  if (!canEditComment(existing, ctx.actorId)) {
    throw new AnnotationPermissionError("FORBIDDEN", "You can only edit your own comments");
  }

  const sanitized = sanitizeComment(input.body);
  if (!sanitized) throw new Error("Comment body must not be empty after sanitization");

  const [row] = await db
    .update(aiAnnotationCommentsTable)
    .set({ body: sanitized, editedAt: new Date() })
    .where(eq(aiAnnotationCommentsTable.id, commentId))
    .returning();

  if (!row) throw new Error("Comment edit failed");
  return mapComment(row);
}

// ─────────────────────────────────────────────────────────────────────────────
// deleteComment — soft-delete a comment
// ─────────────────────────────────────────────────────────────────────────────

export async function deleteComment(
  commentId: number,
  ctx: AnnotationActorContext,
): Promise<void> {
  const [existing] = await db
    .select()
    .from(aiAnnotationCommentsTable)
    .where(eq(aiAnnotationCommentsTable.id, commentId));

  if (!existing) throw new AnnotationPermissionError("NOT_FOUND", "Comment not found");
  if (!canDeleteComment(existing, ctx)) {
    throw new AnnotationPermissionError("FORBIDDEN", "Not authorized to delete this comment");
  }

  await db
    .update(aiAnnotationCommentsTable)
    .set({
      isDeleted:     true,
      deletedAt:     new Date(),
      deletedByType: ctx.authorType,
    })
    .where(eq(aiAnnotationCommentsTable.id, commentId));
}
