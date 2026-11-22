import vue from "@vitejs/plugin-vue";
import path from "node:path";
import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";
import { THIRD_PARTY_LICENSES_MODULE } from "./src/build/thirdPartyLicenses";
import { fileViewerInternals } from "./vite.file-viewer-internals";
import { vueCompiler } from "./vite.vue-compiler";

/** Tests stub the About page's catalog; its collector has its own tests. */
function emptyThirdPartyLicenses(): Plugin {
  const resolvedId = `\0${THIRD_PARTY_LICENSES_MODULE}`;
  return {
    name: "pine-third-party-licenses-stub",
    resolveId: (id) => (id === THIRD_PARTY_LICENSES_MODULE ? resolvedId : null),
    load: (id) =>
      id === resolvedId
        ? "export default { packages: [], referenced: [], texts: [] };"
        : null,
  };
}

export default defineConfig({
  plugins: [vue({ compiler: vueCompiler }), emptyThirdPartyLicenses()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      ...fileViewerInternals(),
    },
  },
  test: {
    environment: "happy-dom",
    // Previews parse documents with style sheet links; a browser's
    // DOMParser never fetches them, so happy-dom should not either.
    environmentOptions: {
      happyDOM: { settings: { disableCSSFileLoading: true } },
    },
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
