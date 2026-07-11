/**
 * commercialAutomationService — Sprint P2.6
 *
 * Rule engine for the Commercial Automation Layer.
 *
 * Rules are evaluated when events fire via the Event Bus. Each rule has:
 *   - triggerEvent: the event type pattern that can activate it
 *   - conditionsJson: key/value checks against event payload
 *   - actionType: what to do when conditions pass
 *
 * Built-in rules (seeded at startup):
 *   1. portfolio_abandonment — viewed ≥3×, no checkout → recommend coupon
 *   2. inactive_customer    — inactive 30 days → send reminder
 *   3. repeat_vip           — repeat orders ≥5 → VIP promotion
 *   4. affiliate_upgrade    — conversions ≥50 → upgrade commission
 */

import { eq, desc, and, sql } from "drizzle-orm";
import {
  db,
  aiAutomationRulesTable,
  aiAutomationExecutionsTable,
  aiCouponsTable,
  aiPromotionsTable,
  type AiAutomationRule,
} from "@workspace/db";
import { logAudit } from "./aiAuditService.js";
import { publishSafe } from "./aiEventBusService.js";
import { logger } from "../lib/logger.js";

// ── Public types ──────────────────────────────────────────────────────────────

export type AutomationResult = {
  ruleId: number;
  ruleCode: string;
  status: "success" | "failed" | "skipped";
  action: string;
  detail: Record<string, unknown>;
};

// ── Seed default rules ────────────────────────────────────────────────────────

export async function seedDefaultAutomationRules(): Promise<void> {
  const defaults: Array<Omit<AiAutomationRule, "id" | "executionCount" | "lastExecutedAt" | "createdAt" | "updatedAt">> = [
    {
      ruleCode: "portfolio_abandonment",
      ruleName: "Portfolio Abandonment — Recommend Coupon",
      description: "Customer viewed same portfolio ≥3× without checkout → recommend coupon",
      triggerEvent: "portfolio.viewed",
      conditionsJson: { minViewCount: 3, hasCheckout: false },
      actionType: "recommend_coupon",
      actionConfigJson: { couponType: "percentage", value: 10, note: "abandonment_recovery" },
      priority: 80,
      isEnabled: true,
    },
    {
      ruleCode: "inactive_customer_reminder",
      ruleName: "Inactive Customer — Send Reminder",
      description: "Customer inactive for 30 days → publish reminder event",
      triggerEvent: "scheduler.tick",
      conditionsJson: { inactiveDays: 30 },
      actionType: "send_reminder",
      actionConfigJson: { reminderType: "inactivity", daysThreshold: 30 },
      priority: 60,
      isEnabled: true,
    },
    {
      ruleCode: "repeat_vip_promotion",
      ruleName: "Repeat Customer VIP Promotion",
      description: "Customer with ≥5 repeat orders → trigger VIP promotion",
      triggerEvent: "service_request.converted",
      conditionsJson: { minRepeatOrders: 5 },
      actionType: "vip_promotion",
      actionConfigJson: { promotionTag: "vip", discountType: "percentage", value: 15 },
      priority: 70,
      isEnabled: true,
    },
    {
      ruleCode: "affiliate_commission_upgrade",
      ruleName: "Affiliate Commission Upgrade",
      description: "Affiliate with ≥50 conversions → upgrade commission rate",
      triggerEvent: "affiliate.conversion_recorded",
      conditionsJson: { minConversions: 50 },
      actionType: "upgrade_commission",
      actionConfigJson: { newCommissionRate: 15 },
      priority: 65,
      isEnabled: true,
    },
    {
      ruleCode: "health_recalculate_on_payment",
      ruleName: "Recalculate Health Score on Payment",
      description: "Recalculate customer health score whenever a payment is verified",
      triggerEvent: "payment.verified",
      conditionsJson: {},
      actionType: "recalculate_health",
      actionConfigJson: {},
      priority: 90,
      isEnabled: true,
    },
    {
      ruleCode: "resegment_on_conversion",
      ruleName: "Re-segment Customer on Conversion",
      description: "Re-evaluate customer segment whenever a service request converts",
      triggerEvent: "service_request.converted",
      conditionsJson: {},
      actionType: "resegment_customer",
      actionConfigJson: {},
      priority: 85,
      isEnabled: true,
    },
  ];

  for (const rule of defaults) {
    const [existing] = await db
      .select({ id: aiAutomationRulesTable.id })
      .from(aiAutomationRulesTable)
      .where(eq(aiAutomationRulesTable.ruleCode, rule.ruleCode))
      .limit(1);
    if (!existing) {
      await db.insert(aiAutomationRulesTable).values(rule);
      logger.info({ ruleCode: rule.ruleCode }, "[automation] seeded rule");
    }
  }
}

// ── Evaluate rules for an event ───────────────────────────────────────────────

