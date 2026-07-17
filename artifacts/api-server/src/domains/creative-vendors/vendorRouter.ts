/**
 * vendorRouter.ts — Team 22 / Creative Vendor Ecosystem
 *
 * DOMAIN MAPPING REVIEW — Team 23 Audit Remediation
 * Status: BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING
 *
 * Active endpoints (extension contract — KEPT):
 *   Public:
 *     GET  /public/creative-vendors              browse/search
 *     GET  /public/creative-vendors/categories   category counts
 *     GET  /public/creative-vendors/recommend    compatibility recommendations
 *     GET  /public/creative-vendors/:id          vendor detail
 *   Admin:
 *     GET    /ai/creative-vendors                list (paginated)
 *     POST   /ai/creative-vendors                create profile extension
 *     GET    /ai/creative-vendors/analytics      analytics
 *     GET    /ai/creative-vendors/:id            full detail (admin)
 *     PATCH  /ai/creative-vendors/:id            update profile fields
 *     POST   /ai/creative-vendors/:id/approve    approve
 *     POST   /ai/creative-vendors/:id/reject     reject
 *
 * BLOCKED endpoints (canonical source pending):
 *   /…/portfolio/*                  → BLOCKED (map to ai_service_portfolios)
 *   /…/ratings                      → BLOCKED (map to marketplace_ratings)
 *   /…/contact                      → BLOCKED (map to ai_quotations or ai_vendor_inquiries)
 *   /workspace/:token/…/my-requests → BLOCKED
 *
 * Team 24 integration task:
 *   import { vendorRouter } from './domains/creative-vendors/index.js';
 *   app.use('/', vendorRouter);  // paths self-prefixed
 */
import { Router, type Request, type Response } from "express";
import { requireAdminApiKey } from "../../middleware/adminAuth.js";
import {
  searchVendors,
  getVendorDetailPublic,
  getVendorAdmin,
  listVendorsAdmin,
  createVendorProfile,
  updateVendorProfile,
  approveVendorProfile,
  rejectVendorProfile,
  getVendorCategories,
  getVendorAnalytics,
  VENDOR_TYPES,
  type VendorSearchParams,
  type CreateVendorProfileInput,
} from "./vendorService.js";
import {
  recommendVendors,
  checkVendorCompatibility,
} from "./vendorRecommendationService.js";

const router = Router();

// ── Helpers ───────────────────────────────────────────────────────────────────

function idParam(req: Request): number | null {
  const n = parseInt(String(req.params["id"] ?? ""), 10);
  return isNaN(n) ? null : n;
}

function err(res: Response, status: number, msg: string): void {
  res.status(status).json({ error: msg });
}

