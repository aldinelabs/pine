import { defineConfig } from "vite";
import { cpSync, mkdirSync } from "node:fs";
import { builtinModules, createRequire } from "node:module";
import path from "node:path";
import { RECALL_TOOL_NAME } from "./src/shared/agent";

const adapterRoot = path.dirname(
  createRequire(import.meta.url).resolve("pi-mcp-adapter"),
);

// pi-vcc names its tool, the summary footer that points at it, and the filter
// that keeps it from matching its own calls all after `vcc_recall`. Rewrite
// them together so the model sees Pine's tool name. Each listed file must
// still contain the name, so a pi-vcc upgrade that moves it fails the build.
const PI_VCC_RECALL_TOOL_NAME = "vcc_recall";
const PI_VCC_RECALL_SOURCES = [
  "/@sting8k/pi-vcc/src/core/format.ts",
  "/@sting8k/pi-vcc/src/core/search-entries.ts",
  "/@sting8k/pi-vcc/src/tools/recall.ts",
];

// Pi is ESM-only and relies on `import.meta.url`. Keep the isolated agent
// process and all of its chunks in ESM instead of emitting runtime `require()`
// calls or rewriting Pi's module metadata for CommonJS.
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [
    {
      name: "rename-pi-vcc-recall-tool",
      transform(source, id) {
        if (!id.includes("/@sting8k/pi-vcc/src/")) return;
        if (
          PI_VCC_RECALL_SOURCES.some((file) => id.endsWith(file)) &&
          !source.includes(PI_VCC_RECALL_TOOL_NAME)
        ) {
          throw new Error(
            `pi-vcc no longer names ${PI_VCC_RECALL_TOOL_NAME} in ${id}; update the rename in vite.agent.config.ts.`,
          );
        }
        return source.replaceAll(PI_VCC_RECALL_TOOL_NAME, RECALL_TOOL_NAME);
      },
    },
    {
      name: "copy-pi-mcp-adapter-assets",
      transform(source, id) {
        if (id.endsWith("/pi-mcp-adapter/mcp-code.ts")) {
          // The adapter launches this as a Node worker. Vite's asset transform
          // otherwise rebundles it for browsers and strips Node built-ins.
          return source.replace(
            'new URL("./mcp-script-worker.mjs", import.meta.url)',
            'new URL("./mcp-script-worker.mjs", "" + import.meta.url)',
          );
        }
        if (
          id.endsWith("/pi-mcp-adapter/mcp-auth.ts") ||
          id.endsWith("/pi-mcp-adapter/secure-keyring.ts")
        ) {
          // Keep the recovery helper as a real file for Node's keyring path.
          return source.replaceAll(
            /new URL\((["'])\.\/mcp-keyring-helper\.cjs\1, import\.meta\.url\)/g,
            'new URL("./mcp-keyring-helper.cjs", "" + import.meta.url)',
          );
        }
      },
      closeBundle() {
        const output = path.resolve(
          mode === "production" ? ".vite/agent-build" : ".vite/build",
        );
        mkdirSync(path.join(output, "skills", "mcp-scripting"), {
          recursive: true,
        });
        for (const asset of [
          "app-bridge.bundle.js",
          "mcp-keyring-helper.cjs",
          "mcp-script-worker.mjs",
        ]) {
          cpSync(path.join(adapterRoot, asset), path.join(output, asset));
        }
        cpSync(
          path.join(adapterRoot, "skills", "mcp-scripting", "SKILL.md"),
          path.join(output, "skills", "mcp-scripting", "SKILL.md"),
        );
      },
    },
  ],
  build: {
    // Keep the production worker separate from Forge's concurrent main/preload
    // builds; the packaging hook copies it into the final shared build folder.
    outDir: mode === "production" ? ".vite/agent-build" : ".vite/build",
    lib: {
      entry: "src/agent.ts",
      fileName: () => "agent.mjs",
      formats: ["es"],
    },
    rollupOptions: {
      external: [
        "@anthropic-ai/sandbox-runtime",
        "@earendil-works/pi-ai",
        "@earendil-works/pi-coding-agent",
        "@napi-rs/keyring",
        // cross-spawn is CommonJS and calls require("child_process") at runtime.
        // Leave it to Node's CJS loader instead of wrapping it in ESM chunks.
        "cross-spawn",
        "yaml",
        // Optional native MCP Apps viewer. The adapter falls back to a browser
        // when glimpseui is not installed.
        "glimpseui",
        ...builtinModules,
        // This bundle runs in Electron's Node-enabled utility process. Vite's
        // browser externalization otherwise replaces Node built-ins with empty
        // shims (for example, AsyncLocalStorage becomes undefined).
        /^node:/,
      ],
      output: {
        // Rolldown's CommonJS bridge still needs require() for some bundled
        // Node dependencies. ESM utility-process chunks have no global require.
        banner:
          'import { createRequire as __pineCreateRequire } from "node:module";\nglobalThis.require ??= __pineCreateRequire(import.meta.url);',
        chunkFileNames: "[name]-[hash].mjs",
      },
    },
  },
}));
