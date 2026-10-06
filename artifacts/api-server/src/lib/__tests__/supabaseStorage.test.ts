import { afterEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
import {
  compressImageForStorage,
  compressImageToWebpForStorage,
  isProductionStorageEnvironment,
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

function legacySupabaseJwt(projectRef: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: "supabase",
    ref: projectRef,
    role: "service_role",
  })).toString("base64url");
  return `${header}.${payload}.test-signature`;
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


  it("derives the project URL from a legacy service-role JWT when the pooler URL has no project ref", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "SUPABASE_DATABASE_URL",
      "postgresql://postgres:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
    );
    vi.stubEnv("SUPABASE_PROD_DATABASE_URL", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PROD_URL", "");
    vi.stubEnv("VITE_SUPABASE_URL", "");
    vi.stubEnv(
      "SUPABASE_SERVICE_ROLE_KEY",
      legacySupabaseJwt("nzdweipzckfszczzqtuw"),
    );

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );

    const url = await uploadToSupabase(
      "diagnostics/runtime.txt",
      Buffer.from("storage-ok"),
      "text/plain",
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "https://nzdweipzckfszczzqtuw.supabase.co/storage/v1/object/ai-assets/diagnostics/runtime.txt",
    );
    expect(url).toBe(
      "https://nzdweipzckfszczzqtuw.supabase.co/storage/v1/object/public/ai-assets/diagnostics/runtime.txt",
    );
  });

  it("accepts VITE_SUPABASE_URL as a production URL fallback for modern secret keys", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv(
      "SUPABASE_DATABASE_URL",
      "postgresql://postgres:secret@aws-0-ap-southeast-2.pooler.supabase.com:6543/postgres",
    );
    vi.stubEnv("SUPABASE_PROD_DATABASE_URL", "");
    vi.stubEnv("SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_PROD_URL", "");
    vi.stubEnv("VITE_SUPABASE_URL", "https://nzdweipzckfszczzqtuw.supabase.co/");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "sb_secret_server_only_test");

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );

    await uploadToSupabase(
      "diagnostics/modern-key.txt",
      Buffer.from("storage-ok"),
      "text/plain",
    );

    expect(String(fetchMock.mock.calls[0]?.[0])).toContain(
      "https://nzdweipzckfszczzqtuw.supabase.co/storage/v1/object/ai-assets/diagnostics/modern-key.txt",
    );
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


  it("normalizes fallback images to compressed WebP for the Edge Storage path", async () => {
    const input = await sharp({
      create: {
        width: 640,
        height: 480,
        channels: 3,
        background: { r: 180, g: 140, b: 100 },
      },
    }).png().toBuffer();

    const result = await compressImageToWebpForStorage(input);

    expect(result.contentType).toBe("image/webp");
    expect(result.compressed).toBe(true);
    expect(result.storedBytes).toBeGreaterThan(0);
    expect(result.storedBytes).toBeLessThan(result.originalBytes);

    const metadata = await sharp(result.buffer).metadata();
    expect(metadata.format).toBe("webp");
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
