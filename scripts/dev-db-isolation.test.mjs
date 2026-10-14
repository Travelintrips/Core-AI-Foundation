import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  assertDevelopmentDatabaseIsolation,
  resolveDatabaseUrl,
} from "../lib/db/src/env.ts";

const dev = "abcdefghijklmnopqrst";
const prod = "zyxwvutsrqponmlkjihgf";
const pooler = "aws-1-ap-southeast-2.pooler.supabase.com";
const env = {
  APP_ENV: "development",
  NODE_ENV: "development",
  SUPABASE_URL_DEV: "https://" + dev + ".supabase.co",
};

describe("DEV database isolation for versioned VPS releases", () => {
  it("accepts custom Supabase pooler users when the project ref is DEV", () => {
    for (const role of ["postgres", "app_worker", "cst-worker"]) {
      const url = "postgresql://" + role + "." + dev +
        ":test@"+pooler+":6543/postgres";
      assert.doesNotThrow(() => assertDevelopmentDatabaseIsolation(url, env));
      assert.equal(resolveDatabaseUrl({ ...env, SUPABASE_DEV_DATABASE_URL: url }), url);
    }
  });
  it("accepts Supabase direct database hosts with the exact DEV project", () => {
    const url = "postgresql://postgres:test@db." + dev + ".supabase.co:5432/postgres";
    assert.doesNotThrow(() => assertDevelopmentDatabaseIsolation(url, env));
  });
  it("rejects production or unverifiable connections without exceptions", () => {
    const wrong = [
      "postgresql://cst." + prod + ":test@" + pooler + ":6543/postgres",
      "postgresql://postgres:test@" + pooler + ":6543/postgres",
      "postgresql://cst." + dev + ".extra:test@" + pooler + ":6543/postgres",
      "postgresql://postgres:test@db." + prod + ".supabase.co:5432/postgres",
      "postgresql://postgres:test@database.example.net:5432/postgres",
    ];
    for (const url of wrong) {
      assert.throws(() => assertDevelopmentDatabaseIsolation(url, env),
        /isolation violation|must identify/);
    }
  });
  it("rejects a missing DEV identity even for a matching pooler username", () => {
    const url = "postgresql://worker." + dev + ":test@" + pooler + ":6543/postgres";
    assert.throws(() => assertDevelopmentDatabaseIsolation(url, { APP_ENV: "development" }),
      /SUPABASE_URL_DEV/);
  });
});
