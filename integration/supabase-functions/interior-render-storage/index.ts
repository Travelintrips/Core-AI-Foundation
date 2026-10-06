import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2.110.2";

const BUCKET = "ai-assets";
const MAX_BYTES = 8 * 1024 * 1024;
const AI_CORE_API_BASE =
  Deno.env.get("AI_CORE_PUBLIC_API_BASE") ?? "https://aicore.cstlogistic.co.id/api";

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

function supabaseSecretKey(): string | null {
  const modern = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (modern) {
    try {
      const parsed = JSON.parse(modern) as Record<string, string>;
      if (typeof parsed.default === "string" && parsed.default) return parsed.default;
      const first = Object.values(parsed).find(
        (value) => typeof value === "string" && value,
      );
      if (first) return first;
    } catch {
      // Fall through to the legacy server-only key.
    }
  }
  return Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isWebp(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  );
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return json(405, { error: "method_not_allowed" });
  }

  const contentType = (req.headers.get("content-type") ?? "")
    .split(";")[0]!
    .trim()
    .toLowerCase();
  if (contentType !== "image/webp") {
    return json(415, { error: "webp_required" });
  }

  const projectIdRaw = req.headers.get("x-interior-project-id") ?? "";
  const accessToken = req.headers.get("x-interior-access-token") ?? "";
  const variantRaw = req.headers.get("x-interior-variant-index") ?? "";

  const projectId = Number(projectIdRaw);
  const variantIndex = Number(variantRaw);
  if (!Number.isSafeInteger(projectId) || projectId <= 0) {
    return json(400, { error: "invalid_project_id" });
  }
  if (!isUuid(accessToken)) {
    return json(401, { error: "invalid_access_token" });
  }
  if (
    !Number.isInteger(variantIndex) ||
    variantIndex < 0 ||
    variantIndex > 3
  ) {
    return json(400, { error: "invalid_variant_index" });
  }

  const declaredLength = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BYTES) {
    return json(413, { error: "image_too_large" });
  }

  const verification = await fetch(
    `${AI_CORE_API_BASE}/public/interior-design/projects/${encodeURIComponent(
      accessToken,
    )}/outputs`,
    {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!verification.ok) {
    return json(403, { error: "project_token_rejected" });
  }

  const verified = (await verification.json()) as {
    project?: { id?: number | string; status?: string };
  };
  if (Number(verified.project?.id) !== projectId) {
    return json(403, { error: "project_token_mismatch" });
  }
  if (
    !["analyzing", "outputs_ready"].includes(
      String(verified.project?.status ?? ""),
    )
  ) {
    return json(409, { error: "project_not_renderable" });
  }

  const bytes = new Uint8Array(await req.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
    return json(bytes.byteLength === 0 ? 400 : 413, {
      error: bytes.byteLength === 0 ? "empty_image" : "image_too_large",
    });
  }
  if (!isWebp(bytes)) {
    return json(415, { error: "invalid_webp_payload" });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const secretKey = supabaseSecretKey();
  if (!supabaseUrl || !secretKey) {
    return json(503, { error: "storage_admin_unavailable" });
  }

  const storage = createClient(supabaseUrl, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Callers cannot choose an arbitrary path. Reusing the same project token
  // only overwrites one of four bounded variants for that owned project.
  const path =
    `interior-renders/public-interior-${projectId}/variant-${variantIndex}.webp`;

  const { error } = await storage.storage.from(BUCKET).upload(path, bytes, {
    contentType: "image/webp",
    cacheControl: "31536000",
    upsert: true,
  });

  if (error) {
    console.error("[interior-render-storage] upload failed", {
      projectId,
      variantIndex,
      code: (error as { statusCode?: string }).statusCode ?? null,
    });
    return json(502, { error: "storage_upload_failed" });
  }

  const { data } = storage.storage.from(BUCKET).getPublicUrl(path);

  return json(200, {
    ok: true,
    path,
    publicUrl: data.publicUrl,
    storedBytes: bytes.byteLength,
    contentType: "image/webp",
  });
});
