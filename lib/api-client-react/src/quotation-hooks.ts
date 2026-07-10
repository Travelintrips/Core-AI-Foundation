/**
 * Quotation (price offer) admin hooks — manual, not orval-generated.
 * Follows the same conventions as cluster-hooks.ts / marketplace-hooks.ts.
 */
import {
  useQuery,
  useMutation,
  type UseQueryOptions,
  type UseMutationOptions,
  type QueryKey,
  type UseQueryResult,
} from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface QuotationLineItemInput {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Quotation {
  id: number;
  projectId: string;
  currency: string;
  lineItems: QuotationLineItemInput[];
  discount: number;
  taxPercent: number;
  subtotal: number;
  taxAmount: number;
  total: number;
  notes: string | null;
  validUntil: string | null;
  status: "draft" | "sent" | "approved" | "rejected" | "expired";
  sentAt: string | null;
  respondedAt: string | null;
  responseNotes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SaveQuotationInput {
  projectId: string;
  data: {
    lineItems: QuotationLineItemInput[];
    discount?: number;
    taxPercent?: number;
    currency?: string;
    notes?: string;
    validUntil?: string;
  };
}

// ── Query key factories ────────────────────────────────────────────────────────

export const getProjectQuotationQueryKey = (projectId: string) =>
  [`/api/creative-ai/projects/${projectId}/quotation`] as const;

// ── Fetchers ──────────────────────────────────────────────────────────────────

export const getProjectQuotation = (projectId: string): Promise<Quotation | null> =>
  customFetch<Quotation>(`/api/creative-ai/projects/${projectId}/quotation`).catch((err) => {
    if (err?.status === 404) return null;
    throw err;
  });

export const saveProjectQuotation = ({ projectId, data }: SaveQuotationInput): Promise<Quotation> =>
  customFetch<Quotation>(`/api/creative-ai/projects/${projectId}/quotation`, {
    method: "PUT",
    body: JSON.stringify(data),
  });

export const sendProjectQuotation = (projectId: string): Promise<Quotation> =>
  customFetch<Quotation>(`/api/creative-ai/projects/${projectId}/quotation/send`, { method: "POST" });

// ── Query hooks ────────────────────────────────────────────────────────────────

export function useGetProjectQuotation<TData = Quotation | null, TError = unknown>(
  projectId: string,
  options?: { query?: UseQueryOptions<Quotation | null, TError, TData> },
): UseQueryResult<TData, TError> & { queryKey: QueryKey } {
  const { query: queryOptions } = options ?? {};
  const queryKey = queryOptions?.queryKey ?? getProjectQuotationQueryKey(projectId);
  const queryFn = () => getProjectQuotation(projectId);
  const q = useQuery({ queryKey, queryFn, enabled: !!projectId, ...queryOptions }) as UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
  };
  q.queryKey = queryKey;
  return q;
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export const useSaveProjectQuotation = <TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Quotation, TError, SaveQuotationInput, TContext> },
) =>
  useMutation<Quotation, TError, SaveQuotationInput, TContext>({
    mutationFn: saveProjectQuotation,
    ...options?.mutation,
  });

export const useSendProjectQuotation = <TError = unknown, TContext = unknown>(
  options?: { mutation?: UseMutationOptions<Quotation, TError, string, TContext> },
) =>
  useMutation<Quotation, TError, string, TContext>({
    mutationFn: sendProjectQuotation,
    ...options?.mutation,
  });
