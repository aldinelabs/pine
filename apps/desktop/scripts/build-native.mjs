// Builds the macOS addons and helpers in native/ as universal binaries, so
// packaging either architecture uses the same files. Elsewhere there is
// nothing to build.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
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

/** Newest modification time under a folder, skipping build output. */
function latestModifiedAt(root) {
  let latest = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === ".build" || entry.name === "build") continue;
    const entryPath = path.join(root, entry.name);
    latest = Math.max(
      latest,
      entry.isDirectory()
        ? latestModifiedAt(entryPath)
        : statSync(entryPath).mtimeMs,
    );
  }
  return latest;
}

/**
 * The Live Context helper (native/live-context) uses SpeechAnalyzer, which
 * needs the macOS 26 SDK. The feature is experimental and flag-gated, so a
 * helper that cannot be built (old SDK, failed build) is skipped with a
 * warning and Pine reports Live Context as unavailable; any earlier build is
 * removed so a stale binary is never packaged. PINE_REQUIRE_LIVE_CONTEXT=1
 * makes these failures errors instead.
 */
function buildLiveContextHelper() {
  const root = path.join(nativeRoot, "live-context");
  const output = path.join(root, "build", "pine-live-context");
  if (
    existsSync(output) &&
    statSync(output).mtimeMs >= latestModifiedAt(root)
  ) {
    return;
  }
  const skip = (reason) => {
    rmSync(output, { force: true });
    const message = `Skipping the Live Context helper: ${reason}`;
    if (process.env.PINE_REQUIRE_LIVE_CONTEXT === "1") {
      console.error(message);
      process.exit(1);
    }
    console.warn(message);
  };

  const sdk = spawnSync("xcrun", ["--sdk", "macosx", "--show-sdk-version"], {
    encoding: "utf8",
  });
  const sdkMajor = Number.parseInt(sdk.stdout ?? "", 10);
  if (!(sdkMajor >= 26)) {
    skip(`it needs the macOS 26 SDK (found ${sdk.stdout?.trim() || "none"}).`);
    return;
  }
  const swiftArgs = [
    "build",
    "-c",
    "release",
    "--arch",
    "arm64",
    "--arch",
    "x86_64",
    "--package-path",
    root,
  ];
  const result = spawnSync(
    "swift",
    [
      ...swiftArgs,
      // Usage descriptions for a standalone run; inside Pine.app macOS reads
      // the app's own Info.plist.
      "-Xlinker",
      "-sectcreate",
      "-Xlinker",
      "__TEXT",
      "-Xlinker",
      "__info_plist",
      "-Xlinker",
      path.join(root, "Info.plist"),
    ],
    { stdio: "inherit" },
  );
  if (result.error || result.status !== 0) {
    skip(
      `swift build failed (${result.error?.message ?? `status ${result.status}`}).`,
    );
    return;
  }
  const binPath = spawnSync("swift", [...swiftArgs, "--show-bin-path"], {
    encoding: "utf8",
  });
  if (binPath.error || binPath.status !== 0) {
    skip("swift build --show-bin-path failed.");
    return;
  }
  try {
    mkdirSync(path.dirname(output), { recursive: true });
    copyFileSync(path.join(binPath.stdout.trim(), "pine-live-context"), output);
  } catch (error) {
    skip(`could not copy the built helper (${error.message}).`);
    return;
  }
  console.log(`Built ${path.relative(process.cwd(), output)}`);
}

/**
 * sherpa-onnx's prebuilt C API and ONNX Runtime (both universal), which the
 * helper opens with dlopen only when a capture asks for speaker labels.
 * Pinned by version and SHA-256; the archive is checked before anything in
 * it is used. Packaging thins them to the target architecture and signs
 * them. Like the helper, a failure only makes speaker labels unavailable
 * unless PINE_REQUIRE_LIVE_CONTEXT=1.
 */
const SHERPA_ONNX = {
  version: "2.0.1",
  url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/v2.0.1/sherpa-onnx-v2.0.1-osx-universal2-shared-no-tts-lib.tar.bz2",
  sha256: "242b0593a033456e9344a76a11713d1c55da794d0e37eabf6acabaf7beeb2b36",
  root: "sherpa-onnx-v2.0.1-osx-universal2-shared-no-tts-lib/lib",
  libraries: ["libsherpa-onnx-c-api.dylib", "libonnxruntime.dylib"],
};

