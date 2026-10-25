import { inArray } from "drizzle-orm";
import { db, aiSettingsTable } from "@workspace/db";
import {
  DEFAULT_SOP, SOP_CONTENT_KEY, SOP_REPLY_KEY, SOP_POLICY_KEY,
  parseEditableSop, parseReplyTemplates, parseRecoveryPolicy, parseSettingJson,
} from "./handshakeSopConfiguration.js";

/** Read settings per job; never trust client-supplied SOP or activation flags. */
export async function readHandshakeSopSettings() {
  // A temporary Settings DB read failure must not block an existing E2E worker job.
  let lookup = new Map<string, string>();
  try {
    const rows = await db.select({ key: aiSettingsTable.key, value: aiSettingsTable.value })
      .from(aiSettingsTable)
      .where(inArray(aiSettingsTable.key, [SOP_CONTENT_KEY, SOP_REPLY_KEY, SOP_POLICY_KEY]));
    lookup = new Map(rows.map(row => [row.key, row.value]));
  } catch {
    console.warn("[handshake-sop] settings read unavailable; using immutable server default");
  }
  const edited = parseEditableSop(parseSettingJson(lookup.get(SOP_CONTENT_KEY)));
  const templates = parseReplyTemplates(parseSettingJson(lookup.get(SOP_REPLY_KEY)));
  const policy = parseRecoveryPolicy(parseSettingJson(lookup.get(SOP_POLICY_KEY)));
  return {
    operationalSop: {
      id: "resource-first-human-last", version: "resource-first-human-last/1",
      title: edited?.title ?? DEFAULT_SOP.title,
      steps: edited?.steps ?? [...DEFAULT_SOP.steps],
      // Security constraints cannot be overridden by dashboard settings.
      constraints: [...DEFAULT_SOP.constraints],
      canonicalCommand: DEFAULT_SOP.canonicalCommand,
    },
    operationalSopSource: edited ? "ai-core-settings" : "ai-core-server",
    replyTemplates: templates,
    // Deliberately not consumed by the automatic worker recovery path.
    recoveryPolicy: policy,
  };
}
