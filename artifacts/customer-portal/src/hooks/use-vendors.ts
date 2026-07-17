/**
 * use-vendors.ts — Team 22 / Creative Vendor Ecosystem
 * React Query hooks for all /public/creative-vendors/* endpoints.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

// ── Base URL helper ───────────────────────────────────────────────────────────
const BASE = import.meta.env.BASE_URL?.replace(/\/$/, '') ?? '';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const b = await res.json();
      if (b?.error) msg = String(b.error);
    } catch { /* */ }
    const e = new Error(msg) as Error & { status?: number };
    e.status = res.status;
    throw e;
  }
  return res.json() as Promise<T>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type VendorType =
  | 'graphic_designer' | 'printing' | 'interior_designer' | 'furniture'
  | 'lighting' | 'flooring' | 'curtain' | 'kitchen' | 'custom_furniture'
  | 'textile' | 'konveksi' | 'embroidery' | 'apparel_printing' | 'packaging'
  | 'product_mockup' | 'photographer' | 'videographer';

export const VENDOR_TYPE_LABELS: Record<VendorType, string> = {
  graphic_designer: 'Graphic Designer',
  printing: 'Percetakan',
  interior_designer: 'Interior Designer',
  furniture: 'Furniture',
  lighting: 'Lighting',
  flooring: 'Flooring',
  curtain: 'Korden & Curtain',
  kitchen: 'Kitchen Set',
  custom_furniture: 'Custom Furniture',
  textile: 'Tekstil',
  konveksi: 'Konveksi',
  embroidery: 'Bordir & Sulam',
  apparel_printing: 'Apparel Printing',
  packaging: 'Packaging',
  product_mockup: 'Product Mockup',
  photographer: 'Fotografer',
  videographer: 'Videografer',
};

export interface PublicVendorCard {
  id: number;
  vendorCode: string;
  displayName: string;
  brandName: string | null;
  vendorType: VendorType;
  shortBio: string | null;
  logoUrl: string | null;
  coverUrl: string | null;
  city: string | null;
  province: string | null;
  country: string;
  contactWhatsapp: string | null;
  contactEmail: string | null;
  websiteUrl: string | null;
  instagramUrl: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  priceCurrency: string | null;
  leadTimeDays: number;
  isAvailableNow: boolean;
  isVerified: boolean;
  isFeatured: boolean;
  avgRating: string;
  totalRatings: number;
  createdAt: string;
}

export interface VendorDetailPublic extends PublicVendorCard {
  description: string | null;
  galleryJson: Array<{ url: string; caption?: string }> | null;
  serviceAreas: Array<{ province: string; city: string | null; isRemote: boolean }>;
  capabilities: Array<{
    capabilityName: string;
    proficiencyLevel: string;
    yearsExperience: number | null;
    toolsJson: string[] | null;
  }>;
  certifications: Array<{
    certificationName: string;
    issuer: string | null;
    issuedAt: string | null;
    expiresAt: string | null;
  }>;
  recentRatings: Array<{
    rating: number;
    review: string | null;
    projectContext: string | null;
    createdAt: string;
  }>;
}

export interface VendorPortfolioItem {
  id: number;
  vendorId: number;
  title: string;
  description: string | null;
  category: string | null;
  coverImageUrl: string | null;
  galleryJson: Array<{ url: string; caption?: string }> | null;
  clientIndustry: string | null;
  projectDurationDays: number | null;
  tagsJson: string[] | null;
  isFeatured: boolean;
  displayOrder: number;
  createdAt: string;
}

export interface ScoredVendor {
  vendor: PublicVendorCard;
  compatibilityScore: number;
  scoreBreakdown: {
    categoryMatch: number;
    areaMatch: number;
    availability: number;
    rating: number;
    verification: number;
  };
  matchReasons: string[];
}

export interface ContactRequestPublic {
  id: number;
  vendorId: number;
  status: string;
  projectDescription: string;
  budgetRange: string | null;
  preferredStartDate: string | null;
  vendorResponse: string | null;
  respondedAt: string | null;
  createdAt: string;
  revealedContact?: {
    whatsapp: string | null;
    email: string | null;
    websiteUrl: string | null;
  } | null;
}

