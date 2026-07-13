/**
 * Service profile registry (section 10).
 *
 * Reuses the existing ServiceType from brief-service-config.ts — no new
 * service taxonomy is invented. Each profile lists which recommendation
 * categories matter most for that service, in priority order, plus optional
 * per-category limit overrides.
 */

import type { ServiceType } from "@/config/brief-service-config";
import type { RecommendationCategory, ServiceProfile } from "./types";

const ALL_CATEGORIES: RecommendationCategory[] = [
  "style", "color", "audience", "personality", "deliverable",
  "toneOfVoice", "photographyDirection", "visualDirection", "contentDirection",
];

export const SERVICE_PROFILES: Record<ServiceType, ServiceProfile> = {
  brand_identity: {
    serviceType: "brand_identity",
    priorityCategories: ["personality", "style", "color", "toneOfVoice", "audience", "visualDirection", "contentDirection", "deliverable", "photographyDirection"],
  },
  logo_design: {
    serviceType: "logo_design",
    priorityCategories: ["style", "color", "personality", "visualDirection", "audience", "toneOfVoice", "deliverable", "contentDirection", "photographyDirection"],
    categoryLimits: { style: 3, color: 3 },
  },
  company_profile: {
    serviceType: "company_profile",
    priorityCategories: ["deliverable", "contentDirection", "toneOfVoice", "personality", "style", "color", "audience", "photographyDirection", "visualDirection"],
  },
  pitch_deck: {
    serviceType: "pitch_deck",
    priorityCategories: ["contentDirection", "audience", "toneOfVoice", "deliverable", "style", "personality", "color", "visualDirection", "photographyDirection"],
  },
  social_media: {
    serviceType: "social_media",
    priorityCategories: ["contentDirection", "audience", "toneOfVoice", "photographyDirection", "style", "color", "deliverable", "personality", "visualDirection"],
  },
  copywriting: {
    serviceType: "copywriting",
    priorityCategories: ["toneOfVoice", "audience", "contentDirection", "personality", "deliverable", "style", "color", "visualDirection", "photographyDirection"],
  },
  image_generation: {
    serviceType: "image_generation",
    priorityCategories: ["photographyDirection", "visualDirection", "style", "color", "contentDirection", "audience", "personality", "toneOfVoice", "deliverable"],
  },
  default: {
    serviceType: "default",
    priorityCategories: ALL_CATEGORIES,
  },
};

export function getServiceProfile(serviceType: ServiceType): ServiceProfile {
  return SERVICE_PROFILES[serviceType] ?? SERVICE_PROFILES.default;
}
