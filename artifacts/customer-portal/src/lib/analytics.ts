/**
 * analytics.ts — V4.2I Typed Analytics Client
 *
 * Privacy-safe, non-blocking analytics for the Customer Portal.
 *
 * RULES:
 *  - All calls are fire-and-forget; failures are logged in dev, silenced in prod
 *  - Events fire once per meaningful action (dedup via eventId UUID per call)
 *  - No PII is collected (no names, emails, phone numbers)
 *  - Anonymous session ID is generated client-side and stored in sessionStorage
 *  - If the analytics flag is disabled, all tracking is suppressed
 *  - No tracking during initial static render (checks for window)
 */

const API_BASE = import.meta.env["BASE_URL"]?.replace(/\/$/, "") ?? "";
const IS_DEV = import.meta.env["DEV"] === true;

// ── Session identity (privacy-safe) ──────────────────────────────────────────

function getSessionId(): string {
  if (typeof window === "undefined") return "ssr";
  let sid = sessionStorage.getItem("_dsid");
  if (!sid) {
    sid = crypto.randomUUID();
    sessionStorage.setItem("_dsid", sid);
  }
  return sid;
}

function getAnonymousUserId(): string {
  if (typeof window === "undefined") return "ssr";
  let uid = localStorage.getItem("_dauid");
  if (!uid) {
    uid = crypto.randomUUID();
    localStorage.setItem("_dauid", uid);
  }
  return uid;
}

// ── Feature flag check ────────────────────────────────────────────────────────

let _analyticsEnabled: boolean | null = null;

async function isAnalyticsEnabled(): Promise<boolean> {
  if (_analyticsEnabled !== null) return _analyticsEnabled;
  try {
    const res = await fetch(
      `${API_BASE}/api/analytics/flags/v4_2_discovery_analytics_enabled?session_id=${getSessionId()}`,
      { signal: AbortSignal.timeout(2000) },
    );
    if (!res.ok) { _analyticsEnabled = true; return true; } // fail-open
    const data = (await res.json()) as { enabled: boolean };
    _analyticsEnabled = data.enabled ?? true;
    return _analyticsEnabled;
  } catch {
    _analyticsEnabled = true; // fail-open if flag check fails
    return true;
  }
}

// ── Event payload ─────────────────────────────────────────────────────────────

export type DiscoverySource =
  | "direct_catalog"
  | "goal_discovery"
  | "goal_detail"
  | "solution_collection"
  | "search"
  | "category_filter"
  | "related_service"
  | "external_campaign";

