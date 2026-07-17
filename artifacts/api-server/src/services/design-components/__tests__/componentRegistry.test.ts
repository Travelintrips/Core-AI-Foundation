/**
 * Team 8 — Component Registry Tests
 */

import { describe, it, expect } from "vitest";
import {
  listAllComponents,
  listComponentsByDomain,
  getComponentDefinition,
  getComponentBySlug,
  isValidComponentType,
  isValidDomain,
  getStats,
  listComponentTypes,
} from "../componentRegistry.js";

describe("componentRegistry", () => {
  describe("listAllComponents", () => {
    it("returns 29 total component definitions", () => {
      const all = listAllComponents();
      expect(all).toHaveLength(29);
    });

    it("every definition has required fields", () => {
      for (const def of listAllComponents()) {
        expect(def.type, `${def.type} missing type`).toBeTruthy();
        expect(def.domain, `${def.type} missing domain`).toBeTruthy();
        expect(def.name, `${def.type} missing name`).toBeTruthy();
        expect(def.slug, `${def.type} missing slug`).toBeTruthy();
        expect(def.description, `${def.type} missing description`).toBeTruthy();
        expect(def.version, `${def.type} missing version`).toBeTruthy();
        expect(def.supportedDomains.length, `${def.type} must support at least one domain`).toBeGreaterThan(0);
        expect(Object.keys(def.properties).length, `${def.type} must have at least one property`).toBeGreaterThan(0);
        expect(Array.isArray(def.constraints), `${def.type} constraints must be array`).toBe(true);
        expect(Array.isArray(def.tags), `${def.type} tags must be array`).toBe(true);
      }
    });

    it("slugs are unique across the registry", () => {
      const slugs = listAllComponents().map((c) => c.slug);
      const unique = new Set(slugs);
      expect(unique.size).toBe(slugs.length);
    });

    it("types are unique across the registry", () => {
      const types = listAllComponents().map((c) => c.type);
      const unique = new Set(types);
      expect(unique.size).toBe(types.length);
    });

    it("every slug matches pattern [a-z0-9-]+", () => {
      for (const def of listAllComponents()) {
        expect(def.slug).toMatch(/^[a-z0-9-]+$/);
      }
    });
  });

  describe("getStats", () => {
    it("returns correct counts per domain", () => {
      const stats = getStats();
      expect(stats.total).toBe(29);
      expect(stats.byDomain.graphic).toBe(8);
      expect(stats.byDomain.interior).toBe(6);
      expect(stats.byDomain.fashion).toBe(7);
      expect(stats.byDomain.packaging).toBe(8);
    });
  });

  describe("listComponentsByDomain", () => {
    it("returns 8 graphic components", () => {
      const comps = listComponentsByDomain("graphic");
      expect(comps.length).toBeGreaterThanOrEqual(8);
      expect(comps.every((c) => c.supportedDomains.includes("graphic"))).toBe(true);
    });

    it("returns 6 interior components", () => {
      const comps = listComponentsByDomain("interior");
      // only interior-primary components
      const primaryOnly = comps.filter((c) => c.domain === "interior");
      expect(primaryOnly).toHaveLength(6);
    });

    it("returns 7 fashion components", () => {
      const comps = listComponentsByDomain("fashion");
      const primaryOnly = comps.filter((c) => c.domain === "fashion");
      expect(primaryOnly).toHaveLength(7);
    });

    it("returns 8 packaging components", () => {
      const comps = listComponentsByDomain("packaging");
      const primaryOnly = comps.filter((c) => c.domain === "packaging");
      expect(primaryOnly).toHaveLength(8);
    });

    it("returns empty array for unknown domain", () => {
      expect(listComponentsByDomain("unknown" as any)).toEqual([]);
    });
  });

  describe("getComponentDefinition", () => {
    it("returns definition for each registered type", () => {
      const types = listComponentTypes();
      for (const type of types) {
        const def = getComponentDefinition(type);
        expect(def, `Definition missing for type: ${type}`).toBeDefined();
        expect(def!.type).toBe(type);
      }
    });

    it("returns undefined for unknown type", () => {
      expect(getComponentDefinition("unknown_type" as any)).toBeUndefined();
    });

    // Spot-check specific types
    it("graphic text has content and fontFamily properties", () => {
      const def = getComponentDefinition("text");
      expect(def).toBeDefined();
      expect(def!.domain).toBe("graphic");
      expect(def!.properties.content).toBeDefined();
      expect(def!.properties.fontFamily).toBeDefined();
    });

    it("packaging barcode has barcodeType and value properties", () => {
      const def = getComponentDefinition("barcode");
      expect(def).toBeDefined();
      expect(def!.domain).toBe("packaging");
      expect(def!.properties.barcodeType).toBeDefined();
      expect(def!.properties.value).toBeDefined();
    });

    it("fashion body_panel has panelSide and garmentType", () => {
      const def = getComponentDefinition("body_panel");
      expect(def).toBeDefined();
      expect(def!.domain).toBe("fashion");
      expect(def!.properties.panelSide.required).toBe(true);
      expect(def!.properties.garmentType.required).toBe(true);
    });

    it("interior sofa has seating capacity", () => {
      const def = getComponentDefinition("sofa");
      expect(def).toBeDefined();
      expect(def!.domain).toBe("interior");
      expect(def!.properties.seatingCapacity).toBeDefined();
    });
  });

  describe("getComponentBySlug", () => {
    it("finds graphic-text by slug", () => {
      const def = getComponentBySlug("graphic-text");
      expect(def).toBeDefined();
      expect(def!.type).toBe("text");
    });

    it("finds packaging-barcode by slug", () => {
      const def = getComponentBySlug("packaging-barcode");
      expect(def).toBeDefined();
      expect(def!.type).toBe("barcode");
    });

    it("returns undefined for unknown slug", () => {
      expect(getComponentBySlug("does-not-exist")).toBeUndefined();
    });
  });

  describe("isValidComponentType", () => {
    it("returns true for all registered types", () => {
      for (const type of listComponentTypes()) {
        expect(isValidComponentType(type)).toBe(true);
      }
    });

    it("returns false for unknown types", () => {
      expect(isValidComponentType("unknown")).toBe(false);
      expect(isValidComponentType("")).toBe(false);
      expect(isValidComponentType("TEXT")).toBe(false); // case-sensitive
    });
  });

  describe("isValidDomain", () => {
    it("accepts all four domains", () => {
      expect(isValidDomain("graphic")).toBe(true);
      expect(isValidDomain("interior")).toBe(true);
      expect(isValidDomain("fashion")).toBe(true);
      expect(isValidDomain("packaging")).toBe(true);
    });

    it("rejects invalid domains", () => {
      expect(isValidDomain("GRAPHIC")).toBe(false);
      expect(isValidDomain("print")).toBe(false);
      expect(isValidDomain("")).toBe(false);
    });
  });

  describe("domain support correctness", () => {
    it("interior components do NOT support packaging domain", () => {
      const interior = listComponentsByDomain("interior").filter((c) => c.domain === "interior");
      for (const comp of interior) {
        expect(comp.supportedDomains.includes("packaging")).toBe(false);
      }
    });

    it("logo supports fashion domain (cross-domain)", () => {
      const logo = getComponentDefinition("logo");
      expect(logo!.supportedDomains).toContain("fashion");
    });

    it("chart only supports graphic domain", () => {
      const chart = getComponentDefinition("chart");
      expect(chart!.supportedDomains).toEqual(["graphic"]);
    });
  });

  describe("property field definitions", () => {
    it("every required property has a label", () => {
      for (const def of listAllComponents()) {
        for (const [key, field] of Object.entries(def.properties)) {
          expect(field.label, `${def.type}.${key} must have a label`).toBeTruthy();
        }
      }
    });

    it("enum fields have non-empty options arrays", () => {
      for (const def of listAllComponents()) {
        for (const [key, field] of Object.entries(def.properties)) {
          if (field.type === "enum") {
            expect(field.options, `${def.type}.${key} enum must have options`).toBeDefined();
            expect(field.options!.length, `${def.type}.${key} enum must have at least one option`).toBeGreaterThan(0);
          }
        }
      }
    });

    it("numeric fields have consistent min <= max when both set", () => {
      for (const def of listAllComponents()) {
        for (const [key, field] of Object.entries(def.properties)) {
          if (field.min !== undefined && field.max !== undefined) {
            expect(field.min, `${def.type}.${key} min must be <= max`).toBeLessThanOrEqual(field.max);
          }
        }
      }
    });
  });
});
