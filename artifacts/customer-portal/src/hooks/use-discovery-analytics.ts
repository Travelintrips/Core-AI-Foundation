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
    if (!goalSlug || tracked.current || !ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !tracked.current) {
          tracked.current = true;
          trackGoalCardViewed(goalSlug);
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, goalSlug]);
}

/** Attach to a service card element ref to track when it becomes visible. */
export function useTrackServiceCardViewed(
  ref: React.RefObject<Element | null>,
  serviceCode: string | null | undefined,
  source?: DiscoverySource,
): void {
  const tracked = useRef(false);
  useEffect(() => {
    if (!serviceCode || tracked.current || !ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !tracked.current) {
          tracked.current = true;
          trackServiceCardViewed(serviceCode, source);
          observer.disconnect();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, serviceCode, source]);
}

/** Attach to a collection element ref to track when it becomes visible. */
export function useTrackCollectionViewed(
  ref: React.RefObject<Element | null>,
  collectionSlug: string | null | undefined,
): void {
  const tracked = useRef(false);
  useEffect(() => {
    if (!collectionSlug || tracked.current || !ref.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !tracked.current) {
          tracked.current = true;
          trackCollectionViewed(collectionSlug);
          observer.disconnect();
        }
      },
      { threshold: 0.4 },
    );
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [ref, collectionSlug]);
}

// ── Action callbacks (stable references) ─────────────────────────────────────

/** Returns stable tracking callbacks for service interaction. */
export function useServiceAnalytics(serviceCode: string | null | undefined) {
  const onServiceOpened = useCallback(
    (source?: DiscoverySource) => {
      if (serviceCode) trackServiceOpened(serviceCode, source);
    },
    [serviceCode],
  );

  const onSelectedFromGoal = useCallback(
    (goalSlug: string) => {
      if (serviceCode) trackServiceSelectedFromGoal(goalSlug, serviceCode);
    },
    [serviceCode],
  );

  const onSelectedFromCollection = useCallback(
    (collectionSlug: string) => {
      if (serviceCode) trackServiceSelectedFromCollection(collectionSlug, serviceCode);
    },
    [serviceCode],
  );

  const onQuoteStarted = useCallback(
    (source?: DiscoverySource) => {
      if (serviceCode) trackQuoteStarted(serviceCode, source);
    },
    [serviceCode],
  );

  const onRequestStarted = useCallback(
    (source?: DiscoverySource) => {
      if (serviceCode) trackRequestStarted(serviceCode, source);
    },
    [serviceCode],
  );

  return { onServiceOpened, onSelectedFromGoal, onSelectedFromCollection, onQuoteStarted, onRequestStarted };
}

/** Returns stable tracking callbacks for collection interaction. */
export function useCollectionAnalytics(collectionSlug: string | null | undefined) {
  const onCollectionOpened = useCallback(() => {
    if (collectionSlug) trackCollectionOpened(collectionSlug);
  }, [collectionSlug]);

  const onServiceSelected = useCallback(
    (serviceCode: string) => {
      if (collectionSlug) trackCollectionServiceSelected(collectionSlug, serviceCode);
    },
    [collectionSlug],
  );

  return { onCollectionOpened, onServiceSelected };
}

/** Returns stable tracking callbacks for search interactions. */
export function useSearchAnalytics() {
  const onSearchStarted = useCallback(() => trackSearchStarted(), []);
  const onSearchCompleted = useCallback((count: number) => trackSearchCompleted(count), []);
  const onSearchEmpty = useCallback(() => trackSearchEmpty(), []);
  const onFilterApplied = useCallback((category: string) => trackFilterApplied(category), []);
  const onFilterRemoved = useCallback((category: string) => trackFilterRemoved(category), []);
  return { onSearchStarted, onSearchCompleted, onSearchEmpty, onFilterApplied, onFilterRemoved };
}

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
