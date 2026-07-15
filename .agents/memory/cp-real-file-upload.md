---
name: Company Profile real file upload (logo/photos/docs/video)
description: How the cp* asset fields moved from pasted-link text inputs to real object-storage uploads, and the auth gap that had to be fixed for it to work.
---

## What changed
`cpUploadedLogo` / `cpUploadedPhotos` / `cpReferenceDocuments` in the brief wizard were
`type="url"`/textarea fields where customers pasted a Google Drive link — no real upload
existed anywhere in the app despite `UploadDropzone.tsx` and the object-storage server
routes (`routes/storage.ts`) already being built. Added a `cpVideo` field (new — no video
upload existed before at all).

Fields stay plain strings in `brief_json` (comma-joined URLs for multi-file) — this was a
deliberate choice to avoid touching `companyProfileBriefIntelligence.ts` /
`companyProfileDocumentMapper.ts` / DB schema. Upload UI lives in
`CpAssetUploader.tsx` (wraps `UploadDropzone` + a small presigned-URL hook in
`lib/use-object-upload.ts`), no Uppy dependency added.

## The auth gap (the actual bug, not just a missing UI)
`routes/storage.ts` (`POST /storage/uploads/request-url`, `GET /storage/objects/*`) had
existed for a while but was **not** in `adminAuth.ts`'s `PUBLIC_PATH_PREFIXES` — only
`/storage/public-objects` was exempted. Every public, unauthenticated customer-portal
route must be explicitly listed there or it 401s silently in production (dev fails open
without `ADMIN_API_KEY`, masking the bug locally). Added `/storage/uploads/request-url`
and `/storage/objects` to the exceptions list.

**Why this matters generally:** a new public-facing feature that calls a
previously-unused backend route is not verified until you curl it end-to-end (or watch
the request in workflow logs) — "the route exists" and "the route is actually public"
are different claims, and `adminAuth.ts`'s exception list is the single source of truth
for which is true.

## Known remaining gap (not fixed, flagged only)
The uploaded logo/photos are **only** used for brief-completeness scoring
(`companyProfileBriefIntelligence.ts`) — they are never embedded into the generated PDF.
The PDF's cover/inline images come exclusively from the AI image-generation pipeline
(`existingImages` param of `mapCompanyProfileToDocumentSpec`). If a customer later
expects their uploaded logo to appear in the delivered document, that's a separate,
larger change (fetch the object storage buffer server-side and pass it into the mapper).
