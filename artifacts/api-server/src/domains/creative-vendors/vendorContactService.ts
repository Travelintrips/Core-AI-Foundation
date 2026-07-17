/**
 * vendorContactService.ts — Team 22 / Creative Vendor Ecosystem
 *
 * Contact request lifecycle:
 *   pending → accepted | declined
 *
 * On accepted: full contact info revealed to requester.
 * No automatic procurement, payment payout, or external messaging.
 */
import { eq, and, desc, sql } from "drizzle-orm";
import {
  vendorDb,
  vendorContactRequestsTable,
  vendorsTable,
  type VendorContactRequest,
} from "./schema.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

const TERMINAL_STATES = ["accepted", "declined"] as const;

export interface ContactRequestPublic {
  id: number;
  vendorId: number;
  status: string;
  projectDescription: string;
  budgetRange: string | null;
  preferredStartDate: string | null;
  vendorResponse: string | null;
  respondedAt: Date | null;
  createdAt: Date;
  // Only populated when status === 'accepted'
  revealedContact?: {
    whatsapp: string | null;
    email: string | null;
    websiteUrl: string | null;
  } | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Submit contact request (workspace-token-gated)
// ─────────────────────────────────────────────────────────────────────────────

export async function submitContactRequest(
  vendorId: number,
  requesterEmailHash: string,
  data: {
    requesterName?: string;
    projectDescription: string;
    budgetRange?: string;
    preferredStartDate?: string;
  },
): Promise<VendorContactRequest> {
  // Verify vendor exists and is approved
  const [vendor] = await vendorDb
    .select()
    .from(vendorsTable)
    .where(
      and(
        eq(vendorsTable.id, vendorId),
        eq(vendorsTable.moderationStatus, "approved"),
        eq(vendorsTable.status, "active"),
      ),
    );

  if (!vendor) throw new Error("Vendor not found or not available");

  const [row] = await vendorDb
    .insert(vendorContactRequestsTable)
    .values({
      vendorId,
      requesterEmailHash,
      requesterName: data.requesterName,
      projectDescription: data.projectDescription,
      budgetRange: data.budgetRange,
      preferredStartDate: data.preferredStartDate,
      status: "pending",
    })
    .returning();

  // Increment contact request counter
  await vendorDb
    .update(vendorsTable)
    .set({
      totalContactRequests: sql`total_contact_requests + 1`,
      updatedAt: new Date(),
    })
    .where(eq(vendorsTable.id, vendorId));

  return row!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Get contact requests for a requester (their own requests)
// ─────────────────────────────────────────────────────────────────────────────

export async function getMyContactRequests(
  requesterEmailHash: string,
): Promise<ContactRequestPublic[]> {
  const rows = await vendorDb
    .select({
      req: vendorContactRequestsTable,
      whatsapp: vendorsTable.whatsapp,
      email: vendorsTable.email,
      websiteUrl: vendorsTable.websiteUrl,
    })
    .from(vendorContactRequestsTable)
    .innerJoin(vendorsTable, eq(vendorContactRequestsTable.vendorId, vendorsTable.id))
    .where(eq(vendorContactRequestsTable.requesterEmailHash, requesterEmailHash))
    .orderBy(desc(vendorContactRequestsTable.createdAt));

  return rows.map(({ req, whatsapp, email, websiteUrl }) => ({
    id: req.id,
    vendorId: req.vendorId,
    status: req.status,
    projectDescription: req.projectDescription,
    budgetRange: req.budgetRange ?? null,
    preferredStartDate: req.preferredStartDate ?? null,
    vendorResponse: req.vendorResponse ?? null,
    respondedAt: req.respondedAt ?? null,
    createdAt: req.createdAt,
    // Reveal full contact only if accepted
    revealedContact:
      req.status === "accepted"
        ? {
            whatsapp: whatsapp ?? null,
            email: email ?? null,
            websiteUrl: websiteUrl ?? null,
          }
        : null,
  }));
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: list all contact requests
// ─────────────────────────────────────────────────────────────────────────────

export async function listContactRequestsAdmin(params: {
  vendorId?: number;
  status?: string;
  page?: number;
  pageSize?: number;
}) {
  const { vendorId, status, page = 1, pageSize = 30 } = params;
  const conditions = [
    vendorId ? eq(vendorContactRequestsTable.vendorId, vendorId) : undefined,
    status ? eq(vendorContactRequestsTable.status, status) : undefined,
  ].filter(Boolean);

  const rows = await vendorDb
    .select()
    .from(vendorContactRequestsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(vendorContactRequestsTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  return rows;
}

// ─────────────────────────────────────────────────────────────────────────────
// Admin: update contact request status (accept / decline)
// ─────────────────────────────────────────────────────────────────────────────

export async function updateContactRequestStatus(
  id: number,
  status: "accepted" | "declined",
  vendorResponse?: string,
): Promise<VendorContactRequest | null> {
  const [existing] = await vendorDb
    .select()
    .from(vendorContactRequestsTable)
    .where(eq(vendorContactRequestsTable.id, id));

  if (!existing) return null;
  if ((TERMINAL_STATES as readonly string[]).includes(existing.status)) {
    throw new Error(
      `Contact request is already in terminal state: ${existing.status}`,
    );
  }

  const [row] = await vendorDb
    .update(vendorContactRequestsTable)
    .set({
      status,
      vendorResponse,
      respondedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(vendorContactRequestsTable.id, id))
    .returning();

  return row ?? null;
}
