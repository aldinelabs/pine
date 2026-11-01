import path from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";
import os from "node:os";
import type { SandboxRuntimeConfig } from "@anthropic-ai/sandbox-runtime";
import hostSource from "./host.mjs?raw";
import windowsHostSource from "./windows-host.mjs?raw";
import { windowsRequiredDenyWritePaths } from "./policy";
import { sandboxShell } from "../bash-env";

export function quoteShell(
  value: string,
  shell: "powershell" | "zsh" | "bash" = "zsh",
): string {
  return shell === "powershell"
    ? `'${value.replaceAll("'", "''")}'`
    : `'${value.replaceAll("'", "'\\''")}'`;
}

export interface SandboxRequest {
  command: string;
  cwd: string;
  env: NodeJS.ProcessEnv;
  config: SandboxRuntimeConfig;
  shell?: string;
  stdin?: string;
  windowsDirect?: {
    executable: string;
    args: string[];
    env?: Record<string, string>;
    stdinFileEnvironment?: string;
  };
}

export class SandboxSetupError extends Error {}

interface SandboxRunOptions {
  onData: (data: Buffer) => void;
  onStderr?: (data: Buffer) => void;
  signal?: AbortSignal;
  timeout?: number;
}

interface SandboxHostResult {
  id?: string;
  kind?: string;
  message?: string;
  exitCode?: number | null;
  signal?: string;
  timing?: {
    coldStart: boolean;
    initializeMs: number;
    requestFileMs: number;
    wrapMs: number;
    childMs: number;
    totalMs: number;
  };
}

export function createSandboxSupervisorEnvironment(
  requestEnvironment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
  hostEnvironment: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {
    ...requestEnvironment,
    ELECTRON_RUN_AS_NODE: "1",
    // SRT's own temp override is scoped to this supervisor, never global.
    CLAUDE_CODE_TMPDIR: requestEnvironment.TMPDIR,
  };

  // srt-win stores its per-process ACL holds below the real user's local
  // application data directory. Ordinary tool environments are deliberately
  // sparse, so restore this single broker dependency from the trusted Pine
  // process instead of exposing the complete host environment.
  if (platform === "win32" && hostEnvironment.LOCALAPPDATA) {
    environment.LOCALAPPDATA = hostEnvironment.LOCALAPPDATA;
  }

  return environment;
}

function validateHostResult(result: SandboxHostResult): { exitCode: number } {
  if (result.kind !== "exit")
    throw new SandboxSetupError(
      `Sandbox setup failed: ${result.message ?? "unknown error"}`,
    );
  if (typeof result.exitCode !== "number")
    throw new Error(
      `Shell terminated by signal ${result.signal ?? "unknown"}.`,
    );
  return { exitCode: result.exitCode };
}

class PersistentWindowsSandboxHost {
  private readonly child;
  private active:
    | {
        id: string;
        options: SandboxRunOptions;
        resolve: (result: SandboxHostResult) => void;
        reject: (error: Error) => void;
        cleanup: () => void;
      }
    | undefined;
  private status = "";
  private idleTimer: NodeJS.Timeout | undefined;
  private closed = false;
  private readonly closedPromise: Promise<void>;

  constructor(
    readonly key: string,
    cwd: string,
    environment: NodeJS.ProcessEnv,
  ) {
    this.child = spawn(
      process.execPath,
      ["--input-type=module", "-e", windowsHostSource],
      {
        cwd,
        env: environment,
        detached: true,
        stdio: ["pipe", "pipe", "pipe", "pipe"],
      },
    );
    this.child.stdin.on("error", () => undefined);
    this.child.stdout.on("data", (chunk: Buffer) =>
      this.active?.options.onData(chunk),
    );
    this.child.stderr.on("data", (chunk: Buffer) =>
      (this.active?.options.onStderr ?? this.active?.options.onData)?.(chunk),
    );
    this.child.stdio[3]!.on("data", (chunk: Buffer) => {
      this.status += chunk.toString();
      for (;;) {
        const newline = this.status.indexOf("\n");
        if (newline < 0) break;
        const line = this.status.slice(0, newline);
        this.status = this.status.slice(newline + 1);
        if (!line) continue;
        let result: SandboxHostResult;
        try {
          result = JSON.parse(line) as SandboxHostResult;
        } catch {
          this.failActive(
            new SandboxSetupError("Sandbox supervisor returned invalid data."),
          );
          void this.dispose();
          continue;
        }
        const active = this.active;
        if (!active || result.id !== active.id) continue;
        this.active = undefined;
        active.cleanup();
        active.resolve(result);
      }
    });
    this.closedPromise = new Promise((resolve) => {
      this.child.once("close", () => {
        this.closed = true;
        this.failActive(
          new SandboxSetupError(
            "Sandbox supervisor exited without a result. The command was not retried natively.",
          ),
        );
        resolve();
      });
    });
    this.child.once("error", (error) => this.failActive(error));
  }

