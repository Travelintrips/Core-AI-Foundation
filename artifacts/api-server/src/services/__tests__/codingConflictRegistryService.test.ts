import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { codingFileTextArraySql } from "../codingConflictRegistryService.js";

describe("coding conflict registry SQL arrays", () => {
  it("binds JavaScript file lists as a PostgreSQL text array for ANY()", () => {
    const dialect = new PgDialect();
    const files = [
      "artifacts/api-server/src/services/imageDesignerService.ts",
      ".github/workflows/ai-image-worker-gcp.yml",
    ];
    const query = dialect.sqlToQuery(sql`
      SELECT 1
      WHERE 'x' = ANY(${codingFileTextArraySql(files)})
    `);

    expect(query.sql.replace(/\s+/g, " ")).toContain(
      "ANY(ARRAY[$1, $2]::text[])",
    );
    expect(query.params).toEqual(files);
    expect(query.sql).not.toContain("ANY(($1, $2)::text[])");
  });

  it("emits a typed empty PostgreSQL array", () => {
    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(sql`
      SELECT 1
      WHERE 'x' = ANY(${codingFileTextArraySql([])})
    `);

    expect(query.sql.replace(/\s+/g, " ")).toContain(
      "ANY(ARRAY[]::text[])",
    );
    expect(query.params).toEqual([]);
  });

  it("cleans reservations for disabled tasks and failed latest graphs without active execution", () => {
    const source = readFileSync(
      new URL("../codingConflictRegistryService.ts", import.meta.url),
      "utf8",
    );

    expect(source).toContain("a.enabled = FALSE");
    expect(source).toContain("a.status = 'DISABLED'");
    expect(source).toContain("g.status = 'FAILED'");
    expect(source).toContain("SELECT MAX(g2.version)");
    expect(source).toContain("cr.status = 'RUNNING'");
    expect(source).toContain("w.status IN ('RUNNING', 'CLAIMED')");
  });
});
