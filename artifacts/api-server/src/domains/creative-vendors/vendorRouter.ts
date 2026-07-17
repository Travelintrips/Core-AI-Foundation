/**
 * vendorRouter.ts — Team 22 / Creative Vendor Ecosystem
 *
 * All paths are self-prefixed; Team 24 mounts via app.use('/', vendorRouter).
 *
 * Public (no auth):
 *   GET  /public/creative-vendors                             browse/search
 *   GET  /public/creative-vendors/categories                 category counts
 *   GET  /public/creative-vendors/recommend                  compatibility recs
 *   GET  /public/creative-vendors/:id                        vendor detail
 *   GET  /public/creative-vendors/:id/portfolio              approved portfolio
 *   GET  /public/creative-vendors/:id/ratings                approved ratings
 *   POST /public/creative-vendors/:id/ratings                submit rating
 *
 * Workspace (token auth):
 *   POST /public/customer/workspace/:token/creative-vendors/:id/contact
 *   GET  /public/customer/workspace/:token/creative-vendors/my-requests
 *
 * Admin (x-admin-api-key):
 *   GET    /ai/creative-vendors                              list + filter
 *   POST   /ai/creative-vendors                             create
 *   GET    /ai/creative-vendors/analytics                   analytics
 *   GET    /ai/creative-vendors/:id                         full detail
 *   PATCH  /ai/creative-vendors/:id                         update
 *   POST   /ai/creative-vendors/:id/approve                 approve
 *   POST   /ai/creative-vendors/:id/reject                  reject
 *   GET    /ai/creative-vendors/:id/portfolio               all items
 *   POST   /ai/creative-vendors/:id/portfolio               add item
 *   PATCH  /ai/creative-vendors/:id/portfolio/:itemId/approve
 *   PATCH  /ai/creative-vendors/:id/portfolio/:itemId/reject
 *   GET    /ai/creative-vendors/contact-requests            all requests
 *   PATCH  /ai/creative-vendors/contact-requests/:id        accept/decline
 */
import { Router, type Request, type Response } from "express";
import { requireAdminApiKey } from "../../middleware/adminAuth.js";
import { resolveWorkspaceSession } from "../../services/customerWorkspaceService.js";
import {
  searchVendors,
  getVendorDetailPublic,
  getVendorAdmin,
  listVendorsAdmin,
  createVendor,
  updateVendor,
  approveVendor,
  rejectVendor,
  submitRating,
  getVendorCategories,
  getVendorAnalytics,
  VENDOR_TYPES,
} from "./vendorService.js";
import {
  listVendorPortfolioPublic,
  listVendorPortfolioAdmin,
  addPortfolioItem,
  approvePortfolioItem,
  rejectPortfolioItem,
} from "./vendorPortfolioService.js";
import {
  submitContactRequest,
  getMyContactRequests,
  listContactRequestsAdmin,
  updateContactRequestStatus,
} from "./vendorContactService.js";
import {
  recommendVendors,
  checkVendorCompatibility,
} from "./vendorRecommendationService.js";
import { vendorDb, vendorRatingsTable } from "./schema.js";
import { eq, and, desc } from "drizzle-orm";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function idParam(req: Request): number | null {
  const n = parseInt(req.params["id"] ?? "", 10);
  return isNaN(n) ? null : n;
}

function err(res: Response, status: number, msg: string) {
  res.status(status).json({ error: msg });
}

