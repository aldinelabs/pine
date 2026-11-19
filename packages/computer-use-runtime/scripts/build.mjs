import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { buildExtension } from "../vendor/munim-computer-use/scripts/build-extension.mjs";
import pineIdentity from "../pine-identity.json" with { type: "json" };

const packageRoot = path.resolve(fileURLToPath(import.meta.url), "../..");
const vendorRoot = path.join(packageRoot, "vendor", "munim-computer-use");
const outputRoot = path.join(packageRoot, "pine-computer-use");
const executableName =
  process.platform === "win32" ? "pine-computer-use.exe" : "pine-computer-use";
const outputExecutable = path.join(outputRoot, "bin", executableName);
const targetArchitecture = process.env.PINE_COMPUTER_USE_ARCH;
const swiftArchitecture =
  targetArchitecture === "x64"
    ? "x86_64"
    : targetArchitecture === "arm64"
      ? "arm64"
      : undefined;

if (targetArchitecture && !swiftArchitecture && process.platform === "darwin") {
  throw new Error(
    `Unsupported PINE_COMPUTER_USE_ARCH value: ${targetArchitecture}`,
  );
}

function latestModifiedAt(root) {
  let latest = 0;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === ".build" || entry.name === "target") continue;
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

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: buildEnvironment(),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} exited with status ${result.status ?? "unknown"}`,
    );
  }
}

function commandOutput(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    env: buildEnvironment(),
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr || `${command} failed`);
  }
  return result.stdout.trim();
}

function buildEnvironment() {
  const cacheRoot = path.join(nativeSourceRoot, ".build", "pine-cache");
  mkdirSync(cacheRoot, { recursive: true });
  return {
    ...process.env,
    CLANG_MODULE_CACHE_PATH: path.join(cacheRoot, "clang"),
    SWIFTPM_MODULECACHE_OVERRIDE: path.join(cacheRoot, "swiftpm"),
  };
}

const nativeSourceRoot =
  process.platform === "darwin"
    ? path.join(vendorRoot, "macos")
    : path.join(vendorRoot, "windows-linux");
const nativeIsCurrent =
  !targetArchitecture &&
  existsSync(outputExecutable) &&
  statSync(outputExecutable).mtimeMs >= latestModifiedAt(nativeSourceRoot);

if (!nativeIsCurrent) {
  let builtExecutable;
  if (process.platform === "darwin") {
    const swiftBuildArgs = ["build", "-c", "release"];
    if (swiftArchitecture) swiftBuildArgs.push("--arch", swiftArchitecture);
    swiftBuildArgs.push("--package-path", nativeSourceRoot);
    run("swift", swiftBuildArgs);
    const binPath = commandOutput("swift", [
      "build",
      "-c",
      "release",
      ...(swiftArchitecture ? ["--arch", swiftArchitecture] : []),
      "--show-bin-path",
      "--package-path",
      nativeSourceRoot,
    ]);
    builtExecutable = path.join(binPath, "munim-computer-use");
  } else {
    run("cargo", [
      "build",
      "--release",
      "--manifest-path",
      path.join(nativeSourceRoot, "Cargo.toml"),
    ]);
    builtExecutable = path.join(
      nativeSourceRoot,
      "target",
      "release",
      process.platform === "win32"
        ? "munim-computer-use.exe"
        : "munim-computer-use",
    );
  }
  mkdirSync(path.dirname(outputExecutable), { recursive: true });
  cpSync(builtExecutable, outputExecutable);
}

const extensionOutput = path.join(outputRoot, "chrome-extension");
const { profile, browserExtension } = pineIdentity;
const { extensionId } = buildExtension({
  out: extensionOutput,
  hosts: profile.nativeHostNames,
  groupTitle: browserExtension.groupTitle,
  name: browserExtension.name,
  description: browserExtension.description,
  key: browserExtension.key,
});
if (!profile.extensionIds.includes(extensionId)) {
  throw new Error(
    `Pine browser extension id ${extensionId} is not in pine-identity.json extensionIds.`,
  );
}
cpSync(
  path.join(packageRoot, "LICENSE.upstream"),
  path.join(outputRoot, "LICENSE.munim"),
);
cpSync(path.join(packageRoot, "NOTICE.md"), path.join(outputRoot, "NOTICE.md"));

console.log(
  `Prepared Pine Computer Use for ${process.platform}/${process.arch}: ${outputRoot}`,
);