export interface DiscoveryEventPayload {
  eventName: string;
  source?: DiscoverySource;
  goalSlug?: string;
  serviceCode?: string;
  collectionSlug?: string;
  categoryCode?: string;
  requestId?: string;
  quoteId?: string;
  orderId?: string;
  experimentKey?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

// ── Core send function ────────────────────────────────────────────────────────

function send(payload: DiscoveryEventPayload): void {
  if (typeof window === "undefined") return; // no SSR tracking

  // Fire-and-forget — intentionally not awaited
  void (async () => {
    try {
      const enabled = await isAnalyticsEnabled();
      if (!enabled) return;

      const body = {
        eventId: crypto.randomUUID(),
        eventName: payload.eventName,
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        sessionId: getSessionId(),
        anonymousUserId: getAnonymousUserId(),
        pagePath: window.location.pathname,
        referrerType: document.referrer ? "web" : "direct",
        source: payload.source,
        goalSlug: payload.goalSlug,
        serviceCode: payload.serviceCode,
        collectionSlug: payload.collectionSlug,
        categoryCode: payload.categoryCode,
        requestId: payload.requestId,
        quoteId: payload.quoteId,
        orderId: payload.orderId,
        experimentKey: payload.experimentKey,
        metadata: payload.metadata,
      };

      await fetch(`${API_BASE}/api/analytics/discovery/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true, // survives page unload
        signal: AbortSignal.timeout(5000),
      });
    } catch {
      if (IS_DEV) console.debug("[analytics] event send failed (suppressed in prod)");
    }
  })();
}

// ── Typed tracking functions ──────────────────────────────────────────────────

/** User opened the marketplace page */
export function trackMarketplaceViewed(): void {
  send({ eventName: "marketplace_viewed" });
}

/** Goal discovery section became visible */
export function trackGoalDiscoveryViewed(): void {
  send({ eventName: "goal_discovery_viewed" });
}

/** A goal card was visible in the viewport */
export function trackGoalCardViewed(goalSlug: string): void {
  send({ eventName: "goal_card_viewed", goalSlug });
}

/** User opened a goal detail */
export function trackGoalOpened(goalSlug: string): void {
  send({ eventName: "goal_opened", goalSlug });
}

/** Services for a goal were loaded successfully */
export function trackGoalServicesLoaded(goalSlug: string): void {
  send({ eventName: "goal_services_loaded", goalSlug });
}

/** Goal returned no services */
export function trackGoalEmptyState(goalSlug: string): void {
  send({ eventName: "goal_empty_state_viewed", goalSlug });
}

/** Goal detail produced an error */
export function trackGoalError(goalSlug: string): void {
  send({ eventName: "goal_error_viewed", goalSlug });
}

/** User started a catalog search */
export function trackSearchStarted(metadata?: { query?: string }): void {
  // Never log raw query — only log that a search happened
  send({ eventName: "catalog_search_started", metadata: metadata?.query ? { hasQuery: true } : undefined });
}

/** Search completed with results */
export function trackSearchCompleted(resultCount: number): void {
  send({ eventName: "catalog_search_completed", metadata: { resultCount } });
}

/** Search returned no results */
export function trackSearchEmpty(): void {
  send({ eventName: "catalog_search_empty" });
}

/** User applied a filter */
export function trackFilterApplied(categoryCode: string): void {
  send({ eventName: "catalog_filter_applied", categoryCode });
}

/** User removed a filter */
export function trackFilterRemoved(categoryCode: string): void {
  send({ eventName: "catalog_filter_removed", categoryCode });
}

/** Service card was visible in viewport */
export function trackServiceCardViewed(serviceCode: string, source?: DiscoverySource): void {
  send({ eventName: "service_card_viewed", serviceCode, source });
}

/** User opened a service detail page */
export function trackServiceOpened(serviceCode: string, source?: DiscoverySource): void {
  send({ eventName: "service_opened", serviceCode, source });
}

/** Service selected from a goal detail */
export function trackServiceSelectedFromGoal(goalSlug: string, serviceCode: string): void {
  send({ eventName: "service_selected_from_goal", goalSlug, serviceCode, source: "goal_discovery" });
}

/** Service selected from a collection */
export function trackServiceSelectedFromCollection(collectionSlug: string, serviceCode: string): void {
  send({ eventName: "service_selected_from_collection", collectionSlug, serviceCode, source: "solution_collection" });
}

/** User clicked "Get Quote" for a service */
export function trackQuoteStarted(serviceCode: string, source?: DiscoverySource): void {
  send({ eventName: "service_quote_started", serviceCode, source });
}

/** User clicked "Request Service" */
export function trackRequestStarted(serviceCode: string, source?: DiscoverySource): void {
  send({ eventName: "service_request_started", serviceCode, source });
}

export function trackCatalogCategoryViewed(categoryCode: string): void {
  send({ eventName: "catalog_category_view", categoryCode, source: "direct_catalog" });
}

export function trackCatalogServiceViewed(serviceCode: string, categoryCode?: string): void {
  send({ eventName: "catalog_service_view", serviceCode, categoryCode, source: "direct_catalog" });
}

export function trackCatalogServiceSelected(serviceCode: string, categoryCode?: string): void {
  send({ eventName: "catalog_service_selected", serviceCode, categoryCode, source: "direct_catalog" });
}

export function trackSmartChoiceStarted(): void {
  send({ eventName: "smart_choice_started", source: "direct_catalog" });
}

export function trackSmartChoiceRecommendation(categoryCode?: string): void {
  send({ eventName: "smart_choice_recommendation", categoryCode, source: "direct_catalog" });
}

export function trackSmartChoiceSelected(serviceCode: string, categoryCode?: string): void {
  send({ eventName: "smart_choice_selected", serviceCode, categoryCode, source: "direct_catalog" });
}

/** Solution collection became visible */
export function trackCollectionViewed(collectionSlug: string): void {
  send({ eventName: "solution_collection_viewed", collectionSlug });
}

/** User opened a solution collection */
export function trackCollectionOpened(collectionSlug: string): void {
  send({ eventName: "solution_collection_opened", collectionSlug });
}

/** User selected a service from inside a collection */
export function trackCollectionServiceSelected(collectionSlug: string, serviceCode: string): void {
  send({ eventName: "collection_service_selected", collectionSlug, serviceCode });
}

/** Quote form displayed */
export function trackQuoteFormViewed(serviceCode: string): void {
  send({ eventName: "quote_form_viewed", serviceCode });
}

/** Quote submitted */
export function trackQuoteSubmitted(quoteId: string, serviceCode: string): void {
  send({ eventName: "quote_submitted", quoteId, serviceCode });
}

/** Request form displayed */
export function trackRequestFormViewed(serviceCode: string): void {
  send({ eventName: "request_form_viewed", serviceCode });
}

/** Request submitted */
export function trackRequestSubmitted(requestId: string, serviceCode: string): void {
  send({ eventName: "request_submitted", requestId, serviceCode });
}

/** Checkout started */
export function trackCheckoutStarted(serviceCode: string): void {
  send({ eventName: "checkout_started", serviceCode });
}

/** Payment started */
export function trackPaymentStarted(serviceCode: string): void {
  send({ eventName: "payment_started", serviceCode });
}

/** Order created */
export function trackOrderCreated(orderId: string, serviceCode: string): void {
  send({ eventName: "order_created", orderId, serviceCode });
}
