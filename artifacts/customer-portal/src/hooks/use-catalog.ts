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

export type ServiceCategory = {
  id: number;
  code: string;
  name: string;
  description: string | null;
  icon: string | null;
  displayOrder: number;
};

export type CatalogService = {
  id: number;
  categoryId: number;
  serviceCode: string;
  serviceName: string;
  shortDescription: string;
  fullDescription: string;
  pricingModel: string;
  startingPrice: string;
  currency: string;
  estimatedDelivery: string;
  humanReview: boolean;
  deliverables: string[] | null;
};

export type ServicePackage = {
  id: number;
  serviceId: number;
  packageName: string;
  packageType: string;
  monthlyPrice: string | null;
  yearlyPrice: string | null;
  oneTimePrice: string | null;
  featuresJson: string[] | null;
};

export type ServiceDetail = CatalogService & { packages: ServicePackage[] };

export type PricingBreakdown = {
  currency: string;
  basePrice: number;
  quantityAdjustment: number;
  rushFee: number;
  revisionFee: number;
  humanReviewFee: number;
  additionalServiceFee: number;
  discount: number;
  subtotal: number;
  taxPercent: number;
  tax: number;
  total: number;
  lineItems: { code: string; label: string; amount: number }[];
};

export type QuoteSelections = {
  packageId?: number;
  pricingModelSelected?: string;
  quantity?: number;
  rushSpeed?: '48h' | '24h' | 'same_day';
  humanReviewRequested?: boolean;
  extraRevisions?: number;
  bilingual?: boolean;
  editableSourceFile?: boolean;
  extendedUsageRights?: boolean;
};

export type ServiceRequestInput = QuoteSelections & {
  customerName: string;
  customerEmail: string;
  customerPhone?: string;
  companyName?: string;
  notes?: string;
};

export function useCategories() {
  return useQuery({
    queryKey: ['catalog', 'categories'],
    queryFn: ({ signal }) => customFetch<ServiceCategory[]>('/api/ai/catalog/categories', { signal }),
  });
}

export function useServices(categoryId?: number) {
  return useQuery({
    queryKey: ['catalog', 'services', categoryId ?? 'all'],
    queryFn: ({ signal }) =>
      customFetch<CatalogService[]>(`/api/ai/catalog/services${categoryId ? `?categoryId=${categoryId}` : ''}`, { signal }),
  });
}

export function useServiceDetail(serviceId: number | undefined) {
  return useQuery({
    enabled: !!serviceId,
    queryKey: ['catalog', 'service', serviceId],
    queryFn: ({ signal }) => customFetch<ServiceDetail>(`/api/ai/catalog/services/${serviceId}`, { signal }),
  });
}

export function useQuoteCalculator(serviceId: number | undefined) {
  return useMutation({
    mutationFn: (selections: QuoteSelections) =>
      customFetch<PricingBreakdown>(`/api/ai/catalog/services/${serviceId}/quote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(selections),
      }),
  });
}

export function useRequestService(serviceId: number | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: ServiceRequestInput) =>
      customFetch<{ requestId: string; total: string; currency: string; status: string }>(
        `/api/ai/catalog/services/${serviceId}/request`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['catalog', 'requests'] }),
  });
}

// ── Service Request Detail (public, by UUID) ──────────────────────────────────

export type ServiceRequestDetail = {
  id: number;
  requestId: string;
  serviceId: number;
  packageId: number | null;
  customerName: string;
  customerEmail: string;
  companyName: string | null;
  currency: string;
  subtotal: string;
  rushFee: string;
  revisionFee: string;
  humanReviewFee: string;
  discount: string;
  tax: string;
  total: string;
  status: string;
  briefJson: Record<string, unknown> | null;
  createdAt: string;
};

export function useRequestDetail(requestId: string | undefined) {
  return useQuery({
    enabled: !!requestId,
    queryKey: ['catalog', 'request', requestId],
    queryFn: ({ signal }) =>
      customFetch<ServiceRequestDetail>(`/api/public/catalog/requests/${requestId}`, { signal }),
  });
}

// ── Save Brief (public, by UUID) ──────────────────────────────────────────────

export function useSaveBrief() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId, brief }: { requestId: string; brief: Record<string, unknown> }) =>
      customFetch<{ ok: boolean; status: string }>(`/api/public/catalog/requests/${requestId}/brief`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brief }),
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['catalog', 'request', vars.requestId] });
    },
  });
}

// ── Service Quotation (ai_quotations, by token) ───────────────────────────────

export type ServiceQuotationItem = {
  id: number;
  quotationId: number;
  itemType: string;
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
  displayOrder: number;
};

export type ServiceQuotation = {
  id: number;
  quotationCode: string;
  serviceRequestId: number | null;
  customerName: string;
  customerEmail: string;
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: string;
  validUntil: string | null;
  issuedAt: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  revisionRequestedAt: string | null;
  revisionNotes: string | null;
};

export function useServiceQuotation(token: string | undefined) {
  return useQuery({
    enabled: !!token,
    queryKey: ['service-quotation', token],
    queryFn: ({ signal }) =>
      customFetch<{ quotation: ServiceQuotation; items: ServiceQuotationItem[] }>(
        `/api/public/quotations/${token}`,
        { signal },
      ),
  });
}

export function useApproveServiceQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ token }: { token: string }) =>
      customFetch<{ success: boolean; status: string }>(`/api/public/quotations/${token}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['service-quotation', vars.token] });
    },
  });
}

export function useRequestChangeServiceQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ token, notes }: { token: string; notes: string }) =>
      customFetch<{ success: boolean; status: string }>(`/api/public/quotations/${token}/request-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['service-quotation', vars.token] });
    },
  });
}

export function useRejectServiceQuotation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ token, notes }: { token: string; notes?: string }) =>
      customFetch<{ success: boolean; status: string }>(`/api/public/quotations/${token}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notes }),
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['service-quotation', vars.token] });
    },
  });
}
