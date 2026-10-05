import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { getPowerShellConfig } from "@earendil-works/pi-coding-agent";

const FALLBACK_PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
const LOGIN_PATH_TIMEOUT_MS = 10_000;

let cachedLoginPath: string | null = null;
let loginPathFailed = false;

/** Resolve Bun's standard per-user install without hard-coded separators. */
export function resolveUserBunPath(
  homeDirectory: string = os.homedir(),
  platform: NodeJS.Platform = process.platform,
): string {
  return path.join(
    homeDirectory,
    ".bun",
    "bin",
    platform === "win32" ? "bun.exe" : "bun",
  );
}

/**
 * Resolve the user's login-shell PATH once and cache it.
 *
 * Electron GUI processes inherit launchd's minimal PATH
 * (`/usr/bin:/bin:/usr/sbin:/sbin`), so tools installed via Homebrew, MacPorts,
 * nvm, or Bun are invisible unless the PATH is resolved from a login shell.
 */
export async function resolveLoginPath(
  platform: NodeJS.Platform = process.platform,
): Promise<string> {
  if (platform === "win32") return process.env.PATH ?? "";
  if (cachedLoginPath) return cachedLoginPath;
  if (loginPathFailed) return FALLBACK_PATH;

  const shell = process.env.SHELL || "/bin/zsh";
  const resolved = await new Promise<string | null>((resolve) => {
    execFile(
      shell,
      ["-l", "-c", "echo $PATH"],
      { timeout: LOGIN_PATH_TIMEOUT_MS },
      (error, stdout) => {
        if (error || !stdout.trim()) resolve(null);
        else resolve(stdout.trim());
      },
    );
  });

  if (!resolved) {
    loginPathFailed = true;
    return FALLBACK_PATH;
  }
  cachedLoginPath = resolved;
  return resolved;
}

/**
 * Settings that make common tools fail fast instead of waiting for input
 * nobody can give. Agent commands have no terminal, so a credential, SSH host
 * key or confirmation prompt would otherwise hang until a timeout. Homebrew's
 * implicit update is skipped because it often stalls on slow networks.
 */
export function createNonInteractiveEnvironment(
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  return {
    GIT_TERMINAL_PROMPT: "0",
    GCM_INTERACTIVE: "never",
    GIT_SSH_COMMAND: "ssh -o BatchMode=yes",
    GIT_PAGER: "cat",
    ...(platform === "win32" ? {} : { PAGER: "cat" }),
    DEBIAN_FRONTEND: "noninteractive",
    PIP_NO_INPUT: "1",
    npm_config_yes: "true",
    HOMEBREW_NO_AUTO_UPDATE: "1",
  };
}

/**
 * Build the environment for Pine's bash tool.
 *
 * Preserve HOME and the login PATH for consistent path resolution. They do not
 * grant sandbox access: private home configs and unshared toolchains may need
 * privileged_bash. Package caches use Pine's temporary directory so ordinary
 * commands do not need read/write access to the user's global caches.
 */
export function createBashEnvironment(
  environment: NodeJS.ProcessEnv | undefined,
  temporaryDirectory: string,
  loginPath: string,
  cwd: string,
): NodeJS.ProcessEnv {
  const source = environment ?? process.env;
  const result: NodeJS.ProcessEnv = {
    HOME: source.HOME ?? path.join(temporaryDirectory, "home"),
    LANG: source.LANG,
    LOGNAME: source.LOGNAME,
    PATH: [path.join(cwd, "node_modules", ".bin"), loginPath]
      .filter(Boolean)
      .join(path.delimiter),
    SHELL: source.SHELL ?? "/bin/zsh",
    TERM: source.TERM,
    TMPDIR: temporaryDirectory,
    // zsh uses TMPPREFIX for here-docs independently of TMPDIR.
    TMPPREFIX: path.join(temporaryDirectory, "zsh"),
    USER: source.USER,
    // Redirect tool caches into the sandbox-writable temporary directory so
    // package installs work without write access to the real HOME.
    BUN_INSTALL_CACHE_DIR: path.join(temporaryDirectory, "bun-cache"),
    XDG_CACHE_HOME: path.join(temporaryDirectory, "xdg-cache"),
    npm_config_cache: path.join(temporaryDirectory, "npm-cache"),
    ...createNonInteractiveEnvironment(),
  };
  for (const [name, value] of Object.entries(source)) {
    if (name.startsWith("LC_")) result[name] = value;
  }
  return result;
}

/**
 * Native execution inherits the host environment in every approval mode. The
 * non-interactive defaults only fill gaps: a value the user set wins.
 */
export function createNativeBashEnvironment(
  environment: NodeJS.ProcessEnv,
  loginPath: string,
  cwd: string,
): NodeJS.ProcessEnv {
  return {
    ...createNonInteractiveEnvironment(),
    ...environment,
    PATH: [path.join(cwd, "node_modules", ".bin"), loginPath]
      .filter(Boolean)
      .join(path.delimiter),
  };
}

/** Resolve the trusted host shell used for sandboxed commands. */
export function sandboxShell(platform: NodeJS.Platform = process.platform): {
  executable: string;
  kind: "powershell" | "zsh";
} {
  if (platform === "win32") {
    return { executable: getPowerShellConfig().shell, kind: "powershell" };
  }
  return { executable: "/bin/zsh", kind: "zsh" };
}
