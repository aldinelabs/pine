// Builds the macOS addons in native/ as universal binaries, so packaging
// either architecture uses the same files. Elsewhere there is nothing to
// build.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const nativeRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../native",
);

/** Each addon is native/<folder>/<name>.m, built to build/<name>.node. */
const addons = [
  { folder: "sidebar-glass", name: "sidebar_glass", frameworks: ["AppKit"] },
  {
    folder: "app-context",
    name: "app_context",
    frameworks: ["AppKit", "ApplicationServices"],
  },
];

if (process.platform !== "darwin") process.exit(0);

for (const { folder, name, frameworks } of addons) {
  const root = path.join(nativeRoot, folder);
  const source = path.join(root, `${name}.m`);
  const output = path.join(root, "build", `${name}.node`);
  if (
    existsSync(output) &&
    statSync(output).mtimeMs >= statSync(source).mtimeMs
  ) {
    continue;
  }

  mkdirSync(path.dirname(output), { recursive: true });
  const result = spawnSync(
    "xcrun",
    [
      "--sdk",
      "macosx",
      "clang",
      "-ObjC",
      "-fobjc-arc",
      "-fmodules",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-Wno-unused-parameter",
      "-O2",
      "-arch",
      "arm64",
      "-arch",
      "x86_64",
      "-mmacosx-version-min=11.0",
      "-bundle",
      // Node-API comes from the Electron process that loads the addon.
      "-undefined",
      "dynamic_lookup",
      ...frameworks.flatMap((framework) => ["-framework", framework]),
      source,
      "-o",
      output,
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
  console.log(`Built ${path.relative(process.cwd(), output)}`);
}
