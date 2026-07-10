/**
 * aiPricingService.ts — AI Service Catalog Pricing Engine
 *
 * Computes a full price breakdown for a service request from the master
 * service/package data plus any active price rules (rush delivery, extra
 * revisions, human review, bilingual, additional concepts, editable source
 * file, extended usage rights). Admins change prices/rules from the data —
 * never hardcode a formula here that assumes a specific price.
 *
 * Tax is resolved from tenant/global ai_settings (key: "tax_percent"),
 * never hardcoded to a specific country's rate.
 */
import { db, aiServicePriceRulesTable, aiSettingsTable, type AiService, type AiServicePackage, type AiServicePriceRule } from "@workspace/db";
import { eq, or, isNull, and } from "drizzle-orm";

export interface PricingSelections {
  quantity?: number;
  rushSpeed?: "48h" | "24h" | "same_day" | null;
  humanReviewRequested?: boolean;
  extraRevisions?: number;
  bilingual?: boolean;
  editableSourceFile?: boolean;
  extendedUsageRights?: boolean;
  additionalConcepts?: number;
}

export interface PricingLineItem {
  code: string;
  label: string;
  amount: number;
}

export interface PricingBreakdown {
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
  lineItems: PricingLineItem[];
  // Internal, never surfaced to customer-facing responses
  estimatedAiCost: number;
  humanLaborEstimate: number;
  grossMargin: number;
  grossMarginPercent: number;
  marginApprovalRequired: boolean;
}

const MARGIN_WARNING_THRESHOLD_PERCENT = 40;

export function calculateBasePrice(service: AiService, pkg: AiServicePackage | null, pricingModelSelected: string): number {
  if (pkg) {
    if (pricingModelSelected === "monthly_subscription" && pkg.monthlyPrice != null) return Number(pkg.monthlyPrice);
    if (pricingModelSelected === "yearly_subscription" && pkg.yearlyPrice != null) return Number(pkg.yearlyPrice);
    if (pkg.oneTimePrice != null) return Number(pkg.oneTimePrice);
    if (pkg.monthlyPrice != null) return Number(pkg.monthlyPrice);
    if (pkg.yearlyPrice != null) return Number(pkg.yearlyPrice);
  }
  return Number(service.startingPrice ?? 0);
}

export function applyPackagePrice(base: number, pkg: AiServicePackage | null): number {
  return base + Number(pkg?.setupFee ?? 0);
}

export function applyQuantityRule(base: number, quantity: number): number {
  if (quantity <= 1) return 0;
  return base * (quantity - 1);
}

async function loadRules(serviceId: number): Promise<AiServicePriceRule[]> {
  return db
    .select()
    .from(aiServicePriceRulesTable)
    .where(and(eq(aiServicePriceRulesTable.active, true), or(isNull(aiServicePriceRulesTable.serviceId), eq(aiServicePriceRulesTable.serviceId, serviceId))))
    .orderBy(aiServicePriceRulesTable.priority);
}

function findRule(rules: AiServicePriceRule[], conditionType: string, match?: (r: AiServicePriceRule) => boolean): AiServicePriceRule | undefined {
  return rules.find((r) => r.conditionType === conditionType && (!match || match(r)));
}

function computeAdjustment(rule: AiServicePriceRule, onAmount: number, units = 1): number {
  let amount = 0;
  switch (rule.adjustmentType) {
    case "fixed_amount":
      amount = Number(rule.adjustmentValue) * units;
      break;
    case "percentage":
      amount = onAmount * (Number(rule.adjustmentValue) / 100);
      break;
    case "multiplier":
      amount = onAmount * (Number(rule.adjustmentValue) - 1);
      break;
    case "per_unit":
      amount = Number(rule.adjustmentValue) * units;
      break;
  }
  if (rule.minimumCharge != null) amount = Math.max(amount, Number(rule.minimumCharge));
  if (rule.maximumCharge != null) amount = Math.min(amount, Number(rule.maximumCharge));
  return Math.round(amount);
}

export async function applyRushFee(base: number, serviceId: number, rushSpeed: PricingSelections["rushSpeed"], rules: AiServicePriceRule[]): Promise<number> {
  if (!rushSpeed) return 0;
  const rule = findRule(rules, "rush_speed", (r) => (r.conditionJson as { speed?: string } | null)?.speed === rushSpeed);
  if (!rule) return 0;
  return computeAdjustment(rule, base);
}

export function applyRevisionFee(extraRevisions: number, rules: AiServicePriceRule[]): number {
  if (!extraRevisions || extraRevisions <= 0) return 0;
  const rule = findRule(rules, "extra_revision");
  if (!rule) return 0;
  return computeAdjustment(rule, 0, extraRevisions);
}

export function applyHumanReviewFee(humanReviewRequested: boolean, rules: AiServicePriceRule[]): number {
  if (!humanReviewRequested) return 0;
  const rule = findRule(rules, "human_review");
  if (!rule) return 0;
  return computeAdjustment(rule, 0, 1);
}

export function applyLanguageFee(base: number, bilingual: boolean, rules: AiServicePriceRule[]): number {
  if (!bilingual) return 0;
  const rule = findRule(rules, "bilingual");
  if (!rule) return 0;
  return computeAdjustment(rule, base);
}

export function applyUsageRightsFee(base: number, extendedUsageRights: boolean, editableSourceFile: boolean, rules: AiServicePriceRule[]): number {
  let fee = 0;
  if (extendedUsageRights) {
    const rule = findRule(rules, "extended_usage_rights");
    if (rule) fee += computeAdjustment(rule, base);
  }
  if (editableSourceFile) {
    const rule = findRule(rules, "editable_source_file");
    if (rule) fee += computeAdjustment(rule, base);
  }
  return fee;
}

