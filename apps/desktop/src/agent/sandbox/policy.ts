import path from "node:path";
import {
  VENDORED_SRT_WIN_EXE,
  type SandboxRuntimeConfig,
} from "@anthropic-ai/sandbox-runtime";
import {
  LINUX_RUNTIME_DIRECTORIES,
  LINUX_RUNTIME_FILES,
  MACOS_RUNTIME_DIRECTORIES,
  MACOS_RUNTIME_FILES,
} from "../bash-sandbox";
import type { PineToolAccessPolicy } from "../tool-access-policy";
import { resolveSpawnableResourcePath } from "./runtime-path";

export function windowsRequiredDenyWritePaths(
  writableFolders: readonly string[],
  protectedPaths: readonly string[],
): string[] {
  return protectedPaths.filter((protectedPath) =>
    writableFolders.some((writableFolder) => {
      const relativePath = path.win32.relative(writableFolder, protectedPath);
      return (
        relativePath === "" ||
        (!relativePath.startsWith(`..${path.win32.sep}`) &&
          relativePath !== ".." &&
          !path.win32.isAbsolute(relativePath))
      );
    }),
  );
}

/** Authority snapshot; no project-controlled config or implicit HOME grants. */
export function createSandboxConfig(
  policy: PineToolAccessPolicy,
  runtimeFiles: string[],
  platform: NodeJS.Platform = process.platform,
  /** Exact hosts an automation run approved; the network is closed otherwise. */
  allowedDomains: readonly string[] = [],
): SandboxRuntimeConfig {
  // Electron's executable depends on frameworks elsewhere in its app bundle.
  // Grant the containing installation, including when run outside /Applications.
  runtimeFiles = [
    ...new Set(
      runtimeFiles.flatMap((entry) => {
        const bundleEnd = entry.indexOf(".app/");
        return bundleEnd < 0 ? [entry] : [entry, entry.slice(0, bundleEnd + 4)];
      }),
    ),
  ];
  const windowsSrtWinPath =
    platform === "win32"
      ? resolveSpawnableResourcePath(VENDORED_SRT_WIN_EXE)
      : undefined;
  const grants = [
    ...policy.readablePaths(),
    ...policy.writableFolders(),
    ...runtimeFiles,
  ];
  if (grants.some((target) => /[*?\[\]\x00-\x1f]/.test(target))) {
    throw new Error(
      "The sandbox backend cannot safely represent wildcard or control characters in a literal path. Native access requires approval.",
    );
  }
  if (platform === "linux") {
    // Bubblewrap hides every top-level directory behind a tmpfs and binds the
    // grants back, creating their ancestors as empty mount points. SRT expands
    // globs into concrete recursive grants on Linux, so the macOS ancestor
    // encoding below would expose whole ancestor directories here.
    return {
      network: {
        allowedDomains: [...allowedDomains],
        deniedDomains: [],
        allowUnixSockets: [],
        allowLocalBinding: false,
      },
      filesystem: {
        denyRead: ["/"],
        allowRead: [
          ...new Set([
            ...LINUX_RUNTIME_DIRECTORIES,
            ...LINUX_RUNTIME_FILES,
            ...runtimeFiles,
            ...policy.readablePaths(),
          ]),
        ],
        allowWrite: policy.writableFolders(),
        denyWrite: [...runtimeFiles],
        allowGitConfig: false,
      },
      enableWeakerNestedSandbox: false,
      enableWeakerNetworkIsolation: false,
    };
  }
  // SRT literal entries are recursive subpaths. A singleton character class
  // forces its documented glob matcher into an exact-path regex instead.
  // This grants ancestor listing / symlink metadata without their contents.
  const exactPath = (target: string) => {
    if (!/[A-Za-z0-9]/.test(target)) {
      throw new Error(
        "The sandbox backend cannot safely encode this ancestor path.",
      );
    }
    return target.replace(/[A-Za-z0-9]/, (character) => `[${character}]`);
  };
  const ancestors = new Set<string>(["/etc", "/tmp", "/var"]);
  for (const target of [
    ...grants,
    ...MACOS_RUNTIME_DIRECTORIES,
    ...MACOS_RUNTIME_FILES,
  ]) {
    let ancestor = path.dirname(target);
    while (ancestor !== path.dirname(ancestor)) {
      ancestors.add(ancestor);
      ancestor = path.dirname(ancestor);
    }
  }
  if (platform === "win32") {
    const writableFolders = policy.writableFolders();
    const protectedRuntimePaths = [
      ...runtimeFiles,
      ...(windowsSrtWinPath ? [path.dirname(windowsSrtWinPath)] : []),
    ];
    return {
      network: {
        allowedDomains: [...allowedDomains],
        deniedDomains: [],
        allowUnixSockets: [],
        allowLocalBinding: false,
      },
      filesystem: {
        // The dedicated srt-sandbox account has no implicit access to the
        // caller's profile. Runtime grants are concrete NTFS ACL entries.
        denyRead: [],
        allowRead: [
          ...new Set([
            ...runtimeFiles,
            ...(windowsSrtWinPath ? [windowsSrtWinPath] : []),
            ...policy.readablePaths(),
          ]),
        ],
        allowWrite: writableFolders,
        // An explicit deny is only needed when a broader write grant contains
        // the runtime. Stamping unrelated paths below a Windows user profile
        // is both redundant and exceptionally slow in srt-win.
        denyWrite: windowsRequiredDenyWritePaths(writableFolders, [
          ...new Set(protectedRuntimePaths),
        ]),
        allowGitConfig: false,
      },
      enableWeakerNestedSandbox: false,
      enableWeakerNetworkIsolation: false,
      windows: {
        srtWin: { path: windowsSrtWinPath! },
      },
    };
  }

  return {
    network: {
      allowedDomains: [...allowedDomains],
      deniedDomains: [],
      allowUnixSockets: [],
      allowLocalBinding: false,
      allowMachLookup: [],
    },
    filesystem: {
      denyRead: ["/"],
      allowRead: [
        ...new Set([
          ...MACOS_RUNTIME_DIRECTORIES,
          ...MACOS_RUNTIME_FILES.filter((entry) => entry !== "/"),
          ...runtimeFiles,
          ...policy.readablePaths(),
          ...[...ancestors].map(exactPath),
        ]),
      ],
      allowWrite: policy.writableFolders(),
      denyWrite: [...runtimeFiles],
      allowGitConfig: false,
    },
    enableWeakerNestedSandbox: false,
    enableWeakerNetworkIsolation: false,
  };
}
