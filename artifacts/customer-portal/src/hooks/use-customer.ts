import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

/** Lightweight fetch wrapper — throws on non-2xx responses with JSON error body */
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

// Custom types mapping to our needs, matching the endpoints
export type CustomerProjectSubmission = {
  clientName: string;
  clientEmail: string;
  clientPhone?: string;
  brandName: string;
  businessType: string;
  productOrService: string;
  targetMarket: string;
  stylePreference?: string;
  colorPreference?: string;
  referenceLinks?: string;
  goal: string;
  notes?: string;
  deadline?: string;
};

export type CustomerSubmissionResult = {
  reviewToken: string;
  dashboardToken: string;
};

export type CustomerDashboardProject = {
  projectId: string;
  brandName: string;
  businessType: string;
  productOrService: string;
  goal: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  reviewStatus: 'not_shared' | 'shared' | 'viewed' | 'approved' | 'rejected' | 'revision_requested';
  reviewToken: string;
  reviewUrl: string;
  deadline?: string;
  hasResult: boolean;
  assetCount: number;
  quotationStatus?: 'sent' | 'approved' | 'rejected' | 'expired' | null;
  quotationTotal?: number | null;
  quotationCurrency?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type QuotationLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
};

export type PublicQuotation = {
  id: number;
  projectId: string;
  brandName: string;
  clientName: string;
  projectStatus: string;
  currency: string;
  lineItems: QuotationLineItem[];
  discount: number;
  taxPercent: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  notes: string | null;
  validUntil: string | null;
  status: 'sent' | 'approved' | 'rejected' | 'expired';
  sentAt: string | null;
  respondedAt: string | null;
};

export type CustomerDashboard = {
  clientName: string;
  clientEmail: string;
  projects: CustomerDashboardProject[];
  totalProjects: number;
  pendingReview: number;
  approved: number;
};

export type PublicAsset = {
  id: number;
  imageUrl: string;
  thumbnailUrl?: string;
  aspectRatio: string;
  status: string;
};

export type ClientComment = {
  id: number;
  reviewId: number;
  projectId: string;
  assetId?: number;
  authorName: string;
  authorType: 'client' | 'internal' | 'agent';
  comment: string;
  status: string;
  createdAt: string;
  updatedAt: string;
};

export type PublicProjectReview = {
  reviewId: number;
  projectId: string;
  clientName: string;
  reviewStatus: 'shared' | 'viewed' | 'approved' | 'rejected' | 'revision_requested';
  brandName: string;
  businessType: string;
  targetMarket: string;
  productOrService: string;
  stylePreference?: string;
  goal: string;
  status: string;
  copyOutput?: string;
  creativeDirection?: string;
  assets: PublicAsset[];
  comments: ClientComment[];
  createdAt: string;
};

export const useSubmitCustomerProject = () => {
  return useMutation({
    mutationFn: async ({ data }: { data: CustomerProjectSubmission }) => {
      return customFetch<CustomerSubmissionResult>('/api/public/customer/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }
  });
};

export const useRequestCustomerAccess = () => {
  return useMutation({
    mutationFn: async ({ data }: { data: { email: string } }) => {
      return customFetch<{ dashboardToken: string; dashboardUrl: string; clientEmail: string; projectCount: number }>('/api/public/customer/request-access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    }
  });
};

export const useGetCustomerDashboard = (dashboardToken: string) => {
  return useQuery({
    queryKey: ['customer-dashboard', dashboardToken],
    queryFn: async ({ signal }) => {
      return customFetch<CustomerDashboard>(`/api/public/customer/dashboard/${dashboardToken}`, { signal });
    },
    enabled: !!dashboardToken,
  });
};

export const useGetPublicCreativeReview = (token: string) => {
  return useQuery({
    queryKey: ['creative-review', token],
    queryFn: async ({ signal }) => {
      return customFetch<PublicProjectReview>(`/api/public/creative-review/${token}`, { signal });
    },
    enabled: !!token,
    refetchInterval: (query) => {
      const data = query.state.data;
      if (data?.status === 'running' || data?.status === 'pending') {
        return 3000;
      }
      return false;
    }
  });
};

export const useAddClientComment = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ token, data }: { token: string; data: { comment: string; authorName: string; assetId?: number } }) => {
      return customFetch<ClientComment>(`/api/public/creative-review/${token}/comment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data, variables) => {
      queryClient.setQueryData<PublicProjectReview>(['creative-review', variables.token], (old) => {
        if (!old) return old;
        return {
          ...old,
          comments: [...old.comments, data]
        };
      });
    }
  });
};

export const useApproveCreativeReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ token, data }: { token: string; data: { notes?: string } }) => {
      return customFetch<{ success: boolean; status: string }>(`/api/public/creative-review/${token}/approve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {}),
      });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['creative-review', variables.token] });
    }
  });
};

export const useRejectCreativeReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ token, data }: { token: string; data: { notes?: string } }) => {
      return customFetch<{ success: boolean; status: string }>(`/api/public/creative-review/${token}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {}),
      });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['creative-review', variables.token] });
    }
  });
};

export const useRequestRevisionCreativeReview = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ token, data }: { token: string; data: { notes: string } }) => {
      return customFetch<{ success: boolean; status: string }>(`/api/public/creative-review/${token}/request-revision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
    },
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['creative-review', variables.token] });
    }
  });
};

export const useGetPublicQuotation = (token: string) => {
  return useQuery({
    queryKey: ['quotation', token],
    queryFn: async ({ signal }) => {
      return customFetch<PublicQuotation>(`/api/public/customer/quotation/${token}`, { signal });
    },
    enabled: !!token,
  });
};

export const useApproveQuotation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ token }: { token: string }) => {
      return customFetch<{ success: boolean; status: string; message: string }>(`/api/public/customer/quotation/${token}/approve`, {
        method: 'POST',
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['quotation', variables.token] });
    }
  });
};

export const useRejectQuotation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ token, data }: { token: string; data?: { notes?: string } }) => {
      return customFetch<{ success: boolean; status: string; message: string }>(`/api/public/customer/quotation/${token}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {}),
      });
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['quotation', variables.token] });
    }
  });
};
