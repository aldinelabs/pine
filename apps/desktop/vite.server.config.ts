import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
import { builtinModules } from "node:module";

const { version } = JSON.parse(readFileSync("package.json", "utf8")) as {
  version: string;
};

// The headless server: Pine's core without Electron, as one ESM entry that
// scripts/build-server.mjs places beside the agent worker and the renderer.
export default defineConfig({
  define: { PINE_SERVER_VERSION: JSON.stringify(version) },
  plugins: [
    {
      name: "forbid-electron",
      // Desktop code reaching the server would only fail once it runs.
      resolveId(source, importer) {
        if (source === "electron" || source.startsWith("electron/"))
          throw new Error(`The server must not import Electron (${importer}).`);
      },
    },
  ],
  build: {
    outDir: ".vite/server",
    emptyOutDir: false,
    minify: false,
    lib: {
      entry: "src/server.ts",
      fileName: () => "server.mjs",
      formats: ["es"],
    },
    rollupOptions: {
      // Loaded at runtime from node_modules, as the agent worker does.
      external: [
        "@anthropic-ai/sandbox-runtime",
        "@earendil-works/pi-ai",
        "@earendil-works/pi-coding-agent",
        ...builtinModules,
        /^node:/,
      ],
      output: {
        // Bundled CommonJS dependencies still call require().
        banner:
          'import { createRequire as __pineCreateRequire } from "node:module";\nglobalThis.require ??= __pineCreateRequire(import.meta.url);',
        chunkFileNames: "server-[name]-[hash].mjs",
      },
    },
  },
});
