/**
 * Built-in Blueprint Registry (Team 7)
 *
 * All 6 domain blueprints are served from code — no DB row required.
 * Custom (user-created) blueprints layer on top via blueprintService.
 */

import { graphicDesignBlueprint } from "./graphic-design.js";
import { presentationBlueprint } from "./presentation.js";
import { interiorBlueprint } from "./interior.js";
import { fashionBlueprint } from "./fashion.js";
import { packagingBlueprint } from "./packaging.js";
import { productDesignBlueprint } from "./product-design.js";
import { jewelryBlueprint } from "./jewelry.js";
import type { Blueprint, BlueprintDomain } from "../types.js";

export const BUILTIN_BLUEPRINTS: readonly Blueprint[] = Object.freeze([
  graphicDesignBlueprint,
  presentationBlueprint,
  interiorBlueprint,
  fashionBlueprint,
  packagingBlueprint,
  productDesignBlueprint,
  jewelryBlueprint,
]);

export const BUILTIN_BLUEPRINT_MAP: ReadonlyMap<string, Blueprint> = new Map(
  BUILTIN_BLUEPRINTS.map((bp) => [bp.id, bp])
);

export const BUILTIN_BLUEPRINT_BY_SLUG: ReadonlyMap<string, Blueprint> = new Map(
  BUILTIN_BLUEPRINTS.map((bp) => [bp.slug, bp])
);

export const BUILTIN_BLUEPRINT_BY_DOMAIN: ReadonlyMap<BlueprintDomain, Blueprint[]> = new Map(
  BUILTIN_BLUEPRINTS.reduce((acc, bp) => {
    const existing = acc.get(bp.domain) ?? [];
    acc.set(bp.domain, [...existing, bp]);
    return acc;
  }, new Map<BlueprintDomain, Blueprint[]>())
);
