/**
 * index.ts — Team 18 / Universal Annotation and Comment System
 *
 * Public exports for the annotation domain.
 */
export { annotationRouter } from "./annotationRouter.js";

// Types
export type {
  AnnotationType,
  AnnotationStatus,
  AnnotationPriority,
  AuthorType,
  AnnotationGeometry,
  AnnotationAnchor,
  AnnotationPermission,
  AnnotationComment,
  AnnotationThread,
  AnnotationRecord,
  CreateAnnotationInput,
  UpdateAnnotationInput,
  CreateCommentInput,
  EditCommentInput,
  AnnotationSelection,
  AnnotationActorContext,
} from "./types.js";

export {
  ANNOTATION_TYPES,
  ANNOTATION_STATUSES,
  ANNOTATION_PRIORITIES,
  AUTHOR_TYPES,
  CreateAnnotationSchema,
  UpdateAnnotationSchema,
  CreateCommentSchema,
  EditCommentSchema,
  AnnotationSelectionSchema,
  AnnotationGeometrySchema,
  AnnotationAnchorSchema,
} from "./types.js";

// Geometry utilities
export {
  normalizePoint,
  denormalizePoint,
  clampAnchor,
  transformAnchor,
  validateGeometry,
  calculateAnnotationBounds,
  migrateAnchorBetweenViewportSizes,
  detectOutsideContent,
} from "./geometry.js";

// Services
export {
  createAnnotation,
  getAnnotation,
  listAnnotations,
  updateAnnotation,
  softDeleteAnnotation,
  resolveAnnotation,
  reopenAnnotation,
  acknowledgeAnnotation,
  archiveAnnotation,
} from "./annotationService.js";

export {
  getThread,
  addComment,
  editComment,
  deleteComment,
} from "./annotationThreadService.js";

export {
  assertTenantMatch,
  assertNoCrossProjectAnchor,
  buildActorContext,
  canCreateAnnotation,
  canResolveAnnotation,
  canReopenAnnotation,
  canArchiveAnnotation,
  canDeleteAnnotation,
  canEditComment,
  canDeleteComment,
  sanitizeComment,
  containsHtml,
  AnnotationPermissionError,
} from "./annotationPermissionService.js";
