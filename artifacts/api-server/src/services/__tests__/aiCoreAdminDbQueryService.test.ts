import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  txExecute: vi.fn(),
  extraExecute: vi.fn(),
  extraTransaction: vi.fn(),
  extraTxExecute: vi.fn(),
  includeExtra: false,
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: mocks.execute,
    transaction: mocks.transaction,
  },
}));

vi.mock("../aiCoreAdminDbConnectionService.js", () => {
  const primary = { id: "primary", label: "AI Core", configured: true, client: () => ({ execute: mocks.execute, transaction: mocks.transaction }) };
  const extra = { id: "sports", label: "Sport center", configured: true, client: () => ({ execute: mocks.extraExecute, transaction: mocks.extraTransaction }) };
  return {
    getAdminDbConnections: () => mocks.includeExtra ? [primary, extra] : [primary],
    getAdminDbConnection: (id = "primary") => {
      if (id === "primary") return primary;
      if (id === "sports" && mocks.includeExtra) return extra;
      throw new Error("Koneksi database tidak terdaftar.");
    },
    readAdminDbMetadata: (connection: typeof primary, query: unknown) => connection.client().execute(query),
  };
});

import {
  buildAdminDbUnresolvedAnswer,
  executeAdminMutationSql,
  executeAdminNaturalTextLookup,
  executeAdminReadOnlySql,
  executeAdminSemanticQuery,
  extractAdminDbNaturalLookup,
  extractAdminDbSemanticIntent,
  extractExplicitAdminMutationSql,
  getAdminDbSchemaCatalog,
  inspectAdminDbSchemaCatalog,
  renderAdminSemanticQueryResult,
  shouldAttemptAdminDbQuery,
  validateAdminMutationSql,
  validateAdminReadOnlySql,
} from "../aiCoreAdminDbQueryService.js";

