import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.js"],
    setupFiles: ["./tests/setup.js"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      include: ["src/**/*.js"],
      // No hard % threshold gate yet — current coverage only spans the pure
      // logic in a handful of service files (see tests/*.test.js). Route
      // handlers, the importer's DB-writing insert*() functions, and the
      // esign/email integrations are still untested and would drag any
      // meaningful threshold down to something not worth gating on. Report
      // the real number every run instead of pretending a fake gate means
      // something — raise this file's ambition once route-level tests exist.
    },
  },
});
