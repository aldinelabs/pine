import { execFileSync } from "node:child_process";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
} from "node:fs";
import path from "node:path";
import type { ForgeConfig } from "@electron-forge/shared-types";
import { MakerDMG } from "@electron-forge/maker-dmg";
import { MakerSquirrel } from "@electron-forge/maker-squirrel";
import { MakerZIP } from "@electron-forge/maker-zip";
import { MakerDeb } from "@electron-forge/maker-deb";
import { MakerRpm } from "@electron-forge/maker-rpm";
import { VitePlugin } from "@electron-forge/plugin-vite";

// The isolated agent process (vite.agent.config.ts) externalizes
// @earendil-works/pi-coding-agent and @earendil-works/pi-ai so their ESM-only,
// import.meta.url-aware code is never re-bundled. bun hoists those deps to the
// monorepo root node_modules, so they never reach the packaged app and the agent
// utility process crashes on import. Bake the runtime dependency closure into the
// packaged app's node_modules after the default prune pass.
const AGENT_RUNTIME_ENTRYPOINTS = [
  "@anthropic-ai/sandbox-runtime",
  "@ff-labs/fff-node",
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "pi-mcp-adapter",
] as const;
// Packages the main process loads at runtime from their own folder (native
// addons, a wasm file); optional per platform, so a missing one is skipped.
const MAIN_RUNTIME_ENTRYPOINTS = [
  "electron-liquid-glass",
  "node-datachannel",
  // WeChat voice messages: SILK decoding, which reads silk.wasm beside it.
  "silk-wasm",
] as const;

const LIVE_CONTEXT_HELPER = "native/live-context/build/pine-live-context";
/** sherpa-onnx and ONNX Runtime for speaker labels, beside the helper. */
const LIVE_CONTEXT_LIB = "native/live-context/build/live-context-lib";
/** The speaker-label models (about 30 MB) and their licenses. */
const LIVE_CONTEXT_MODELS = "native/live-context/build/live-context-models";

