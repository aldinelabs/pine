import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileViewerRenderers } from "@file-viewer/vite-plugin";
import path from "node:path";
import { vueCompiler } from "./vite.vue-compiler";

// https://vitejs.dev/config
export default defineConfig({
  plugins: [
    vue({ compiler: vueCompiler }),
    tailwindcss(),
    // Publishes file-viewer's workers, WASM and fonts under `file-viewer/`
    // next to index.html; the preview sets that directory as its asset base.
    fileViewerRenderers({
      inject: false,
      copyAssets: { baseDir: "file-viewer" },
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Workspace packages are served as source. Left to discovery, one added
  // while the dev server runs is pre-bundled and then goes stale on edits.
  optimizeDeps: {
    exclude: [
      "@pine/pi-background-tasks",
      "@pine/rpiv-ask-user-question",
      "@pine/rpiv-todo",
    ],
  },
});
