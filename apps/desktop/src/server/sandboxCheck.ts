import { spawnSync } from "node:child_process";
import { SandboxManager } from "@anthropic-ai/sandbox-runtime";

export interface SandboxProbe {
  missingDependencies(): string[];
  /** Error output when bubblewrap cannot create its namespaces. */
  namespaceError(): string | undefined;
}

const systemProbe: SandboxProbe = {
  missingDependencies: () => SandboxManager.checkDependencies().errors,
  namespaceError: () => {
    const result = spawnSync(
      "bwrap",
      [
        ...["--ro-bind", "/", "/", "--dev", "/dev", "--proc", "/proc"],
        ...["--unshare-all", "true"],
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    if (result.status === 0) return undefined;
    return (result.stderr || result.error?.message || "").trim();
  },
};

/**
 * Explain at startup why sandboxed agent tools would fail on this Linux host.
 * Pine still runs without them; every command then needs privileged_bash.
 */
export function linuxSandboxProblems(
  probe: SandboxProbe = systemProbe,
): string[] {
  const missing = probe.missingDependencies();
  if (missing.length > 0)
    return [
      `Agent tools cannot run sandboxed: ${missing.join(", ")}.`,
      "Install bubblewrap, socat and ripgrep (for example: apt install bubblewrap socat ripgrep).",
    ];
  const error = probe.namespaceError();
  if (error === undefined) return [];
  return [
    `Agent tools cannot run sandboxed: bubblewrap failed (${error}).`,
    "Allow unprivileged user namespaces on this host. In Docker, run with --security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt systempaths=unconfined.",
  ];
}
