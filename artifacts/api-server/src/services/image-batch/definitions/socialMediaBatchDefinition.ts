/**
 * socialMediaBatchDefinition.ts — Phase 5 Creative Asset Batch Engine
 *
 * Social Media Design (catalog: social-media-design) — platform/aspect-ratio
 * breakdown from entitlement. Visually consistent (same brand/style brief)
 * but not identical copies — each platform gets its own composition brief.
 * Any headline/caption text is baked in via overlay, never diffusion-rendered.
 */

import type { GeneratedImageBatchItem, ImageBatchDefinition, ImageBatchItemSpec } from "../imageBatchTypes.js";

const PLATFORM_DIRECTIONS: Record<string, string> = {
  "instagram-feed": "Instagram feed post, square composition, bold central visual, on-brand color palette",
  "instagram-story": "Instagram story, vertical full-bleed composition, breathing room at top and bottom for UI overlays",
  "facebook-post": "Facebook post, wide landscape composition, clear focal point readable at small thumbnail size",
  "linkedin-post": "LinkedIn post, professional and polished composition, corporate-appropriate visual tone",
};

export const socialMediaBatchDefinition: ImageBatchDefinition = {
  batchType: "social_media",
  serviceCodes: ["social-media-design"],
  catalogFallback: {
    batchType: "social_media",
    zipRequired: true,
    totalItems: 4,
    groups: [
      { key: "instagram-feed", label: "Instagram Feed (1:1)", count: 1, aspectRatio: "1:1", platform: "instagram" },
      { key: "instagram-story", label: "Instagram Story (9:16)", count: 1, aspectRatio: "9:16", platform: "instagram" },
      { key: "facebook-post", label: "Facebook Post (16:9)", count: 1, aspectRatio: "16:9", platform: "facebook" },
      { key: "linkedin-post", label: "LinkedIn Post (1:1)", count: 1, aspectRatio: "1:1", platform: "linkedin" },
    ],
  },

  buildItems(entitlement, brief): ImageBatchItemSpec[] {
    return entitlement.groups.map((group) => {
      const direction = PLATFORM_DIRECTIONS[group.key] ?? `Social media visual for ${group.platform ?? "the brand"}`;
      return {
        itemKey: group.key,
        group: group.key,
        groupLabel: group.label,
        platform: group.platform,
        role: {
          role: `social_${group.key}`,
          label: group.label,
          promptHint: direction,
          aspectRatio: group.aspectRatio ?? "1:1",
          noText: true, // background stays text-free; real copy is baked in via overlay below
          overlay: { kind: "brandTagline" },
        },
      };
    });
  },

  validateBatch(items: GeneratedImageBatchItem[], entitlement) {
    const accepted = new Set(
      items.filter((i) => i.itemStatus === "completed").map((i) => i.group),
    );
    const missingGroups = entitlement.groups.map((g) => g.key).filter((k) => !accepted.has(k));
    return {
      ok: missingGroups.length === 0,
      missingGroups,
      completedCount: accepted.size,
      requiredCount: entitlement.groups.length,
    };
  },

  zipFolderFor(item) {
    return `social-media/${item.group}`;
  },
};
