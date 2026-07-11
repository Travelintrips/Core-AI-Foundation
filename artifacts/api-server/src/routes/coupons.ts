import { Router } from "express";
import { listCoupons, createCoupon, updateCoupon, validateCoupon, redeemCoupon } from "../services/couponService";

const router = Router();

// GET /ai/coupons
router.get("/ai/coupons", async (_req, res): Promise<void> => {
  const coupons = await listCoupons();
  res.json({ items: coupons, total: coupons.length });
});

// POST /ai/coupons
router.post("/ai/coupons", async (req, res): Promise<void> => {
  const { code, type, value, minimumOrder, maximumDiscount, startDate, endDate,
    usageLimit, usagePerCustomer } = req.body;

  if (!code || !type || value === undefined) {
    res.status(400).json({ error: "code, type, and value are required" });
    return;
  }
  if (!["percentage","fixed"].includes(type)) {
    res.status(400).json({ error: "type must be percentage or fixed" });
    return;
  }

  const coupon = await createCoupon({
    code: code.toUpperCase().trim(),
    type,
    value: parseInt(String(value), 10),
    minimumOrder: minimumOrder ? parseInt(String(minimumOrder), 10) : undefined,
    maximumDiscount: maximumDiscount ? parseInt(String(maximumDiscount), 10) : undefined,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    usageLimit: usageLimit ? parseInt(String(usageLimit), 10) : undefined,
    usagePerCustomer: usagePerCustomer ? parseInt(String(usagePerCustomer), 10) : 1,
    status: "active",
  });

  res.status(201).json(coupon);
});

// PATCH /ai/coupons/:id
router.patch("/ai/coupons/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const updated = await updateCoupon(id, req.body);
  if (!updated) { res.status(404).json({ error: "Coupon not found" }); return; }
  res.json(updated);
});

// POST /ai/coupons/validate (admin + public)
router.post("/ai/coupons/validate", async (req, res): Promise<void> => {
  const { code, orderAmount, customerProfileId } = req.body;
  if (!code || !orderAmount) {
    res.status(400).json({ error: "code and orderAmount are required" });
    return;
  }

  const result = await validateCoupon({
    code: String(code),
    orderAmount: parseInt(String(orderAmount), 10),
    customerProfileId: customerProfileId ? parseInt(String(customerProfileId), 10) : undefined,
  });

  if (!result.valid) {
    res.status(422).json({ valid: false, reason: result.reason });
    return;
  }

  res.json({
    valid: true,
    couponId: result.coupon!.id,
    code: result.coupon!.code,
    type: result.coupon!.type,
    value: result.coupon!.value,
    discountAmount: result.discountAmount,
  });
});

// POST /ai/coupons/redeem
router.post("/ai/coupons/redeem", async (req, res): Promise<void> => {
  const { couponId, customerProfileId, serviceRequestId, discountAmount } = req.body;
  if (!couponId || !discountAmount) {
    res.status(400).json({ error: "couponId and discountAmount are required" });
    return;
  }

  await redeemCoupon({
    couponId: parseInt(String(couponId), 10),
    customerProfileId: customerProfileId ? parseInt(String(customerProfileId), 10) : undefined,
    serviceRequestId: serviceRequestId ? parseInt(String(serviceRequestId), 10) : undefined,
    discountAmount: parseInt(String(discountAmount), 10),
  });

  res.json({ ok: true });
});

export default router;
