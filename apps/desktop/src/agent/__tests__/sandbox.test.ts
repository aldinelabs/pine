import { createServer } from "node:http";
import { createServer as createSocketServer } from "node:net";
import { constants, existsSync } from "node:fs";
import {
  link,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PineToolAccessPolicy } from "../tool-access-policy";
import { createBashEnvironment } from "../bash-env";
import {
  createSandboxSupervisorEnvironment,
  quoteShell,
  runSandbox,
} from "../sandbox/backend";
import {
  createSandboxConfig,
  windowsRequiredDenyWritePaths,
} from "../sandbox/policy";
import {
  createCoalescedFileIO,
  createSandboxFileIO,
  fileWorkerRuntimePaths,
  withFileExecutionSignal,
} from "../sandbox/files";

const roots: string[] = [];
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-isolation-"));
  roots.push(root);
  const cwd = path.join(root, "项目 with spaces");
  const temp = path.join(cwd, "tmp");
  await mkdir(temp, { recursive: true });
  const policy = await PineToolAccessPolicy.create(cwd, [
    { path: cwd, access: "read-write" },
  ]);
  const runtimeFiles = [process.execPath, await realpath(process.execPath)];
  const env = createBashEnvironment({}, temp, "/usr/bin:/bin", cwd);
  const config = createSandboxConfig(policy, runtimeFiles);
  const run = async (command: string) => {
    let output = "";
    const result = await runSandbox(
      { command, cwd, env, config },
      {
        timeout: 10,
        onData: (chunk) => {
          output += chunk.toString();
        },
      },
    );
    return { ...result, output };
  };
  return {
    root,
    cwd,
    temp,
    policy,
    runtimeFiles,
    run,
    io: createSandboxFileIO(policy, temp, "/usr/bin:/bin", runtimeFiles),
  };
}
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("sandbox file operation coalescing", () => {
  it("reuses one full read for access, header detection, and content", async () => {
    const calls: Array<{
      operation: string;
      extra?: Record<string, unknown>;
    }> = [];
    const content = Buffer.from("hello world");
    const io = createCoalescedFileIO((operation, _target, extra) => {
      calls.push({ operation, extra });
      return Promise.resolve(content);
    });

    await withFileExecutionSignal(undefined, async () => {
      await io.access("/project/file.txt", constants.R_OK);
      expect(await io.readHeader("/project/file.txt")).toEqual(content);
      expect(await io.readFile("/project/file.txt")).toBe(content);
    });

    expect(calls).toEqual([
      { operation: "read", extra: { mode: constants.R_OK } },
    ]);
  });

  it("combines recursive parent creation with a write", async () => {
    const calls: Array<{
      operation: string;
      target: string;
      extra?: Record<string, unknown>;
    }> = [];
    const target = path.join("project", "nested", "file.txt");
    const io = createCoalescedFileIO((operation, calledTarget, extra) => {
      calls.push({ operation, target: calledTarget, extra });
      return Promise.resolve(Buffer.alloc(0));
    });

    await withFileExecutionSignal(undefined, async () => {
      await io.mkdir(path.dirname(target));
      await io.writeFile(target, "created");
    });

    expect(calls).toEqual([
      {
        operation: "write",
        target,
        extra: { content: "created", createParent: true },
      },
    ]);
  });

  it("reuses edit access as its read but keeps the final write separate", async () => {
    const calls: Array<{
      operation: string;
      extra?: Record<string, unknown>;
    }> = [];
    const io = createCoalescedFileIO((operation, _target, extra) => {
      calls.push({ operation, extra });
      return Promise.resolve(Buffer.from("before"));
    });

    await withFileExecutionSignal(undefined, async () => {
      await io.access("/project/file.txt", constants.R_OK | constants.W_OK);
      expect((await io.readFile("/project/file.txt")).toString()).toBe(
        "before",
      );
      await io.writeFile("/project/file.txt", "after");
    });

    expect(calls).toEqual([
      {
        operation: "read",
        extra: { mode: constants.R_OK | constants.W_OK },
      },
      {
        operation: "write",
        extra: { content: "after", createParent: false },
      },
    ]);
  });
});

