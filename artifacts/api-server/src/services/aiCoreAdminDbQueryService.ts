import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  getAdminDbConnection,
  getAdminDbConnections,
  readAdminDbMetadata,
  runAdminDbReadTransaction,
} from "./aiCoreAdminDbConnectionService.js";

export type AdminDbSchemaTable = {
  schema: string;
  table: string;
  columns: string[];
  databaseId?: string;
  databaseLabel?: string;
};

export type AdminDbQueryExecution = {
  sql: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
  sourceDatabaseId?: string;
  discovery?: AdminDbDiscovery;
};

export type AdminDbDiscovery = {
  databases: Array<{ id: string; label: string; status: "ok" | "unavailable"; tableCount: number; error?: string }>;
  tableCount: number;
};

export function sanitizeAdminDbError(error: unknown): string {
  const cause = error instanceof Error ? error.cause : undefined;
  const message = cause instanceof Error ? cause.message : error instanceof Error ? error.message : error;
  return String(message)
    .replace(/(?:postgres(?:ql)?|https?):\/\/[^\s]+/gi, "[REDACTED_URL]")
    .replace(/((?:password|token|secret|api[_-]?key)\s*[=:]\s*)\S+/gi, "$1[REDACTED]")
    .replace(/[\r\n\t]+/g, " ").slice(0, 300);
}

async function discoverAdminDbMetadata(query: ReturnType<typeof sql.raw>) {
  const connections = getAdminDbConnections();
  const outcomes = await Promise.allSettled(connections.map((connection) => readAdminDbMetadata(connection, query)));
  const records: Array<Record<string, unknown> & { database_id: string; database_label: string }> = [];
  const discovery: AdminDbDiscovery = { databases: [], tableCount: 0 };
  outcomes.forEach((outcome, index) => {
    const connection = connections[index]!;
    if (outcome.status === "rejected") {
      discovery.databases.push({ id: connection.id, label: connection.label, status: "unavailable", tableCount: 0, error: sanitizeAdminDbError(outcome.reason) });
      return;
    }
    const rows = rowsOf<Record<string, unknown>>(outcome.value);
    const tableCount = new Set(rows.map((row) => `${row.table_schema}.${row.table_name}`)).size;
    discovery.databases.push({ id: connection.id, label: connection.label, status: "ok", tableCount });
    discovery.tableCount += tableCount;
    for (const row of rows) records.push({ ...row, database_id: connection.id, database_label: connection.label });
  });
  if (!discovery.databases.some((entry) => entry.status === "ok")) {
    throw new Error("Metadata database tidak dapat dibaca: " + discovery.databases.map((entry) => `${entry.label}: ${entry.error}`).join("; "));
  }
  return { records, discovery };
}

export type AdminDbConversationMessage = {
  role: "user" | "assistant";
  text: string;
};

export type AdminDbSemanticIntent = {
  aggregation: "sum" | "count" | "avg" | "min" | "max";
  metricLabel: string;
  valueKind: "currency" | "number";
  domain: string;
  timeRange: {
    label: string;
    startSql: string;
    endSql: string;
  } | null;
  inheritedFromContext: boolean;
};

export type AdminDbSemanticExecution = AdminDbQueryExecution & {
  intent: AdminDbSemanticIntent;
  sourceTable: string;
  valueColumn: string | null;
  timeColumn: string | null;
  matchedRows: number;
  confidence: number;
  statusFilterApplied: boolean;
};

type AdminDbNaturalLookupIntent = {
  subject: string;
  value: string;
};

type AdminDbTextSearchTarget = {
  schema: string;
  table: string;
  columns: string[];
  textColumns: string[];
  score: number;
  databaseId: string;
};

const READ_INTENT =
  /\b(cari|cek|periksa|lihat|tampilkan|show|find|search|list|daftar|berapa|hitung|count|siapa|mana|status|detail|data|database|db|record|rekam|riwayat|history)\b/i;

const EXPLANATION_ONLY =
  /\b(jelaskan|explain|apa\s+itu|what\s+is|bagaimana\s+cara|how\s+to|contoh|example)\b/i;

const MUTATION =
  /\b(insert|update|delete|merge|upsert|alter|drop|truncate|create|grant|revoke|comment|vacuum|analyze|refresh|reindex|cluster|copy|call|do|set\s+role|reset\s+role)\b/i;

const AI_RUNTIME_INVENTORY =
  /\b(agent(?:\s+ai)?|worker|model|provider|runtime|openclaw|openhands|n8n|temporal|ollama|gemini)\b/i;

const DANGEROUS_READ =
  /\b(pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_export|lo_import|dblink|postgres_fdw|file_fdw|program\b|for\s+update|for\s+share|lock\s+table)\b/i;

const SENSITIVE_COLUMN =
  /(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|session[_-]?key|encryption[_-]?key|signing[_-]?key|refresh[_-]?token|access[_-]?token)/i;

const MAX_RESULT_ROWS = 200;
const STATEMENT_TIMEOUT_MS = 8000;
const DEFAULT_BUSINESS_TIMEZONE = "Asia/Jakarta";

function adminDbBusinessTimezone(): string {
  const candidate =
    process.env["AI_CORE_BUSINESS_TIMEZONE"] ??
    process.env["AI_SCHEDULER_TIMEZONE"] ??
    DEFAULT_BUSINESS_TIMEZONE;
  return /^[A-Za-z_+-]+(?:\/[A-Za-z0-9_+.-]+)*$/.test(candidate)
    ? candidate
    : DEFAULT_BUSINESS_TIMEZONE;
}

