import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  transaction: vi.fn(),
  txExecute: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: {
    execute: mocks.execute,
    transaction: mocks.transaction,
  },
}));

import {
  executeAdminMutationSql,
  executeAdminNaturalTextLookup,
  extractAdminDbNaturalLookup,
  executeAdminReadOnlySql,
  extractExplicitAdminMutationSql,
  getAdminDbSchemaCatalog,
  shouldAttemptAdminDbQuery,
  validateAdminMutationSql,
  validateAdminReadOnlySql,
} from "../aiCoreAdminDbQueryService.js";

describe("AI Core admin database query service", () => {
  beforeEach(() => {
    mocks.execute.mockReset();
    mocks.transaction.mockReset();
    mocks.txExecute.mockReset();
    mocks.transaction.mockImplementation(async (fn: (tx: { execute: typeof mocks.txExecute }) => Promise<unknown>) =>
      fn({ execute: mocks.txExecute }),
    );
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
});
