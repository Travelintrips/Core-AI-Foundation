/**
 * use-discovery-analytics.ts — V4.2I React Analytics Hooks
 *
 * Thin React wrappers around the analytics client.
 *
 * Rules:
 *  - useEffect-based hooks fire only once on mount (not on every render)
 *  - Intersection observer hooks use a threshold so cards must be meaningfully visible
 *  - All hooks are safe to call before the component is mounted (no-op SSR)
 */

import { useEffect, useRef, useCallback } from "react";
import {
  trackMarketplaceViewed,
  trackGoalDiscoveryViewed,
  trackGoalCardViewed,
  trackGoalOpened,
  trackGoalServicesLoaded,
  trackGoalEmptyState,
  trackGoalError,
  trackSearchStarted,
  trackSearchCompleted,
  trackSearchEmpty,
  trackFilterApplied,
  trackFilterRemoved,
  trackServiceCardViewed,
  trackServiceOpened,
  trackServiceSelectedFromGoal,
  trackServiceSelectedFromCollection,
  trackQuoteStarted,
  trackRequestStarted,
  trackCollectionViewed,
  trackCollectionOpened,
  trackCollectionServiceSelected,
  trackQuoteFormViewed,
  trackQuoteSubmitted,
  trackRequestFormViewed,
  trackRequestSubmitted,
  trackCheckoutStarted,
  trackPaymentStarted,
  trackOrderCreated,
  type DiscoverySource,
} from "../lib/analytics.js";

// ── Page-level hooks (fire once on mount) ─────────────────────────────────────

/** Track marketplace page view. Call at the top of the marketplace page. */
export function useTrackMarketplaceViewed(): void {
  useEffect(() => {
    trackMarketplaceViewed();
  }, []);
}

/** Track goal discovery section view. Pass `visible` from intersection logic. */
export function useTrackGoalDiscoveryViewed(visible: boolean): void {
  const tracked = useRef(false);
  useEffect(() => {
    if (visible && !tracked.current) {
      tracked.current = true;
      trackGoalDiscoveryViewed();
    }
  }, [visible]);
}

// ── Goal detail hooks ─────────────────────────────────────────────────────────

/** Track when a goal detail page is opened. */
export function useTrackGoalOpened(goalSlug: string | null | undefined): void {
  const tracked = useRef<string | null>(null);
  useEffect(() => {
    if (goalSlug && tracked.current !== goalSlug) {
      tracked.current = goalSlug;
      trackGoalOpened(goalSlug);
    }
  }, [goalSlug]);
}

/** Track goal services loaded state. */
export function useTrackGoalServicesLoaded(
  goalSlug: string | null | undefined,
  loaded: boolean,
  isEmpty: boolean,
  isError: boolean,
): void {
  const tracked = useRef(false);
  useEffect(() => {
    if (!goalSlug || !loaded || tracked.current) return;
    tracked.current = true;
    if (isError) trackGoalError(goalSlug);
    else if (isEmpty) trackGoalEmptyState(goalSlug);
    else trackGoalServicesLoaded(goalSlug);
  }, [goalSlug, loaded, isEmpty, isError]);
}

// ── Intersection-based card view tracking ─────────────────────────────────────

