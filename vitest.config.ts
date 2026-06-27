import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/**/src/**/*.test.ts", "extensions/**/src/**/*.test.ts"],
    environment: "node",
  },
});