export async function evaluateRulesForEvent(opts: {
  eventType: string;
  eventId?: string;
  payload: Record<string, unknown>;
  customerProfileId?: number | null;
}): Promise<AutomationResult[]> {
  const { eventType, eventId, payload, customerProfileId } = opts;

  // Load enabled rules that match this event type
  const rules = await db
    .select()
    .from(aiAutomationRulesTable)
    .where(
      and(
        eq(aiAutomationRulesTable.triggerEvent, eventType),
        eq(aiAutomationRulesTable.isEnabled, true),
      ),
    )
    .orderBy(desc(aiAutomationRulesTable.priority));

  const results: AutomationResult[] = [];

  for (const rule of rules) {
    try {
      const conditionsMet = checkConditions(rule.conditionsJson as Record<string, unknown>, payload);
      if (!conditionsMet) {
        results.push({ ruleId: rule.id, ruleCode: rule.ruleCode, status: "skipped", action: rule.actionType, detail: { reason: "conditions_not_met" } });
        continue;
      }

      const actionResult = await executeAction(rule, payload, customerProfileId ?? null);

      // Log execution
      await db.insert(aiAutomationExecutionsTable).values({
        ruleId: rule.id,
        triggerEventId: eventId,
        triggerEventType: eventType,
        customerProfileId: customerProfileId ?? null,
        status: actionResult.ok ? "success" : "failed",
        resultJson: actionResult.data,
      });

      // Increment rule counter
      await db
        .update(aiAutomationRulesTable)
        .set({
          executionCount: sql`${aiAutomationRulesTable.executionCount} + 1`,
          lastExecutedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(aiAutomationRulesTable.id, rule.id));

      await logAudit("automation", "rule_executed", String(rule.id), "ai_automation_rule", "success", {
        ruleCode: rule.ruleCode, action: rule.actionType, eventType,
      });

      results.push({
        ruleId: rule.id,
        ruleCode: rule.ruleCode,
        status: actionResult.ok ? "success" : "failed",
        action: rule.actionType,
        detail: actionResult.data ?? {},
      });
    } catch (err) {
      logger.error({ err, ruleCode: rule.ruleCode }, "[automation] rule evaluation error");
      results.push({ ruleId: rule.id, ruleCode: rule.ruleCode, status: "failed", action: rule.actionType, detail: { error: String(err) } });
    }
  }

  return results;
}

// ── Condition checker ─────────────────────────────────────────────────────────

function checkConditions(conditions: Record<string, unknown>, payload: Record<string, unknown>): boolean {
  for (const [key, expected] of Object.entries(conditions)) {
    const actual = payload[key];
    if (actual === undefined) return false;
    if (typeof expected === "object" && expected !== null) {
      const cond = expected as Record<string, unknown>;
      if ("gte" in cond && Number(actual) < Number(cond.gte)) return false;
      if ("lte" in cond && Number(actual) > Number(cond.lte)) return false;
      if ("eq" in cond && actual !== cond.eq) return false;
      if ("gt" in cond && Number(actual) <= Number(cond.gt)) return false;
    } else if (actual !== expected) {
      return false;
    }
  }
  return true;
}

// ── Action executor ───────────────────────────────────────────────────────────

async function executeAction(
  rule: AiAutomationRule,
  payload: Record<string, unknown>,
  customerProfileId: number | null,
): Promise<{ ok: boolean; data?: Record<string, unknown> }> {
  const config = (rule.actionConfigJson ?? {}) as Record<string, unknown>;

  switch (rule.actionType) {
    case "recommend_coupon": {
      publishSafe({
        eventType: "automation.coupon_recommended",
        sourceModule: "commercial-automation",
        sourceId: rule.ruleCode,
        payload: { ruleCode: rule.ruleCode, customerProfileId, config, triggeredBy: payload },
      });
      return { ok: true, data: { action: "coupon_recommended", customerProfileId } };
    }

    case "send_reminder": {
      publishSafe({
        eventType: "automation.reminder_sent",
        sourceModule: "commercial-automation",
        sourceId: rule.ruleCode,
        payload: { ruleCode: rule.ruleCode, customerProfileId, config, triggeredBy: payload },
      });
      return { ok: true, data: { action: "reminder_sent", customerProfileId } };
    }

    case "vip_promotion": {
      publishSafe({
        eventType: "automation.vip_promotion_triggered",
        sourceModule: "commercial-automation",
        sourceId: rule.ruleCode,
        payload: { ruleCode: rule.ruleCode, customerProfileId, config, triggeredBy: payload },
      });
      return { ok: true, data: { action: "vip_promotion_triggered", customerProfileId } };
    }

    case "upgrade_commission": {
      publishSafe({
        eventType: "automation.commission_upgraded",
        sourceModule: "commercial-automation",
        sourceId: rule.ruleCode,
        payload: { ruleCode: rule.ruleCode, affiliateId: payload.affiliateId, config },
      });
      return { ok: true, data: { action: "commission_upgraded", affiliateId: payload.affiliateId } };
    }

    case "recalculate_health":
    case "resegment_customer": {
      // These are handled by dedicated handlers in eventHandlerRegistry
      publishSafe({
        eventType: `automation.${rule.actionType}`,
        sourceModule: "commercial-automation",
        sourceId: rule.ruleCode,
        payload: { ruleCode: rule.ruleCode, customerProfileId, triggeredBy: payload },
      });
      return { ok: true, data: { action: rule.actionType, customerProfileId } };
    }

    default:
      return { ok: false, data: { error: `Unknown action: ${rule.actionType}` } };
  }
}

// ── Admin stats ───────────────────────────────────────────────────────────────

export async function getAutomationStats(): Promise<{
  totalRules: number;
  enabledRules: number;
  totalExecutions: number;
  recentExecutions: typeof aiAutomationExecutionsTable.$inferSelect[];
  byAction: Record<string, number>;
}> {
  const [rules, executions] = await Promise.all([
    db.select().from(aiAutomationRulesTable),
    db
      .select()
      .from(aiAutomationExecutionsTable)
      .orderBy(desc(aiAutomationExecutionsTable.executedAt))
      .limit(50),
  ]);

  const byAction: Record<string, number> = {};
  for (const rule of rules) {
    byAction[rule.actionType] = (byAction[rule.actionType] ?? 0) + rule.executionCount;
  }

  return {
    totalRules: rules.length,
    enabledRules: rules.filter((r) => r.isEnabled).length,
    totalExecutions: executions.length,
    recentExecutions: executions,
    byAction,
  };
}