function locateWorkspaceNodeModules(): string {
  let dir = process.cwd();
  for (;;) {
    const probe = path.join(
      dir,
      "node_modules",
      "@earendil-works",
      "pi-coding-agent",
    );
    if (existsSync(probe)) return path.join(dir, "node_modules");
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Unable to locate workspace node_modules from ${process.cwd()}`,
      );
    }
    dir = parent;
  }
}

function collectRuntimeDeps(
  workspaceNodeModules: string,
  entrypoints: readonly string[],
): string[] {
  const deps = new Set<string>();
  const visited = new Set<string>();
  // A package may carry its own copy of a dependency in a nested
  // node_modules (a different major than the hoisted one). That copy travels
  // with its parent, but its own dependencies resolve from the hoisted tree
  // and must be collected from the copy's manifest, not the hoisted one's.
  const queue = entrypoints.map((name) => ({
    name,
    fromDirectory: workspaceNodeModules,
  }));
  while (queue.length > 0) {
    const next = queue.shift();
    if (next === undefined) continue;
    const nested = path.join(next.fromDirectory, "node_modules", next.name);
    const packageDirectory =
      next.fromDirectory !== workspaceNodeModules && existsSync(nested)
        ? nested
        : path.join(workspaceNodeModules, next.name);
    if (packageDirectory === path.join(workspaceNodeModules, next.name)) {
      deps.add(next.name);
    }
    if (visited.has(packageDirectory)) continue;
    visited.add(packageDirectory);
    const manifestPath = path.join(packageDirectory, "package.json");
    if (!existsSync(manifestPath)) continue;
    let manifest: {
      dependencies?: Record<string, unknown>;
      optionalDependencies?: Record<string, unknown>;
    };
    try {
      manifest = JSON.parse(
        readFileSync(manifestPath, "utf8"),
      ) as typeof manifest;
    } catch {
      continue;
    }
    const transitive = [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ];
    for (const dep of transitive) {
      queue.push({ name: dep, fromDirectory: packageDirectory });
    }
  }
  return [...deps];
}

function injectAgentBuild(buildPath: string): void {
  const sourceBuild = path.join(__dirname, ".vite", "agent-build");
  const agentEntry = path.join(sourceBuild, "agent.mjs");
  if (!existsSync(agentEntry)) {
    throw new Error(`Missing built agent process at ${agentEntry}`);
  }

  // The agent is a separate Vite entry with relative ESM chunks. Forge's
  // packaged app can otherwise contain main.js and preload.js while silently
  // omitting this worker and the chunks it imports.
  cpSync(sourceBuild, path.join(buildPath, ".vite", "build"), {
    recursive: true,
  });
  rmSync(path.join(buildPath, ".vite", "agent-build"), {
    force: true,
    recursive: true,
  });
}

function injectRuntimeDeps(buildPath: string): void {
  const workspaceNodeModules = locateWorkspaceNodeModules();
  const runtimeDeps = collectRuntimeDeps(workspaceNodeModules, [
    ...AGENT_RUNTIME_ENTRYPOINTS,
    ...MAIN_RUNTIME_ENTRYPOINTS,
  ]);
  const targetNodeModules = path.join(buildPath, "node_modules");
  mkdirSync(targetNodeModules, { recursive: true });
  for (const dep of runtimeDeps) {
    const source = path.join(workspaceNodeModules, dep);
    const target = path.join(targetNodeModules, dep);
    if (!existsSync(source) || existsSync(target)) continue;
    cpSync(source, target, { recursive: true });
  }
}

/**
 * The speaker-label libraries arrive universal; each package keeps only its
 * own architecture (about half the size) and signs them before the helper
 * that opens them.
 */
function prepareLiveContextLibraries(appPath: string, arch: string): void {
  const folder = path.join(appPath, "Contents/Resources/live-context-lib");
  if (!existsSync(folder)) return;
  const slice = arch === "x64" ? "x86_64" : arch;
  for (const name of readdirSync(folder)) {
    if (!name.endsWith(".dylib")) continue;
    const library = path.join(folder, name);
    const archs = execFileSync("lipo", ["-archs", library], {
      encoding: "utf8",
    })
      .trim()
      .split(/\s+/);
    if (archs.length > 1 && archs.includes(slice))
      execFileSync("lipo", [library, "-thin", slice, "-output", library]);
    execFileSync("codesign", [
      "--force",
      "--sign",
      "-",
      "--timestamp=none",
      library,
    ]);
  }
}

function signMacPackage(outputPaths: string[], arch: string): void {
  for (const outputPath of outputPaths) {
    const appPath = path.join(outputPath, "Pine.app");
    if (!existsSync(appPath)) continue;

    const computerUseHelper = path.join(
      appPath,
      "Contents/Resources/pine-computer-use/bin/pine-computer-use",
    );
    if (!existsSync(computerUseHelper)) {
      throw new Error(`Missing computer-use helper at ${computerUseHelper}`);
    }

    execFileSync("codesign", [
      "--force",
      "--sign",
      "-",
      "--timestamp=none",
      "--identifier",
      "munim-computer-use",
      "--requirements",
      '=designated => identifier "munim-computer-use"',
      computerUseHelper,
    ]);
    // Optional: an Xcode without the macOS 26 SDK skips it, and the app
    // then reports Live Context as unavailable. Pine spawns it, so macOS
    // asks for microphone and system audio access on Pine's behalf.
    const liveContextHelper = path.join(
      appPath,
      "Contents/Resources/pine-live-context",
    );
    prepareLiveContextLibraries(appPath, arch);
    if (existsSync(liveContextHelper)) {
      execFileSync("codesign", [
        "--force",
        "--sign",
        "-",
        "--timestamp=none",
        "--identifier",
        "com.electron.pine.live-context",
        "--requirements",
        '=designated => identifier "com.electron.pine.live-context"',
        liveContextHelper,
      ]);
    }
    execFileSync("codesign", [
      "--force",
      "--deep",
      "--sign",
      "-",
      "--timestamp=none",
      "--identifier",
      "com.electron.pine",
      "--requirements",
      '=designated => identifier "com.electron.pine"',
      appPath,
    ]);
    execFileSync("codesign", [
      "--verify",
      "--deep",
      "--strict",
      "--verbose=2",
      appPath,
    ]);
  }
}

/** Window size, icon size and icon centres of the DMG window, in points. */
const dmgLayout = JSON.parse(
  readFileSync(
    path.join(__dirname, "resources/installer/dmg-layout.json"),
    "utf8",
  ),
) as {
  iconSize: number;
  app: { x: number; y: number };
  applications: { x: number; y: number };
};

const windowsCertificateFile = process.env.WINDOWS_CERTIFICATE_FILE;
const windowsCertificatePassword = process.env.WINDOWS_CERTIFICATE_PASSWORD;
const windowsSign =
  windowsCertificateFile && windowsCertificatePassword
    ? {
        certificateFile: windowsCertificateFile,
        certificatePassword: windowsCertificatePassword,
      }
    : undefined;

const config: ForgeConfig = {
  packagerConfig: {
    // ASAR avoids Windows long-path issues and reduces small-file startup I/O.
    // srt-win is spawned by the OS and native addons are loaded with dlopen,
    // so both must remain real unpacked files.
    asar: {
      unpack: path.join(
        "**",
        "node_modules",
        `{${[
          path.join(
            "@anthropic-ai",
            "sandbox-runtime",
            "vendor",
            "srt-win",
            "**",
            "*",
          ),
          path.join("electron-liquid-glass", "prebuilds", "**", "*"),
          // The prebuilt WebRTC binary is loaded with dlopen.
          path.join("@node-datachannel", "**", "*"),
          // fff's search library and its FFI loader are opened with dlopen.
          path.join("@ff-labs", "fff-bin-*", "**", "*"),
          path.join("@yuuang", "**", "*"),
        ].join(",")}}`,
      ),
    },
    // Packager discovers icon.icon and compiles its native Assets.car on macOS;
    // icon.icns is Apple's generated legacy fallback, icon.ico is for Windows.
    icon: path.join(__dirname, "resources/icon"),
    win32metadata: {
      CompanyName: "Xinyuan Weng",
      FileDescription: "Pine desktop client",
      InternalName: "Pine",
      OriginalFilename: "Pine.exe",
      ProductName: "Pine",
      "requested-execution-level": "asInvoker",
    },
    windowsSign,
    extraResource: [
      path.join(__dirname, "resources/icon.png"),
      path.join(__dirname, "resources/tray"),
      path.join(__dirname, "../../.pine/release.json"),
      path.join(
        __dirname,
        "../../packages/computer-use-runtime/pine-computer-use",
      ),
      // Fetched by scripts/fetch-geoip.mjs before packaging.
      path.join(__dirname, "resources/geoip/dbip-city-lite.mmdb.gz"),
      // Built by scripts/build-native.mjs; loaded by path from main.
      ...(process.platform === "darwin"
        ? [
            path.join(
              __dirname,
              "native/sidebar-glass/build/sidebar_glass.node",
            ),
            path.join(__dirname, "native/app-context/build/app_context.node"),
          ]
        : []),
      // Built by scripts/build-native.mjs when the macOS 26 SDK is present.
      ...(process.platform === "darwin" &&
      existsSync(path.join(__dirname, LIVE_CONTEXT_HELPER))
        ? [path.join(__dirname, LIVE_CONTEXT_HELPER)]
        : []),
      // Fetched (pinned, checksummed) by scripts/build-native.mjs: the
      // library and the models speaker labels need, macOS only. Without
      // both, the app has no speaker labels.
      ...(process.platform === "darwin" &&
      existsSync(path.join(__dirname, LIVE_CONTEXT_HELPER)) &&
      existsSync(path.join(__dirname, LIVE_CONTEXT_LIB)) &&
      existsSync(path.join(__dirname, LIVE_CONTEXT_MODELS))
        ? [
            path.join(__dirname, LIVE_CONTEXT_LIB),
            path.join(__dirname, LIVE_CONTEXT_MODELS),
          ]
        : []),
    ],
    // The prompts macOS shows when Live Context first listens.
    extendInfo: {
      NSMicrophoneUsageDescription:
        "Pine transcribes what you say into the conversation's live context.",
      NSAudioCaptureUsageDescription:
        "Pine transcribes the meeting or class audio playing on this Mac into the conversation's live context.",
    },
    afterPrune: [
      (
        buildPath: string,
        _electronVersion: string,
        _platform: string,
        _arch: string,
        callback: (err?: Error | null) => void,
      ) => {
        injectAgentBuild(buildPath);
        injectRuntimeDeps(buildPath);
        callback();
      },
    ],
  },
  hooks: {
    // Runs for every package and make, including CI's direct forge calls.
    prePackage: () => {
      execFileSync(
        process.execPath,
        [path.join(__dirname, "scripts/fetch-geoip.mjs")],
        { stdio: "inherit" },
      );
      return Promise.resolve();
    },
    postPackage: (_forgeConfig, packageResult) => {
      if (packageResult.platform === "darwin") {
        signMacPackage(packageResult.outputPaths, packageResult.arch);
      }
      return Promise.resolve();
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({
      name: "Pine",
      exe: "Pine.exe",
      setupExe: "PineSetup.exe",
      setupIcon: path.join(__dirname, "resources/icon.ico"),
      // Shown while Squirrel installs; see resources/generate-installer-art.mjs.
      loadingGif: path.join(
        __dirname,
        "resources/installer/windows-loading.gif",
      ),
      // Apps & features downloads this URL for the uninstall entry's icon.
      iconUrl:
        "https://raw.githubusercontent.com/aldinelabs/pine/main/apps/desktop/resources/icon.ico",
      windowsSign,
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerDMG(
      {
        format: "ULFO",
        // appdmg pairs dmg-background@2x.png with it into a Retina TIFF and
        // sizes the window to it; resources/generate-installer-art.mjs draws
        // the background around the same layout.
        background: path.join(
          __dirname,
          "resources/installer/dmg-background.png",
        ),
        icon: path.join(__dirname, "resources/icon.icns"),
        iconSize: dmgLayout.iconSize,
        contents: (options) => [
          { ...dmgLayout.app, type: "file", path: options.appPath },
          { ...dmgLayout.applications, type: "link", path: "/Applications" },
        ],
      },
      ["darwin"],
    ),
    new MakerRpm({
      options: { icon: path.join(__dirname, "resources/icon.png") },
    }),
    new MakerDeb({
      options: { icon: path.join(__dirname, "resources/icon.png") },
    }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: "src/main.ts",
          config: "vite.main.config.ts",
        },
        {
          entry: "src/preload.ts",
          config: "vite.preload.config.ts",
        },
        {
          entry: "src/agent.ts",
          config: "vite.agent.config.ts",
        },
      ],
      renderer: [
        {
          name: "main_window",
          config: "vite.renderer.config.ts",
        },
      ],
    }),
  ],
};

export default config;
