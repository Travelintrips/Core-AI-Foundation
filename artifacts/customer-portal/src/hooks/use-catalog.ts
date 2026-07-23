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
  visibility?: string;
  commercialStatus?: string;
  isFeatured?: boolean;
  startingPriceOverride?: string | null;
  serviceCount?: number;
  exampleOutputs?: string[];
  startingPrice?: string | null;
  services?: CatalogService[];
};

export type CatalogService = {
  id: number;
  categoryId: number;
  serviceCode: string;
  serviceName: string;
  shortDescription: string;
  fullDescription: string;
  // fixed_price = Standard checkout (no quotation) | custom_project | enterprise
  serviceFlow: 'fixed_price' | 'custom_project' | 'enterprise';
  pricingModel: string;
  startingPrice: string;
  currency: string;
  estimatedDelivery: string;
  humanReview: boolean;
  deliverables: string[] | null;
  legacyCategoryId?: number;
  parentCategoryId?: number | null;
  aliases?: string[] | null;
  displayAsPrimary?: boolean;
  displayOrder?: number;
  isFeatured?: boolean;
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
  // full_payment | deposit | subscription | purchase_order
  paymentPolicy: string;
  depositPercentage: number;
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

// Customer portal must only ever see publicly-visible categories/services
// (Creative AI today). This hits the public, unauthenticated endpoint —
// never the internal /api/ai/catalog/categories admin endpoint.
export function usePublicCatalog() {
  return useQuery({
    queryKey: ['catalog', 'public'],
    queryFn: ({ signal }) =>
      customFetch<{ categories: ServiceCategory[]; services: CatalogService[] }>('/api/ai/catalog/public', { signal }),
  });
}

export function useCategories() {
  const { data, ...rest } = usePublicCatalog();
  return { ...rest, data: data?.categories };
}

export function useServices(categoryId?: number) {
  const { data, ...rest } = usePublicCatalog();
  const filtered = data?.services.filter((s) => !categoryId || s.categoryId === categoryId);
  return { ...rest, data: filtered };
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

export type PricingLineItem = {
  code: string;
  label: string;
  amount: number;
};

export type ServiceRequestDetail = {
  id: number;
  requestId: string;
  serviceId: number;
  serviceFlow: 'fixed_price' | 'custom_project' | 'enterprise';
  createdProjectId: string | null;
  packageId: number | null;
  customerName: string;
  customerEmail: string;
  companyName: string | null;
  currency: string;
  subtotal: string;
  rushFee: string;
  revisionFee: string;
  humanReviewFee: string;
  additionalServiceFee: string;
  discount: string;
  tax: string;
  total: string;
  status: string;
  briefJson: Record<string, unknown> | null;
  completionNotes: string | null;
  completionLinks: Array<{ label: string; url: string }> | null;
  createdAt: string;
  pricingBreakdown: {
    basePrice: number | null;
    lineItems: PricingLineItem[];
    taxPercent: number;
  } | null;
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

// ── Checkout (Standard / fixed_price flow — no quotation) ─────────────────────

export type PaymentScheduleRow = {
  id: number;
  projectId: number;
  paymentType: string;
  percentage: number | null;
  amount: string;
  currency: string;
  status: string;
  reference: string | null;
};

export type CheckoutResponse = {
  ok: boolean;
  alreadyCreated?: boolean;
  createdProjectId: string;
  paymentPolicy: string;
  schedule: PaymentScheduleRow[];
};

export function useCheckout() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId }: { requestId: string }) =>
      customFetch<CheckoutResponse>(`/api/public/catalog/requests/${requestId}/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['catalog', 'request', vars.requestId] });
    },
  });
}

export function useSubmitPaymentProof() {
  return useMutation({
    mutationFn: ({ scheduleId, reference }: { scheduleId: number; reference: string }) =>
      customFetch<{ ok: boolean; schedule: PaymentScheduleRow }>(`/api/public/payments/${scheduleId}/submit-proof`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reference }),
      }),
  });
}

export function useStartBrief() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ requestId }: { requestId: string }) =>
      customFetch<{ ok: boolean; status: string }>(`/api/public/catalog/requests/${requestId}/start-brief`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
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
      customFetch<{ quotation: ServiceQuotation; items: ServiceQuotationItem[]; requestStatus: string | null; gateStatus: string | null }>(
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
      // Approving also advances the underlying service request's status
      // (ai_service_requests.status -> "approved"), which the
      // request-pricing page reads via useRequestDetail. Without this the
      // pricing/status page keeps showing stale data until it happens to
      // refetch on its own.
      queryClient.invalidateQueries({ queryKey: ['catalog', 'request'] });
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
      queryClient.invalidateQueries({ queryKey: ['catalog', 'request'] });
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
      queryClient.invalidateQueries({ queryKey: ['catalog', 'request'] });
    },
  });
}