  async run(
    request: SandboxRequest & {
      config: SandboxRuntimeConfig;
      runtimeUrl: string;
      id: string;
    },
    options: SandboxRunOptions,
  ): Promise<SandboxHostResult> {
    if (this.closed)
      throw new SandboxSetupError("Sandbox supervisor is unavailable.");
    if (options.signal?.aborted) throw new Error("aborted");
    if (this.active)
      throw new SandboxSetupError(
        "Sandbox supervisor received overlapping work.",
      );
    if (this.idleTimer) clearTimeout(this.idleTimer);

    return await new Promise<SandboxHostResult>((resolve, reject) => {
      let timedOut = false;
      const abort = () => {
        const error = timedOut
          ? new Error(`timeout:${options.timeout}`)
          : new Error("aborted");
        this.failActive(error);
        void this.dispose();
      };
      const timer =
        options.timeout === undefined
          ? undefined
          : setTimeout(
              () => {
                timedOut = true;
                abort();
              },
              Math.min(options.timeout * 1_000, 2_147_483_647),
            );
      const cleanup = () => {
        if (timer) clearTimeout(timer);
        options.signal?.removeEventListener("abort", abort);
      };
      this.active = { id: request.id, options, resolve, reject, cleanup };
      options.signal?.addEventListener("abort", abort, { once: true });
      this.child.stdin.write(`${JSON.stringify(request)}\n`, (error) => {
        if (!error) return;
        this.failActive(error);
        void this.dispose();
      });
    });
  }

  scheduleIdle(dispose: () => void): void {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(dispose, 60_000);
  }

  async dispose(): Promise<void> {
    if (this.idleTimer) clearTimeout(this.idleTimer);
    if (this.closed) return await this.closedPromise;
    this.child.kill("SIGTERM");
    const killTimer = setTimeout(() => this.child.kill("SIGKILL"), 2_000);
    await this.closedPromise;
    clearTimeout(killTimer);
  }

  private failActive(error: Error): void {
    const active = this.active;
    if (!active) return;
    this.active = undefined;
    active.cleanup();
    active.reject(error);
  }
}

let windowsHost: PersistentWindowsSandboxHost | undefined;
let windowsQueue: Promise<void> = Promise.resolve();

function windowsHostKey(
  request: SandboxRequest,
  config: SandboxRuntimeConfig,
  runtimeUrl: string,
  environment: NodeJS.ProcessEnv,
): string {
  return JSON.stringify({
    cwd: request.cwd,
    config,
    runtimeUrl,
    environment: Object.entries(environment).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  });
}

async function runPersistentWindowsSandbox(
  request: SandboxRequest,
  config: SandboxRuntimeConfig,
  runtimeUrl: string,
  options: SandboxRunOptions,
  prepareStartedAt: number,
): Promise<{ exitCode: number }> {
  const queuedAt = performance.now();
  const environment = createSandboxSupervisorEnvironment(request.env);
  const key = windowsHostKey(request, config, runtimeUrl, environment);
  let resolveTurn: () => void;
  const previous = windowsQueue;
  windowsQueue = new Promise<void>((resolve) => {
    resolveTurn = resolve;
  });
  await previous;
  const dequeuedAt = performance.now();
  try {
    const createdHost = !windowsHost || windowsHost.key !== key;
    if (!windowsHost || windowsHost.key !== key) {
      await windowsHost?.dispose();
      windowsHost = new PersistentWindowsSandboxHost(
        key,
        request.cwd,
        environment,
      );
    }
    const host = windowsHost;
    const roundTripStartedAt = performance.now();
    const result = await host.run(
      { ...request, config, runtimeUrl, id: randomUUID() },
      options,
    );
    const completedAt = performance.now();
    const performanceRecord = {
      timestamp: new Date().toISOString(),
      tool: request.windowsDirect ? "file" : "shell",
      createdHost,
      prepareMs: Math.round((queuedAt - prepareStartedAt) * 10) / 10,
      queueMs: Math.round((dequeuedAt - queuedAt) * 10) / 10,
      roundTripMs: Math.round((completedAt - roundTripStartedAt) * 10) / 10,
      ...result.timing,
    };
    if (process.env.PINE_SANDBOX_PERF === "1") {
      console.info("[Pine sandbox perf]", JSON.stringify(performanceRecord));
      try {
        appendFileSync(
          path.join(os.tmpdir(), "pine-sandbox-perf.jsonl"),
          `${JSON.stringify(performanceRecord)}\n`,
        );
      } catch {
        // Diagnostics must never change the tool result.
      }
    }
    if (result.kind !== "exit") {
      await host.dispose();
      if (windowsHost === host) windowsHost = undefined;
    } else {
      host.scheduleIdle(() => {
        if (windowsHost === host) windowsHost = undefined;
        void host.dispose();
      });
    }
    return validateHostResult(result);
  } catch (error) {
    const host = windowsHost;
    if (host) {
      windowsHost = undefined;
      await host.dispose();
    }
    throw error;
  } finally {
    resolveTurn!();
  }
}

