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
assert.ok(metadata.tables.some((table) => table.databaseId === "primary" && table.schema === "sport_center" && table.table === "sport_payments"), "Sport payment metadata must be discoverable");
assert.equal(metadata.secretsExposed, false);
console.log(JSON.stringify({ phase: "metadata", tables: metadata.discovery.tableCount }));

const answer = await (await request("/ai/core-chat/messages", payload)).json();
function checkSemantic(result) {
  assert.equal(result.route, "ADMIN_DB_QUERY");
  assert.ok(result.databaseQuery?.sourceDatabaseId, result.warning || result.reply || "Semantic query did not execute");
  assert.equal(result.databaseQuery?.sourceDatabaseId, "primary");
  assert.equal(result.databaseQuery?.sourceTable, "sport_center.sport_payments");
  assert.equal(result.databaseQuery?.valueColumn, "amount");
  assert.equal(result.databaseQuery?.timeColumn, "paid_at");
  assert.equal(result.databaseQuery?.statusFilterApplied, true);
  assert.match(result.databaseQuery.sql, /IN \('confirmed'\)/);
  assert.equal(result.usage?.totalTokens, 0);
  assert.equal(result.estimatedCostUsd, 0);
  assert.ok(Array.isArray(result.data) && result.data.length === 1);
}
checkSemantic(answer);
assert.equal(answer.workload, "DATA_LOOKUP");
assert.equal(answer.costClass, "ZERO");
console.log(JSON.stringify({ phase: "ask", amount: answer.data[0].value, rows: answer.data[0].matched_rows }));

const autoAnswer = await (await request("/ai/core-chat/messages", { ...payload, mode: "auto" })).json();
checkSemantic(autoAnswer);
assert.equal(autoAnswer.workload, "DATA_LOOKUP");
assert.equal(autoAnswer.costClass, "ZERO");
console.log(JSON.stringify({ phase: "auto", result: "PASS" }));

// Compare the semantic result with an independent, explicit read-only aggregate.
const baseline = await (await request("/ai/core-chat/messages", {
  ...payload,
  message: "SELECT COALESCE(SUM(amount), 0) AS value, COUNT(*) AS matched_rows FROM sport_center.sport_payments WHERE lower(status::text) = 'confirmed' AND paid_at AT TIME ZONE 'Asia/Jakarta' >= (now() AT TIME ZONE 'Asia/Jakarta')::date - INTERVAL '1 day' AND paid_at AT TIME ZONE 'Asia/Jakarta' < (now() AT TIME ZONE 'Asia/Jakarta')::date",
})).json();
assert.equal(baseline.route, "ADMIN_DB_QUERY");
assert.ok(Array.isArray(baseline.data) && baseline.data.length === 1, baseline.warning || baseline.reply || "SQL baseline did not execute");
assert.equal(Number(answer.data[0].value), Number(baseline.data[0].value));
assert.equal(Number(answer.data[0].matched_rows), Number(baseline.data[0].matched_rows));

const rawStream = await (await request("/ai/core-chat/messages/stream", payload)).text();
const events = rawStream.replace(/\r/g, "").split("\n\n").filter(Boolean).map((block) => {
  const lines = block.split("\n");
  const event = lines.find((line) => line.startsWith("event:"))?.slice(6).trim();
  const raw = lines.filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trimStart()).join("\n");
  return { event, data: raw ? JSON.parse(raw) : null };
});
const meta = events.find((event) => event.event === "meta")?.data;
const done = events.find((event) => event.event === "done")?.data;
checkSemantic({ ...meta, ...done });
assert.ok(events.some((event) => event.event === "delta" && event.data?.text.includes("Pendapatan sport center kemarin")));
assert.equal(Number(done.data[0].value), Number(answer.data[0].value));

const followUp = await (await request("/ai/core-chat/messages", {
  ...payload,
  message: "kalau minggu lalu?",
  context: [{ role: "user", text: question }, { role: "assistant", text: answer.reply }],
})).json();
checkSemantic(followUp);
assert.equal(followUp.databaseQuery.inheritedFromContext, true);
assert.equal(followUp.data[0].period, "minggu lalu");
console.log(JSON.stringify({ adminDbSmoke: "PASS", metadataTables: metadata.discovery.tableCount, source: answer.databaseQuery.sourceTable, yesterdayAmount: answer.data[0].value, yesterdayRows: answer.data[0].matched_rows, auto: "PASS", streaming: "PASS", followUp: "PASS", tokens: 0 }));
