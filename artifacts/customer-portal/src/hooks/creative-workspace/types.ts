/**
 * Frontend TypeScript types for the Creative Workspace (Team 2).
 * Mirror the backend DTOs from services/customer-creative-workspace/types.ts
 */

export type StageStatus = "pending" | "working" | "completed" | "failed" | "blocked";

export interface ProductionStage {
  id: number;
  name: string;
  label: string;
  status: StageStatus;
  startedAt: string | null;
  completedAt: string | null;
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

export interface CWDeliverable {
  id: number;
  assetType: string;
  category: string | null;
  title: string;
  status: string;
  statusLabel?: string;
  version: number;
  revisionNotes: string | null;
  locked: boolean;
  downloadAvailable: boolean;
  signEndpoint: string;
  createdAt: string;
}

export interface CWZipBundle {
  id: number;
  status: string;
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

export interface CWRevisionEntry {
  id: number;
  round: number;
  status: string;
  statusLabel: string;
  feedback: string | null;
  sharedAt: string | null;
  viewedAt: string | null;
  resolvedAt: string | null;
  reviewUrl: string | null;
}

export interface RevisionHistory {
  projectNumber: string;
  totalRounds: number;
  currentStatus: string;
  currentStatusLabel: string;
  entries: CWRevisionEntry[];
}

export type NotificationSeverity = "info" | "success" | "warning" | "action";

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

export interface CWHistoryEvent {
  id: string;
  eventType: string;
  title: string;
  message: string;
  severity: "info" | "success" | "warning" | "error";
  createdAt: string;
}

export interface ProjectHistory {
  projectNumber: string;
  events: CWHistoryEvent[];
  total: number;
}

export interface CWUrgentAction {
  type: string;
  projectNumber: string;
  projectName: string;
  label: string;
  message: string;
  priority: "high" | "medium" | "low";
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

export interface CWStats {
  totalProjects: number;
  activeProjects: number;
  waitingReview: number;
  completedProjects: number;
  pendingPayment: number;
  unreadNotifications: number;
  downloadableAssets: number;
  outstandingBalance: number;
  outstandingCurrency: string;
}

export interface CWOverview {
  clientName: string;
  clientEmail: string;
  stats: CWStats;
  recentProjects: CWProjectCard[];
  urgentActions: CWUrgentAction[];
}
