import { describe, expect, it } from "vitest";
import { applyGcpApplicationSecrets } from "../../lib/gcpSecretsBootstrap.js";

describe("GCP application secret precedence", () => {
  it("refreshes production database URLs from GCP while preserving unrelated injected values", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "production",
      SUPABASE_PROD_DATABASE_URL: "postgresql://postgres:stale@db.example:6543/postgres",
      SUPABASE_DATABASE_URL: "postgresql://postgres:stale-legacy@db.example:6543/postgres",
      OPENAI_API_KEY: "hostinger-openai",
    };

    const result = applyGcpApplicationSecrets(
      {
        SUPABASE_PROD_DATABASE_URL: "postgresql://postgres:fresh@db.example:6543/postgres",
        SUPABASE_DATABASE_URL: "postgresql://postgres:fresh-legacy@db.example:6543/postgres",
        OPENAI_API_KEY: "gcp-openai",
        ADMIN_API_KEY: "gcp-admin",
      },
      env,
    );

    expect(env.SUPABASE_PROD_DATABASE_URL).toContain(":fresh@");
    expect(env.SUPABASE_DATABASE_URL).toContain(":fresh-legacy@");
    expect(env.OPENAI_API_KEY).toBe("hostinger-openai");
    expect(env.ADMIN_API_KEY).toBe("gcp-admin");
    expect(result).toEqual({ loaded: 1, overridden: 2, skipped: 1 });
  });


  it("treats APP_ENV from the consolidated secret as production before applying precedence", () => {
    const env: NodeJS.ProcessEnv = {
      SUPABASE_PROD_DATABASE_URL: "postgresql://postgres:stale@db.example:6543/postgres",
      OPENAI_API_KEY: "hostinger-openai",
    };

    const result = applyGcpApplicationSecrets(
      {
        APP_ENV: "production",
        SUPABASE_PROD_DATABASE_URL: "postgresql://postgres:fresh@db.example:6543/postgres",
        OPENAI_API_KEY: "gcp-openai",
      },
      env,
    );

    expect(env.APP_ENV).toBe("production");
    expect(env.SUPABASE_PROD_DATABASE_URL).toContain(":fresh@");
    expect(env.OPENAI_API_KEY).toBe("hostinger-openai");
    expect(result).toEqual({ loaded: 1, overridden: 1, skipped: 1 });
  });

  it("keeps existing database URLs outside production", () => {
    const env: NodeJS.ProcessEnv = {
      NODE_ENV: "development",
      SUPABASE_PROD_DATABASE_URL: "postgresql://postgres:local@db.example:6543/postgres",
    };

    const result = applyGcpApplicationSecrets(
      {
        SUPABASE_PROD_DATABASE_URL: "postgresql://postgres:gcp@db.example:6543/postgres",
      },
      env,
    );

    expect(env.SUPABASE_PROD_DATABASE_URL).toContain(":local@");
    expect(result).toEqual({ loaded: 0, overridden: 0, skipped: 1 });
  });
});
