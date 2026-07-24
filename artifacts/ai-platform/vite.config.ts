import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

// ─── Build-time guard: fail if a server-side secret is referenced via ────────
// import.meta.env.  These names must NEVER enter the browser bundle.
// If you need to add a new server-only variable, add it to this list.
const FORBIDDEN_SERVER_SECRETS = [
  "ADMIN_API_KEY",
  "SESSION_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY_DEV",
  "SMTP_PASS",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GEMINI_API_KEY",
  "MISTRAL_API_KEY",
  "REPLICATE_API_TOKEN",
] as const;

/**
 * Vite plugin that aborts the build (or HMR transform) if any source file
 * accesses a forbidden server-side secret through import.meta.env.
 *
 * Matches both dot-notation (import.meta.env.ADMIN_API_KEY) and
 * bracket-notation (import.meta.env["ADMIN_API_KEY"]).
 */
function noServerSecretsPlugin(): Plugin {
  const pat = new RegExp(
    `import\\.meta\\.env(?:\\.VITE_[A-Z_]+|\\??\\.(?:${FORBIDDEN_SERVER_SECRETS.join("|")})|\\??\\["(?:${FORBIDDEN_SERVER_SECRETS.join("|")})"\\]|\\??\\['(?:${FORBIDDEN_SERVER_SECRETS.join("|")})'\\])`,
    "g",
  );
  // Simpler: just look for the secret names after import.meta.env
  const simpler = new RegExp(
    `import\\.meta\\.env(?:\\??\\.|\\.?\\[["'])(?:${FORBIDDEN_SERVER_SECRETS.join("|")})`,
  );

  return {
    name: "no-server-secrets",
    enforce: "pre",
    transform(code, id) {
      if (id.includes("node_modules") || id.includes("/dist/")) return null;
      if (!id.endsWith(".ts") && !id.endsWith(".tsx") && !id.endsWith(".js") && !id.endsWith(".jsx")) return null;
      if (simpler.test(code)) {
        const matches = [...code.matchAll(new RegExp(simpler.source, "g"))].map((m) => m[0]);
        this.error(
          `[SECURITY] Server-side secret referenced via import.meta.env in:\n  ${id}\n` +
          `  Forbidden references: ${[...new Set(matches)].join(", ")}\n` +
          `  Use the httpOnly session cookie (POST /api/internal/auth/login) instead.`,
        );
      }
      return null;
    },
  };
}

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    "BASE_PATH environment variable is required but was not provided.",
  );
}

export default defineConfig({
  base: basePath,
  plugins: [
    noServerSecretsPlugin(),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
