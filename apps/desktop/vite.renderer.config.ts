import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import { fileViewerRenderers } from "@file-viewer/vite-plugin";
import { createRequire } from "node:module";
import path from "node:path";
import {
  fileViewerInternals,
  fileViewerWorkers,
} from "./vite.file-viewer-internals";
import { vueCompiler } from "./vite.vue-compiler";

/**
 * file-viewer's preset is served unbundled and imports its capability
 * packages only when a format needs them, so Vite would find them mid-session,
 * re-bundle, and break modules the page already loaded. Bundling them up front
 * keeps the dependency graph stable.
 */
function fileViewerCapabilities(): string[] {
  const manifest = createRequire(__filename)(
    "@file-viewer/preset-all/package.json",
  ) as { dependencies?: Record<string, string> };
  return Object.keys(manifest.dependencies ?? {}).filter((name) =>
    name.startsWith("@file-viewer/capability-"),
  );
}

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
    fileViewerWorkers(),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      ...fileViewerInternals(),
    },
  },
  // Workspace packages are served as source. Left to discovery, one added
  // while the dev server runs is pre-bundled and then goes stale on edits.
  optimizeDeps: {
    include: [
      ...fileViewerCapabilities(),
      // The Photoshop renderer imports this UMD bundle, which only exports
      // once pre-bundled.
      "ag-psd/dist/bundle.js",
      // Pine's own preview decoders, imported when a format needs them.
      "@file-viewer/capability-mermaid/engine",
      "@file-viewer/eda-layout",
      "@file-viewer/eda-orcad",
      "@file-viewer/geometry-engine",
      "@file-viewer/renderer-chm",
      "@file-viewer/renderer-chm/security",
      "@file-viewer/renderer-epub",
      "@flyfish-dev/cad-viewer",
      "@kenjiuno/msgreader",
      "@ljheee/xmind-parser",
      "@tmcw/togeojson",
      "@tonejs/midi",
      "ag-psd",
      "cfb",
      "heic2any",
      "hyparquet",
      "jszip",
      "libarchive.js",
      "postal-mime",
      "roughjs",
      "shpjs",
      "three",
      ...[
        "controls/OrbitControls",
        ..."GLTF OBJ STL PLY FBX Collada TDS 3MF AMF USD PCD VRML XYZ VTK"
          .split(" ")
          .map((name) => `loaders/${name}Loader`),
      ].map((path) => `three/addons/${path}.js`),
      "sql.js",
      "utif",
    ],
    exclude: [
      "@pine/pi-background-tasks",
      "@pine/rpiv-ask-user-question",
      "@pine/rpiv-todo",
    ],
  },
});