async function resolveToken(token: string) {
  try {
    const result = await resolveWorkspaceSession(token);
    if (!result.ok) return null;
    const session = (result as Record<string, unknown>)["session"] as
      | Record<string, unknown>
      | undefined;
    const emailHash = session?.["emailHash"] as string | undefined;
    if (!emailHash) return null;
    return { emailHash };
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Routes
// ─────────────────────────────────────────────────────────────────────────────

// GET /public/creative-vendors — browse
router.get(
  "/public/creative-vendors",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        q,
        vendorType,
        province,
        city,
        isAvailableNow,
        isVerified,
        isFeatured,
        maxLeadTimeDays,
        sort,
        page,
        pageSize,
      } = req.query as Record<string, string>;

      const result = await searchVendors({
        q,
        vendorType: vendorType as (typeof VENDOR_TYPES)[number] | undefined,
        province,
        city,
        isAvailableNow:
          isAvailableNow !== undefined ? isAvailableNow === "true" : undefined,
        isVerified: isVerified !== undefined ? isVerified === "true" : undefined,
        isFeatured: isFeatured !== undefined ? isFeatured === "true" : undefined,
        maxLeadTimeDays: maxLeadTimeDays ? parseInt(maxLeadTimeDays, 10) : undefined,
        sort: sort as "rating" | "newest" | "lead_time" | "featured" | undefined,
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? Math.min(parseInt(pageSize, 10), 48) : 24,
      });

      res.json(result);
    } catch (e) {
      console.error("[creative-vendors] search error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// GET /public/creative-vendors/categories
router.get(
  "/public/creative-vendors/categories",
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const categories = await getVendorCategories();
      res.json({ categories });
    } catch (e) {
      console.error("[creative-vendors] categories error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// GET /public/creative-vendors/recommend
router.get(
  "/public/creative-vendors/recommend",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const {
        vendorType,
        province,
        city,
        maxLeadTimeDays,
        isRemoteOk,
        limit,
      } = req.query as Record<string, string>;

      if (!vendorType) {
        err(res, 400, "vendorType is required");
        return;
      }

      const recommendations = await recommendVendors({
        vendorType,
        province,
        city,
        maxLeadTimeDays: maxLeadTimeDays ? parseInt(maxLeadTimeDays, 10) : undefined,
        isRemoteOk: isRemoteOk === "true",
        limit: limit ? Math.min(parseInt(limit, 10), 20) : 10,
      });

      res.json({ recommendations });
    } catch (e) {
      console.error("[creative-vendors] recommend error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// GET /public/creative-vendors/:id
router.get(
  "/public/creative-vendors/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = idParam(req);
      if (!id) { err(res, 400, "Invalid vendor id"); return; }

      const vendor = await getVendorDetailPublic(id);
      if (!vendor) { err(res, 404, "Vendor not found"); return; }

      res.json({ vendor });
    } catch (e) {
      console.error("[creative-vendors] detail error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// GET /public/creative-vendors/:id/portfolio
router.get(
  "/public/creative-vendors/:id/portfolio",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = idParam(req);
      if (!id) { err(res, 400, "Invalid vendor id"); return; }

      const items = await listVendorPortfolioPublic(id);
      res.json({ items });
    } catch (e) {
      console.error("[creative-vendors] portfolio error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// GET /public/creative-vendors/:id/ratings
router.get(
  "/public/creative-vendors/:id/ratings",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = idParam(req);
      if (!id) { err(res, 400, "Invalid vendor id"); return; }

      const { page, pageSize } = req.query as Record<string, string>;
      const limit = Math.min(parseInt(pageSize ?? "20", 10), 50);
      const offset = (Math.max(parseInt(page ?? "1", 10), 1) - 1) * limit;

      const rows = await vendorDb
        .select()
        .from(vendorRatingsTable)
        .where(
          and(
            eq(vendorRatingsTable.vendorId, id),
            eq(vendorRatingsTable.moderationStatus, "approved"),
          ),
        )
        .orderBy(desc(vendorRatingsTable.createdAt))
        .limit(limit)
        .offset(offset);

      res.json({
        ratings: rows.map((r) => ({
          rating: r.rating,
          review: r.review,
          projectContext: r.projectContext,
          createdAt: r.createdAt,
        })),
      });
    } catch (e) {
      console.error("[creative-vendors] ratings error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// POST /public/creative-vendors/:id/ratings
router.post(
  "/public/creative-vendors/:id/ratings",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = idParam(req);
      if (!id) { err(res, 400, "Invalid vendor id"); return; }

      const { clientEmailHash, rating, review, projectContext } = req.body as {
        clientEmailHash?: string;
        rating?: number;
        review?: string;
        projectContext?: string;
      };

      if (!clientEmailHash) { err(res, 400, "clientEmailHash is required"); return; }
      if (!rating || rating < 1 || rating > 5) {
        err(res, 400, "rating must be 1–5");
        return;
      }

      const row = await submitRating(
        id,
        clientEmailHash,
        rating,
        review,
        projectContext,
      );
      res.status(201).json({ rating: row });
    } catch (e) {
      console.error("[creative-vendors] submit rating error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Workspace Routes (token auth)
// ─────────────────────────────────────────────────────────────────────────────

// POST /public/customer/workspace/:token/creative-vendors/:id/contact
router.post(
  "/public/customer/workspace/:token/creative-vendors/:id/contact",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const token = req.params["token"] as string;
      const id = idParam(req);
      if (!id) { err(res, 400, "Invalid vendor id"); return; }

      const session = await resolveToken(token);
      if (!session) { err(res, 401, "Invalid or expired workspace token"); return; }

      const { requesterName, projectDescription, budgetRange, preferredStartDate } =
        req.body as {
          requesterName?: string;
          projectDescription?: string;
          budgetRange?: string;
          preferredStartDate?: string;
        };

      if (!projectDescription?.trim()) {
        err(res, 400, "projectDescription is required");
        return;
      }

      const contactRequest = await submitContactRequest(id, session.emailHash, {
        requesterName,
        projectDescription,
        budgetRange,
        preferredStartDate,
      });

      res.status(201).json({ contactRequest });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Internal server error";
      if (msg === "Vendor not found or not available") {
        err(res, 404, msg);
      } else {
        console.error("[creative-vendors] contact request error", e);
        err(res, 500, "Internal server error");
      }
    }
  },
);

// GET /public/customer/workspace/:token/creative-vendors/my-requests
router.get(
  "/public/customer/workspace/:token/creative-vendors/my-requests",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const token = req.params["token"] as string;
      const session = await resolveToken(token);
      if (!session) { err(res, 401, "Invalid or expired workspace token"); return; }

      const requests = await getMyContactRequests(session.emailHash);
      res.json({ requests });
    } catch (e) {
      console.error("[creative-vendors] my-requests error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin Routes (requireAdminApiKey)
// ─────────────────────────────────────────────────────────────────────────────

// GET /ai/creative-vendors/analytics  — must be before /:id
router.get(
  "/ai/creative-vendors/analytics",
  requireAdminApiKey,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const analytics = await getVendorAnalytics();
      res.json(analytics);
    } catch (e) {
      console.error("[creative-vendors] analytics error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// GET /ai/creative-vendors/contact-requests — before /:id
router.get(
  "/ai/creative-vendors/contact-requests",
  requireAdminApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { vendorId, status, page, pageSize } = req.query as Record<string, string>;
      const requests = await listContactRequestsAdmin({
        vendorId: vendorId ? parseInt(vendorId, 10) : undefined,
        status,
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 30,
      });
      res.json({ requests });
    } catch (e) {
      console.error("[creative-vendors] admin contact-requests error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// GET /ai/creative-vendors
router.get(
  "/ai/creative-vendors",
  requireAdminApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { moderationStatus, vendorType, status, page, pageSize } =
        req.query as Record<string, string>;
      const result = await listVendorsAdmin({
        moderationStatus,
        vendorType,
        status,
        page: page ? parseInt(page, 10) : 1,
        pageSize: pageSize ? parseInt(pageSize, 10) : 30,
      });
      res.json(result);
    } catch (e) {
      console.error("[creative-vendors] admin list error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// POST /ai/creative-vendors
router.post(
  "/ai/creative-vendors",
  requireAdminApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { displayName, vendorType, ...rest } = req.body as Record<string, unknown>;
      if (!displayName || !vendorType) {
        err(res, 400, "displayName and vendorType are required");
        return;
      }
      if (!VENDOR_TYPES.includes(vendorType as (typeof VENDOR_TYPES)[number])) {
        err(res, 400, `vendorType must be one of: ${VENDOR_TYPES.join(", ")}`);
        return;
      }
      const vendor = await createVendor({
        displayName: String(displayName),
        vendorType: vendorType as (typeof VENDOR_TYPES)[number],
        ...rest as Record<string, string | number>,
      });
      res.status(201).json({ vendor });
    } catch (e) {
      console.error("[creative-vendors] admin create error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// GET /ai/creative-vendors/:id
router.get(
  "/ai/creative-vendors/:id",
  requireAdminApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = idParam(req);
      if (!id) { err(res, 400, "Invalid vendor id"); return; }
      const vendor = await getVendorAdmin(id);
      if (!vendor) { err(res, 404, "Vendor not found"); return; }
      res.json({ vendor });
    } catch (e) {
      console.error("[creative-vendors] admin get error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// PATCH /ai/creative-vendors/:id
router.patch(
  "/ai/creative-vendors/:id",
  requireAdminApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = idParam(req);
      if (!id) { err(res, 400, "Invalid vendor id"); return; }
      const vendor = await updateVendor(id, req.body as Record<string, unknown>);
      if (!vendor) { err(res, 404, "Vendor not found"); return; }
      res.json({ vendor });
    } catch (e) {
      console.error("[creative-vendors] admin update error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// POST /ai/creative-vendors/:id/approve
router.post(
  "/ai/creative-vendors/:id/approve",
  requireAdminApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = idParam(req);
      if (!id) { err(res, 400, "Invalid vendor id"); return; }
      const vendor = await approveVendor(id);
      if (!vendor) { err(res, 404, "Vendor not found"); return; }
      res.json({ vendor });
    } catch (e) {
      console.error("[creative-vendors] admin approve error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// POST /ai/creative-vendors/:id/reject
router.post(
  "/ai/creative-vendors/:id/reject",
  requireAdminApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = idParam(req);
      if (!id) { err(res, 400, "Invalid vendor id"); return; }
      const { reason } = req.body as { reason?: string };
      if (!reason?.trim()) { err(res, 400, "reason is required"); return; }
      const vendor = await rejectVendor(id, reason);
      if (!vendor) { err(res, 404, "Vendor not found"); return; }
      res.json({ vendor });
    } catch (e) {
      console.error("[creative-vendors] admin reject error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// GET /ai/creative-vendors/:id/portfolio
router.get(
  "/ai/creative-vendors/:id/portfolio",
  requireAdminApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = idParam(req);
      if (!id) { err(res, 400, "Invalid vendor id"); return; }
      const { moderationStatus } = req.query as Record<string, string>;
      const items = await listVendorPortfolioAdmin(id, moderationStatus);
      res.json({ items });
    } catch (e) {
      console.error("[creative-vendors] admin portfolio list error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// POST /ai/creative-vendors/:id/portfolio
router.post(
  "/ai/creative-vendors/:id/portfolio",
  requireAdminApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = idParam(req);
      if (!id) { err(res, 400, "Invalid vendor id"); return; }
      const { title, ...rest } = req.body as Record<string, unknown>;
      if (!title) { err(res, 400, "title is required"); return; }
      const item = await addPortfolioItem(id, { title: String(title), ...rest as Record<string, string | number> });
      res.status(201).json({ item });
    } catch (e) {
      console.error("[creative-vendors] admin portfolio add error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// PATCH /ai/creative-vendors/:id/portfolio/:itemId/approve
router.patch(
  "/ai/creative-vendors/:id/portfolio/:itemId/approve",
  requireAdminApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = idParam(req);
      const itemId = parseInt(req.params["itemId"] ?? "", 10);
      if (!id || isNaN(itemId)) { err(res, 400, "Invalid id"); return; }
      const item = await approvePortfolioItem(id, itemId);
      if (!item) { err(res, 404, "Portfolio item not found"); return; }
      res.json({ item });
    } catch (e) {
      console.error("[creative-vendors] admin portfolio approve error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// PATCH /ai/creative-vendors/:id/portfolio/:itemId/reject
router.patch(
  "/ai/creative-vendors/:id/portfolio/:itemId/reject",
  requireAdminApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = idParam(req);
      const itemId = parseInt(req.params["itemId"] ?? "", 10);
      if (!id || isNaN(itemId)) { err(res, 400, "Invalid id"); return; }
      const { reason } = req.body as { reason?: string };
      if (!reason?.trim()) { err(res, 400, "reason is required"); return; }
      const item = await rejectPortfolioItem(id, itemId, reason);
      if (!item) { err(res, 404, "Portfolio item not found"); return; }
      res.json({ item });
    } catch (e) {
      console.error("[creative-vendors] admin portfolio reject error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// PATCH /ai/creative-vendors/contact-requests/:id
router.patch(
  "/ai/creative-vendors/contact-requests/:id",
  requireAdminApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = idParam(req);
      if (!id) { err(res, 400, "Invalid id"); return; }
      const { status, vendorResponse } = req.body as {
        status?: string;
        vendorResponse?: string;
      };
      if (status !== "accepted" && status !== "declined") {
        err(res, 400, "status must be 'accepted' or 'declined'");
        return;
      }
      const request = await updateContactRequestStatus(id, status, vendorResponse);
      if (!request) { err(res, 404, "Contact request not found"); return; }
      res.json({ request });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Internal server error";
      if (msg.includes("terminal state")) {
        err(res, 409, msg);
      } else {
        console.error("[creative-vendors] admin contact-request update error", e);
        err(res, 500, "Internal server error");
      }
    }
  },
);

export { router as vendorRouter };
