import {
  getPowerShellConfig,
  getShellConfig,
} from "@earendil-works/pi-coding-agent";
import path from "node:path";
import {
  createBashEnvironment,
  createNativeBashEnvironment,
  sandboxShell,
} from "./bash-env";
import {
  describeReviewEnvironment,
  hostOsDescription,
  type ReviewEnvironmentBase,
  type ReviewExecutionEnvironment,
} from "./runtime/review-environment";

export interface ShellReviewEnvironmentOptions {
  cwd: string;
  projectRoots: readonly string[];
  temporaryDirectory: string;
  loginPath: string;
  /** Extra variables the command receives, such as automation secrets. */
  extraEnv?: Readonly<Record<string, string>>;
  platform?: NodeJS.Platform;
  /** Host environment; defaults to `process.env`. */
  hostEnv?: NodeJS.ProcessEnv;
}

export type DescribeShellReviewEnvironment = (
  command: string,
  sandbox: "inside" | "outside",
) => ReviewExecutionEnvironment;

/**
 * Describes a shell call the way it will really run: the same shell, working
 * directory and environment that Pine's sandboxed or native executor uses.
 */
export function createShellReviewEnvironment(
  options: ShellReviewEnvironmentOptions,
): DescribeShellReviewEnvironment {
  const platform = options.platform ?? process.platform;
  const hostEnv = () => options.hostEnv ?? process.env;
  const projectRoots = [...new Set([options.cwd, ...options.projectRoots])];
  const common = {
    os: hostOsDescription(platform),
    arch: process.arch,
    cwd: options.cwd,
    projectRoots,
  };
  let sandboxed: ReviewEnvironmentBase | undefined;
  let native: ReviewEnvironmentBase | undefined;
  const base = (sandbox: "inside" | "outside"): ReviewEnvironmentBase => {
    if (platform === "win32") {
      // Both executors run PowerShell without a profile on Windows.
      sandboxed ??= native ??= {
        ...common,
        shell: `${getPowerShellConfig().shell} -NoProfile -NonInteractive (PowerShell, no profile)`,
        shellKind: "powershell",
      };
      return sandboxed;
    }
    if (sandbox === "inside") {
      const shell = sandboxShell(platform);
      sandboxed ??= {
        ...common,
        shell:
          shell.kind === "zsh"
            ? `${shell.executable} -f -o pipefail -c (zsh, no user startup files)`
            : `${shell.executable} --noprofile --norc -o pipefail -c (bash, no user startup files)`,
        shellKind: shell.kind === "zsh" ? "zsh" : "bash",
      };
      return sandboxed;
    }
    if (!native) {
      const executable = getShellConfig().shell;
      const name = path.basename(executable);
      native = {
        ...common,
        shell: `${executable} -c (${name}, non-interactive, no user startup files)`,
        shellKind: name.includes("zsh") ? "zsh" : "bash",
      };
    }
    return native;
  };
  return (command, sandbox) => {
    const env =
      sandbox === "inside"
        ? createBashEnvironment(
            hostEnv(),
            options.temporaryDirectory,
            options.loginPath,
            options.cwd,
          )
        : createNativeBashEnvironment(
            { ...hostEnv() },
            options.loginPath,
            options.cwd,
          );
    return describeReviewEnvironment(base(sandbox), sandbox, command, {
      ...env,
      ...options.extraEnv,
    });
  };
}