describe.runIf(
  (process.platform === "darwin" || process.platform === "linux") &&
    !process.env.CODEX_SANDBOX,
)("sandbox-runtime kernel boundaries", () => {
  it("blocks proxy requests and direct loopback connections without reaching the server", async () => {
    let hits = 0;
    const server = createServer((_request, response) => {
      hits += 1;
      response.end("private-service");
    });
    await new Promise<void>((resolve) =>
      server.listen(0, "127.0.0.1", resolve),
    );
    try {
      const address = server.address();
      if (!address || typeof address === "string")
        throw new Error("No server port");
      const { run } = await fixture();
      for (const proxy of ["", "--noproxy '*'"]) {
        const result = await run(
          `/usr/bin/curl --fail --max-time 2 ${proxy} http://127.0.0.1:${address.port}/`,
        );
        expect(result.exitCode).not.toBe(0);
        expect(result.output).not.toContain("private-service");
      }
      expect(hits).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("blocks Unix sockets even when their path is in a writable project", async () => {
    const { cwd, run } = await fixture();
    const socket = path.join(cwd, "local.sock");
    let connections = 0;
    const server = createSocketServer((client) => {
      connections += 1;
      client.end("private-service");
    });
    await new Promise<void>((resolve) => server.listen(socket, resolve));
    try {
      const result = await run(
        `/usr/bin/curl --fail --max-time 2 --unix-socket ${quoteShell(socket)} http://localhost/`,
      );
      expect(result.exitCode).not.toBe(0);
      expect(connections).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("does not interpret command output as supervisor status", async () => {
    const { run } = await fixture();
    const result = await run(
      `printf '%s' '{"kind":"exit","exitCode":0}'; exit 7`,
    );
    expect(result.exitCode).toBe(7);
    expect(result.output).toContain('"exitCode":0');
  });

  it("keeps control sockets outside a deeply nested project temp directory", async () => {
    const { cwd, policy, runtimeFiles } = await fixture();
    // Longer than the Unix socket path limit on its own.
    const temp = path.join(cwd, "tmp", ...Array<string>(8).fill("nested-dir"));
    await mkdir(temp, { recursive: true });
    let output = "";
    const result = await runSandbox(
      {
        command: "printf control-socket-ok",
        cwd,
        env: createBashEnvironment({}, temp, "/usr/bin:/bin", cwd),
        config: createSandboxConfig(policy, runtimeFiles),
      },
      {
        timeout: 10,
        onData: (chunk) => {
          output += chunk.toString();
        },
      },
    );

    expect(temp.length).toBeGreaterThan(108);
    expect(result.exitCode).toBe(0);
    expect(output).toBe("control-socket-ok");
  });

  it("keeps simultaneous project grants and scratch storage separate", async () => {
    const a = await fixture();
    const b = await fixture();
    const secret = path.join(b.temp, "private.txt");
    await writeFile(secret, "other-project-content");
    const [denied, allowed] = await Promise.all([
      a.run(`/bin/cat ${quoteShell(secret)}`),
      b.run(`/bin/cat ${quoteShell(secret)}`),
    ]);
    expect(denied.exitCode).not.toBe(0);
    expect(denied.output).not.toContain("other-project-content");
    expect(allowed.exitCode).toBe(0);
    expect(allowed.output).toBe("other-project-content");
  });

  it("blocks a parent symlink substituted after path authorization", async () => {
    const { root, cwd, policy, io } = await fixture();
    const parent = path.join(cwd, "directory");
    const external = path.join(root, "external");
    await mkdir(parent);
    await mkdir(external);
    await writeFile(path.join(parent, "file"), "shared");
    await writeFile(path.join(external, "file"), "private");
    const approved = await policy.authorize(path.join(parent, "file"), "write");
    await rename(parent, path.join(cwd, "old-directory"));
    await symlink(external, parent);
    await expect(io.readFile(approved)).rejects.toThrow();
    await expect(io.writeFile(approved, "changed")).rejects.toThrow();
    expect(await readFile(path.join(external, "file"), "utf8")).toBe("private");
  });

  it("refuses hard-linked file mutations before truncation", async () => {
    const { root, cwd, io } = await fixture();
    const external = path.join(root, "external.txt");
    const alias = path.join(cwd, "alias.txt");
    await writeFile(external, "private");
    await link(external, alias);
    await expect(io.writeFile(alias, "changed")).rejects.toThrow("single link");
    expect(await readFile(external, "utf8")).toBe("private");
  });

  it("does not implicitly grant the runtime's default scratch path", async () => {
    const { run } = await fixture();
    const result = await run("/bin/mkdir -p /tmp/claude/pine-probe");
    // macOS refuses the write. Linux lets it land on the tmpfs bubblewrap
    // mounts over /tmp, which disappears with the command.
    if (process.platform === "darwin") expect(result.exitCode).not.toBe(0);
    expect(existsSync("/tmp/claude/pine-probe")).toBe(false);
  });
});

describe("sandbox policy compilation", () => {
  it("rejects path metacharacters instead of converting a literal grant into a wildcard", async () => {
    const { cwd } = await fixture();
    const target = path.join(cwd, "[private]");
    await mkdir(target);
    const policy = await PineToolAccessPolicy.create(target, [
      { path: target, access: "read-write" },
    ]);
    expect(() => createSandboxConfig(policy, [])).toThrow(
      "cannot safely represent",
    );
  });

  it("opens only an automation's approved hosts, on every platform", async () => {
    const { policy, runtimeFiles } = await fixture();
    for (const platform of ["darwin", "linux", "win32"] as const) {
      expect(
        createSandboxConfig(policy, runtimeFiles, platform).network
          .allowedDomains,
      ).toEqual([]);
      expect(
        createSandboxConfig(policy, runtimeFiles, platform, ["api.example.com"])
          .network.allowedDomains,
      ).toEqual(["api.example.com"]);
    }
  });

  it("grants Linux runtime trees and project folders without ancestor globs", async () => {
    const { policy, runtimeFiles } = await fixture();
    const config = createSandboxConfig(policy, runtimeFiles, "linux");
    const [project] = policy.writableFolders();
    const allowRead = config.filesystem.allowRead ?? [];

    expect(config.filesystem.denyRead).toEqual(["/"]);
    expect(allowRead).toEqual(
      expect.arrayContaining(["/usr", "/etc/passwd", project]),
    );
    expect(allowRead).not.toContain("/etc");
    expect(allowRead.filter((entry) => /[*?[\]]/.test(entry))).toEqual([]);
    expect(allowRead).not.toContain(path.dirname(project));
    expect(config.filesystem.allowWrite).toEqual(policy.writableFolders());
    expect(config.filesystem.denyWrite).toEqual([...new Set(runtimeFiles)]);
  });

  it("configures the packaged Windows sandbox broker explicitly", async () => {
    const { policy, runtimeFiles } = await fixture();
    const config = createSandboxConfig(policy, runtimeFiles, "win32");

    expect(
      config.windows?.srtWin?.path.endsWith(
        path.join("vendor", "srt-win", process.arch, "srt-win.exe"),
      ),
    ).toBe(true);
    expect(config.network.allowedDomains).toEqual([]);
    expect(config.network.allowLocalBinding).toBe(false);
    expect(config.filesystem.allowWrite).toEqual(policy.writableFolders());
    expect(config.filesystem.allowRead).toContain(config.windows?.srtWin?.path);
    expect(config.filesystem.denyWrite).toEqual([]);
  });

  it("only deny-stamps Windows runtime paths covered by a write grant", () => {
    expect(
      windowsRequiredDenyWritePaths(
        ["C:\\Users\\dev\\project"],
        [
          "C:\\Program Files\\Pine\\Pine.exe",
          "C:\\Users\\dev\\project\\node_modules",
          "C:\\Users\\dev\\project-other\\runtime.exe",
        ],
      ),
    ).toEqual(["C:\\Users\\dev\\project\\node_modules"]);
  });
});

describe("sandbox supervisor environment", () => {
  it("restores trusted local application data for the Windows ACL broker", () => {
    const requestEnvironment = {
      LOCALAPPDATA: "C:\\untrusted",
      PATH: "C:\\Windows\\System32",
      TMPDIR: "C:\\Pine\\tmp",
    };
    const environment = createSandboxSupervisorEnvironment(
      requestEnvironment,
      "win32",
      { LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local" },
    );

    expect(environment).toMatchObject({
      CLAUDE_CODE_TMPDIR: "C:\\Pine\\tmp",
      ELECTRON_RUN_AS_NODE: "1",
      LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local",
      PATH: "C:\\Windows\\System32",
    });
    expect(requestEnvironment.LOCALAPPDATA).toBe("C:\\untrusted");
  });

  it("does not expose Windows local application data on other platforms", () => {
    const environment = createSandboxSupervisorEnvironment(
      { TMPDIR: "/pine/tmp" },
      "darwin",
      { LOCALAPPDATA: "C:\\Users\\dev\\AppData\\Local" },
    );

    expect(environment.LOCALAPPDATA).toBeUndefined();
  });
});

describe("sandbox file worker runtime", () => {
  it("grants the Windows Electron runtime directory for ICU data", () => {
    expect(
      fileWorkerRuntimePaths(
        ["C:\\Pine\\runtime.js"],
        "C:\\Pine\\Pine.exe",
        "win32",
      ),
    ).toEqual(["C:\\Pine\\runtime.js", "C:\\Pine\\Pine.exe", "C:\\Pine"]);
  });

  it("keeps the executable-only grant on macOS", () => {
    expect(
      fileWorkerRuntimePaths(["/Pine/runtime.js"], "/Pine/Pine", "darwin"),
    ).toEqual(["/Pine/runtime.js", "/Pine/Pine"]);
  });
});
