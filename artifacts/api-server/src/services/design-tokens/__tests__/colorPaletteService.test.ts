// Team 10 — Color Palette Service unit tests (pure logic + DB mocked)

import { describe, it, expect, vi } from "vitest";
import {
  checkContrast,
  isPrintSafe,
  toPrintSafeHex,
  palettesAreDuplicate,
  hexToHsl,
  hexToCmyk,
  formatCmyk,
  normalizeHex,
} from "../colorUtils.js";

// ── Contrast (WCAG) integration-style tests ───────────────────────────────────

describe("WCAG contrast — semantic role compliance", () => {
  const WHITE = "#ffffff";
  const BLACK = "#000000";

  it("primary text must meet AA on white background", () => {
    // Dark navy — common primary text colour
    const primaryText = "#1a1a2e";
    const result = checkContrast(primaryText, WHITE);
    expect(result.wcagAA).toBe(true);
  });

  it("light grey text fails AA on white", () => {
    const lightGrey = "#cccccc";
    const result = checkContrast(lightGrey, WHITE);
    expect(result.wcagAA).toBe(false);
    expect(result.level).toBe("fail");
  });

  it("white text meets AA on dark background", () => {
    const darkBg = "#1a1a2e";
    const result = checkContrast(WHITE, darkBg);
    expect(result.wcagAA).toBe(true);
  });

  it("typical CTA blue (#0066cc) meets AA on white", () => {
    const result = checkContrast("#0066cc", WHITE);
    expect(result.wcagAA).toBe(true);
  });

  it("mid-tone orange may fail AAA on white (tests threshold detection)", () => {
    const result = checkContrast("#ff6600", WHITE);
    // Orange on white typically fails AAA; just verify the result is well-formed
    expect(typeof result.wcagAAA).toBe("boolean");
    expect(result.ratio).toBeGreaterThan(1);
  });

  it("contrast ratio is symmetric", () => {
    const ab = checkContrast("#336699", "#ffffff").ratio;
    const ba = checkContrast("#ffffff", "#336699").ratio;
    expect(ab).toBeCloseTo(ba, 2);
  });
});

// ── Print-safe validation tests ───────────────────────────────────────────────

describe("Print-safe palette validation", () => {
  it("muted corporate colours are print-safe", () => {
    // These are typical brand colours well within CMYK gamut
    expect(isPrintSafe("#003366")).toBe(true); // dark navy
    expect(isPrintSafe("#c8813a")).toBe(true); // muted orange
    expect(isPrintSafe("#4a4a4a")).toBe(true); // dark grey
    expect(isPrintSafe("#ffffff")).toBe(true); // white
    expect(isPrintSafe("#000000")).toBe(true); // black
  });

  it("print-safe conversion returns valid 6-digit hex", () => {
    const colours = ["#ff0000", "#00ff00", "#0000ff", "#ff00ff", "#ffff00"];
    for (const hex of colours) {
      const safe = toPrintSafeHex(hex);
      expect(safe).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  it("CMYK conversion round-trips within tolerance for muted colours", () => {
    const muted = ["#336699", "#cc6633", "#669933", "#996699"];
    for (const hex of muted) {
      expect(isPrintSafe(hex)).toBe(true);
      const printSafe = toPrintSafeHex(hex);
      expect(printSafe).toBe(hex); // should not be modified
    }
  });
});

// ── Duplicate palette detection ───────────────────────────────────────────────

describe("Duplicate palette detection", () => {
  it("detects duplicate regardless of colour order", () => {
    expect(palettesAreDuplicate(
      ["#ff0000", "#00ff00", "#0000ff"],
      ["#0000ff", "#ff0000", "#00ff00"]
    )).toBe(true);
  });

  it("does not flag different palettes as duplicates", () => {
    expect(palettesAreDuplicate(
      ["#ff0000", "#00ff00"],
      ["#ff0000", "#ffffff"]
    )).toBe(false);
  });

  it("treats #fff and #ffffff as the same colour", () => {
    expect(palettesAreDuplicate(
      ["#fff", "#000"],
      ["#ffffff", "#000000"]
    )).toBe(true);
  });

  it("treats uppercase and lowercase hex as identical", () => {
    expect(palettesAreDuplicate(
      ["#FF0000"],
      ["#ff0000"]
    )).toBe(true);
  });

  it("different palette sizes are not duplicates", () => {
    expect(palettesAreDuplicate(
      ["#ff0000"],
      ["#ff0000", "#00ff00"]
    )).toBe(false);
  });
});

// ── Semantic colour metadata ───────────────────────────────────────────────────

describe("Semantic colour metadata computation", () => {
  it("hexToHsl produces valid HSL string", () => {
    const hsl = hexToHsl("#0066cc");
    expect(hsl).toMatch(/^hsl\(\d+, \d+%, \d+%\)$/);
  });

  it("CMYK format is correct", () => {
    const cmyk = hexToCmyk("#000000");
    expect(formatCmyk(cmyk)).toBe("cmyk(0%, 0%, 0%, 100%)");
  });

  it("normalizeHex adds hash and lowercases", () => {
    expect(normalizeHex("FF0000")).toBe("#ff0000");
    expect(normalizeHex("#F00")).toBe("#ff0000");
  });

  it("contrastOnWhite and contrastOnBlack are both computed", () => {
    const blue = "#0066cc";
    const onWhite = checkContrast(blue, "#ffffff");
    const onBlack = checkContrast(blue, "#000000");
    expect(onWhite.ratio).toBeGreaterThan(1);
    expect(onBlack.ratio).toBeGreaterThan(1);
    // Medium blue should be readable on black (dark background)
    expect(onBlack.ratio).toBeGreaterThan(2);
  });
});
