import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

async function customFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `Request failed: ${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

const base = (token: string) => `/api/public/customer/workspace/${token}`;

export type WorkspaceSummary = {
  clientName: string;
  clientEmail: string;
  activeProjects: number;
  waitingReview: number;
  completedProjects: number;
  outstandingBalance: number;
  outstandingCurrency: string;
  invoiceCount: number;
  downloadCount: number;
  brandAssetCount: number;
  aiCredits: number;
};

export type WorkspaceProject = {
  projectNumber: string;
  kind: 'creative_project' | 'service_request';
  brandName: string;
  serviceName: string;
  packageName: string | null;
  businessType: string | null;
  currentStage: string;
  currentStageLabel: string;
  progressPercent: number;
  assignedAiTeam: string[];
  deliveryDate: string | null;
  paymentStatus: string | null;
  filesUnlocked: boolean;
  reviewStatus: string | null;
  reviewToken: string | null;
  reviewUrl: string | null;
  portalPath: string;
  quotationStatus: string | null;
  quotationTotal: number | string | null;
  quotationCurrency: string | null;
  currency: string;
  total: number | string | null;
  createdAt: string;
  updatedAt: string;
  internalProjectId: number | null;
};

export type WorkspaceProjectDetail = {
  overview: WorkspaceProject & {
    targetMarket?: string;
    productOrService?: string;
    goal?: string;
    stylePreference?: string;
    colorPreference?: string;
  };
  timeline: { stage: string; label: string; completed: boolean; current: boolean }[];
  deliverables: {
    id: number;
    title: string;
    category: string | null;
    version: number;
    status: string;
    approvedBy: string | null;
    revisionNotes: string | null;
    locked: boolean;
    createdAt: string;
  }[];
  reviews: { status: string; sharedAt: string | null; createdAt: string }[];
  payments: { id: number; installmentLabel: string; amount: string; status: string; dueDate: string | null }[];
  invoices: { id: number; invoiceNumber: string; total: string; status: string; issuedAt: string | null }[];
  recommendations: string[];
  /** V4.0B — optional so older cached responses / tests without it don't break. */
  runtime?: RuntimeSnapshot;
};

export type RuntimeWorkerStatus = 'queued' | 'working' | 'completed' | 'failed' | 'blocked';

export type RuntimeWorkerSnapshot = {
  id: string;
  roleKey: string;
  displayName: string;
  department: string | null;
  specialty: string | null;
  stepId: number;
  stepName: string;
  status: RuntimeWorkerStatus;
  currentTask: string;
  provider: string | null;
  model: string | null;
  startedAt: string;
  completedAt: string | null;
  outputCount: number;
  isHuman: boolean;
  source: 'creative_workflow';
  isLive: true;
};

export type RuntimeCurrentTask = {
  stepId: number;
  stepName: string;
  taskLabel: string;
  workerRole: string;
  workerDisplayName: string;
  status: RuntimeWorkerStatus;
  startedAt: string;
  provider: string | null;
  model: string | null;
  lastUpdatedAt: string;
};

export type RuntimeSnapshot = {
  source: 'creative_workflow' | 'unavailable';
  isLive: boolean;
  workers: RuntimeWorkerSnapshot[];
  currentWorkerId: string | null;
  currentStepId: number | null;
  currentTask: RuntimeCurrentTask | null;
  lastUpdatedAt: string | null;
};

export type WorkspaceDownload = {
  id: number;
  title: string;
  category: string | null;
  projectNumber: string;
  projectName: string;
  version: number;
  status: string;
  approvedBy: string | null;
  revisionNotes: string | null;
  locked: boolean;
  createdAt: string;
  /** Page count — present for PDF document assets. */
  pageCount?: number | null;
  /** File size in bytes — present for PDF document assets. */
  fileSizeBytes?: number | null;
  /** Structured document type, e.g. "brand_strategy". */
  documentType?: string | null;
  /** MIME type of the asset. */
  mimeType?: string | null;
  /** Slide count — present for PPTX presentation assets. */
  slideCount?: number | null;
};

export type WorkspaceInvoice = {
  id: number;
  invoiceNumber: string;
  projectNumber: string | null;
  invoiceType: string;
  currency: string;
  amount: string;
  status: string;
  issuedAt: string | null;
  dueDate: string | null;
  paidAt: string | null;
  paymentScheduleId: number | null;
  scheduleStatus: string | null;
  scheduleReference: string | null;
  proofImageUrl: string | null;
};

export type WorkspaceBrandKit = {
  projectNumber: string;
  brandName: string;
  colorPalette: string | null;
  typography: string | null;
  visualStyle: Record<string, unknown> | null;
  brandVoice: Record<string, unknown> | null;
  targetAudience: string | null;
  logos: { id: number; title: string; locked: boolean }[];
};

export type WorkspaceNotification = {
  key: string;
  category: string;
  title: string;
  message: string;
  projectNumber: string | null;
  isRead: boolean;
  createdAt: string;
};

export type WorkspaceActivity = {
  action: string;
  label: string;
  resourceId: string | null;
  status: string;
  createdAt: string;
};

export type WorkspaceProfile = {
  clientEmail: string;
  clientName: string;
  companyName: string | null;
  address: string | null;
  picName: string | null;
  picPhone: string | null;
  billingEmail: string | null;
  taxId: string | null;
  paymentMethodNotes: string | null;
  brandPreferences: string | null;
};

export type SupportTicket = {
  id: number;
  subject: string;
  message: string;
  category: string;
  projectId: string | null;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export function useWorkspaceSummary(token: string) {
  return useQuery({
    queryKey: ['workspace-summary', token],
    queryFn: ({ signal }) => customFetch<WorkspaceSummary>(`${base(token)}/summary`, { signal }),
    enabled: !!token,
  });
}

export function useWorkspaceProjects(token: string, filters: { search?: string; status?: string; sort?: string } = {}) {
  const qs = new URLSearchParams();
  if (filters.search) qs.set('search', filters.search);
  if (filters.status) qs.set('status', filters.status);
  if (filters.sort) qs.set('sort', filters.sort);
  const query = qs.toString();
  return useQuery({
    queryKey: ['workspace-projects', token, filters],
    queryFn: ({ signal }) => customFetch<{ items: WorkspaceProject[]; total: number }>(`${base(token)}/projects${query ? `?${query}` : ''}`, { signal }),
    enabled: !!token,
  });
}

export function useWorkspaceProjectDetail(token: string, projectNumber: string) {
  return useQuery({
    queryKey: ['workspace-project-detail', token, projectNumber],
    queryFn: ({ signal }) => customFetch<WorkspaceProjectDetail>(`${base(token)}/projects/${projectNumber}`, { signal }),
    enabled: !!token && !!projectNumber,
  });
}

export function useWorkspaceDownloads(token: string, filters: { category?: string; search?: string } = {}) {
  const qs = new URLSearchParams();
  if (filters.category) qs.set('category', filters.category);
  if (filters.search) qs.set('search', filters.search);
  const query = qs.toString();
  return useQuery({
    queryKey: ['workspace-downloads', token, filters],
    queryFn: ({ signal }) => customFetch<{ items: WorkspaceDownload[]; total: number }>(`${base(token)}/downloads${query ? `?${query}` : ''}`, { signal }),
    enabled: !!token,
  });
}

export function useSignDownload(token: string) {
  return useMutation({
    mutationFn: async (assetId: number) => {
      return customFetch<{ downloadUrl: string; expiresAt: string }>(`${base(token)}/downloads/${assetId}/sign`, { method: 'POST' });
    },
  });
}

export function useWorkspaceBrandKit(token: string) {
  return useQuery({
    queryKey: ['workspace-brand-kit', token],
    queryFn: ({ signal }) => customFetch<{ items: WorkspaceBrandKit[]; total: number }>(`${base(token)}/brand-kit`, { signal }),
    enabled: !!token,
  });
}

export function useWorkspaceInvoices(token: string, status?: string) {
  const qs = status ? `?status=${status}` : '';
  return useQuery({
    queryKey: ['workspace-invoices', token, status],
    queryFn: ({ signal }) => customFetch<{ items: WorkspaceInvoice[]; total: number }>(`${base(token)}/invoices${qs}`, { signal }),
    enabled: !!token,
  });
}

export function useWorkspaceNotifications(token: string, filters: { category?: string; read?: string } = {}) {
  const qs = new URLSearchParams();
  if (filters.category) qs.set('category', filters.category);
  if (filters.read) qs.set('read', filters.read);
  const query = qs.toString();
  return useQuery({
    queryKey: ['workspace-notifications', token, filters],
    queryFn: ({ signal }) => customFetch<{ items: WorkspaceNotification[]; total: number; unreadCount: number }>(`${base(token)}/notifications${query ? `?${query}` : ''}`, { signal }),
    enabled: !!token,
    refetchInterval: 30000,
  });
}

export function useMarkNotificationRead(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (key: string) => customFetch(`${base(token)}/notifications/read`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
    }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace-notifications', token] }),
  });
}

export function useMarkAllNotificationsRead(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => customFetch(`${base(token)}/notifications/read-all`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace-notifications', token] }),
  });
}

export function useWorkspaceActivity(token: string) {
  return useQuery({
    queryKey: ['workspace-activity', token],
    queryFn: ({ signal }) => customFetch<{ items: WorkspaceActivity[]; total: number }>(`${base(token)}/activity`, { signal }),
    enabled: !!token,
  });
}

export function useWorkspaceProfile(token: string) {
  return useQuery({
    queryKey: ['workspace-profile', token],
    queryFn: ({ signal }) => customFetch<WorkspaceProfile>(`${base(token)}/profile`, { signal }),
    enabled: !!token,
  });
}

export function useUpdateWorkspaceProfile(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<WorkspaceProfile>) => customFetch<WorkspaceProfile>(`${base(token)}/profile`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(patch),
    }),
    onSuccess: (data) => qc.setQueryData(['workspace-profile', token], data),
  });
}

export function useSupportTickets(token: string) {
  return useQuery({
    queryKey: ['workspace-support-tickets', token],
    queryFn: ({ signal }) => customFetch<{ items: SupportTicket[]; total: number }>(`${base(token)}/support/tickets`, { signal }),
    enabled: !!token,
  });
}

export function useCreateSupportTicket(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { subject: string; message: string; category?: string; projectNumber?: string }) =>
      customFetch<SupportTicket>(`${base(token)}/support/tickets`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data),
      }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['workspace-support-tickets', token] }),
  });
}

export function useSubmitPaymentProof(token: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ scheduleId, reference, proofImageBase64, proofImageMimeType }: {
      scheduleId: number;
      reference: string;
      proofImageBase64?: string | null;
      proofImageMimeType?: string;
    }) =>
      customFetch<{ ok: boolean; schedule: unknown; proofImageUrl: string | null }>(`/api/public/payments/${scheduleId}/submit-proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference, proofImageBase64: proofImageBase64 ?? null, proofImageMimeType: proofImageMimeType ?? 'image/jpeg' }),
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['workspace-invoices', token] });
      qc.invalidateQueries({ queryKey: ['workspace-summary', token] });
    },
  });
}

export function useRepeatOrder(token: string) {
  return useMutation({
    mutationFn: ({ projectNumber, mode }: { projectNumber: string; mode: 'similar' | 'duplicate' | 'use_brief' }) =>
      customFetch<{ prefill: Record<string, unknown>; redirectTo: string }>(`${base(token)}/projects/${projectNumber}/repeat-order`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode }),
      }),
  });
}
