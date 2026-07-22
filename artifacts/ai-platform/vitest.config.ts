import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  test: {
    projects: [
      {
        // Existing pure-logic tests (node environment — baseline unchanged)
        test: {
          name: "node",
          environment: "node",
          include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
          exclude: ["src/components/workspace/**/*.test.tsx"],
        },
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "./src"),
          },
        },
      },
      {
        // Workspace component tests (DOM environment)
        plugins: [react()],
        test: {
          name: "workspace-dom",
          environment: "happy-dom",
          include: ["src/components/workspace/**/*.test.tsx"],
          setupFiles: ["./src/components/workspace/__tests__/setup.ts"],
          globals: true,
        },
        resolve: {
          alias: {
            "@": path.resolve(__dirname, "./src"),
          },
        },
      },
    ],
  },
});
