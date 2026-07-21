/**
 * Universal Property Panel — Security Utilities
 *
 * Rules:
 * - NEVER render raw HTML from plugin-supplied strings.
 * - All labels, descriptions, placeholders must be sanitized to plain text.
 * - No dangerouslySetInnerHTML anywhere in the panel.
 * - No arbitrary component/module loading from URLs.
 * - No secret metadata exposed through the panel.
 */

/**
 * Sanitize a string from plugin/external source so it cannot inject HTML.
 * Returns a plain text string safe for use as React children (text node).
 * In React, setting {sanitizeLabel(str)} as a text child is always safe —
 * React does NOT render it as HTML. This function provides a defense-in-depth
 * layer and ensures we don't accidentally pass strings to dangerous APIs.
 */
export function sanitizeLabel(input: unknown): string {
  if (input === null || input === undefined) return "";
  const str = String(input);
  // First pass: strip content of executable tags (script, style, iframe, etc.)
  const noScripts = str
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "");
  // Second pass: strip all remaining HTML tags (self-closing, attributes, etc.)
  return noScripts.replace(/<[^>]*>/g, "").trim();
}

/**
 * Generate a stable, safe input element ID from section and field IDs.
 * Used for label[htmlFor] / input[id] pairing (accessibility).
 *
 * Only uses alphanumeric + hyphen/underscore characters from the input.
 */
export function generateInputId(sectionId: string, fieldId: string): string {
  const safe = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `prop-${safe(sectionId)}-${safe(fieldId)}`;
}

/**
 * Assert a value is safe to use as a property value (no executable content).
 * Returns true if the value is a plain scalar or structured data.
 * Rejects values that look like functions or HTML strings with scripts.
 */
export function isValueSafe(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "function") return false;
  if (typeof value === "string") {
    // Reject strings containing <script or javascript: protocol
    const lower = value.toLowerCase();
    if (lower.includes("<script") || lower.includes("javascript:")) {
      return false;
    }
  }
  return true;
}

/**
 * Sanitize a PropertyValue before storing/sending.
 * Clears strings that contain unsafe content.
 */
export function sanitizePropertyValue(
  value: unknown,
): import("./types").PropertyValue {
  if (!isValueSafe(value)) return null;
  return value as import("./types").PropertyValue;
}
