/**
 * Vitest configuration for the tamahagane-fe app.
 *
 * Mirrors the path aliases from vite.config.ts so that test files can use
 * the same @app/*, @engine/*, and @/* import aliases as production code.
 * Without these aliases, dynamic imports of route modules in tests would fail
 * with "Cannot find package '@app/...'".
 *
 * The test environment is "node" — browser globals (document, window) are not
 * available. Tests that import modules with browser side-effects must mock those
 * modules via vi.mock() before importing the module under test.
 */

import path from "node:path";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@engine": path.resolve(import.meta.dirname, "src/engine"),
      "@app": path.resolve(import.meta.dirname, "src/app"),
      "@kido": path.resolve(import.meta.dirname, "src/kido"),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