export interface VendorSearchParams {
  q?: string;
  vendorType?: VendorType;
  province?: string;
  city?: string;
  isAvailableNow?: boolean;
  isVerified?: boolean;
  isFeatured?: boolean;
  maxLeadTimeDays?: number;
  sort?: 'rating' | 'newest' | 'lead_time' | 'featured';
  page?: number;
  pageSize?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks — Public
// ─────────────────────────────────────────────────────────────────────────────

export function useVendors(params: VendorSearchParams = {}) {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.vendorType) qs.set('vendorType', params.vendorType);
  if (params.province) qs.set('province', params.province);
  if (params.city) qs.set('city', params.city);
  if (params.isAvailableNow !== undefined) qs.set('isAvailableNow', String(params.isAvailableNow));
  if (params.isVerified !== undefined) qs.set('isVerified', String(params.isVerified));
  if (params.isFeatured !== undefined) qs.set('isFeatured', String(params.isFeatured));
  if (params.maxLeadTimeDays !== undefined) qs.set('maxLeadTimeDays', String(params.maxLeadTimeDays));
  if (params.sort) qs.set('sort', params.sort);
  qs.set('page', String(params.page ?? 1));
  qs.set('pageSize', String(params.pageSize ?? 24));

  return useQuery({
    queryKey: ['vendors', params],
    queryFn: () =>
      fetchJson<{
        items: PublicVendorCard[];
        pagination: { page: number; pageSize: number; total: number; totalPages: number };
      }>(`${BASE}/api/public/creative-vendors?${qs}`),
  });
}

export function useVendorDetail(id: number | null) {
  return useQuery({
    queryKey: ['vendor', id],
    queryFn: () =>
      fetchJson<{ vendor: VendorDetailPublic }>(`${BASE}/api/public/creative-vendors/${id}`),
    enabled: id != null,
    select: (d) => d.vendor,
  });
}

export function useVendorPortfolio(vendorId: number | null) {
  return useQuery({
    queryKey: ['vendor-portfolio', vendorId],
    queryFn: () =>
      fetchJson<{ items: VendorPortfolioItem[] }>(
        `${BASE}/api/public/creative-vendors/${vendorId}/portfolio`,
      ),
    enabled: vendorId != null,
    select: (d) => d.items,
  });
}

export function useVendorRatings(vendorId: number | null, page = 1) {
  return useQuery({
    queryKey: ['vendor-ratings', vendorId, page],
    queryFn: () =>
      fetchJson<{ ratings: VendorDetailPublic['recentRatings'] }>(
        `${BASE}/api/public/creative-vendors/${vendorId}/ratings?page=${page}`,
      ),
    enabled: vendorId != null,
    select: (d) => d.ratings,
  });
}

export function useVendorCategories() {
  return useQuery({
    queryKey: ['vendor-categories'],
    queryFn: () =>
      fetchJson<{ categories: Array<{ vendorType: string; count: number }> }>(
        `${BASE}/api/public/creative-vendors/categories`,
      ),
    select: (d) => d.categories,
    staleTime: 5 * 60 * 1000,
  });
}

export function useVendorRecommendations(params: {
  vendorType: string;
  province?: string;
  maxLeadTimeDays?: number;
  isRemoteOk?: boolean;
  limit?: number;
}) {
  const qs = new URLSearchParams({ vendorType: params.vendorType });
  if (params.province) qs.set('province', params.province);
  if (params.maxLeadTimeDays) qs.set('maxLeadTimeDays', String(params.maxLeadTimeDays));
  if (params.isRemoteOk) qs.set('isRemoteOk', 'true');
  if (params.limit) qs.set('limit', String(params.limit));

  return useQuery({
    queryKey: ['vendor-recommendations', params],
    queryFn: () =>
      fetchJson<{ recommendations: ScoredVendor[] }>(
        `${BASE}/api/public/creative-vendors/recommend?${qs}`,
      ),
    enabled: !!params.vendorType,
    select: (d) => d.recommendations,
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Hooks — Workspace (token-gated)
// ─────────────────────────────────────────────────────────────────────────────

export function useMyContactRequests(token: string | undefined) {
  return useQuery({
    queryKey: ['my-contact-requests', token],
    queryFn: () =>
      fetchJson<{ requests: ContactRequestPublic[] }>(
        `${BASE}/api/public/customer/workspace/${token}/creative-vendors/my-requests`,
      ),
    enabled: !!token,
    select: (d) => d.requests,
  });
}

export function useSubmitContactRequest(token: string | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      vendorId: number;
      requesterName?: string;
      projectDescription: string;
      budgetRange?: string;
      preferredStartDate?: string;
    }) => {
      const { vendorId, ...body } = data;
      return fetchJson<{ contactRequest: ContactRequestPublic }>(
        `${BASE}/api/public/customer/workspace/${token}/creative-vendors/${vendorId}/contact`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
      );
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['my-contact-requests', token] });
    },
  });
}

export function useSubmitRating(vendorId: number | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: {
      clientEmailHash: string;
      rating: number;
      review?: string;
      projectContext?: string;
    }) =>
      fetchJson<unknown>(
        `${BASE}/api/public/creative-vendors/${vendorId}/ratings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['vendor-ratings', vendorId] });
      void qc.invalidateQueries({ queryKey: ['vendor', vendorId] });
    },
  });
}