function rowsOf<T extends Record<string, unknown>>(value: unknown): T[] {
  if (!value || typeof value !== "object" || !("rows" in value)) return [];
  const rows = (value as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

function normalizeWords(message: string): string[] {
  const synonyms: Record<string, string[]> = {
    customer: ["customer", "customers", "client", "clients", "pelanggan", "klien"],
    pelanggan: ["customer", "customers", "client", "clients", "pelanggan"],
    klien: ["client", "clients", "customer", "customers"],
    tagihan: ["invoice", "invoices", "billing", "payment"],
    invoice: ["invoice", "invoices", "billing"],
    pembayaran: ["payment", "payments", "invoice"],
    pesanan: ["order", "orders", "booking"],
    order: ["order", "orders"],
    booking: ["booking", "bookings", "reservation"],
    vendor: ["vendor", "vendors", "supplier"],
    supplier: ["supplier", "suppliers", "vendor"],
    penawaran: ["quotation", "quote", "quotes", "rfq"],
    quotation: ["quotation", "quotations", "quote", "rfq"],
    proyek: ["project", "projects"],
    project: ["project", "projects"],
    tugas: ["task", "tasks", "job", "jobs"],
    task: ["task", "tasks", "job", "jobs"],
    tenant: ["tenant", "tenants"],
    user: ["user", "users", "account"],
    pengguna: ["user", "users", "account"],
    karyawan: ["employee", "employees", "staff", "user"],
    layanan: ["service", "services", "request"],
    service: ["service", "services", "request"],
    dokumen: ["document", "documents", "file"],
  };

  const base = message
    .toLowerCase()
    .replace(/[^a-z0-9_\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 3);

  const expanded = new Set<string>(base);
  for (const word of base) {
    for (const synonym of synonyms[word] ?? []) expanded.add(synonym);
  }
  return [...expanded];
}


type AdminDbColumnMetadata = {
  name: string;
  dataType: string;
  udtName: string;
};

type AdminDbSemanticTable = {
  schema: string;
  table: string;
  columns: AdminDbColumnMetadata[];
  databaseId: string;
  databaseLabel: string;
};

type AdminDbSemanticPlan = {
  intent: AdminDbSemanticIntent;
  table: AdminDbSemanticTable;
  valueColumn: AdminDbColumnMetadata | null;
  timeColumn: AdminDbColumnMetadata | null;
  statusColumn: AdminDbColumnMetadata | null;
  confidence: number;
  discovery: AdminDbDiscovery;
};

const MONEY_METRIC =
  /\b(pendapatan|omzet|revenue|pemasukan|income|sales|penjualan|nilai\s+penjualan|total\s+pembayaran|payment\s+total|gross\s+sales)\b/i;

const AVERAGE_METRIC =
  /\b(rata[-\s]?rata|average|avg|rerata)\b/i;

const MAX_METRIC =
  /\b(terbesar|tertinggi|maximum|max|maksimum)\b/i;

const MIN_METRIC =
  /\b(terkecil|terendah|minimum|min)\b/i;

const COUNT_METRIC =
  /\b(jumlah|count|berapa\s+banyak|total\s+(?:booking|order|pesanan|customer|pelanggan|tenant|transaksi|transaction|invoice|tagihan|user|pengguna))\b/i;

const FOLLOW_UP_HINT =
  /^(?:kalau|kalo|bagaimana|gimana|lalu|terus|dan|dibanding|bandingkan|yang|untuk|sedangkan)\b/i;

const SUCCESS_STATUS =
  /^(?:paid|success|successful|completed|complete|settled|captured|approved|done|succeeded|lunas|berhasil|confirmed|verified|accepted)$/i;

const NUMERIC_DATA_TYPES = new Set([
  "smallint",
  "integer",
  "bigint",
  "decimal",
  "numeric",
  "real",
  "double precision",
  "money",
]);

const TEMPORAL_DATA_TYPES = new Set([
  "date",
  "timestamp without time zone",
  "timestamp with time zone",
  "time without time zone",
  "time with time zone",
]);

function normalizeSemanticText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectSemanticTimeRange(
  message: string,
): AdminDbSemanticIntent["timeRange"] {
  const value = normalizeSemanticText(message);

  if (/\b(kemarin|yesterday)\b/.test(value)) {
    return {
      label: "kemarin",
      startSql: "CURRENT_DATE - INTERVAL '1 day'",
      endSql: "CURRENT_DATE",
    };
  }
  if (/\b(hari ini|today)\b/.test(value)) {
    return {
      label: "hari ini",
      startSql: "CURRENT_DATE",
      endSql: "CURRENT_DATE + INTERVAL '1 day'",
    };
  }
  if (/\b(minggu lalu|pekan lalu|last week)\b/.test(value)) {
    return {
      label: "minggu lalu",
      startSql: "date_trunc('week', CURRENT_DATE) - INTERVAL '1 week'",
      endSql: "date_trunc('week', CURRENT_DATE)",
    };
  }
  if (/\b(minggu ini|pekan ini|this week)\b/.test(value)) {
    return {
      label: "minggu ini",
      startSql: "date_trunc('week', CURRENT_DATE)",
      endSql: "date_trunc('week', CURRENT_DATE) + INTERVAL '1 week'",
    };
  }
  if (/\b(bulan lalu|last month)\b/.test(value)) {
    return {
      label: "bulan lalu",
      startSql: "date_trunc('month', CURRENT_DATE) - INTERVAL '1 month'",
      endSql: "date_trunc('month', CURRENT_DATE)",
    };
  }
  if (/\b(bulan ini|this month)\b/.test(value)) {
    return {
      label: "bulan ini",
      startSql: "date_trunc('month', CURRENT_DATE)",
      endSql: "date_trunc('month', CURRENT_DATE) + INTERVAL '1 month'",
    };
  }
  if (/\b(tahun lalu|last year)\b/.test(value)) {
    return {
      label: "tahun lalu",
      startSql: "date_trunc('year', CURRENT_DATE) - INTERVAL '1 year'",
      endSql: "date_trunc('year', CURRENT_DATE)",
    };
  }
  if (/\b(tahun ini|this year)\b/.test(value)) {
    return {
      label: "tahun ini",
      startSql: "date_trunc('year', CURRENT_DATE)",
      endSql: "date_trunc('year', CURRENT_DATE) + INTERVAL '1 year'",
    };
  }

  const trailingDays = value.match(/\b(\d{1,3})\s+hari\s+terakhir\b/);
  if (trailingDays) {
    const days = Math.min(Math.max(Number(trailingDays[1] ?? 1), 1), 366);
    return {
      label: String(days) + " hari terakhir",
      startSql: "CURRENT_DATE - INTERVAL '" + String(days - 1) + " days'",
      endSql: "CURRENT_DATE + INTERVAL '1 day'",
    };
  }

  return null;
}

function detectSemanticAggregation(message: string): {
  aggregation: AdminDbSemanticIntent["aggregation"];
  metricLabel: string;
  valueKind: AdminDbSemanticIntent["valueKind"];
} | null {
  if (MONEY_METRIC.test(message)) {
    return { aggregation: "sum", metricLabel: "pendapatan", valueKind: "currency" };
  }
  if (AVERAGE_METRIC.test(message)) {
    return { aggregation: "avg", metricLabel: "rata-rata", valueKind: "number" };
  }
  if (MAX_METRIC.test(message)) {
    return { aggregation: "max", metricLabel: "nilai tertinggi", valueKind: "number" };
  }
  if (MIN_METRIC.test(message)) {
    return { aggregation: "min", metricLabel: "nilai terendah", valueKind: "number" };
  }
  if (COUNT_METRIC.test(message)) {
    return { aggregation: "count", metricLabel: "jumlah", valueKind: "number" };
  }

  const normalized = normalizeSemanticText(message);
  if (/\bberapa\b/.test(normalized) && !/\b(berapa\s+(?:rupiah|rp|nilai|nominal))\b/.test(normalized)) {
    return { aggregation: "count", metricLabel: "jumlah", valueKind: "number" };
  }

  return null;
}

function extractSemanticDomain(message: string): string {
  let value = normalizeSemanticText(message);
  const removable = [
    /\b(tolong|mohon|please|cek|check|periksa|lihat|show|tampilkan|cari|find|search|berapa|berapa banyak|hitung|count|jumlah|total)\b/g,
    /\b(pendapatan|omzet|revenue|pemasukan|income|sales|penjualan|nilai penjualan|total pembayaran|payment total|gross sales)\b/g,
    /\b(rata rata|average|avg|rerata|terbesar|tertinggi|maximum|max|maksimum|terkecil|terendah|minimum|min)\b/g,
    /\b(kemarin|yesterday|hari ini|today|minggu lalu|pekan lalu|last week|minggu ini|pekan ini|this week|bulan lalu|last month|bulan ini|this month|tahun lalu|last year|tahun ini|this year)\b/g,
    /\b\d{1,3}\s+hari\s+terakhir\b/g,
    /\b(kalau|kalo|bagaimana|gimana|lalu|terus|dan|dibanding|bandingkan|dengan|yang|untuk|pada|di|dari|saat|sekarang|ini|itu)\b/g,
  ];
  for (const pattern of removable) value = value.replace(pattern, " ");
  return value.replace(/\s+/g, " ").trim();
}

function semanticParts(message: string): {
  metric: ReturnType<typeof detectSemanticAggregation>;
  domain: string;
  timeRange: AdminDbSemanticIntent["timeRange"];
} {
  return {
    metric: detectSemanticAggregation(message),
    domain: extractSemanticDomain(message),
    timeRange: detectSemanticTimeRange(message),
  };
}

export function extractAdminDbSemanticIntent(
  message: string,
  context: AdminDbConversationMessage[] = [],
): AdminDbSemanticIntent | null {
  const value = message.trim();
  if (!value || extractExplicitReadOnlySql(value) || MUTATION.test(value) || EXPLANATION_ONLY.test(value) || AI_RUNTIME_INVENTORY.test(value)) return null;

  const current = semanticParts(value);
  let metric = current.metric;
  let domain = current.domain;
  let timeRange = current.timeRange;
  let inheritedFromContext = false;

  const words = normalizeSemanticText(value).split(" ").filter(Boolean);
  const looksLikeFollowUp =
    FOLLOW_UP_HINT.test(value.trim().toLowerCase()) ||
    (words.length <= 6 && Boolean(current.timeRange));

  if ((!metric || !domain || (!timeRange && looksLikeFollowUp)) && context.length > 0) {
    for (let index = context.length - 1; index >= 0; index -= 1) {
      const previous = context[index];
      if (!previous || previous.role !== "user") continue;
      const prior = semanticParts(previous.text);
      let used = false;
      if (!metric && prior.metric) {
        metric = prior.metric;
        used = true;
      }
      if (!domain && prior.domain) {
        domain = prior.domain;
        used = true;
      }
      if (!timeRange && looksLikeFollowUp && prior.timeRange) {
        timeRange = prior.timeRange;
        used = true;
      }
      inheritedFromContext = inheritedFromContext || used;
      if (metric && domain && (timeRange || !looksLikeFollowUp)) break;
    }
  }

  if (!metric || !domain) return null;

  return {
    ...metric,
    domain,
    timeRange,
    inheritedFromContext,
  };
}

function isNumericColumn(column: AdminDbColumnMetadata): boolean {
  return NUMERIC_DATA_TYPES.has(column.dataType) ||
    /^(int2|int4|int8|float4|float8|numeric|decimal|money)$/.test(column.udtName);
}

function isTemporalColumn(column: AdminDbColumnMetadata): boolean {
  return TEMPORAL_DATA_TYPES.has(column.dataType) ||
    /^(date|timestamp|timestamptz|time|timetz)$/.test(column.udtName);
}

function semanticTableScore(
  table: AdminDbSemanticTable,
  intent: AdminDbSemanticIntent,
): number {
  const words = normalizeWords(intent.domain);
  let score = 0;
  const tableName = table.table.toLowerCase();
  const schemaName = table.schema.toLowerCase();
  const columnNames = table.columns.map((column) => column.name.toLowerCase());

  // Historical copies and synchronization tables are not current business facts.
  if (/(^zz_|^deleted_|^backup_|_backup$|_sync$|_logs?$|_audit)/.test(tableName)) return 0;

  for (const word of words) {
    if (tableName.includes(word)) score += 14;
    if (schemaName.includes(word)) score += 3;
    if ((table.databaseId + " " + table.databaseLabel).toLowerCase().includes(word)) score += 6;
    if (columnNames.some((column) => column.includes(word))) score += 4;
  }

  // A financial table from an unrelated business domain must not win merely
  // because its amount/time columns look suitable.
  if (score === 0) return 0;

  if (intent.valueKind === "currency") {
    if (/expense|refund|cost|fee/.test(tableName)) return 0;
    if (/payment|transaction|sale|revenue|receipt/.test(tableName)) score += 14;
    else if (/invoice|order|booking|billing/.test(tableName)) score += 6;
  }

  return score;
}

function semanticValueColumnScore(
  column: AdminDbColumnMetadata,
  intent: AdminDbSemanticIntent,
): number {
  if (!isNumericColumn(column) || /(^id$|_id$|count$|quantity$|qty$)/i.test(column.name)) {
    return -1;
  }

  const name = column.name.toLowerCase();
  if (intent.valueKind === "currency") {
    const priorities: Array<[RegExp, number]> = [
      [/^(paid_amount|settled_amount|captured_amount)$/, 38],
      [/^(amount|revenue|income)$/, 36],
      [/^(total_amount|grand_total|gross_amount|net_amount)$/, 34],
      [/(paid|settled|captured).*amount/, 32],
      [/(revenue|income|sales|amount|total|price|value)/, 24],
    ];
    for (const [pattern, score] of priorities) {
      if (pattern.test(name)) return score;
    }
    return 3;
  }

  if (/(amount|total|price|value|score|duration|rate|quantity|qty)/.test(name)) {
    return 20;
  }
  return 6;
}

function semanticTimeColumnScore(
  column: AdminDbColumnMetadata,
  intent: AdminDbSemanticIntent,
): number {
  if (!isTemporalColumn(column)) return -1;
  const name = column.name.toLowerCase();

  if (intent.valueKind === "currency") {
    const priorities: Array<[RegExp, number]> = [
      [/^(paid_at|settled_at|captured_at|payment_date|paid_date)$/, 40],
      [/(paid|settled|captured|payment|transaction).*(_at|date|time)$/, 36],
      [/^(completed_at|completed_date)$/, 30],
      [/(booking|order|invoice).*(_at|date|time)$/, 24],
      [/^(created_at|created_date)$/, 18],
    ];
    for (const [pattern, score] of priorities) {
      if (pattern.test(name)) return score;
    }
  }

  if (/(_at|date|time)$/.test(name)) return 16;
  return 8;
}

function semanticStatusColumnScore(column: AdminDbColumnMetadata): number {
  const name = column.name.toLowerCase();
  if (name === "payment_status") return 30;
  if (name === "status") return 24;
  if (/status|state/.test(name)) return 12;
  return -1;
}

async function getAdminDbSemanticTables(): Promise<{ tables: AdminDbSemanticTable[]; discovery: AdminDbDiscovery }> {
  const result = await discoverAdminDbMetadata(sql.raw(
    "SELECT table_schema, table_name, column_name, data_type, udt_name, ordinal_position " +
    "FROM information_schema.columns " +
    "WHERE table_schema NOT IN ('pg_catalog','information_schema') " +
    "ORDER BY table_schema, table_name, ordinal_position"
  ));

  const grouped = new Map<string, AdminDbSemanticTable>();
  for (const row of result.records) {
    const schema = String(row.table_schema ?? "");
    const table = String(row.table_name ?? "");
    const name = String(row.column_name ?? "");
    if (!schema || !table || !name) continue;
    const key = row.database_id + "." + schema + "." + table;
    const current = grouped.get(key) ?? { schema, table, columns: [], databaseId: row.database_id, databaseLabel: row.database_label };
    current.columns.push({
      name,
      dataType: String(row.data_type ?? ""),
      udtName: String(row.udt_name ?? ""),
    });
    grouped.set(key, current);
  }
  return { tables: [...grouped.values()], discovery: result.discovery };
}

async function buildAdminDbSemanticPlan(
  intent: AdminDbSemanticIntent,
): Promise<AdminDbSemanticPlan | null> {
  const { tables, discovery } = await getAdminDbSemanticTables();
  const candidates = tables
    .map((table) => {
      const tableScore = semanticTableScore(table, intent);
      const valueColumn =
        intent.aggregation === "count"
          ? null
          : [...table.columns]
              .map((column) => ({
                column,
                score: semanticValueColumnScore(column, intent),
              }))
              .filter((item) => item.score >= 0)
              .sort((left, right) => right.score - left.score)[0] ?? null;
      const timeColumn =
        intent.timeRange
          ? [...table.columns]
              .map((column) => ({
                column,
                score: semanticTimeColumnScore(column, intent),
              }))
              .filter((item) => item.score >= 0)
              .sort((left, right) => right.score - left.score)[0] ?? null
          : null;
      const statusColumn =
        [...table.columns]
          .map((column) => ({
            column,
            score: semanticStatusColumnScore(column),
          }))
          .filter((item) => item.score >= 0)
          .sort((left, right) => right.score - left.score)[0] ?? null;

      const valueScore = valueColumn?.score ?? (intent.aggregation === "count" ? 20 : -20);
      const timeScore = intent.timeRange ? (timeColumn?.score ?? -30) : 10;
      const score = tableScore + valueScore + timeScore;

      return {
        table,
        tableScore,
        valueColumn: valueColumn?.column ?? null,
        valueScore,
        timeColumn: timeColumn?.column ?? null,
        timeScore,
        statusColumn: statusColumn?.column ?? null,
        score,
      };
    })
    .filter((item) =>
      item.tableScore > 0 &&
      (intent.aggregation === "count" || item.valueColumn) &&
      (!intent.timeRange || item.timeColumn)
    )
    .sort((left, right) => right.score - left.score);

  const best = candidates[0];
  if (!best) return null;

  const confidence = Math.min(
    0.99,
    0.5 +
      Math.min(best.tableScore, 36) / 120 +
      Math.max(best.valueScore, 0) / 160 +
      Math.max(best.timeScore, 0) / 200 +
      (intent.inheritedFromContext ? 0.02 : 0),
  );

  if (confidence < 0.72) return null;

  return {
    intent,
    table: best.table,
    valueColumn: best.valueColumn,
    timeColumn: best.timeColumn,
    statusColumn: best.statusColumn,
    confidence,
    discovery,
  };
}

function quoteSqlLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

function semanticAggregateExpression(plan: AdminDbSemanticPlan): string {
  if (plan.intent.aggregation === "count") return "COUNT(*)::bigint";
  if (!plan.valueColumn) throw new Error("Semantic aggregate requires a numeric value column.");
  const column = quoteIdentifier(plan.valueColumn.name);
  switch (plan.intent.aggregation) {
    case "sum":
      return "COALESCE(SUM(" + column + "), 0)";
    case "avg":
      return "AVG(" + column + ")";
    case "min":
      return "MIN(" + column + ")";
    case "max":
      return "MAX(" + column + ")";
    default:
      throw new Error("Unsupported semantic aggregation.");
  }
}

export async function executeAdminSemanticQuery(
  message: string,
  context: AdminDbConversationMessage[] = [],
): Promise<AdminDbSemanticExecution | null> {
  const intent = extractAdminDbSemanticIntent(message, context);
  if (!intent) return null;

  const plan = await buildAdminDbSemanticPlan(intent);
  if (!plan) return null;

  const tableRef =
    quoteIdentifier(plan.table.schema) + "." + quoteIdentifier(plan.table.table);
  const startedAt = Date.now();

  const businessTimezone = adminDbBusinessTimezone();
  const execution = await runAdminDbReadTransaction(getAdminDbConnection(plan.table.databaseId), async (tx) => {
    await tx.execute(sql.raw("SET TRANSACTION READ ONLY"));
    await tx.execute(sql.raw(
      "SET LOCAL statement_timeout = '" + String(STATEMENT_TIMEOUT_MS) + "ms'"
    ));
    await tx.execute(sql.raw("SET LOCAL lock_timeout = '1500ms'"));
    await tx.execute(sql.raw(
      "SET LOCAL TIME ZONE " + quoteSqlLiteral(businessTimezone)
    ));

    let successfulStatuses: string[] = [];
    if (plan.statusColumn && plan.intent.valueKind === "currency") {
      const statusRef = quoteIdentifier(plan.statusColumn.name);
      const statusResult = await tx.execute(sql.raw(
        "SELECT DISTINCT lower(" + statusRef + "::text) AS value " +
        "FROM " + tableRef + " WHERE " + statusRef + " IS NOT NULL LIMIT 40"
      ));
      successfulStatuses = rowsOf<Record<string, unknown>>(statusResult)
        .map((row) => String(row.value ?? "").trim().toLowerCase())
        .filter((value) => value && SUCCESS_STATUS.test(value));
    }

    const conditions: string[] = [];
    if (intent.timeRange && plan.timeColumn) {
      const timeRef = quoteIdentifier(plan.timeColumn.name);
      conditions.push(
        timeRef + " >= " + intent.timeRange.startSql +
        " AND " + timeRef + " < " + intent.timeRange.endSql
      );
    }
    if (plan.statusColumn && intent.valueKind === "currency") {
      const statusRef = quoteIdentifier(plan.statusColumn.name);
      conditions.push(
        successfulStatuses.length > 0
          ? "lower(" + statusRef + "::text) IN (" + successfulStatuses.map(quoteSqlLiteral).join(",") + ")"
          : "FALSE"
      );
    }

    const query =
      "SELECT " + semanticAggregateExpression(plan) + " AS value, " +
      "COUNT(*)::bigint AS matched_rows FROM " + tableRef +
      (conditions.length > 0 ? " WHERE " + conditions.join(" AND ") : "");

    const result = await tx.execute(sql.raw(query));
    const row = rowsOf<Record<string, unknown>>(result)[0] ?? {};
    return {
      query,
      row,
      statusFilterApplied: Boolean(plan.statusColumn && intent.valueKind === "currency"),
    };
  });

  const matchedRows = Number(execution.row.matched_rows ?? 0);
  const rows = [{
    metric: intent.metricLabel,
    domain: intent.domain,
    period: intent.timeRange?.label ?? "semua waktu",
    value: execution.row.value ?? 0,
    matched_rows: matchedRows,
    source_table: plan.table.schema + "." + plan.table.table,
    source_database: plan.table.databaseId,
    source_column: plan.valueColumn?.name ?? null,
    time_column: plan.timeColumn?.name ?? null,
    timezone: businessTimezone,
  }];

  return {
    sql: execution.query,
    rows,
    rowCount: 1,
    truncated: false,
    elapsedMs: Date.now() - startedAt,
    intent,
    sourceTable: plan.table.schema + "." + plan.table.table,
    sourceDatabaseId: plan.table.databaseId,
    discovery: plan.discovery,
    valueColumn: plan.valueColumn?.name ?? null,
    timeColumn: plan.timeColumn?.name ?? null,
    matchedRows,
    confidence: plan.confidence,
    statusFilterApplied: execution.statusFilterApplied,
  };
}

function formatSemanticValue(
  value: unknown,
  kind: AdminDbSemanticIntent["valueKind"],
): string {
  const numeric = Number(value ?? 0);
  if (kind === "currency" && Number.isFinite(numeric)) {
    return new Intl.NumberFormat("id-ID", {
      style: "currency",
      currency: "IDR",
      maximumFractionDigits: 0,
    }).format(numeric);
  }
  if (Number.isFinite(numeric)) {
    return new Intl.NumberFormat("id-ID", {
      maximumFractionDigits: 2,
    }).format(numeric);
  }
  return displayValue(value);
}

export function renderAdminSemanticQueryResult(
  result: AdminDbSemanticExecution,
): string {
  const row = result.rows[0] ?? {};
  const period =
    result.intent.timeRange ? " " + result.intent.timeRange.label : "";
  const source =
    result.sourceTable +
    (result.valueColumn ? "." + result.valueColumn : "");
  const timeDetail =
    result.timeColumn ? "; waktu memakai " + result.timeColumn : "";

  const zeroDetail =
    result.matchedRows === 0
      ? " Tidak ada transaksi/record yang memenuhi filter pada periode tersebut."
      : "";

  const summary =
    result.intent.metricLabel.charAt(0).toUpperCase() +
    result.intent.metricLabel.slice(1) +
    " " + result.intent.domain + period + ": " +
    formatSemanticValue(row.value, result.intent.valueKind) + "." +
    zeroDetail;

  // Simple count questions should read like a normal chat answer. Keep
  // provenance/diagnostics in structured execution metadata instead of
  // exposing database internals to the user.
  if (result.intent.aggregation === "count") {
    return summary;
  }

  return [
    summary,
    "Dihitung dari " + String(result.matchedRows) +
      " record pada " + source + timeDetail +
      "; database " + (result.sourceDatabaseId ?? "primary") +
      "; zona waktu " + adminDbBusinessTimezone() + ".",
    "Confidence semantic: " +
      String(Math.round(result.confidence * 100)) + "%; " +
      (result.statusFilterApplied
        ? "status transaksi sukses terdeteksi dan difilter otomatis."
        : "tidak ada filter status sukses yang perlu/berhasil diterapkan."),
    "Akses: read-only Admin DB Query; 0 token LLM.",
  ].join("\n");
}

export function extractAdminDbNaturalLookup(
  message: string,
): AdminDbNaturalLookupIntent | null {
  const value = message
    .trim()
    .replace(/[?!.,;:]+$/g, "")
    .trim();
  if (!value || MUTATION.test(value)) return null;

  const match = value.match(
    /^(?:tolong\s+)?(?:cari|find|search|cek|periksa|lihat|tampilkan|show)\s+(?:semua\s+)?(?:data\s+)?(.+?)\s+(?:atas\s+nama|bernama|dengan\s+nama|nama)\s+["']?(.+?)["']?$/i,
  );
  if (!match) return null;

  const subject = String(match[1] ?? "").trim();
  const lookupValue = String(match[2] ?? "").trim();
  if (subject.length < 2 || lookupValue.length < 1) return null;

  return { subject, value: lookupValue };
}

function quoteIdentifier(value: string): string {
  return '"' + value.replace(/"/g, '""') + '"';
}

async function getAdminDbTextSearchTargets(
  subject: string,
): Promise<AdminDbTextSearchTarget[]> {
  const result = await discoverAdminDbMetadata(sql.raw(
    "SELECT table_schema, table_name, " +
    "array_agg(column_name ORDER BY ordinal_position) AS columns, " +
    "array_agg(column_name ORDER BY ordinal_position) FILTER (" +
    "WHERE data_type IN ('text','character varying','character') OR udt_name = 'citext'" +
    ") AS text_columns " +
    "FROM information_schema.columns " +
    "WHERE table_schema NOT IN ('pg_catalog','information_schema') " +
    "GROUP BY table_schema, table_name ORDER BY table_schema, table_name"
  ));

  const words = normalizeWords(subject);
  return result.records
    .map((row) => {
      const schema = String(row.table_schema ?? "");
      const table = String(row.table_name ?? "");
      const columns = Array.isArray(row.columns)
        ? row.columns.map((column) => String(column))
        : [];
      const textColumns = Array.isArray(row.text_columns)
        ? row.text_columns.map((column) => String(column))
        : [];

      let score = 0;
      for (const word of words) {
        if (table.toLowerCase().includes(word)) score += 12;
        if (schema.toLowerCase().includes(word)) score += 2;
        if (columns.some((column) => column.toLowerCase().includes(word))) {
          score += 4;
        }
      }

      return { schema, table, columns, textColumns, score, databaseId: row.database_id };
    })
    .filter(
      (target) =>
        target.schema &&
        target.table &&
        target.textColumns.length > 0 &&
        target.score > 0,
    )
    .sort((left, right) => right.score - left.score)
    .slice(0, 12);
}

function redactSensitiveValue(
  value: unknown,
  key = "",
): unknown {
  if (key && SENSITIVE_COLUMN.test(key) && value != null) {
    return "[REDACTED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveValue(item));
  }
  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      output[childKey] = redactSensitiveValue(childValue, childKey);
    }
    return output;
  }
  return value;
}

export async function executeAdminNaturalTextLookup(
  message: string,
): Promise<AdminDbQueryExecution | null> {
  const intent = extractAdminDbNaturalLookup(message);
  if (!intent) return null;

  const targets = await getAdminDbTextSearchTargets(intent.subject);
  const startedAt = Date.now();
  if (targets.length === 0) {
    return {
      sql:
        "DYNAMIC_TEXT_LOOKUP subject=" +
        intent.subject +
        " value=" +
        intent.value,
      rows: [],
      rowCount: 0,
      truncated: false,
      elapsedMs: Date.now() - startedAt,
    };
  }

  const pattern = "%" + intent.value + "%";
  const groupedTargets = new Map<string, AdminDbTextSearchTarget[]>();
  for (const target of targets) {
    const group = groupedTargets.get(target.databaseId) ?? [];
    group.push(target);
    groupedTargets.set(target.databaseId, group);
  }
  const collected: Record<string, unknown>[] = [];
  for (const [databaseId, databaseTargets] of groupedTargets) {
    const matches = await runAdminDbReadTransaction(getAdminDbConnection(databaseId), async (tx) => {
    await tx.execute(sql.raw("SET TRANSACTION READ ONLY"));
    await tx.execute(sql.raw(
      "SET LOCAL statement_timeout = '" + String(STATEMENT_TIMEOUT_MS) + "ms'"
    ));
    await tx.execute(sql.raw("SET LOCAL lock_timeout = '1500ms'"));

    const output: Record<string, unknown>[] = [];
    for (const target of databaseTargets) {
      const searchableColumns = target.textColumns
        .filter((column) => !SENSITIVE_COLUMN.test(column))
        .slice(0, 30);
      if (searchableColumns.length === 0) continue;

      const conditions = searchableColumns.map((column) =>
        sql`${sql.raw("t." + quoteIdentifier(column))} ILIKE ${pattern}`
      );
      const tableRef =
        quoteIdentifier(target.schema) + "." + quoteIdentifier(target.table);
      const query = sql`
        SELECT to_jsonb(t) AS row_data
        FROM ${sql.raw(tableRef)} AS t
        WHERE ${sql.join(conditions, sql` OR `)}
        LIMIT 25
      `;
      const result = await tx.execute(query);
      const matches = rowsOf<Record<string, unknown>>(result);

      for (const match of matches) {
        const rowData =
          match.row_data && typeof match.row_data === "object"
            ? redactSensitiveValue(match.row_data) as Record<string, unknown>
            : {};
        output.push({
          source_table: target.schema + "." + target.table,
          source_database: databaseId,
          ...rowData,
        });
        if (output.length >= MAX_RESULT_ROWS + 1) return output;
      }
    }
    return output;
    });
    collected.push(...matches);
    if (collected.length >= MAX_RESULT_ROWS + 1) break;
  }

  const truncated = collected.length > MAX_RESULT_ROWS;
  const rows = collected.slice(0, MAX_RESULT_ROWS);

  return {
    sql:
      "DYNAMIC_TEXT_LOOKUP subject=" +
      intent.subject +
      " value=" +
      intent.value +
      " tables=" +
      targets.map((target) => target.schema + "." + target.table).join(","),
    rows,
    rowCount: rows.length,
    truncated,
    elapsedMs: Date.now() - startedAt,
  };
}

export function shouldAttemptAdminDbQuery(message: string): boolean {
  const value = message.trim();
  if (!value || MUTATION.test(value)) return false;
  if (extractExplicitReadOnlySql(value)) return true;
  if (!READ_INTENT.test(value)) return false;
  if (
    EXPLANATION_ONLY.test(value) &&
    !/\b(data|database|db|record|tabel|table)\b/i.test(value)
  ) {
    return false;
  }
  return true;
}

export function extractExplicitReadOnlySql(message: string): string | null {
  const candidate = message.trim();
  if (/^(select|with)\b/i.test(candidate)) return candidate;
  return null;
}

export async function getAdminDbSchemaCatalog(
  message: string,
): Promise<AdminDbSchemaTable[]> {
  return (await inspectAdminDbSchemaCatalog(message)).tables;
}

export async function inspectAdminDbSchemaCatalog(message = ""): Promise<{ tables: AdminDbSchemaTable[]; discovery: AdminDbDiscovery }> {
  const result = await discoverAdminDbMetadata(sql.raw(
    "SELECT table_schema, table_name, array_agg(column_name ORDER BY ordinal_position) AS columns " +
    "FROM information_schema.columns " +
    "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') " +
    "GROUP BY table_schema, table_name ORDER BY table_schema, table_name"
  ));

  const tables = result.records
    .map((row) => ({
      schema: String(row.table_schema ?? ""),
      table: String(row.table_name ?? ""),
      databaseId: row.database_id,
      databaseLabel: row.database_label,
      columns: Array.isArray(row.columns)
        ? row.columns.map((column) => String(column))
        : [],
    }))
    .filter((table) => table.schema && table.table);

  const words = normalizeWords(message);
  const scored = tables.map((table) => {
    let score = 0;
    for (const word of words) {
      if (table.table.toLowerCase().includes(word)) score += 8;
      if (table.schema.toLowerCase().includes(word)) score += 2;
      if (table.columns.some((column) => column.toLowerCase().includes(word))) {
        score += 4;
      }
    }
    return { table, score };
  });

  const relevant = scored
    .filter((item) => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, 40)
    .map((item) => item.table);

  return { tables: message.trim() ? (relevant.length > 0 ? relevant : tables.slice(0, 120)) : tables, discovery: result.discovery };
}

export function buildAdminDbUnresolvedAnswer(
  message: string,
  context: AdminDbConversationMessage[],
  discovery: AdminDbDiscovery,
): Record<string, unknown> | null {
  const semantic = extractAdminDbSemanticIntent(message, context);
  const requiresData = Boolean(
    extractExplicitReadOnlySql(message) || extractAdminDbNaturalLookup(message) ||
    (semantic && (semantic.valueKind === "currency" || semantic.timeRange)) ||
    (shouldAttemptAdminDbQuery(message) && /\b(data|database|db|record|rekam|riwayat|tabel|table)\b/i.test(message)),
  );
  if (!requiresData) return null;
  const searched = discovery.databases.filter((entry) => entry.status === "ok");
  const unavailable = discovery.databases.filter((entry) => entry.status === "unavailable");
  return {
    kind: "answer", route: "ADMIN_DB_QUERY", provider: null, model: null,
    workload: "DATA_LOOKUP", costClass: "ZERO", estimatedCostUsd: 0,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
    reply: [
      `Metadata ${discovery.tableCount} tabel pada ${searched.map((entry) => entry.label).join(", ") || "database terdaftar"} sudah diperiksa.`,
      "Sumber data atau kolom yang cocok belum dapat dipastikan, sehingga angka belum dihitung. Tidak ada hasil perkiraan yang digunakan.",
      ...(unavailable.length ? [`Koneksi yang belum dapat diperiksa: ${unavailable.map((entry) => entry.label).join(", ")}.`] : []),
    ].join("\n"),
    databaseQuery: { executed: false, access: "ADMIN_READ_ONLY", discovery },
  };
}

export function formatAdminDbSchemaCatalog(
  tables: AdminDbSchemaTable[],
): string {
  return tables
    .map((table) =>
      "[database=" + (table.databaseId ?? "primary") + "] " + table.schema + "." + table.table + "(" + table.columns.join(", ") + ")"
    )
    .join("\n");
}

export function validateAdminReadOnlySql(rawSql: string): string {
  const normalized = rawSql.trim().replace(/;+\s*$/g, "");

  if (!/^(select|with)\b/i.test(normalized)) {
    throw new Error("Admin DB Query only accepts SELECT/WITH statements.");
  }
  if (normalized.includes(";")) {
    throw new Error("Only one SQL statement is allowed.");
  }
  if (MUTATION.test(normalized)) {
    throw new Error("Mutating or DDL SQL is not allowed in the read-only query path.");
  }
  if (DANGEROUS_READ.test(normalized)) {
    throw new Error("Unsafe PostgreSQL function or locking clause is not allowed.");
  }

  return normalized;
}

function redactSensitiveRow(
  row: Record<string, unknown>,
): Record<string, unknown> {
  return redactSensitiveValue(row) as Record<string, unknown>;
}

export async function executeAdminReadOnlySql(
  rawSql: string,
  databaseId = "primary",
): Promise<AdminDbQueryExecution> {
  const query = validateAdminReadOnlySql(rawSql);
  const wrapped =
    "SELECT * FROM (" + query + ") AS ai_core_admin_query LIMIT " +
    String(MAX_RESULT_ROWS + 1);
  const startedAt = Date.now();

  const result = await runAdminDbReadTransaction(getAdminDbConnection(databaseId), async (tx) => {
    await tx.execute(sql.raw("SET TRANSACTION READ ONLY"));
    await tx.execute(sql.raw(
      "SET LOCAL statement_timeout = '" + String(STATEMENT_TIMEOUT_MS) + "ms'"
    ));
    await tx.execute(sql.raw("SET LOCAL lock_timeout = '1500ms'"));
    return tx.execute(sql.raw(wrapped));
  });

  const rawRows = rowsOf<Record<string, unknown>>(result);
  const truncated = rawRows.length > MAX_RESULT_ROWS;
  const rows = rawRows
    .slice(0, MAX_RESULT_ROWS)
    .map(redactSensitiveRow);

  return {
    sql: query,
    rows,
    rowCount: rows.length,
    truncated,
    elapsedMs: Date.now() - startedAt,
    sourceDatabaseId: databaseId,
  };
}

function displayValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") {
    const text = JSON.stringify(value);
    return text.length > 160 ? text.slice(0, 157) + "..." : text;
  }
  const text = String(value).replace(/[\r\n]+/g, " ");
  return text.length > 160 ? text.slice(0, 157) + "..." : text;
}

export function renderAdminDbQueryResult(
  result: AdminDbQueryExecution,
): string {
  if (result.rows.length === 0) {
    return [
      "Query database selesai tetapi tidak menemukan baris yang cocok.",
      "Waktu query: " + String(result.elapsedMs) + " ms.",
      "Akses: read-only Admin DB Query.",
    ].join("\n");
  }

  const columns = Object.keys(result.rows[0] ?? {}).slice(0, 12);
  const visibleRows = result.rows.slice(0, 20);
  const header = "| " + columns.join(" | ") + " |";
  const divider = "| " + columns.map(() => "---").join(" | ") + " |";
  const body = visibleRows.map((row) =>
    "| " +
    columns
      .map((column) => displayValue(row[column]).replace(/\|/g, "\\|"))
      .join(" | ") +
    " |"
  );

  return [
    "Ditemukan " + String(result.rowCount) + " baris" +
      (result.truncated ? " (hasil dibatasi 200 baris)." : "."),
    "",
    header,
    divider,
    ...body,
    ...(result.rows.length > visibleRows.length
      ? ["", "Menampilkan 20 dari " + String(result.rowCount) + " baris."]
      : []),
    "",
    "Waktu query: " + String(result.elapsedMs) +
      " ms. Akses: read-only Admin DB Query.",
  ].join("\n");
}

export type AdminDbMutationExecution = {
  sql: string;
  rowCount: number;
  elapsedMs: number;
};

const DESTRUCTIVE_DDL =
  /\b(drop|truncate|alter|grant|revoke|create\s+(?:role|user|extension)|reindex|cluster|vacuum|copy|call|do)\b/i;

export function extractExplicitAdminMutationSql(message: string): string | null {
  const candidate = message.trim();
  const prefixed = candidate.match(/^(?:run|execute|eksekusi|jalankan)\s+sql\s*:\s*([\s\S]+)$/i);
  const sqlText = prefixed?.[1]?.trim() ?? (/^(insert|update|delete)\b/i.test(candidate) ? candidate : null);
  return sqlText || null;
}

export function validateAdminMutationSql(rawSql: string): string {
  const normalized = rawSql.trim().replace(/;+\s*$/g, "");
  if (!/^(insert|update|delete)\b/i.test(normalized)) {
    throw new Error("Admin DB mutation only accepts INSERT, UPDATE, or DELETE.");
  }
  if (normalized.includes(";") || /--|\/\*/.test(normalized)) {
    throw new Error("Only one SQL statement without SQL comments is allowed.");
  }
  if (DESTRUCTIVE_DDL.test(normalized) || DANGEROUS_READ.test(normalized)) {
    throw new Error("DDL, privileged functions, and unsafe locking are not allowed here.");
  }
  if (/^(update|delete)\b/i.test(normalized) && !/\bwhere\b/i.test(normalized)) {
    throw new Error("UPDATE/DELETE requires an explicit WHERE clause.");
  }
  return normalized;
}

export async function executeAdminMutationSql(
  rawSql: string,
): Promise<AdminDbMutationExecution> {
  const query = validateAdminMutationSql(rawSql);
  const startedAt = Date.now();
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql.raw("SET LOCAL statement_timeout = '8000ms'"));
    await tx.execute(sql.raw("SET LOCAL lock_timeout = '1500ms'"));
    return tx.execute(sql.raw(query));
  });
  const rowCount =
    result && typeof result === "object" && "rowCount" in result
      ? Number((result as { rowCount?: unknown }).rowCount ?? 0)
      : 0;
  return { sql: query, rowCount: Number.isFinite(rowCount) ? rowCount : 0, elapsedMs: Date.now() - startedAt };
}

export function renderAdminDbMutationResult(result: AdminDbMutationExecution): string {
  return `Perubahan database berhasil dijalankan. Baris terdampak: ${result.rowCount}. Waktu: ${result.elapsedMs} ms.`;
}
