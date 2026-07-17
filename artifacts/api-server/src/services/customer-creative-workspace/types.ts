/**
 * types.ts — Customer-safe DTOs for the Creative Workspace (Team 2).
 *
 * Security rules (enforced at adapter layer, not here):
 *   • No storagePath exposed (internal object-storage keys)
 *   • No imageUrl from creative_ai_assets (may be pre-signed S3 URLs with internal paths)
 *   • No provider / model / tokenUsage / cost data
 *   • No internal step input/output (may contain prompts or raw model responses)
 *   • No reviewToken plaintext
 */

// ── Auth ──────────────────────────────────────────────────────────────────────

export interface CWSession {
  emailHash: string;
  clientEmail: string;
  clientName: string;
}

// ── Brief ─────────────────────────────────────────────────────────────────────

export interface BriefField {
  key: string;
  label: string;
  value: string | null;
  filled: boolean;
  required: boolean;
}

export interface BriefStatus {
  projectNumber: string;
  serviceType: string | null;
  briefCompletionPercent: number;
  fields: BriefField[];
  summary: string | null;
  submittedAt: string | null;
  lastUpdatedAt: string | null;
}

// ── Production Progress ───────────────────────────────────────────────────────

export type StageStatus = 'pending' | 'working' | 'completed' | 'failed' | 'blocked';

export interface ProductionStage {
  id: number;
  name: string;
  label: string;
  status: StageStatus;
  startedAt: string | null;
  completedAt: string | null;
  /** Customer-facing description of what this stage does */
  description: string;
}

export interface ProductionProgress {
  projectNumber: string;
  projectStatus: string;
  overallStageLabel: string;
  progressPercent: number;
  stages: ProductionStage[];
  currentStageName: string | null;
  estimatedDelivery: string | null;
  lastActivityAt: string | null;
}

// ── Deliverables ──────────────────────────────────────────────────────────────

export interface CWDeliverable {
  id: number;
  assetType: string;
  category: string | null;
  title: string;
  status: string;
  version: number;
  revisionNotes: string | null;
  locked: boolean;
  downloadAvailable: boolean;
  /** POST this path to get a time-limited signed download URL */
  signEndpoint: string;
  createdAt: string;
}

export interface CWZipBundle {
  id: number;
  status: string;
  /** POST this path to get a signed download URL */
  signEndpoint: string;
  assetCount: number | null;
  createdAt: string;
}

export interface DeliverableBundle {
  projectNumber: string;
  filesUnlocked: boolean;
  deliverables: CWDeliverable[];
  zipBundle: CWZipBundle | null;
  totalAssets: number;
  approvedAssets: number;
  pendingAssets: number;
}

// ── Revisions ─────────────────────────────────────────────────────────────────

export interface CWRevisionEntry {
  id: number;
  round: number;
  status: string;
  statusLabel: string;
  feedback: string | null;
  sharedAt: string | null;
  viewedAt: string | null;
  resolvedAt: string | null;
  /** reviewUrl is safe to expose to the token owner */
  reviewUrl: string | null;
}

export interface RevisionHistory {
  projectNumber: string;
  totalRounds: number;
  currentStatus: string;
  currentStatusLabel: string;
  entries: CWRevisionEntry[];
}

// ── Notifications ─────────────────────────────────────────────────────────────

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'action';

export interface CWNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  projectNumber: string | null;
  read: boolean;
  severity: NotificationSeverity;
  createdAt: string;
  actionLabel: string | null;
  actionPath: string | null;
}

export interface NotificationSummary {
  items: CWNotification[];
  unreadCount: number;
  total: number;
}

// ── Overview ──────────────────────────────────────────────────────────────────

export interface CWUrgentAction {
  type: 'review_pending' | 'payment_required' | 'brief_incomplete' | 'download_ready' | 'revision_requested';
  projectNumber: string;
  projectName: string;
  label: string;
  message: string;
  priority: 'high' | 'medium' | 'low';
  actionPath: string;
}

export interface CWProjectCard {
  projectNumber: string;
  brandName: string;
  serviceName: string;
  packageName: string | null;
  currentStage: string;
  currentStageLabel: string;
  progressPercent: number;
  filesUnlocked: boolean;
  deliveryDate: string | null;
  reviewStatus: string | null;
  paymentStatus: string | null;
  urgentAction: CWUrgentAction | null;
  createdAt: string;
  updatedAt: string;
}

export interface CWOverview {
  clientName: string;
  clientEmail: string;
  stats: {
    totalProjects: number;
    activeProjects: number;
    waitingReview: number;
    completedProjects: number;
    pendingPayment: number;
    unreadNotifications: number;
    downloadableAssets: number;
    outstandingBalance: number;
    outstandingCurrency: string;
  };
  recentProjects: CWProjectCard[];
  urgentActions: CWUrgentAction[];
}

// ── History (canonical event feed) ───────────────────────────────────────────

export interface CWHistoryEvent {
  id: string;
  eventType: string;
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'error';
  createdAt: string;
}

export interface ProjectHistory {
  projectNumber: string;
  events: CWHistoryEvent[];
  total: number;
}
