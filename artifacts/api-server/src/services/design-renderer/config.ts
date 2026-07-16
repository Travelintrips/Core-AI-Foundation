/**
 * Design Renderer — Environment Configuration
 * Centralises all process.env reads for the renderer subsystem.
 */

export const renderConfig = {
  concurrency:           parseInt(process.env["DESIGN_RENDER_CONCURRENCY"]              ?? "2",                      10),
  maxAttempts:           parseInt(process.env["DESIGN_RENDER_MAX_ATTEMPTS"]             ?? "3",                      10),
  timeoutMs:             parseInt(process.env["DESIGN_RENDER_TIMEOUT_MS"]               ?? "60000",                  10),
  maxRemoteAssetBytes:   parseInt(process.env["DESIGN_RENDER_MAX_REMOTE_ASSET_BYTES"]   ?? "10485760",               10), // 10 MB
  assetFetchTimeoutMs:   parseInt(process.env["DESIGN_RENDER_ASSET_FETCH_TIMEOUT_MS"]  ?? "15000",                  10),
  cacheMaxBytes:         parseInt(process.env["DESIGN_RENDER_CACHE_MAX_BYTES"]          ?? "104857600",              10), // 100 MB
  cacheTtlMs:            parseInt(process.env["DESIGN_RENDER_CACHE_TTL_MS"]             ?? "300000",                 10), // 5 min
  jpegQuality:           parseInt(process.env["DESIGN_RENDER_JPEG_QUALITY"]             ?? "88",                     10),
  webpQuality:           parseInt(process.env["DESIGN_RENDER_WEBP_QUALITY"]             ?? "88",                     10),
  rendererVersion:              process.env["DESIGN_RENDERER_VERSION"]                  ?? "design-svg-renderer-v1",
} as const;
