import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@the-street/shared": path.resolve(__dirname, "../shared/src/index.ts"),
      "@the-street/ai-service": path.resolve(__dirname, "../ai-service/src/index.ts"),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
