import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { vueCompiler } from "./vite.vue-compiler";

// https://vitejs.dev/config
export default defineConfig({
  plugins: [vue({ compiler: vueCompiler }), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  // Workspace packages are served as source. Left to discovery, one added
  // while the dev server runs is pre-bundled and then goes stale on edits.
  optimizeDeps: {
    exclude: ["@pine/rpiv-ask-user-question", "@pine/rpiv-todo"],
  },
});