async function fetchDiarizationLibrary() {
  const root = path.join(nativeRoot, "live-context");
  const output = path.join(root, "build", "live-context-lib");
  const stamp = path.join(output, ".sha256");
  const helper = path.join(root, "build", "pine-live-context");
  const fail = (reason) => {
    rmSync(output, { force: true, recursive: true });
    const message = `Skipping speaker labels for Live Context: ${reason}`;
    if (process.env.PINE_REQUIRE_LIVE_CONTEXT === "1") {
      console.error(message);
      process.exit(1);
    }
    console.warn(message);
  };
  if (!existsSync(helper)) {
    rmSync(output, { force: true, recursive: true });
    return;
  }
  if (
    existsSync(stamp) &&
    readFileSync(stamp, "utf8").trim() === SHERPA_ONNX.sha256 &&
    SHERPA_ONNX.libraries.every((name) => existsSync(path.join(output, name)))
  ) {
    return;
  }

  const downloads = path.join(root, ".build", "downloads");
  const archive = path.join(downloads, path.basename(SHERPA_ONNX.url));
  const sha256 = (file) =>
    createHash("sha256").update(readFileSync(file)).digest("hex");
  try {
    mkdirSync(downloads, { recursive: true });
    if (!existsSync(archive) || sha256(archive) !== SHERPA_ONNX.sha256) {
      const response = await fetch(SHERPA_ONNX.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      writeFileSync(
        `${archive}.partial`,
        Buffer.from(await response.arrayBuffer()),
      );
      renameSync(`${archive}.partial`, archive);
    }
  } catch (error) {
    fail(`could not download sherpa-onnx (${error.message}).`);
    return;
  }
  const actual = sha256(archive);
  if (actual !== SHERPA_ONNX.sha256) {
    rmSync(archive, { force: true });
    fail(`sherpa-onnx's archive has SHA-256 ${actual}, not the pinned one.`);
    return;
  }

  const staging = `${output}.partial`;
  rmSync(staging, { force: true, recursive: true });
  mkdirSync(staging, { recursive: true });
  const extract = spawnSync(
    "tar",
    [
      "-xjf",
      archive,
      "-C",
      staging,
      "--strip-components",
      "2",
      ...SHERPA_ONNX.libraries.map((name) => `${SHERPA_ONNX.root}/${name}`),
    ],
    { stdio: "inherit" },
  );
  if (
    extract.status !== 0 ||
    !SHERPA_ONNX.libraries.every((name) => existsSync(path.join(staging, name)))
  ) {
    rmSync(staging, { force: true, recursive: true });
    fail("could not unpack sherpa-onnx.");
    return;
  }
  copyFileSync(path.join(root, "NOTICE.md"), path.join(staging, "NOTICE.md"));
  writeFileSync(path.join(staging, ".sha256"), `${SHERPA_ONNX.sha256}\n`);
  rmSync(output, { force: true, recursive: true });
  renameSync(staging, output);
  console.log(
    `Fetched sherpa-onnx ${SHERPA_ONNX.version} into ${path.relative(process.cwd(), output)}`,
  );
}

/**
 * The speaker-label models, bundled into the app (see
 * native/live-context/speaker-models.json for the pins). Each is checked
 * by size and SHA-256 on every build, so a cached copy (local or CI's
 * actions/cache) is reused only while it matches, and fetched again
 * otherwise: the pinned Hugging Face commit first, then its mirror. Like
 * the library, a failure only makes speaker labels unavailable unless
 * PINE_REQUIRE_LIVE_CONTEXT=1.
 */
async function fetchSpeakerModels() {
  const root = path.join(nativeRoot, "live-context");
  const output = path.join(root, "build", "live-context-models");
  const pins = JSON.parse(
    readFileSync(path.join(root, "speaker-models.json"), "utf8"),
  );
  const models = [pins.segmentation, pins.embedding];
  const fail = (reason) => {
    rmSync(output, { force: true, recursive: true });
    const message = `Skipping speaker labels for Live Context: ${reason}`;
    if (process.env.PINE_REQUIRE_LIVE_CONTEXT === "1") {
      console.error(message);
      process.exit(1);
    }
    console.warn(message);
  };
  // Without the helper or the library the models would never be used.
  if (
    !existsSync(path.join(root, "build", "pine-live-context")) ||
    !existsSync(path.join(root, "build", "live-context-lib"))
  ) {
    rmSync(output, { force: true, recursive: true });
    return;
  }
  const matches = (file, model) =>
    existsSync(file) &&
    statSync(file).size === model.bytes &&
    createHash("sha256").update(readFileSync(file)).digest("hex") ===
      model.sha256;

  mkdirSync(output, { recursive: true });
  // Only the pinned files and their licenses: a model dropped from the
  // pins leaves no copy.
  const expected = new Set([
    ...models.map((model) => model.file),
    "NOTICE.md",
    "licenses",
  ]);
  for (const name of readdirSync(output))
    if (!expected.has(name))
      rmSync(path.join(output, name), { force: true, recursive: true });

  for (const model of models) {
    const file = path.join(output, model.file);
    if (matches(file, model)) continue;
    rmSync(file, { force: true });
    const problems = [];
    for (const url of model.urls) {
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(5 * 60_000),
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        writeFileSync(
          `${file}.partial`,
          Buffer.from(await response.arrayBuffer()),
        );
        if (!matches(`${file}.partial`, model))
          throw new Error("size or SHA-256 differs from the pin");
        renameSync(`${file}.partial`, file);
        console.log(
          `Fetched ${model.file} into ${path.relative(process.cwd(), output)}`,
        );
        break;
      } catch (error) {
        rmSync(`${file}.partial`, { force: true });
        problems.push(`${new URL(url).host}: ${error.message}`);
      }
    }
    if (!existsSync(file)) {
      fail(`could not fetch ${model.file} (${problems.join("; ")}).`);
      return;
    }
  }
  // Their licenses travel with them (MIT and Apache-2.0 ask for it).
  copyFileSync(path.join(root, "NOTICE.md"), path.join(output, "NOTICE.md"));
  cpSync(path.join(root, "licenses"), path.join(output, "licenses"), {
    recursive: true,
  });
}

buildLiveContextHelper();
await fetchDiarizationLibrary();
await fetchSpeakerModels();
