type AiCoreInboxLike = {
  eventType: string;
  title?: string | null;
  resultSummary?: string | null;
  message?: string | null;
};

const EVENT_LABELS: Record<string, string> = {
  COMPLETED: "Selesai ✅",
  FAILED: "Gagal ❌",
  BLOCKED: "Perlu tindakan ⚠️",
  MERGED: "Sudah di-merge ✅",
  DEPLOYED: "Sudah di-deploy ✅",
  BILLING_ALERT: "Peringatan biaya ⚠️",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function firstTextPayload(value: unknown): string | null {
  const record = asRecord(value);
  if (!record) return null;

  for (const candidate of [record["result"], record["payload"], record["data"]]) {
    const nested = firstTextPayload(candidate);
    if (nested) return nested;
  }

  const payloads = Array.isArray(record["payloads"]) ? record["payloads"] : [];
  for (const item of payloads) {
    const payload = asRecord(item);
    if (payload && typeof payload["text"] === "string" && payload["text"].trim()) {
      return payload["text"].trim();
    }
  }

  for (const key of ["reply", "text", "message", "summary", "resultSummary"]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }

  return null;
}

function compactText(value: string, max = 520): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= max) return normalized;
  return normalized.slice(0, max - 1).trimEnd() + "…";
}

function humanSummary(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;

  if ((text.startsWith("{") && text.endsWith("}")) || (text.startsWith("[") && text.endsWith("]"))) {
    try {
      const extracted = firstTextPayload(JSON.parse(text));
      if (extracted) return compactText(extracted);
    } catch {
      // Fall through to compact plain text.
    }
  }

  return compactText(text);
}

export function formatAiCoreInboxForChat(item: AiCoreInboxLike): {
  title: string;
  summary: string;
} {
  const summary =
    humanSummary(item.resultSummary) ??
    humanSummary(item.message) ??
    "Tidak ada ringkasan tambahan.";

  const rawTitle = item.title?.trim() || "AI Core";
  const isGenericTaskTitle = /^(?:task\s+selesai|task|ai\s+core)$/i.test(rawTitle);
  const prefix = isGenericTaskTitle ? "OpenClaw" : rawTitle;
  const eventLabel = EVENT_LABELS[item.eventType] ?? item.eventType;

  return {
    title: `${prefix} · ${eventLabel}`,
    summary,
  };
}
