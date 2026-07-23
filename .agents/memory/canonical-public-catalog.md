---
name: Canonical public catalog
description: Rules for the six-category Creative AI discovery catalog and its additive legacy compatibility model
---

The public Creative AI discovery catalog is intentionally limited to six canonical categories: brand-identity, content-marketing, ai-visual-design, presentation-documents, product-commercial, and specialized-design. Legacy categories and service IDs remain available internally and for historical compatibility.

**Why:** The catalog was simplified for customer discovery without breaking existing quotation, payment, workflow, project, artifact, or history records.

**How to apply:** Keep historical `category_id` values unchanged; use the additive canonical parent/metadata fields for public grouping. Public category normalization must be idempotent, and legacy rows must be archived or made internal rather than deleted.