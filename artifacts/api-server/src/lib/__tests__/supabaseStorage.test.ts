import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  compressImageForStorage,
  compressInteriorRenderForStorage,
  isProductionStorageEnvironment,
  uploadPublicInteriorRenderViaEdge,
  uploadToSupabase,
} from "../supabaseStorage.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function productionEnv(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "production",
    SUPABASE_PROD_DATABASE_URL:
      "postgresql://postgres.nzdweipzckfszczzqtuw:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
    SUPABASE_PROD_SERVICE_ROLE_KEY: "server-only-test-key",
    ...overrides,
  };
}

describe("Supabase Storage production credential selection", () => {
  it("treats APP_ENV=production as production even when NODE_ENV is absent", () => {
    expect(
      isProductionStorageEnvironment({
        APP_ENV: "production",
        SUPABASE_PROD_DATABASE_URL: "postgresql://example",
        SUPABASE_PROD_SERVICE_ROLE_KEY: "secret",
      }),
    ).toBe(true);
  });

  it("falls toward production when only production Supabase credentials exist", () => {
    expect(
      isProductionStorageEnvironment({
        SUPABASE_PROD_DATABASE_URL: "postgresql://example",
        SUPABASE_PROD_SERVICE_ROLE_KEY: "secret",
      }),
    ).toBe(true);
  });

  it("keeps a development-only credential set in development", () => {
    expect(
      isProductionStorageEnvironment({
        NODE_ENV: "development",
        SUPABASE_DEV_DATABASE_URL: "postgresql://example",
        SUPABASE_SERVICE_ROLE_KEY_DEV: "secret",
      }),
    ).toBe(false);
  });
});

describe("Supabase Storage compression gate", () => {
  async function highQualityWebp(): Promise<Buffer> {
    const width = 640;
    const height = 480;
    const pixels = Buffer.alloc(width * height * 3);
    let state = 0x12345678;
    for (let i = 0; i < pixels.length; i += 1) {
      state = (1664525 * state + 1013904223) >>> 0;
      pixels[i] = state & 0xff;
    }

    return sharp(pixels, {
      raw: { width, height, channels: 3 },
    })
      .webp({ quality: 100, effort: 1 })
      .toBuffer();
  }

  it("re-encodes generated WebP before upload and reduces bytes", async () => {
    const input = await highQualityWebp();
    const result = await compressImageForStorage(input, "image/webp");

    expect(result.contentType).toBe("image/webp");
    expect(result.compressed).toBe(true);
    expect(result.storedBytes).toBeLessThan(result.originalBytes);

    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.format).toBe("webp");
  });

  it("normalizes public Interior renders to compressed WebP", async () => {
    const input = await highQualityWebp();
    const result = await compressInteriorRenderForStorage(input);

    expect(result.contentType).toBe("image/webp");
    expect(result.compressed).toBe(true);
    expect(result.storedBytes).toBeLessThanOrEqual(result.originalBytes);

    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.format).toBe("webp");
  });

  it("sends compressed WebP through the authenticated Edge bridge without an admin key", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "SUPABASE_PROD_DATABASE_URL",
      "postgresql://postgres.nzdweipzckfszczzqtuw:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
    );
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_PROD_SERVICE_ROLE_KEY", "");
    vi.stubEnv("SUPABASE_SECRET_KEY", "");
    vi.stubEnv("SUPABASE_PROD_SECRET_KEY", "");

    const input = await highQualityWebp();
    const expected = await compressInteriorRenderForStorage(input);
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          path: "interior-renders/public-interior-42/variant-1.webp",
          publicUrl:
            "https://nzdweipzckfszczzqtuw.supabase.co/storage/v1/object/public/ai-assets/interior-renders/public-interior-42/variant-1.webp",
          storedBytes: expected.storedBytes,
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );

    const result = await uploadPublicInteriorRenderViaEdge({
      projectId: 42,
      accessToken: "123e4567-e89b-42d3-a456-426614174000",
      variantIndex: 1,
      buffer: input,
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!;
    expect(String(requestUrl)).toBe(
      "https://nzdweipzckfszczzqtuw.supabase.co/functions/v1/interior-render-storage",
    );
    expect(requestInit?.headers).toMatchObject({
      "Content-Type": "image/webp",
      "x-interior-project-id": "42",
      "x-interior-variant-index": "1",
    });
    const body = requestInit?.body;
    expect(body).toBeInstanceOf(Uint8Array);
    expect((body as Uint8Array).byteLength).toBeLessThanOrEqual(input.byteLength);
    expect(result.storagePath).toBe(
      "interior-renders/public-interior-42/variant-1.webp",
    );
    expect(result.storedBytes).toBe(expected.storedBytes);
  });

  it("uploads the compressed buffer to the production Supabase project", async () => {
    for (const [key, value] of Object.entries(productionEnv())) {
      if (value != null) vi.stubEnv(key, value);
    }

    const input = await highQualityWebp();
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );

    const url = await uploadToSupabase(
      "interior-renders/e2e/compressed.webp",
      input,
      "image/webp",
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [requestUrl, requestInit] = fetchMock.mock.calls[0]!;
    expect(String(requestUrl)).toContain(
      "https://nzdweipzckfszczzqtuw.supabase.co/storage/v1/object/ai-assets/interior-renders/e2e/compressed.webp",
    );

    const body = requestInit?.body;
    expect(body).toBeInstanceOf(Uint8Array);
    expect((body as Uint8Array).byteLength).toBeLessThan(input.byteLength);
    expect(requestInit?.headers).toMatchObject({
      "Content-Type": "image/webp",
      "x-upsert": "true",
    });
    expect(url).toBe(
      "https://nzdweipzckfszczzqtuw.supabase.co/storage/v1/object/public/ai-assets/interior-renders/e2e/compressed.webp",
    );
  });
});
