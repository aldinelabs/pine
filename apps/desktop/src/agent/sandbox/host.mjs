// Trusted one-shot supervisor. Supplied through Node's -e argument, never
// loaded from a project-writable file. Each process owns one SRT singleton.
import { spawn } from "node:child_process";
import { writeSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

let input = "";
for await (const chunk of process.stdin) input += chunk;
const request = JSON.parse(input);
const report = (result) => writeSync(3, JSON.stringify(result));
let child;
let cancelled = false;
let killTimer;
let controlDirectory;
let manager;
const stop = () => {
  cancelled = true;
  if (!child?.pid) return;
  try {
    if (process.platform === "win32") child.kill();
    else process.kill(-child.pid, "SIGTERM");
  } catch {}
  killTimer ??= setTimeout(() => {
    try {
      if (process.platform === "win32") child.kill();
      else process.kill(-child.pid, "SIGKILL");
    } catch {}
  }, 500);
};
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
try {
  // Unix socket paths have a small platform limit. This private directory is
  // only used by the trusted supervisor and is never a filesystem grant.
  // The command's project-scoped TMPDIR may itself be deeply nested, so it
  // cannot safely host SRT's additional pine-srt-*/srt-mux-*.sock path.
  const controlRoot = process.platform === "win32" ? os.tmpdir() : "/tmp";
  controlDirectory = await mkdtemp(path.join(controlRoot, "pine-srt-"));
  if (process.platform !== "win32") process.env.TMPDIR = controlDirectory;
  const { SandboxManager, SandboxRuntimeConfigSchema, getDefaultWritePaths } =
    await import(request.runtimeUrl);
  manager = SandboxManager;
  const config = SandboxRuntimeConfigSchema.parse(request.config);
  if (
    process.platform === "win32" &&
    request.windowsDirect?.stdinFileEnvironment
  ) {
    const requestFile = path.join(controlDirectory, "request.json");
    await writeFile(requestFile, request.stdin ?? "", {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    config.filesystem.allowRead.push(controlDirectory);
    request.windowsDirect.env = {
      ...request.windowsDirect.env,
      [request.windowsDirect.stdinFileEnvironment]: requestFile,
    };
  }
  // SRT adds these paths even with an explicit allowWrite list. Turn off
  // implicit application scratch grants while retaining device I/O.
  if (process.platform !== "win32") {
    config.filesystem.denyWrite.push(
      ...getDefaultWritePaths().filter((target) => !target.startsWith("/dev/")),
    );
  }
  await SandboxManager.initialize(config, undefined, false);
  if (cancelled) throw new Error("aborted");
  if (process.platform === "win32") {
    const direct = request.windowsDirect;
    const wrapped = await SandboxManager.wrapWithSandboxArgv(
      request.command,
      direct
        ? { exe: direct.executable, args: direct.args }
        : (request.shell ?? "powershell"),
      undefined,
      undefined,
      request.cwd,
      { commandId: request.id },
    );
    if (direct?.env) {
      const separator = wrapped.argv.lastIndexOf("--");
      if (separator < 0)
        throw new Error("Windows sandbox command delimiter is missing.");
      const environmentArguments = Object.entries(direct.env).flatMap(
        ([name, value]) => ["--env", `${name}=${value}`],
      );
      wrapped.argv.splice(separator, 0, ...environmentArguments);
    }
    if (cancelled) throw new Error("aborted");
    child = spawn(wrapped.argv[0], wrapped.argv.slice(1), {
      cwd: request.cwd,
      env: wrapped.env,
      shell: false,
      windowsHide: true,
      stdio: ["pipe", "inherit", "inherit"],
    });
  } else {
    const wrapped = await SandboxManager.wrapWithSandbox(
      request.command,
      request.shell,
      undefined,
      undefined,
      { commandId: request.id },
    );
    if (cancelled) throw new Error("aborted");
    // The wrapper runs before the sandbox applies, so it must not read any
    // user startup file either.
    const noStartupFiles =
      path.basename(request.shell) === "zsh"
        ? ["-f"]
        : ["--noprofile", "--norc"];
    child = spawn(request.shell, [...noStartupFiles, "-c", wrapped], {
      cwd: request.cwd,
      env: request.env,
      detached: true,
      // Only stdout/stderr and the file request reach the sandboxed process.
      // FD 3 is reserved for supervisor results, inaccessible to the command.
      stdio: ["pipe", "inherit", "inherit"],
    });
  }
  child.stdin.on("error", () => {});
  child.stdin.end(request.stdin ?? "");
  const result = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (exitCode, signal) => resolve({ exitCode, signal }));
  });
  // A command invocation does not own background daemons. End its process
  // group even when the leader exits before the descendants.
  try {
    if (process.platform !== "win32") process.kill(-child.pid, "SIGKILL");
  } catch {}
  if (cancelled) throw new Error("aborted");
  report({ kind: "exit", ...result });
} catch (error) {
  report({ kind: "setup-error", message: String(error?.message ?? error) });
} finally {
  if (killTimer) clearTimeout(killTimer);
  await manager?.reset();
  if (controlDirectory)
    await rm(controlDirectory, { recursive: true, force: true });
}
