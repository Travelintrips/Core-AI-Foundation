# ADR-004: Asset Storage via Supabase S3-Compatible Object Storage

**Status:** Accepted
**Date:** 2026-07-26
**Phase:** Material Phase 5 (pattern established in earlier phases)

---

## Context

Material records include binary assets: reference images (texture photos, finish samples), supplier PDFs, and AI-generated render thumbnails. These assets must be:

- Durably stored (survive server restarts and redeployments)
- Accessible via stable URLs for use in the admin UI and customer-facing deliverables
- Tenant-isolated (one tenant cannot access another's assets)
- Manageable without adding a separate storage service to the infrastructure

---

## Decision

Use **Supabase S3-compatible object storage** (accessed via the Supabase Storage API) as the single asset storage layer for all material-related binaries.

- Bucket: `ai-assets` (created idempotently at server startup via `supabaseStorage.ts`)
- Storage paths follow the pattern: `{tenantId}/{domain}/{recordId}/{filename}`
- Asset URLs stored in material/staging records as `asset_urls` (JSONB array)
- Checksums validated before writing to detect corruption or duplicate uploads
- Signed URLs generated on-demand for private assets; public URLs used for published catalog images

---

## Alternatives Considered

### Replit Object Storage (App Storage)
Use Replit's built-in object storage. Rejected — not available at the project's storage scale; Supabase storage already present as the database layer, so unifying on Supabase reduces operational complexity.

### Local Filesystem
Store assets on the server's local filesystem. Rejected — not durable across server restarts/redeployments on Replit; not horizontally scalable; no CDN.

### Separate S3 Bucket (AWS/GCP)
Use a cloud provider S3 bucket. Rejected — adds a separate service dependency with separate credentials; Supabase Storage provides S3-compatible API with the existing Supabase project, keeping the dependency count low.

### Store Assets in Database (BYTEA)
Store binary assets as BLOBs in PostgreSQL. Rejected — degrades database performance for large binaries; prevents CDN delivery; significantly increases database storage costs.

---

## Consequences

**Positive:**
- Single infrastructure dependency (Supabase) for both database and storage
- S3-compatible API means standard tooling and SDK patterns apply
- Bucket `ai-assets` is shared across domains, reducing per-feature setup
- Signed URLs allow time-limited private access without exposing permanent links

**Negative:**
- Supabase storage billing is separate from database billing
- Supabase outage affects both database and asset availability simultaneously
- Cross-region latency if storage region differs from API server region

**Security note:**
- Asset URLs from external sources (OCR, supplier uploads) are validated against an SSRF allowlist before being fetched and stored — prevents server-side request forgery attacks
