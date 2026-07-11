import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CatalogService } from './use-catalog';

async function customFetch<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let message = `Request failed: ${res.status} ${res.statusText}`;
    let body: unknown = null;
    try {
      body = await res.json();
      if (body && typeof body === 'object' && 'error' in body) message = String((body as { error: unknown }).error);
    } catch { /* ignore */ }
    const err = new Error(message) as Error & { status?: number; body?: unknown };
    err.status = res.status;
    err.body = body;
    throw err;
  }
  return res.json() as Promise<T>;
}

// ── Types ──────────────────────────────────────────────────────────────────────

export type PortfolioGalleryItem = {
  type: 'image' | 'video' | 'pdf' | 'mockup' | 'brand_guideline' | 'presentation' | 'packaging' | 'company_profile';
  url: string;
  caption?: string;
};

export type PortfolioWorkflowStep = { step: string; label: string };

export type Portfolio = {
  id: number;
  serviceId: number;
  title: string;
  industry: string;
  style: string;
  colorTags: string[] | null;
  businessSize: string;
  packageLabel: string | null;
  description: string | null;
  coverImage: string | null;
  galleryJson: PortfolioGalleryItem[] | null;
  beforeImage: string | null;
  afterImage: string | null;
  deliverablesJson: string[] | null;
  toolsUsedJson: string[] | null;
  workflowJson: PortfolioWorkflowStep[] | null;
  deliveryTime: string | null;
  rating: string | null;
  views: number;
  completedProjects: number;
  featured: boolean;
  status: string;
  displayOrder: number;
};

export type PortfolioReview = {
  id: number;
  serviceId: number;
  portfolioId: number | null;
  rating: number;
  review: string;
  company: string;
  industry: string | null;
  clientName: string | null;
  featured: boolean;
  status: string;
};

export type ServiceFaq = {
  id: number;
  serviceId: number;
  question: string;
  answer: string;
  displayOrder: number;
  status: string;
};

export type ServiceShowcase = {
  service: CatalogService;
  portfolios: Portfolio[];
  reviews: PortfolioReview[];
  faqs: ServiceFaq[];
  relatedServices: CatalogService[];
  stats: { totalProjects: number; avgRating: number | null; reviewCount: number };
};

// ── Showcase bundle ────────────────────────────────────────────────────────────

export function useServiceShowcase(serviceId: number | undefined) {
  return useQuery({
    enabled: !!serviceId,
    queryKey: ['portfolio', 'showcase', serviceId],
    queryFn: ({ signal }) => customFetch<ServiceShowcase>(`/api/ai/portfolio/services/${serviceId}/showcase`, { signal }),
  });
}

export function useRecordPortfolioView() {
  return useMutation({
    mutationFn: (portfolioId: number) =>
      customFetch<{ views: number }>(`/api/ai/portfolio/portfolios/${portfolioId}/view`, { method: 'POST' }),
  });
}

// ── Live AI Preview ────────────────────────────────────────────────────────────

export const LIVE_PREVIEW_MAX = 2;
const SESSION_ID_KEY = 'ai-showcase-session-id';

export function getOrCreateSessionId(): string {
  let id = localStorage.getItem(SESSION_ID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(SESSION_ID_KEY, id);
  }
  return id;
}

export type LivePreviewInput = {
  serviceId: number;
  companyName: string;
  industry: string;
  style: string;
  primaryColor?: string;
  secondaryColor?: string;
  shortDescription?: string;
};

export type LivePreviewConcept = {
  name: string;
  style_explanation: string;
  reasoning: string;
  color_recommendation: { primary: string; secondary: string; accent?: string };
  typography_recommendation: { heading: string; body: string };
  rating: number;
  imageDataUrl: string | null;
};

export type LivePreview = {
  id: number;
  sessionId: string;
  serviceId: number;
  companyName: string;
  industry: string;
  style: string;
  status: 'generating' | 'ready' | 'failed' | 'converted';
  conceptA: LivePreviewConcept | null;
  conceptB: LivePreviewConcept | null;
  selectedConcept: 'A' | 'B' | null;
  errorMessage: string | null;
};

export function usePreviewSessionUsage() {
  const sessionId = getOrCreateSessionId();
  return useQuery({
    queryKey: ['portfolio', 'preview-usage', sessionId],
    queryFn: ({ signal }) =>
      customFetch<{ used: number; limit: number; remaining: number }>(
        `/api/ai/portfolio/preview/session/${sessionId}/count`,
        { signal },
      ),
  });
}

export function useStartLivePreview() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: LivePreviewInput) =>
      customFetch<{ id: number; status: string; remaining: number }>('/api/ai/portfolio/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...input, sessionId: getOrCreateSessionId() }),
      }),
    onSuccess: () => {
      const sessionId = getOrCreateSessionId();
      queryClient.invalidateQueries({ queryKey: ['portfolio', 'preview-usage', sessionId] });
    },
  });
}

export function useLivePreview(previewId: number | undefined, opts?: { poll?: boolean }) {
  return useQuery({
    enabled: !!previewId,
    queryKey: ['portfolio', 'preview', previewId],
    queryFn: ({ signal }) => customFetch<LivePreview>(`/api/ai/portfolio/preview/${previewId}`, { signal }),
    refetchInterval: (query) => {
      if (!opts?.poll) return false;
      const status = query.state.data?.status;
      return status === 'generating' ? 1800 : false;
    },
  });
}

export type ContinueConceptResult = {
  previewId: number;
  serviceId: number;
  selectedConcept: 'A' | 'B';
  conceptData: LivePreviewConcept;
  seed: { brandName: string; businessType: string; stylePreference: string; notes: string };
};

export function useContinueLivePreview() {
  return useMutation({
    mutationFn: ({ previewId, concept }: { previewId: number; concept: 'A' | 'B' }) =>
      customFetch<ContinueConceptResult>(`/api/ai/portfolio/preview/${previewId}/continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ concept }),
      }),
  });
}
