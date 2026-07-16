/**
 * use-object-upload.ts — Direct-to-storage file upload for public brief forms.
 *
 * Two-step presigned URL flow (see object-storage skill):
 *   1. POST /api/storage/uploads/request-url  → { uploadURL, objectPath }
 *   2. PUT <uploadURL>                         → file bytes go straight to GCS
 *
 * The file itself never touches the Express JSON body — only tiny metadata
 * does — so this is safe for large files (e.g. company profile videos)
 * despite the server's 10mb JSON body limit.
 */

export interface ObjectUploadResult {
  /** Raw object path returned by the server, e.g. "/objects/uploads/uuid". */
  objectPath: string;
  /** Ready-to-use serving URL — GET this to view/download the file. */
  url: string;
}

async function requestUploadUrl(file: File): Promise<{ uploadURL: string; objectPath: string }> {
  const res = await fetch("/api/storage/uploads/request-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: file.name,
      size: file.size,
      contentType: file.type || "application/octet-stream",
    }),
  });
  if (!res.ok) {
    let message = "Gagal membuat URL upload";
    try {
      const body = await res.json();
      if (body?.error) message = body.error;
    } catch { /* ignore */ }
    throw new Error(message);
  }
  return res.json();
}

/**
 * Uploads a single file directly to object storage, reporting progress via
 * XHR (fetch has no upload-progress event). Resolves with a serving URL
 * that can be persisted directly into brief_json and later re-fetched with
 * a plain GET — no auth required, matching this route's public ACL.
 */
export function uploadFileToStorage(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<ObjectUploadResult> {
  return requestUploadUrl(file).then(({ uploadURL, objectPath }) => {
    return new Promise<ObjectUploadResult>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("PUT", uploadURL);
      xhr.setRequestHeader("Content-Type", file.type || "application/octet-stream");
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable && onProgress) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve({ objectPath, url: `/api/storage${objectPath}` });
        } else {
          reject(new Error(`Upload gagal (status ${xhr.status})`));
        }
      };
      xhr.onerror = () => reject(new Error("Upload gagal — periksa koneksi internet Anda"));
      xhr.send(file);
    });
  });
}
