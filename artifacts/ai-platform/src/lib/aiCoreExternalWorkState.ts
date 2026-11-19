export type ExternalJobStatus = "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED" | "UNKNOWN";

export function externalJobStatusLabel(status: ExternalJobStatus): string {
  switch (status) {
    case "QUEUED": return "Menunggu worker";
    case "PROCESSING": return "Sedang dikerjakan";
    case "COMPLETED": return "Selesai";
    case "FAILED": return "Gagal";
    case "UNKNOWN": return "Perlu diperiksa";
  }
}

export function isExternalJobTerminal(status: string): boolean {
  return status === "COMPLETED" || status === "FAILED";
}


export function externalWorkRouteLabel(route?: string | null): string | null {
  if (route === "EXTERNAL_AGENT") return "OpenClaw · job";
  if (route === "CHATGPT_DEV_WAKE") return "OpenClaw · browser wake";
  return null;
}
