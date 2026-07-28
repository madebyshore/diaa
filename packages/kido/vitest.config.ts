import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Use jsdom so that modules using document/window (like raf.ts → tab.ts)
    // don't throw ReferenceError in the test environment.
    environment: "jsdom",
    include: ["src/**/*.test.ts"],
  },
});
