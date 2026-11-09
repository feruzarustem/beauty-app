import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    environment: "node",
    fileParallelism: false,
    env: {
      DATABASE_URL: "postgresql://postgres:postgres@localhost:5433/beauty_test",
      SESSION_SECRET: "test-secret-test-secret-test-secret-32chars",
    },
  },
});