describe("AI Core admin database query service", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.transaction.mockReset();
    mocks.txExecute.mockReset();
    mocks.includeExtra = false;
    mocks.extraExecute.mockReset();
    mocks.extraTransaction.mockReset();
    mocks.extraTxExecute.mockReset();
    mocks.transaction.mockImplementation(async (fn: (tx: { execute: typeof mocks.txExecute }) => Promise<unknown>) =>
      fn({ execute: mocks.txExecute }),
    );
    mocks.extraTransaction.mockImplementation(async (fn: (tx: { execute: typeof mocks.extraTxExecute }) => Promise<unknown>) =>
      fn({ execute: mocks.extraTxExecute }),
    );
  });

  it("understands business metric, domain, and relative time semantically", () => {
    expect(
      extractAdminDbSemanticIntent("cek berapa pendapatan sport center kemarin"),
    ).toMatchObject({
      aggregation: "sum",
      metricLabel: "pendapatan",
      valueKind: "currency",
      domain: "sport center",
      timeRange: {
        label: "kemarin",
        startSql: "CURRENT_DATE - INTERVAL '1 day'",
        endSql: "CURRENT_DATE",
      },
      inheritedFromContext: false,
    });
  });

  it("inherits metric and domain for short conversational follow-ups", () => {
    expect(
      extractAdminDbSemanticIntent("kalau minggu lalu?", [
        {
          role: "user",
          text: "cek berapa pendapatan sport center kemarin",
        },
        {
          role: "assistant",
          text: "Pendapatan sport center kemarin: Rp1.000.000.",
        },
      ]),
    ).toMatchObject({
      aggregation: "sum",
      metricLabel: "pendapatan",
      domain: "sport center",
      timeRange: {
        label: "minggu lalu",
      },
      inheritedFromContext: true,
    });
  });

  it("discovers the best fact table and executes a semantic aggregate read-only", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          table_schema: "public",
          table_name: "sport_bookings",
          column_name: "id",
          data_type: "bigint",
          udt_name: "int8",
          ordinal_position: 1,
        },
        {
          table_schema: "public",
          table_name: "sport_bookings",
          column_name: "total_amount",
          data_type: "numeric",
          udt_name: "numeric",
          ordinal_position: 2,
        },
        {
          table_schema: "public",
          table_name: "sport_bookings",
          column_name: "booking_date",
          data_type: "date",
          udt_name: "date",
          ordinal_position: 3,
        },
        {
          table_schema: "public",
          table_name: "sport_payments",
          column_name: "id",
          data_type: "bigint",
          udt_name: "int8",
          ordinal_position: 1,
        },
        {
          table_schema: "public",
          table_name: "sport_payments",
          column_name: "amount",
          data_type: "numeric",
          udt_name: "numeric",
          ordinal_position: 2,
        },
        {
          table_schema: "public",
          table_name: "sport_payments",
          column_name: "status",
          data_type: "character varying",
          udt_name: "varchar",
          ordinal_position: 3,
        },
        {
          table_schema: "public",
          table_name: "sport_payments",
          column_name: "paid_at",
          data_type: "timestamp with time zone",
          udt_name: "timestamptz",
          ordinal_position: 4,
        },
      ],
    });

    mocks.txExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ value: "paid" }, { value: "failed" }],
      })
      .mockResolvedValueOnce({
        rows: [{ value: "1250000", matched_rows: "12" }],
      });

    const result = await executeAdminSemanticQuery(
      "cek berapa pendapatan sport center kemarin",
    );

    expect(result).not.toBeNull();
    expect(result?.sourceTable).toBe("public.sport_payments");
    expect(result?.valueColumn).toBe("amount");
    expect(result?.timeColumn).toBe("paid_at");
    expect(result?.statusFilterApplied).toBe(true);
    expect(result?.matchedRows).toBe(12);
    expect(result?.sql).toContain('SUM("amount")');
    expect(result?.sql).toContain('"paid_at" >= CURRENT_DATE - INTERVAL \'1 day\'');
    expect(result?.sql).toContain("lower(\"status\"::text) IN ('paid')");

    const reply = result ? renderAdminSemanticQueryResult(result) : "";
    expect(reply).toContain("Pendapatan sport center kemarin");
    expect(reply.replace(/\s/g, "")).toContain("Rp1.250.000");
    expect(reply).toContain("zona waktu Asia/Jakarta");
    expect(reply).toContain("read-only Admin DB Query");
  });

  it("renders an empty aggregate as zero instead of saying no rows were found", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          table_schema: "public",
          table_name: "sport_payments",
          column_name: "amount",
          data_type: "numeric",
          udt_name: "numeric",
          ordinal_position: 1,
        },
        {
          table_schema: "public",
          table_name: "sport_payments",
          column_name: "status",
          data_type: "text",
          udt_name: "text",
          ordinal_position: 2,
        },
        {
          table_schema: "public",
          table_name: "sport_payments",
          column_name: "paid_at",
          data_type: "timestamp with time zone",
          udt_name: "timestamptz",
          ordinal_position: 3,
        },
      ],
    });

    mocks.txExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ value: "paid" }] })
      .mockResolvedValueOnce({
        rows: [{ value: "0", matched_rows: "0" }],
      });

    const result = await executeAdminSemanticQuery(
      "cek berapa pendapatan sport center kemarin",
    );
    const reply = result ? renderAdminSemanticQueryResult(result) : "";

    expect(reply.replace(/\s/g, "")).toContain("Rp0");
    expect(reply).toContain("Tidak ada transaksi/record");
    expect(reply).not.toContain("tidak menemukan baris");
  });

  it("extracts deterministic natural text lookups", () => {
    expect(extractAdminDbNaturalLookup("cari customer atas nama IKI")).toEqual({
      subject: "customer",
      value: "IKI",
    });
    expect(extractAdminDbNaturalLookup("lihat vendor bernama PT Sumber Makmur")).toEqual({
      subject: "vendor",
      value: "PT Sumber Makmur",
    });
  });

  it("recognizes natural-language database lookups without an entity allowlist", () => {
    expect(shouldAttemptAdminDbQuery("cari customer atas nama IKI")).toBe(true);
    expect(shouldAttemptAdminDbQuery("lihat data shipment dengan nomor ABC-123")).toBe(true);
    expect(shouldAttemptAdminDbQuery("berapa invoice yang belum lunas")).toBe(true);
  });

  it("keeps conceptual questions out of the database path", () => {
    expect(shouldAttemptAdminDbQuery("jelaskan apa itu customer profile")).toBe(false);
  });

  it("accepts direct admin SELECT/WITH but rejects mutation and multi-statement SQL", () => {
    expect(validateAdminReadOnlySql("SELECT * FROM public.customers LIMIT 5"))
      .toBe("SELECT * FROM public.customers LIMIT 5");
    expect(validateAdminReadOnlySql("WITH x AS (SELECT 1 AS n) SELECT * FROM x"))
      .toContain("WITH x AS");
    expect(() => validateAdminReadOnlySql("DELETE FROM public.customers"))
      .toThrow(/SELECT\/WITH/);
    expect(() => validateAdminReadOnlySql("SELECT 1; SELECT 2"))
      .toThrow(/one SQL statement/i);
  });

  it("accepts explicit bounded DML and rejects broad/destructive mutations", async () => {
    expect(extractExplicitAdminMutationSql(
      "jalankan sql: UPDATE public.customers SET active = true WHERE id = 7",
    )).toContain("UPDATE public.customers");
    expect(validateAdminMutationSql(
      "DELETE FROM public.ai_tasks WHERE id = 'abc'",
    )).toContain("WHERE id");
    expect(() => validateAdminMutationSql("DELETE FROM public.ai_tasks"))
      .toThrow(/WHERE/);
    expect(() => validateAdminMutationSql("DROP TABLE public.ai_tasks"))
      .toThrow(/INSERT, UPDATE, or DELETE/);

    mocks.txExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    const result = await executeAdminMutationSql(
      "UPDATE public.customers SET active = true WHERE id = 7",
    );
    expect(result.rowCount).toBe(1);
  });

  it("discovers tables dynamically across application schemas", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          table_schema: "public",
          table_name: "customers",
          columns: ["id", "name", "company_name"],
        },
        {
          table_schema: "logistics",
          table_name: "shipments",
          columns: ["id", "shipment_number", "customer_id"],
        },
        {
          table_schema: "ai_platform",
          table_name: "ai_tasks",
          columns: ["id", "customer_name", "status"],
        },
      ],
    });

    const result = await getAdminDbSchemaCatalog("cari shipment ABC-123");

    expect(result[0]).toMatchObject({
      schema: "logistics",
      table: "shipments",
    });
  });

  it("runs deterministic text lookup across dynamically discovered tables", async () => {
    mocks.execute.mockResolvedValueOnce({
      rows: [
        {
          table_schema: "public",
          table_name: "customers",
          columns: ["id", "name", "company_name", "api_token"],
          text_columns: ["name", "company_name", "api_token"],
        },
      ],
    });
    mocks.txExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            row_data: {
              id: "cust-1",
              name: "IKI",
              company_name: "IKI Logistics",
              api_token: "hidden",
            },
          },
        ],
      });

    const result = await executeAdminNaturalTextLookup("cari customer atas nama IKI");

    expect(result?.rowCount).toBe(1);
    expect(result?.rows[0]).toMatchObject({
      source_table: "public.customers",
      name: "IKI",
      company_name: "IKI Logistics",
      api_token: "[REDACTED]",
    });
  });

  it("executes in a read-only transaction and redacts credential-like columns", async () => {
    mocks.txExecute
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 1,
            name: "Customer A",
            api_token: "secret-value",
          },
        ],
      });

    const result = await executeAdminReadOnlySql(
      "SELECT id, name, api_token FROM public.customers",
    );

    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect(mocks.txExecute).toHaveBeenCalledTimes(4);
    expect(result.rows).toEqual([
      {
        id: 1,
        name: "Customer A",
        api_token: "[REDACTED]",
      },
    ]);
  });
  function paymentMetadata(schema = "sport_center", table = "sport_payments") {
    return [
      { column_name: "amount", data_type: "numeric", udt_name: "numeric" },
      { column_name: "status", data_type: "USER-DEFINED", udt_name: "payment_status" },
      { column_name: "paid_at", data_type: "timestamp with time zone", udt_name: "timestamptz" },
    ].map((column, index) => ({ table_schema: schema, table_name: table, ordinal_position: index + 1, ...column }));
  }

  function aggregateResponses(execute = mocks.txExecute, statuses = ["confirmed", "pending"], value = "480000", count = "5") {
    for (let index = 0; index < 4; index++) execute.mockResolvedValueOnce({ rows: [] });
    execute.mockResolvedValueOnce({ rows: statuses.map((status) => ({ value: status })) });
    execute.mockResolvedValueOnce({ rows: [{ value, matched_rows: count }] });
  }

  it("uses the canonical sport schema and confirmed payments instead of mirrors, expenses, or deleted tables", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: [
      ...paymentMetadata("public"), ...paymentMetadata(),
      ...paymentMetadata("sport_center", "sport_expenses"),
      ...paymentMetadata("public", "zz_deleted_sport_center_payments"),
    ] });
    aggregateResponses();
    const result = await executeAdminSemanticQuery("cek berapa pendapatan sport center kemarin");
    expect(result).toMatchObject({ sourceTable: "sport_center.sport_payments", sourceDatabaseId: "primary", matchedRows: 5, statusFilterApplied: true });
    expect(result?.sql).toContain("IN ('confirmed')");
    expect(result?.sql).not.toContain("'pending'");
    expect(renderAdminSemanticQueryResult(result!).replace(/\s/g, "")).toContain("Rp480.000");
  });

  it("does not count pending payments when no successful status is present", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: paymentMetadata() });
    aggregateResponses(mocks.txExecute, ["pending", "cancelled"], "0", "0");
    const result = await executeAdminSemanticQuery("cek berapa pendapatan sport center kemarin");
    expect(result?.sql).toContain("FALSE");
    expect(result).toMatchObject({ statusFilterApplied: true, matchedRows: 0 });
  });

  it("does not use an unrelated financial table for a missing business domain", async () => {
    mocks.execute.mockResolvedValueOnce({ rows: paymentMetadata("public", "logistics_payments") });
    expect(await executeAdminSemanticQuery("cek berapa pendapatan sport center kemarin")).toBeNull();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("discovers and executes on the selected registered connection", async () => {
    mocks.includeExtra = true;
    mocks.execute.mockResolvedValueOnce({ rows: paymentMetadata("public", "logistics_payments") });
    mocks.extraExecute.mockResolvedValueOnce({ rows: paymentMetadata() });
    aggregateResponses(mocks.extraTxExecute);
    const result = await executeAdminSemanticQuery("cek berapa pendapatan sport center kemarin");
    expect(result).toMatchObject({ sourceDatabaseId: "sports", sourceTable: "sport_center.sport_payments", matchedRows: 5 });
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.extraTransaction).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable metadata connections while retaining healthy schemas and redacting credentials", async () => {
    mocks.includeExtra = true;
    mocks.execute.mockResolvedValueOnce({ rows: [{ table_schema: "public", table_name: "customers", columns: ["id", "name"] }] });
    mocks.extraExecute.mockRejectedValueOnce(new Error("connect postgresql://user:private@invalid/db password=private"));
    const result = await inspectAdminDbSchemaCatalog();
    expect(result.tables[0]).toMatchObject({ databaseId: "primary", table: "customers" });
    expect(result.discovery).toMatchObject({ tableCount: 1, databases: [ { id: "primary", status: "ok" }, { id: "sports", status: "unavailable" } ] });
    expect(JSON.stringify(result)).not.toContain("private");
  });

  it("executes explicit reads only on registered connections", async () => {
    mocks.includeExtra = true;
    mocks.extraTxExecute.mockResolvedValue({ rows: [] });
    expect(await executeAdminReadOnlySql("SELECT 1", "sports")).toMatchObject({ sourceDatabaseId: "sports" });
    expect(mocks.extraTransaction).toHaveBeenCalledTimes(1);
    await expect(executeAdminReadOnlySql("SELECT 1", "unknown")).rejects.toThrow(/terdaftar/);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("keeps unresolved business questions and contextual follow-ups on the database route", () => {
    const discovery = { tableCount: 1, databases: [{ id: "primary", label: "AI Core", status: "ok" as const, tableCount: 1 }] };
    expect(buildAdminDbUnresolvedAnswer("cek berapa pendapatan sport center kemarin", [], discovery)).toMatchObject({ route: "ADMIN_DB_QUERY", databaseQuery: { executed: false, discovery } });
    expect(buildAdminDbUnresolvedAnswer("kalau minggu lalu?", [{ role: "user", text: "cek berapa pendapatan sport center kemarin" }], discovery)).toMatchObject({ route: "ADMIN_DB_QUERY" });
    expect(buildAdminDbUnresolvedAnswer("jelaskan apa itu customer profile", [], discovery)).toBeNull();
    expect(buildAdminDbUnresolvedAnswer("halo", [], discovery)).toBeNull();
  });

});