/** Attach to a goal card element ref to track when it becomes visible. */
export function useTrackGoalCardViewed(
  ref: React.RefObject<Element | null>,
  goalSlug: string | null | undefined,
): void {
  const tracked = useRef(false);
  useEffect(() => {
    if (!goalSlug || !ref.current || tracked.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !tracked.current) {
          tracked.current = true;
          trackGoalCardViewed(goalSlug);
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [goalSlug, ref]);
}

/** Attach to a service card element ref to track when it becomes visible. */
export function useTrackServiceCardViewed(
  ref: React.RefObject<Element | null>,
  serviceCode: string | null | undefined,
  source?: DiscoverySource,
): void {
  const tracked = useRef(false);
  useEffect(() => {
    if (!serviceCode || !ref.current || tracked.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !tracked.current) {
          tracked.current = true;
          trackServiceCardViewed(serviceCode, source);
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [serviceCode, source, ref]);
}

// ── Click-based callbacks ─────────────────────────────────────────────────────

/** Returns stable callback for service open tracking. */
export function useTrackServiceOpened(
  serviceCode: string | null | undefined,
  source?: DiscoverySource,
) {
  return useCallback(() => {
    if (serviceCode) trackServiceOpened(serviceCode, source);
  }, [serviceCode, source]);
}

/** Returns stable callback for service-from-goal tracking. */
export function useTrackServiceSelectedFromGoal(
  goalSlug: string | null | undefined,
  serviceCode: string | null | undefined,
) {
  return useCallback(() => {
    if (goalSlug && serviceCode) trackServiceSelectedFromGoal(goalSlug, serviceCode);
  }, [goalSlug, serviceCode]);
}

/** Returns stable callback for service-from-collection tracking. */
export function useTrackServiceSelectedFromCollection(
  collectionSlug: string | null | undefined,
  serviceCode: string | null | undefined,
) {
  return useCallback(() => {
    if (collectionSlug && serviceCode) trackServiceSelectedFromCollection(collectionSlug, serviceCode);
  }, [collectionSlug, serviceCode]);
}

/** Returns stable callbacks for quote + request start events. */
export function useTrackServiceActions(serviceCode: string | null | undefined, source?: DiscoverySource) {
  const onQuoteStarted = useCallback(() => {
    if (serviceCode) trackQuoteStarted(serviceCode, source);
  }, [serviceCode, source]);

  const onRequestStarted = useCallback(() => {
    if (serviceCode) trackRequestStarted(serviceCode, source);
  }, [serviceCode, source]);

  return { onQuoteStarted, onRequestStarted };
}

// ── Collection hooks ──────────────────────────────────────────────────────────

/** Track when a collection page is viewed. */
export function useTrackCollectionViewed(collectionSlug: string | null | undefined): void {
  const tracked = useRef<string | null>(null);
  useEffect(() => {
    if (collectionSlug && tracked.current !== collectionSlug) {
      tracked.current = collectionSlug;
      trackCollectionViewed(collectionSlug);
    }
  }, [collectionSlug]);
}

/** Track when a collection is opened (detail). */
export function useTrackCollectionOpened(collectionSlug: string | null | undefined): void {
  const tracked = useRef<string | null>(null);
  useEffect(() => {
    if (collectionSlug && tracked.current !== collectionSlug) {
      tracked.current = collectionSlug;
      trackCollectionOpened(collectionSlug);
    }
  }, [collectionSlug]);
}

/** Returns stable callback for collection service selected. */
export function useTrackCollectionServiceSelected(
  collectionSlug: string | null | undefined,
  serviceCode: string | null | undefined,
) {
  return useCallback(() => {
    if (collectionSlug && serviceCode) trackCollectionServiceSelected(collectionSlug, serviceCode);
  }, [collectionSlug, serviceCode]);
}

// ── Search hooks ──────────────────────────────────────────────────────────────

export function useTrackSearch() {
  const onSearchStarted = useCallback(() => trackSearchStarted(), []);
  const onSearchCompleted = useCallback((count: number) => trackSearchCompleted(count), []);
  const onSearchEmpty = useCallback(() => trackSearchEmpty(), []);
  const onFilterApplied = useCallback((code: string) => trackFilterApplied(code), []);
  const onFilterRemoved = useCallback((code: string) => trackFilterRemoved(code), []);
  return { onSearchStarted, onSearchCompleted, onSearchEmpty, onFilterApplied, onFilterRemoved };
}

// ── Conversion funnel hooks ───────────────────────────────────────────────────

/** Returns stable callbacks for conversion funnel. */
export function useConversionAnalytics(serviceCode?: string) {
  const onQuoteFormViewed = useCallback(() => {
    if (serviceCode) trackQuoteFormViewed(serviceCode);
  }, [serviceCode]);

  const onQuoteSubmitted = useCallback(
    (quoteId: string) => {
      if (serviceCode) trackQuoteSubmitted(quoteId, serviceCode);
    },
    [serviceCode],
  );

  const onRequestFormViewed = useCallback(() => {
    if (serviceCode) trackRequestFormViewed(serviceCode);
  }, [serviceCode]);

  const onRequestSubmitted = useCallback(
    (requestId: string) => {
      if (serviceCode) trackRequestSubmitted(requestId, serviceCode);
    },
    [serviceCode],
  );

  const onCheckoutStarted = useCallback(() => {
    if (serviceCode) trackCheckoutStarted(serviceCode);
  }, [serviceCode]);

  const onPaymentStarted = useCallback(() => {
    if (serviceCode) trackPaymentStarted(serviceCode);
  }, [serviceCode]);

  const onOrderCreated = useCallback(
    (orderId: string) => {
      if (serviceCode) trackOrderCreated(orderId, serviceCode);
    },
    [serviceCode],
  );

  return {
    onQuoteFormViewed,
    onQuoteSubmitted,
    onRequestFormViewed,
    onRequestSubmitted,
    onCheckoutStarted,
    onPaymentStarted,
    onOrderCreated,
  };
}
