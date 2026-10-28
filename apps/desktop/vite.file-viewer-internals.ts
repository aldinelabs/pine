import { copyFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * file-viewer modules Pine reuses but its packages do not export. The
 * packages are pinned to exact versions, so these paths stay put until an
 * upgrade, which the tests that import them would catch.
 */
export function fileViewerInternals(): Record<string, string> {
  const require = createRequire(__filename);
  const epub = path.dirname(
    require.resolve("@file-viewer/renderer-epub/package.json"),
  );
  const ofd = path.dirname(
    require.resolve("@file-viewer/renderer-ofd/package.json"),
  );
  return {
    "@file-viewer-internal/umd-parser": path.join(epub, "dist/umd/parser.js"),
    "@file-viewer-internal/ofd": path.join(ofd, "vendor/dltech/ofd/ofd.js"),
  };
}

/**
 * Workers the file-viewer plugin only copies from asset packages Pine does
 * not install. The renderers ship the same self-contained files, so they are
 * published where the renderers look for them: `file-viewer/vendor/`.
 */
const vendoredWorkers: [string, string, string[]][] = [
  ["@file-viewer/renderer-hangul", "hangul", ["hangul.worker.js"]],
  ["@file-viewer/renderer-iwork", "iwork", ["iwork.worker.js"]],
  [
    "@file-viewer/renderer-wordperfect",
    "wordperfect",
    ["wordperfect.worker.js", "libwpd.mjs", "libwpd.wasm"],
  ],
];

export function fileViewerWorkers(): Plugin {
  let publicDir = "";
  return {
    name: "pine:file-viewer-workers",
    configResolved(config) {
      publicDir = config.publicDir;
    },
    async buildStart() {
      const require = createRequire(__filename);
      for (const [name, folder, files] of vendoredWorkers) {
        const dist = path.join(
          path.dirname(require.resolve(`${name}/package.json`)),
          "dist",
        );
        const target = path.join(publicDir, "file-viewer/vendor", folder);
        await mkdir(target, { recursive: true });
        for (const file of files)
          await copyFile(path.join(dist, file), path.join(target, file));
      }
    },
  };
}
