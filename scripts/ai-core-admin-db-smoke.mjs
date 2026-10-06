import assert from "node:assert/strict";

const baseUrl = (process.env.API_BASE_URL || "https://aicore.cstlogistic.co.id/api").replace(/\/$/, "");
const adminKey = process.env.ADMIN_API_KEY;
assert.ok(adminKey, "ADMIN_API_KEY is required");

const transientStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTransientRequestError(error) {
  return (
    error?.name === "TimeoutError" ||
    error?.name === "AbortError" ||
    error instanceof TypeError ||
    ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN"].includes(error?.cause?.code)
  );
}

async function request(path, payload) {
  const semanticChatRequest = path === "/ai/core-chat/messages" || path === "/ai/core-chat/messages/stream";
  const maxAttempts = semanticChatRequest ? 2 : 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    // Metadata/readiness calls should stay fast. The schema-aware chat path can
    // queue briefly behind production DB activity, so give the retry a larger
    // bounded window instead of repeating several short requests that all time out.
    const timeoutMs = semanticChatRequest ? (attempt === 1 ? 35_000 : 75_000) : 25_000;
    try {
      const response = await fetch(baseUrl + path, {
        method: payload ? "POST" : "GET",
        headers: {
          "x-admin-api-key": adminKey,
          ...(payload ? { "Content-Type": "application/json" } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (response.status === 200) return response;

      if (!transientStatuses.has(response.status) || attempt === maxAttempts) {
        assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
      }

      console.warn(
        JSON.stringify({
          phase: "request_retry",
          path,
          attempt,
          maxAttempts,
          timeoutMs,
          status: response.status,
        }),
      );
    } catch (error) {
      if (!isTransientRequestError(error) || attempt === maxAttempts) throw error;

      console.warn(
        JSON.stringify({
          phase: "request_retry",
          path,
          attempt,
          maxAttempts,
          timeoutMs,
          error: error?.name || "request_error",
        }),
      );
    }

    await sleep(attempt * 2_000);
  }

  throw new Error(`${path}: exhausted bounded retries`);
}

const question = "cek berapa pendapatan sport center kemarin";
const payload = { message: question, mode: "ask", modelPolicy: "smart" };
const metadata = await (await request("/ai/core-chat/databases/metadata")).json();
assert.ok(
  metadata.tables.some(
    (table) =>
      table.databaseId === "primary" &&
      table.schema === "sport_center" &&
      table.table === "sport_payments",
  ),
  "Sport payment metadata must be discoverable",
);
assert.equal(metadata.secretsExposed, false);
console.log(JSON.stringify({ phase: "metadata", tables: metadata.discovery.tableCount }));

// Production only needs one representative natural-language semantic lookup.
// Ask/Auto/stream/follow-up parity belongs in route tests, while Data Tool
// readiness/execution is already verified by dedicated production steps.
const answer = await (await request("/ai/core-chat/messages", payload)).json();
assert.equal(answer.route, "ADMIN_DB_QUERY");
assert.ok(
  answer.databaseQuery?.sourceDatabaseId,
  answer.warning || answer.reply || "Semantic query did not execute",
);
assert.equal(answer.databaseQuery?.sourceDatabaseId, "primary");
assert.equal(answer.databaseQuery?.sourceTable, "sport_center.sport_payments");
assert.equal(answer.databaseQuery?.valueColumn, "amount");
assert.equal(answer.databaseQuery?.timeColumn, "paid_at");
assert.equal(answer.databaseQuery?.statusFilterApplied, true);
assert.match(answer.databaseQuery.sql, /IN \('confirmed'\)/);
assert.equal(answer.usage?.totalTokens, 0);
assert.equal(answer.estimatedCostUsd, 0);
assert.equal(answer.workload, "DATA_LOOKUP");
assert.equal(answer.costClass, "ZERO");
assert.ok(Array.isArray(answer.data) && answer.data.length === 1);
console.log(
  JSON.stringify({
    adminDbSmoke: "PASS",
    metadataTables: metadata.discovery.tableCount,
    source: answer.databaseQuery.sourceTable,
    yesterdayAmount: answer.data[0].value,
    yesterdayRows: answer.data[0].matched_rows,
    tokens: 0,
  }),
);
