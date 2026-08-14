/**
 * Canonical eligibility guard for Interior Design export downloads.
 *
 * Token validity is checked separately by the signed-token verifier. This
 * policy protects the package lifecycle independently, so a still-valid token
 * cannot keep an expired package downloadable.
 */
export interface ExportDownloadPackage {
  status: string;
  storagePath: string | null;
  expiresAt: Date | null;
}

export function isExportPackageDownloadable(
  packageRow: ExportDownloadPackage,
  now = new Date(),
): boolean {
  return packageRow.status === "completed"
    && Boolean(packageRow.storagePath)
    && packageRow.expiresAt !== null
    && packageRow.expiresAt.getTime() > now.getTime();
}