import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: [
        "lib/event-publisher.ts",
        "lib/epoch-manager.ts",
        "lib/epoch-aggregator.ts"
      ],
      reporter: ["text", "text-summary"]
    }
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".")
    }
  }
});
