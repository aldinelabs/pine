import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
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
  "@earendil-works/pi-coding-agent",
  "@earendil-works/pi-ai",
  "pi-mcp-adapter",
] as const;
// Native addons the main process loads at runtime; optional per platform, so
// a missing one is skipped.
const MAIN_RUNTIME_ENTRYPOINTS = ["electron-liquid-glass"] as const;

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
  const queue = [...entrypoints];
  while (queue.length > 0) {
    const name = queue.shift();
    if (name === undefined) continue;
    if (deps.has(name)) continue;
    deps.add(name);
    const manifestPath = path.join(workspaceNodeModules, name, "package.json");
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
      if (!deps.has(dep)) queue.push(dep);
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

function signMacPackage(outputPaths: string[]): void {
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
      path.join(__dirname, "../../.pine/release.json"),
      path.join(
        __dirname,
        "../../packages/computer-use-runtime/pine-computer-use",
      ),
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
    ],
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
    postPackage: (_forgeConfig, packageResult) => {
      if (packageResult.platform === "darwin") {
        signMacPackage(packageResult.outputPaths);
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
      windowsSign,
    }),
    new MakerZIP({}, ["darwin"]),
    new MakerDMG({ format: "ULFO" }, ["darwin"]),
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
