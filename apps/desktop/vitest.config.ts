import vue from "@vitejs/plugin-vue";
import path from "node:path";
import { defineConfig } from "vitest/config";
import { vueCompiler } from "./vite.vue-compiler";

export default defineConfig({
  plugins: [vue({ compiler: vueCompiler })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  test: {
    environment: "happy-dom",
    include: ["src/**/__tests__/**/*.test.ts"],
    setupFiles: ["src/__tests__/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: "v8",
      reporter: ["text", "html", "lcov"],
      reportsDirectory: "coverage",
      include: ["src/**/*.{ts,vue}"],
      exclude: [
        "src/**/__tests__/**",
        "src/components/ui/**",
        "src/main.ts",
        "src/preload.ts",
        "src/renderer.ts",
      ],
    },
  },
});
