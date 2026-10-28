import { createRequire } from "node:module";
import path from "node:path";

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
  return {
    "@file-viewer-internal/umd-parser": path.join(epub, "dist/umd/parser.js"),
  };
}