export function applyAdditionalConceptFee(count: number, rules: AiServicePriceRule[]): number {
  if (!count || count <= 0) return 0;
  const rule = findRule(rules, "additional_concept");
  if (!rule) return 0;
  return computeAdjustment(rule, 0, count);
}

export function applyDiscount(subtotal: number, discountAmount: number): number {
  return Math.min(discountAmount, subtotal);
}

export async function calculateTax(subtotal: number, tenantId?: string | null): Promise<{ taxPercent: number; tax: number }> {
  return resolveTax(subtotal, tenantId);
}

export function validateMinimumCharge(amount: number, minimumCharge?: number | null): number {
  if (minimumCharge == null) return amount;
  return Math.max(amount, minimumCharge);
}

/**
 * Full pricing calculation entrypoint — used by both the pricing calculator
 * (quote preview) and the request-creation route (final snapshot).
 */
export async function generatePricingSnapshot(
  service: AiService,
  pkg: AiServicePackage | null,
  pricingModelSelected: string,
  selections: PricingSelections,
  discountAmount = 0,
  tenantId?: string | null,
): Promise<PricingBreakdown> {
  const quantity = Math.max(1, selections.quantity ?? 1);
  const rules = await loadRules(service.id);

  const basePrice = applyPackagePrice(calculateBasePrice(service, pkg, pricingModelSelected), pkg);
  const quantityAdjustment = applyQuantityRule(basePrice, quantity);
  const preAddOnBase = basePrice + quantityAdjustment;

  const rushFee = await applyRushFee(preAddOnBase, service.id, selections.rushSpeed ?? null, rules);
  const revisionFee = applyRevisionFee(selections.extraRevisions ?? 0, rules);
  const humanReviewFee = applyHumanReviewFee(!!selections.humanReviewRequested, rules);
  const languageFee = applyLanguageFee(preAddOnBase, !!selections.bilingual, rules);
  const usageRightsFee = applyUsageRightsFee(preAddOnBase, !!selections.extendedUsageRights, !!selections.editableSourceFile, rules);
  const additionalConceptFee = applyAdditionalConceptFee(selections.additionalConcepts ?? 0, rules);
  const additionalServiceFee = languageFee + usageRightsFee + additionalConceptFee;

  let subtotal = preAddOnBase + rushFee + humanReviewFee + revisionFee + additionalServiceFee;
  const discount = applyDiscount(subtotal, discountAmount);
  subtotal = subtotal - discount;

  const { taxPercent, tax } = await resolveTax(subtotal, tenantId);
  const total = subtotal + tax;

  // Cost/margin estimate — heuristic: AI cost ~8% of base, human labor only when human review requested
  const estimatedAiCost = Math.round(preAddOnBase * 0.08);
  const humanLaborEstimate = selections.humanReviewRequested ? Math.round(humanReviewFee * 0.6 || preAddOnBase * 0.15) : 0;
  const totalCost = estimatedAiCost + humanLaborEstimate;
  const grossMargin = total - totalCost;
  const grossMarginPercent = total > 0 ? Math.round((grossMargin / total) * 1000) / 10 : 0;

  const lineItems: PricingLineItem[] = [
    { code: "base_price", label: pkg ? `${pkg.packageName} package` : "Base price", amount: basePrice },
  ];
  if (quantityAdjustment) lineItems.push({ code: "quantity", label: `Quantity (${quantity}x)`, amount: quantityAdjustment });
  if (rushFee) lineItems.push({ code: "rush_fee", label: "Rush delivery", amount: rushFee });
  if (revisionFee) lineItems.push({ code: "revision_fee", label: "Extra revisions", amount: revisionFee });
  if (humanReviewFee) lineItems.push({ code: "human_review_fee", label: "Human review", amount: humanReviewFee });
  if (languageFee) lineItems.push({ code: "bilingual", label: "Bilingual", amount: languageFee });
  if (usageRightsFee) lineItems.push({ code: "usage_rights", label: "Extended usage / source file", amount: usageRightsFee });
  if (additionalConceptFee) lineItems.push({ code: "additional_concept", label: "Additional concepts", amount: additionalConceptFee });
  if (discount) lineItems.push({ code: "discount", label: "Discount", amount: -discount });
  if (tax) lineItems.push({ code: "tax", label: `Tax (${taxPercent}%)`, amount: tax });

  return {
    currency: service.currency,
    basePrice,
    quantityAdjustment,
    rushFee,
    revisionFee,
    humanReviewFee,
    additionalServiceFee,
    discount,
    subtotal,
    taxPercent,
    tax,
    total,
    lineItems,
    estimatedAiCost,
    humanLaborEstimate,
    grossMargin,
    grossMarginPercent,
    marginApprovalRequired: grossMarginPercent < MARGIN_WARNING_THRESHOLD_PERCENT,
  };
}

async function resolveTax(subtotal: number, tenantId?: string | null): Promise<{ taxPercent: number; tax: number }> {
  const [setting] = await db
    .select()
    .from(aiSettingsTable)
    .where(eq(aiSettingsTable.key, tenantId ? `tax_percent:${tenantId}` : "tax_percent"))
    .limit(1);
  const taxPercent = setting ? Number(setting.value) : 0;
  return { taxPercent, tax: Math.round(subtotal * (taxPercent / 100)) };
}

/** Strip internal cost/margin fields before sending a breakdown to customer-facing responses. */
export function toCustomerFacingBreakdown(breakdown: PricingBreakdown) {
  const { estimatedAiCost, humanLaborEstimate, grossMargin, grossMarginPercent, marginApprovalRequired, ...customerFacing } = breakdown;
  return customerFacing;
}
