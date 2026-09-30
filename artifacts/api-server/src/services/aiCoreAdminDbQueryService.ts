import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

export type AdminDbSchemaTable = {
  schema: string;
  table: string;
  columns: string[];
};

export type AdminDbQueryExecution = {
  sql: string;
  rows: Record<string, unknown>[];
  rowCount: number;
  truncated: boolean;
  elapsedMs: number;
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
};

const READ_INTENT =
  /\b(cari|cek|periksa|lihat|tampilkan|show|find|search|list|daftar|berapa|hitung|count|siapa|mana|status|detail|data|database|db|record|rekam|riwayat|history)\b/i;

const EXPLANATION_ONLY =
  /\b(jelaskan|explain|apa\s+itu|what\s+is|bagaimana\s+cara|how\s+to|contoh|example)\b/i;

const MUTATION =
  /\b(insert|update|delete|merge|upsert|alter|drop|truncate|create|grant|revoke|comment|vacuum|analyze|refresh|reindex|cluster|copy|call|do|set\s+role|reset\s+role)\b/i;

const DANGEROUS_READ =
  /\b(pg_sleep|pg_read_file|pg_read_binary_file|pg_ls_dir|lo_export|lo_import|dblink|postgres_fdw|file_fdw|program\b|for\s+update|for\s+share|lock\s+table)\b/i;

const SENSITIVE_COLUMN =
  /(password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|session[_-]?key|encryption[_-]?key|signing[_-]?key|refresh[_-]?token|access[_-]?token)/i;

const MAX_RESULT_ROWS = 200;
const STATEMENT_TIMEOUT_MS = 8000;

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
  const result = await db.execute(sql.raw(
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
  return rowsOf<Record<string, unknown>>(result)
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

      return { schema, table, columns, textColumns, score };
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
  const collected = await db.transaction(async (tx) => {
    await tx.execute(sql.raw("SET TRANSACTION READ ONLY"));
    await tx.execute(sql.raw(
      "SET LOCAL statement_timeout = '" + String(STATEMENT_TIMEOUT_MS) + "ms'"
    ));
    await tx.execute(sql.raw("SET LOCAL lock_timeout = '1500ms'"));

    const output: Record<string, unknown>[] = [];
    for (const target of targets) {
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
          ...rowData,
        });
        if (output.length >= MAX_RESULT_ROWS + 1) return output;
      }
    }
    return output;
  });

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
  const result = await db.execute(sql.raw(
    "SELECT table_schema, table_name, array_agg(column_name ORDER BY ordinal_position) AS columns " +
    "FROM information_schema.columns " +
    "WHERE table_schema NOT IN ('pg_catalog', 'information_schema') " +
    "GROUP BY table_schema, table_name ORDER BY table_schema, table_name"
  ));

  const tables = rowsOf<Record<string, unknown>>(result)
    .map((row) => ({
      schema: String(row.table_schema ?? ""),
      table: String(row.table_name ?? ""),
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

  return relevant.length > 0 ? relevant : tables.slice(0, 120);
}

export function formatAdminDbSchemaCatalog(
  tables: AdminDbSchemaTable[],
): string {
  return tables
    .map((table) =>
      table.schema + "." + table.table + "(" + table.columns.join(", ") + ")"
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
): Promise<AdminDbQueryExecution> {
  const query = validateAdminReadOnlySql(rawSql);
  const wrapped =
    "SELECT * FROM (" + query + ") AS ai_core_admin_query LIMIT " +
    String(MAX_RESULT_ROWS + 1);
  const startedAt = Date.now();

  const result = await db.transaction(async (tx) => {
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
