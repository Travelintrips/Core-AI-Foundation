import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";

const BUCKET = "payment-proofs";

function getSupabaseClient() {
  const url =
    process.env.SUPABASE_URL_DEV ||
    process.env.SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL_DEV;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY_DEV ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase URL/service role key not configured");
  return createClient(url, key, { auth: { persistSession: false } });
}

/**
 * Upload a base64-encoded image to Supabase Storage and return its public URL.
 * Creates the bucket if it doesn't exist.
 */
export async function uploadPaymentProofImage(
  base64Data: string,
  mimeType: string,
  scheduleId: number,
): Promise<string> {
  const supabase = getSupabaseClient();

  // Ensure bucket exists (idempotent)
  const { data: buckets } = await supabase.storage.listBuckets();
  const exists = buckets?.some((b) => b.name === BUCKET);
  if (!exists) {
    const { error } = await supabase.storage.createBucket(BUCKET, { public: true });
    if (error && !error.message.includes("already exists")) {
      throw new Error(`Failed to create storage bucket: ${error.message}`);
    }
  }

  // Strip data URI prefix if present
  const rawBase64 = base64Data.replace(/^data:[^;]+;base64,/, "");
  const buffer = Buffer.from(rawBase64, "base64");

  const ext = mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : "jpg";
  const filename = `schedule-${scheduleId}/${randomUUID()}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(filename, buffer, { contentType: mimeType, upsert: true });

  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(filename);
  return data.publicUrl;
}
