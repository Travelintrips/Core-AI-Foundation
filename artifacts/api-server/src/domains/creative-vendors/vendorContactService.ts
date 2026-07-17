/**
 * vendorContactService.ts — Team 22 / Creative Vendor Ecosystem
 *
 * DOMAIN MAPPING REVIEW — Team 23 Audit Remediation
 * Status: BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING
 *
 * FINDING: creative_vendor_contact_requests has no direct duplicate, but
 *   the platform's inquiry/lead capture mechanism is pending canonical review.
 *   Closest existing concepts:
 *     - ai_quotations (structured service purchase intent)
 *     - service_request flow (formal service engagement)
 *
 * INTEGRATION CONTRACT (for Team 24 architecture review):
 *   Option A: Extend ai_quotations with vendorProfileId column —
 *     a vendor inquiry becomes a lightweight quotation request.
 *
 *   Option B: New ai_vendor_inquiries table anchored to marketplace_creators —
 *     if the contact flow is lighter-weight than a quotation.
 *
 *   Option C: Reuse ai_quotations + inquiry_type discriminator.
 *
 * SECURITY NOTE (preserved for architecture review):
 *   - Requester identity must be hashed (SHA-256) before storage — no PII in DB
 *   - Rate limiting: max N contact requests per email hash per vendor per 24h
 *   - Deduplication: (vendor_id, requester_email_hash) within rolling window
 *   - Terminal state guard: once accepted/declined, status is immutable
 *   - Vendor contact info (whatsapp/email) revealed only on accepted status
 *
 * ALL FUNCTIONS IN THIS FILE THROW BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING.
 */

export class VendorContactBlockedError extends Error {
  readonly code = "BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING";
  readonly domain = "contact_requests";
  readonly options = ["ai_quotations", "ai_vendor_inquiries", "quotation+discriminator"];

  constructor(fn: string) {
    super(
      `${fn}: BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING — ` +
        `contact request canonical source pending architecture review. ` +
        `Options: ai_quotations extension, ai_vendor_inquiries new table, ` +
        `or quotation+discriminator pattern. See vendorContactService.ts header.`,
    );
    this.name = "VendorContactBlockedError";
  }
}

/** Stub — BLOCKED. Pending canonical contact/inquiry mapping. */
export async function submitContactRequest(
  _vendorId: number,
  _input: unknown,
): Promise<never> {
  throw new VendorContactBlockedError("submitContactRequest");
}

/** Stub — BLOCKED. Pending canonical contact/inquiry mapping. */
export async function getMyContactRequests(
  _requesterEmailHash: string,
  _page?: number,
  _pageSize?: number,
): Promise<never> {
  throw new VendorContactBlockedError("getMyContactRequests");
}

/** Stub — BLOCKED. Pending canonical contact/inquiry mapping. */
export async function listContactRequestsAdmin(
  _vendorId?: number,
  _status?: string,
  _page?: number,
  _pageSize?: number,
): Promise<never> {
  throw new VendorContactBlockedError("listContactRequestsAdmin");
}

/** Stub — BLOCKED. Pending canonical contact/inquiry mapping. */
export async function updateContactRequestStatus(
  _id: number,
  _status: "accepted" | "declined",
  _vendorResponse?: string,
): Promise<never> {
  throw new VendorContactBlockedError("updateContactRequestStatus");
}
