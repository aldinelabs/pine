import type { BashOperations } from "@earendil-works/pi-coding-agent";
import path from "node:path";
import { runSandbox, quoteShell } from "./sandbox/backend";
import { createSandboxConfig } from "./sandbox/policy";
import { createBashEnvironment, sandboxShell } from "./bash-env";
import type { PineToolAccessPolicy } from "./tool-access-policy";

/**
 * A failed sandboxed process emitted permission-related text. This is only
 * diagnostic evidence: output cannot identify the enforcing authority.
 */
export class SandboxCommandPermissionError extends Error {
  constructor(readonly outputTail: string) {
    const privilegedShell =
      process.platform === "win32"
        ? "privileged_powershell"
        : "privileged_bash";
    super(
      process.platform !== "win32" && mentionsSystemTemporaryPath(outputTail)
        ? `The command failed inside the project sandbox while accessing system temporary storage (/tmp), which ordinary bash cannot use. For scratch files the command creates itself, use "$TMPDIR" (this project's temporary directory) and retry with ordinary bash instead of escalating. Use ${privilegedShell} only if the command must access an existing /tmp path created outside Pine. Check for partial effects first: commands after the failed step may already have run.`
        : `The command failed inside the project sandbox and reported a permission-related error. This may be a sandbox restriction or an ordinary OS/application permission failure. Use ${privilegedShell} for this operation if it genuinely requires capabilities outside the project sandbox.`,
    );
  }
}

/** Whether output names a path under the system /tmp (or /private/tmp). */
export function mentionsSystemTemporaryPath(output: string): boolean {
  return /(?:^|[\s:'"`=(])(?:\/private)?\/tmp(?=[/\s:'"`)]|$)/m.test(output);
}

/** A diagnostic hint only; no command-specific error codes or authorization. */
export function hasPermissionDiagnostic(output: string): boolean {
  return /operation not permitted|permission denied|permission error|access denied|\bE(?:PERM|ACCES)\b|blocked by sandbox|sandbox(?:_extension| violation| denied)/i.test(
    output,
  );
}

export function createScopedBashOperations(
  policy: PineToolAccessPolicy,
  temporaryDirectory: string,
  loginPath: string,
  runtimeFiles: string[],
): BashOperations {
  return {
    exec: async (command, cwd, options) => {
      await policy.authorize(cwd, "write");
      const shell = sandboxShell();
      const windowsCommand = [
        "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
        "$OutputEncoding = [Console]::OutputEncoding",
        `$env:PINE_TMPDIR=${quoteShell(temporaryDirectory, "powershell")}`,
        `$env:BUN_INSTALL_CACHE_DIR=${quoteShell(path.join(temporaryDirectory, "bun-cache"), "powershell")}`,
        `$env:XDG_CACHE_HOME=${quoteShell(path.join(temporaryDirectory, "xdg-cache"), "powershell")}`,
        `$env:npm_config_cache=${quoteShell(path.join(temporaryDirectory, "npm-cache"), "powershell")}`,
        command,
      ].join("; ");
      let outputTail = "";
      const result = await runSandbox(
        {
          command:
            shell.kind === "zsh"
              ? `exec /bin/zsh -f -o pipefail -o no_bg_nice -c ${quoteShell(command)}`
              : windowsCommand,
          cwd: policy.cwd,
          env: createBashEnvironment(
            options.env,
            temporaryDirectory,
            loginPath,
            policy.cwd,
          ),
          config: createSandboxConfig(policy, runtimeFiles),
          shell: shell.executable,
        },
        {
          ...options,
          onData: (chunk) => {
            outputTail = (outputTail + chunk.toString("utf8")).slice(-16_384);
            options.onData(chunk);
          },
        },
      );
      if (result.exitCode !== 0 && hasPermissionDiagnostic(outputTail))
        throw new SandboxCommandPermissionError(outputTail);
      return result;
    },
  };
}