function blockedEndpoint(reason: string) {
  return (_req: Request, res: Response): void => {
    res.status(503).json({
      error: "BLOCKED_PENDING_VENDOR_CANONICAL_MAPPING",
      detail: reason,
    });
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Public Routes — Active
// ─────────────────────────────────────────────────────────────────────────────

// GET /public/creative-vendors — browse/search
router.get(
  "/public/creative-vendors",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const params: VendorSearchParams = {
        q: req.query["q"] as string | undefined,
        vendorType: req.query["vendorType"] as VendorSearchParams["vendorType"],
        province: req.query["province"] as string | undefined,
        city: req.query["city"] as string | undefined,
        isAvailableNow: req.query["isAvailableNow"] === "true" ? true
          : req.query["isAvailableNow"] === "false" ? false : undefined,
        isVerified: req.query["isVerified"] === "true" ? true
          : req.query["isVerified"] === "false" ? false : undefined,
        isFeatured: req.query["isFeatured"] === "true" ? true : undefined,
        maxLeadTimeDays: req.query["maxLeadTimeDays"]
          ? parseInt(String(req.query["maxLeadTimeDays"]), 10) : undefined,
        sort: req.query["sort"] as VendorSearchParams["sort"],
        page: req.query["page"] ? parseInt(String(req.query["page"]), 10) : 1,
        pageSize: req.query["pageSize"] ? parseInt(String(req.query["pageSize"]), 10) : 20,
      };
      const result = await searchVendors(params);
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
      const rows = await getVendorCategories();
      res.json({ categories: rows, allTypes: VENDOR_TYPES });
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
      const vendorType = String(req.query["vendorType"] ?? "");
      if (!vendorType) { err(res, 400, "vendorType is required"); return; }
      const results = await recommendVendors({
        vendorType,
        province: req.query["province"] as string | undefined,
        city: req.query["city"] as string | undefined,
        maxLeadTimeDays: req.query["maxLeadTimeDays"]
          ? parseInt(String(req.query["maxLeadTimeDays"]), 10) : undefined,
        isRemoteOk: req.query["isRemoteOk"] === "true",
        limit: req.query["limit"] ? parseInt(String(req.query["limit"]), 10) : 10,
      });
      res.json({ recommendations: results });
    } catch (e) {
      console.error("[creative-vendors] recommend error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// GET /public/creative-vendors/:id — vendor detail
router.get(
  "/public/creative-vendors/:id",
  async (req: Request, res: Response): Promise<void> => {
    try {
      const id = idParam(req);
      if (!id) { err(res, 400, "Invalid id"); return; }
      const vendor = await getVendorDetailPublic(id);
      if (!vendor) { err(res, 404, "Vendor not found"); return; }
      res.json({ vendor });
    } catch (e) {
      console.error("[creative-vendors] detail error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// BLOCKED Public Routes — canonical mapping pending
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/public/creative-vendors/:id/portfolio",
  blockedEndpoint("creative_vendor_portfolio_items maps to ai_service_portfolios. Pending architecture review."),
);

router.get(
  "/public/creative-vendors/:id/ratings",
  blockedEndpoint("creative_vendor_ratings maps to marketplace_ratings (itemType='creative_vendor'). Pending architecture review."),
);

router.post(
  "/public/creative-vendors/:id/ratings",
  blockedEndpoint("creative_vendor_ratings maps to marketplace_ratings (itemType='creative_vendor'). Pending architecture review."),
);

router.post(
  "/public/customer/workspace/:token/creative-vendors/:id/contact",
  blockedEndpoint("creative_vendor_contact_requests pending canonical contact/inquiry mapping (ai_quotations or ai_vendor_inquiries)."),
);

router.get(
  "/public/customer/workspace/:token/creative-vendors/my-requests",
  blockedEndpoint("creative_vendor_contact_requests pending canonical contact/inquiry mapping (ai_quotations or ai_vendor_inquiries)."),
);

// ─────────────────────────────────────────────────────────────────────────────
// Admin Routes — Active
// ─────────────────────────────────────────────────────────────────────────────

// GET /ai/creative-vendors/analytics — must be before /:id
router.get(
  "/ai/creative-vendors/analytics",
  requireAdminApiKey,
  async (_req: Request, res: Response): Promise<void> => {
    try {
      const data = await getVendorAnalytics();
      res.json(data);
    } catch (e) {
      console.error("[creative-vendors] analytics error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// GET /ai/creative-vendors — list + filter
router.get(
  "/ai/creative-vendors",
  requireAdminApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const result = await listVendorsAdmin(
        req.query["moderationStatus"] as string | undefined,
        req.query["vendorType"] as string | undefined,
        req.query["page"] ? parseInt(String(req.query["page"]), 10) : 1,
        req.query["pageSize"] ? parseInt(String(req.query["pageSize"]), 10) : 30,
      );
      res.json(result);
    } catch (e) {
      console.error("[creative-vendors] admin list error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// POST /ai/creative-vendors — create profile extension
router.post(
  "/ai/creative-vendors",
  requireAdminApiKey,
  async (req: Request, res: Response): Promise<void> => {
    try {
      const body = req.body as CreateVendorProfileInput;
      if (!body.creatorId || !body.vendorType) {
        err(res, 400, "creatorId and vendorType are required"); return;
      }
      const profile = await createVendorProfile(body);
      res.status(201).json({ profile });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Internal server error";
      if (msg.includes("unique constraint") || msg.includes("duplicate")) {
        err(res, 409, "A vendor profile already exists for this creator");
      } else if (msg.includes("Invalid URL") || msg.includes("private/internal")) {
        err(res, 400, msg);
      } else {
        console.error("[creative-vendors] admin create error", e);
        err(res, 500, "Internal server error");
      }
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
      if (!id) { err(res, 400, "Invalid id"); return; }
      const result = await getVendorAdmin(id);
      if (!result) { err(res, 404, "Vendor not found"); return; }
      res.json(result);
    } catch (e) {
      console.error("[creative-vendors] admin detail error", e);
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
      if (!id) { err(res, 400, "Invalid id"); return; }
      const profile = await updateVendorProfile(id, req.body as Parameters<typeof updateVendorProfile>[1]);
      if (!profile) { err(res, 404, "Vendor profile not found"); return; }
      res.json({ profile });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Internal server error";
      if (msg.includes("Invalid URL") || msg.includes("private/internal")) {
        err(res, 400, msg);
      } else {
        console.error("[creative-vendors] admin update error", e);
        err(res, 500, "Internal server error");
      }
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
      if (!id) { err(res, 400, "Invalid id"); return; }
      const profile = await approveVendorProfile(id);
      if (!profile) { err(res, 404, "Vendor profile not found"); return; }
      res.json({ profile });
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
      if (!id) { err(res, 400, "Invalid id"); return; }
      const { reason } = req.body as { reason?: string };
      if (!reason?.trim()) { err(res, 400, "reason is required"); return; }
      const profile = await rejectVendorProfile(id, reason);
      if (!profile) { err(res, 404, "Vendor profile not found"); return; }
      res.json({ profile });
    } catch (e) {
      console.error("[creative-vendors] admin reject error", e);
      err(res, 500, "Internal server error");
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// BLOCKED Admin Routes
// ─────────────────────────────────────────────────────────────────────────────

router.get(
  "/ai/creative-vendors/:id/portfolio",
  requireAdminApiKey,
  blockedEndpoint("creative_vendor_portfolio_items maps to ai_service_portfolios. Pending architecture review."),
);

router.post(
  "/ai/creative-vendors/:id/portfolio",
  requireAdminApiKey,
  blockedEndpoint("creative_vendor_portfolio_items maps to ai_service_portfolios. Pending architecture review."),
);

router.patch(
  "/ai/creative-vendors/:id/portfolio/:itemId/approve",
  requireAdminApiKey,
  blockedEndpoint("creative_vendor_portfolio_items maps to ai_service_portfolios. Pending architecture review."),
);

router.patch(
  "/ai/creative-vendors/:id/portfolio/:itemId/reject",
  requireAdminApiKey,
  blockedEndpoint("creative_vendor_portfolio_items maps to ai_service_portfolios. Pending architecture review."),
);

router.get(
  "/ai/creative-vendors/contact-requests",
  requireAdminApiKey,
  blockedEndpoint("creative_vendor_contact_requests pending canonical contact/inquiry mapping."),
);

router.patch(
  "/ai/creative-vendors/contact-requests/:id",
  requireAdminApiKey,
  blockedEndpoint("creative_vendor_contact_requests pending canonical contact/inquiry mapping."),
);

export { router as vendorRouter };
