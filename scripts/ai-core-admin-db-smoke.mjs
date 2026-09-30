import assert from "node:assert/strict";

const baseUrl = (process.env.API_BASE_URL || "https://aicore.cstlogistic.co.id/api").replace(/\/$/, "");
const adminKey = process.env.ADMIN_API_KEY;
assert.ok(adminKey, "ADMIN_API_KEY is required");

async function request(path, payload) {
  const response = await fetch(baseUrl + path, {
    method: payload ? "POST" : "GET",
    headers: {
      "x-admin-api-key": adminKey,
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
    signal: AbortSignal.timeout(30_000),
  });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response;
}

const question = "cek berapa pendapatan sport center kemarin";
const payload = { message: question, mode: "ask", modelPolicy: "smart" };
const metadata = await (await request("/ai/core-chat/databases/metadata")).json();
assert.ok(metadata.tables.some((table) => table.databaseId === "primary" && table.schema === "sport_center" && table.table === "sport_payments"), "Sport payment metadata must be discoverable");
assert.equal(metadata.secretsExposed, false);

const answer = await (await request("/ai/core-chat/messages", payload)).json();
function checkSemantic(result) {
  assert.equal(result.route, "ADMIN_DB_QUERY");
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

const autoAnswer = await (await request("/ai/core-chat/messages", { ...payload, mode: "auto" })).json();
checkSemantic(autoAnswer);
assert.equal(autoAnswer.workload, "DATA_LOOKUP");
assert.equal(autoAnswer.costClass, "ZERO");

// Compare the semantic result with an independent, explicit read-only aggregate.
const baseline = await (await request("/ai/core-chat/messages", {
  ...payload,
  message: "SELECT COALESCE(SUM(amount), 0) AS value, COUNT(*) AS matched_rows FROM sport_center.sport_payments WHERE lower(status::text) = 'confirmed' AND paid_at AT TIME ZONE 'Asia/Jakarta' >= (now() AT TIME ZONE 'Asia/Jakarta')::date - INTERVAL '1 day' AND paid_at AT TIME ZONE 'Asia/Jakarta' < (now() AT TIME ZONE 'Asia/Jakarta')::date",
})).json();
assert.equal(baseline.route, "ADMIN_DB_QUERY");
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
