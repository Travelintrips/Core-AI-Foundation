import { defineConfig } from "drizzle-kit";
import path from "path";
import { resolveDatabaseUrl } from "./src/env";

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts"),
  dialect: "postgresql",
  schemaFilter: ["ai_platform"],
  dbCredentials: {
    url: resolveDatabaseUrl(),
  },
});