/**
 * macOS and Linux isolate each call; Windows reuses one serialized authority
 * snapshot.
 */
export async function runSandbox(
  request: SandboxRequest,
  options: SandboxRunOptions,
): Promise<{ exitCode: number }> {
  const prepareStartedAt = performance.now();
  if (
    process.platform !== "darwin" &&
    process.platform !== "linux" &&
    process.platform !== "win32"
  ) {
    throw new SandboxSetupError(
      "The sandbox backend has not been validated on this platform. Native execution requires explicit approval.",
    );
  }
  if (options.signal?.aborted) throw new Error("aborted");
  if (
    options.timeout !== undefined &&
    (!Number.isFinite(options.timeout) || options.timeout <= 0)
  ) {
    throw new Error("Invalid timeout: must be a positive number");
  }
  const runtimeEntry = createRequire(import.meta.url).resolve(
    "@anthropic-ai/sandbox-runtime",
  );
  const runtimeUrl = pathToFileURL(runtimeEntry).href;
  let dependencyRoot = path.dirname(runtimeEntry);
  while (path.basename(dependencyRoot) !== "node_modules") {
    const parent = path.dirname(dependencyRoot);
    if (parent === dependencyRoot)
      throw new SandboxSetupError(
        "Cannot locate the trusted sandbox runtime dependency tree.",
      );
    dependencyRoot = parent;
  }
  const config = structuredClone(request.config);
  // A project can contain Pine's development dependency tree. Sandboxed code
  // must never rewrite the supervisor's next import into an unsandboxed host.
  const protectedSupervisorPaths = [dependencyRoot, process.execPath];
  config.filesystem.denyWrite.push(
    ...(process.platform === "win32"
      ? windowsRequiredDenyWritePaths(
          config.filesystem.allowWrite,
          protectedSupervisorPaths,
        )
      : protectedSupervisorPaths),
  );
  // On Linux SRT starts the command through its seccomp helper from inside
  // bubblewrap, so the helper must be readable there.
  if (process.platform === "linux")
    config.filesystem.allowRead?.push(
      path.join(path.dirname(path.dirname(runtimeEntry)), "vendor", "seccomp"),
    );
  if (process.platform === "win32")
    return await runPersistentWindowsSandbox(
      request,
      config,
      runtimeUrl,
      options,
      prepareStartedAt,
    );
  const child = spawn(
    process.execPath,
    ["--input-type=module", "-e", hostSource],
    {
      cwd: request.cwd,
      env: createSandboxSupervisorEnvironment(request.env),
      detached: true,
      stdio: ["pipe", "pipe", "pipe", "pipe"],
    },
  );
  child.stdin.on("error", () => undefined);
  child.stdin.end(
    JSON.stringify({
      ...request,
      shell: request.shell ?? sandboxShell().executable,
      config,
      runtimeUrl,
      id: randomUUID(),
    }),
  );
  let status = "";
  child.stdio[3]!.on("data", (chunk: Buffer) => {
    status = (status + chunk.toString()).slice(-65_536);
  });
  child.stdout.on("data", options.onData);
  child.stderr.on("data", options.onStderr ?? options.onData);
  let timedOut = false;
  let killTimer: NodeJS.Timeout | undefined;
  let drainTimer: NodeJS.Timeout | undefined;
  const abort = () => {
    child.kill("SIGTERM");
    killTimer ??= setTimeout(() => child.kill("SIGKILL"), 2_000);
  };
  const timer =
    options.timeout === undefined
      ? undefined
      : setTimeout(
          () => {
            timedOut = true;
            abort();
          },
          Math.min(options.timeout * 1_000, 2_147_483_647),
        );
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) abort();
  child.once("exit", () => {
    drainTimer = setTimeout(() => {
      child.stdout.destroy();
      child.stderr.destroy();
      child.stdio[3]!.destroy();
    }, 1_000);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", () => resolve());
    });
    if (options.signal?.aborted) throw new Error("aborted");
    if (timedOut) throw new Error(`timeout:${options.timeout}`);
    let result: SandboxHostResult;
    try {
      result = JSON.parse(status) as typeof result;
    } catch {
      throw new SandboxSetupError(
        "Sandbox supervisor exited without a result. The command was not retried natively.",
      );
    }
    return validateHostResult(result);
  } finally {
    if (timer) clearTimeout(timer);
    if (killTimer) clearTimeout(killTimer);
    if (drainTimer) clearTimeout(drainTimer);
    options.signal?.removeEventListener("abort", abort);
  }
}
