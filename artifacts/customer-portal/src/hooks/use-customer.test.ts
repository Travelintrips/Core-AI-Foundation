import { describe, expect, it } from "vitest";
import { shouldPollPublicCreativeReview, type PublicProjectReview } from "./use-customer";

function review(overrides: Partial<PublicProjectReview> = {}): PublicProjectReview {
  return {
    reviewId: 1,
    projectId: "project-1",
    clientName: "Client",
    reviewStatus: "viewed",
    brandName: "Interior Test",
    businessType: "Interior Design",
    targetMarket: "Homeowner",
    productOrService: "Interior Design",
    goal: "Render a living room",
    status: "completed",
    assets: [],
    render: null,
    comments: [],
    createdAt: new Date(0).toISOString(),
    quotationStatus: null,
    quotationTotal: null,
    quotationCurrency: null,
    ...overrides,
  };
}

describe("shouldPollPublicCreativeReview", () => {
  it("keeps polling while the interior final render session is active even before asset rows exist", () => {
    expect(shouldPollPublicCreativeReview(review({
      render: { sessionId: 7, status: "final_generating", progress: 0, variantCount: 2 },
    }))).toBe(true);
  });

  it("keeps polling while an image asset is pending", () => {
    expect(shouldPollPublicCreativeReview(review({
      assets: [{ id: 1, imageUrl: null, aspectRatio: "16:9", status: "pending" }],
    }))).toBe(true);
  });

  it("stops polling after render completion when no other work is active", () => {
    expect(shouldPollPublicCreativeReview(review({
      render: { sessionId: 7, status: "completed", progress: 100, variantCount: 2 },
      assets: [{ id: 2, imageUrl: "https://example.test/render.webp", aspectRatio: "16:9", status: "completed", assetType: "interior_render", renderStage: "final" }],
    }))).toBe(false);
  });
});
