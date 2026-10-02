import { spawn } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionLocation } from "../protocol";
import { createHash } from "node:crypto";
import { createSandboxConfig } from "../sandbox/policy";
import type { ToolGate } from "../gate";
import {
  createPineToolDefinitions,
  hasPermissionDiagnostic,
  PineAttachedPathAccess,
  PineToolAccessPolicy,
  SandboxCommandPermissionError,
} from "../tools";

function createFakeGate(
  overrides: {
    reviewBashCommand?: ToolGate["reviewBashCommand"];
    reviewFileCall?: ToolGate["reviewFileCall"];
    reviewDenial?: ToolGate["reviewDenial"];
    reviewPrivilegedCall?: ToolGate["reviewPrivilegedCall"];
  } = {},
): ToolGate & {
  reviewBashCommand: ReturnType<typeof vi.fn>;
  reviewFileCall: ReturnType<typeof vi.fn>;
  reviewDenial: ReturnType<typeof vi.fn>;
  reviewPrivilegedCall: ReturnType<typeof vi.fn>;
} {
  return {
    reviewBashCommand: vi.fn(
      overrides.reviewBashCommand ??
        (() => Promise.resolve({ kind: "allow" as const })),
    ),
    reviewFileCall: vi.fn(
      overrides.reviewFileCall ??
        (() => Promise.resolve({ kind: "allow" as const })),
    ),
    reviewDenial: vi.fn(
      overrides.reviewDenial ??
        (() => Promise.resolve({ kind: "allow" as const })),
    ),
    reviewPrivilegedCall: vi.fn(
      overrides.reviewPrivilegedCall ??
        (() => Promise.resolve({ kind: "allow" as const })),
    ),
    isApprovedCommand: () => false,
    resetTurn: () => undefined,
  };
}

const temporaryDirectories: string[] = [];

async function createFixture(): Promise<{
  location: AgentSessionLocation;
  outside: string;
  readOnly: string;
  readWrite: string;
}> {
  const root = await mkdtemp(
    path.join(
      process.platform === "darwin" ? "/private/tmp" : os.tmpdir(),
      "pine-tools-",
    ),
  );
  temporaryDirectories.push(root);
  const readWrite = path.join(root, "workspace");
  const readOnly = path.join(root, "context");
  const outside = path.join(root, "private");
  await Promise.all([
    mkdir(readWrite),
    mkdir(readOnly),
    mkdir(outside),
    mkdir(path.join(root, "Application Support", "data", "sessions"), {
      recursive: true,
    }),
  ]);
  return {
    location: {
      agentDir: path.join(root, "agent"),
      cwd: readWrite,
      folders: [
        { access: "read-write", path: readWrite },
        { access: "read-only", path: readOnly },
      ],
      sessionsRoot: path.join(root, "Application Support", "data", "sessions"),
    },
    outside,
    readOnly,
    readWrite,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ask_user_question timeout", () => {
  it("returns a timeout to the agent and aborts the pending question in Autonomous Work mode", async () => {
    const { location } = await createFixture();
    const requestQuestionnaire = vi.fn(
      (_toolCallId: string, _params: unknown, signal?: AbortSignal) =>
        new Promise<{ answers: []; cancelled: true }>((resolve) => {
          signal?.addEventListener(
            "abort",
            () => resolve({ answers: [], cancelled: true }),
            { once: true },
          );
        }),
    );
    const tools = await createPineToolDefinitions(
      location,
      createFakeGate(),
      undefined,
      {
        getApprovalMode: () => "autonomous",
        getGate: () => null,
        requestQuestionnaire,
      },
    );
    const tool = tools.find(
      (candidate) => candidate.name === "ask_user_question",
    );
    expect(tool).toBeDefined();
    vi.useFakeTimers();
    try {
      const resultPromise = tool!.execute(
        "question-1",
        {
          questions: [
            {
              question: "Choose a path",
              header: "Path",
              options: [
                { label: "A", description: "First path" },
                { label: "B", description: "Second path" },
              ],
            },
          ],
          timeout: 2,
        },
        undefined,
        undefined,
        undefined as never,
      );
      await vi.advanceTimersByTimeAsync(2_000);
      const result = await resultPromise;
      expect(result.content[0]).toMatchObject({
        text: expect.stringContaining("timed out after 2 seconds"),
      });
      expect(result.details).toMatchObject({
        cancelled: true,
        timedOut: true,
        timeoutSeconds: 2,
      });
      expect(requestQuestionnaire.mock.calls[0]?.[2]?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("PineToolAccessPolicy", () => {
  it("allows reads from every shared folder and writes only to writable folders", async () => {
    const { location, outside, readOnly, readWrite } = await createFixture();
    const policy = await PineToolAccessPolicy.create(
      location.cwd,
      location.folders,
    );

    const canonicalReadWrite = await realpath(readWrite);
    const canonicalReadOnly = await realpath(readOnly);
    await expect(
      policy.authorize(path.join(readWrite, "new", "file.txt"), "write", {
        allowMissing: true,
      }),
    ).resolves.toBe(path.join(canonicalReadWrite, "new", "file.txt"));
    await expect(policy.authorize(readOnly, "read")).resolves.toBe(
      canonicalReadOnly,
    );
    await expect(policy.authorize(readOnly, "write")).rejects.toThrow(
      "Folder is read-only",
    );
    await expect(policy.authorize(outside, "read")).rejects.toThrow(
      "outside the folders shared with Pine",
    );
  });

  it("combines overlapping grants independently of their order", async () => {
    const { readWrite } = await createFixture();
    const child = path.join(readWrite, "nested");
    await mkdir(child);
    const grants = [
      { path: readWrite, access: "read-only" as const },
      { path: child, access: "read-write" as const },
    ];
    for (const folders of [grants, [...grants].reverse()]) {
      const policy = await PineToolAccessPolicy.create(child, folders);
      await expect(policy.authorize(child, "write")).resolves.toBe(
        await realpath(child),
      );
      await expect(policy.authorize(readWrite, "write")).rejects.toThrow(
        "read-only",
      );
    }
  });

  it("resolves symlinks before checking folder boundaries", async () => {
    const { location, outside, readWrite } = await createFixture();
    const secretPath = path.join(outside, "secret.txt");
    const linkPath = path.join(readWrite, "secret-link.txt");
    await writeFile(secretPath, "secret");
    await symlink(secretPath, linkPath);
    const policy = await PineToolAccessPolicy.create(
      location.cwd,
      location.folders,
    );

    await expect(policy.authorize(linkPath, "read")).rejects.toThrow(
      "outside the folders shared with Pine",
    );
  });

  it("grants attached files and folder descendants read-only access", async () => {
    const { location, outside } = await createFixture();
    const attachedFile = path.join(outside, "attached.txt");
    const attachedFolder = path.join(outside, "references");
    const nestedFile = path.join(attachedFolder, "nested.txt");
    await mkdir(attachedFolder);
    await Promise.all([
      writeFile(attachedFile, "attached"),
      writeFile(nestedFile, "nested"),
    ]);
    const attachedPaths = new PineAttachedPathAccess();
    await attachedPaths.grant([attachedFile, attachedFolder]);
    const policy = await PineToolAccessPolicy.create(
      location.cwd,
      location.folders,
      attachedPaths,
    );

    await expect(policy.authorize(attachedFile, "read")).resolves.toBe(
      await realpath(attachedFile),
    );
    await expect(policy.authorize(nestedFile, "read")).resolves.toBe(
      await realpath(nestedFile),
    );
    await expect(policy.authorize(attachedFile, "write")).rejects.toThrow(
      "outside the folders shared with Pine",
    );
  });

  it("adds managed Skill directories only while authoring is active", async () => {
    const { location, outside } = await createFixture();
    const skillRoot = path.join(outside, "skills");
    await mkdir(skillRoot);
    let authoringActive = false;
    const policy = await PineToolAccessPolicy.create(
      location.cwd,
      location.folders,
      undefined,
      () =>
        authoringActive
          ? [{ access: "read-write" as const, path: skillRoot }]
          : [],
    );

    await expect(
      policy.authorize(path.join(skillRoot, "review", "references"), "write", {
        allowMissing: true,
      }),
    ).rejects.toThrow("outside the folders shared with Pine");

    authoringActive = true;
    await expect(
      policy.authorize(path.join(skillRoot, "review", "references"), "write", {
        allowMissing: true,
      }),
    ).resolves.toBe(path.join(skillRoot, "review", "references"));
    expect(policy.writableFolders()).toContain(skillRoot);

    authoringActive = false;
    await expect(
      policy.authorize(path.join(skillRoot, "review", "references"), "write", {
        allowMissing: true,
      }),
    ).rejects.toThrow("outside the folders shared with Pine");
  });

  it("requires the default folder to be writable", async () => {
    const { readOnly } = await createFixture();

    await expect(
      PineToolAccessPolicy.create(readOnly, [
        { access: "read-only", path: readOnly },
      ]),
    ).rejects.toThrow("default folder must be an available read-write folder");
  });
});

const describeSandbox = describe.runIf(
  process.platform === "darwin" && !process.env.CODEX_SANDBOX,
);
describeSandbox("createPineToolDefinitions", () => {
  it("adds the background task tools and hands the session its registry", async () => {
    const { location } = await createFixture();
    const attach = vi.fn();

    const tools = await createPineToolDefinitions(
      location,
      createFakeGate(),
      undefined,
      {
        getApprovalMode: () => "auto-approve",
        getGate: () => null,
        backgroundTasks: {
          onChange: vi.fn(),
          sendCompletionNotification: vi.fn(),
          attach,
        },
      },
    );

    expect(tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["bg_run", "bg_status", "bg_logs", "bg_kill"]),
    );
    expect(attach).toHaveBeenCalledTimes(1);
    const registry = attach.mock.calls[0]?.[0] as {
      dispose(): Promise<void>;
      snapshots(): unknown[];
    };
    expect(registry.snapshots()).toEqual([]);
    await registry.dispose();
  });

  it("runs background tasks in the project sandbox and keeps their output readable", async () => {
    const { location, readWrite } = await createFixture();
    const attach = vi.fn();
    const notify = vi.fn();
    const tools = await createPineToolDefinitions(
      location,
      createFakeGate(),
      undefined,
      {
        getApprovalMode: () => "auto-approve",
        getGate: () => null,
        backgroundTasks: {
          onChange: vi.fn(),
          sendCompletionNotification: notify,
          attach,
        },
      },
    );
    const run = tools.find((tool) => tool.name === "bg_run");
    const result = await run!.execute(
      "call",
      {
        name: "Print",
        command: "pwd && echo sandboxed",
      },
      undefined,
      undefined,
      {} as never,
    );
    const registry = attach.mock.calls[0]?.[0] as {
      snapshots(): Array<{ id: string; status: string; outputPath: string }>;
      readOutput(id: string, maxBytes: number): Promise<{ content: string }>;
    };
    const [task] = registry.snapshots();
    expect(result.details).toMatchObject({ task: { privileged: false } });
    await vi.waitFor(
      () => expect(registry.snapshots()[0]?.status).toBe("completed"),
      { timeout: 15_000 },
    );
    const output = await registry.readOutput(task.id, 1000);
    expect(output.content).toContain(await realpath(readWrite));
    expect(output.content).toContain("sandboxed");
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it("registers Pi's four default tools with Pine-owned operations, plus todo", async () => {
    const { location } = await createFixture();

    const tools = await createPineToolDefinitions(location);

    expect(tools.map((tool) => tool.name)).toEqual([
      "read",
      "bash",
      "edit",
      "write",
      "todo",
    ]);
    const scratchDirectory = path.join(
      path.dirname(location.sessionsRoot),
      "tmp",
      createHash("sha256")
        .update(await realpath(location.cwd))
        .digest("hex")
        .slice(0, 24),
    );
    expect(tools.find((tool) => tool.name === "bash")?.description).toContain(
      `The scratch directory is ${JSON.stringify(await realpath(scratchDirectory))}`,
    );

    const bash = tools.find((tool) => tool.name === "bash");
    if (!bash) throw new Error("Bash tool is missing.");
    const bashParams = bash.parameters as {
      required?: string[];
      properties?: Record<string, unknown>;
    };
    expect(bashParams.required).toContain("description");
    expect(bashParams.required).toContain("command");
    expect(bashParams.properties?.description).toBeDefined();
    // Streaming display relies on the model emitting `description` before
    // `command`, which follows the schema's property order.
    expect(Object.keys(bashParams.properties ?? {})[0]).toBe("description");
  });

  it("reads shared context and limits mutations to writable folders", async () => {
    const { location, readOnly, readWrite } = await createFixture();
    const contextPath = path.join(readOnly, "context.txt");
    const outputPath = path.join(readWrite, "output.txt");
    await writeFile(contextPath, "shared context");
    const tools = await createPineToolDefinitions(location);
    const read = tools.find((tool) => tool.name === "read");
    const edit = tools.find((tool) => tool.name === "edit");
    const write = tools.find((tool) => tool.name === "write");
    if (!read || !edit || !write) throw new Error("File tools are missing.");

    await expect(
      read.execute(
        "read-context",
        { path: contextPath },
        undefined,
        undefined,
        undefined as never,
      ),
    ).resolves.toEqual(
      expect.objectContaining({
        content: [expect.objectContaining({ text: "shared context" })],
      }),
    );
    await write.execute(
      "write-output",
      { content: "before", path: outputPath },
      undefined,
      undefined,
      undefined as never,
    );
    await edit.execute(
      "edit-output",
      {
        edits: [{ newText: "after", oldText: "before" }],
        path: outputPath,
      },
      undefined,
      undefined,
      undefined as never,
    );

    await expect(readFile(outputPath, "utf8")).resolves.toBe("after");
    await expect(
      write.execute(
        "write-context",
        { content: "denied", path: contextPath },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("Folder is read-only");
  });

  it("allows file tools to use Pine's temporary directory without escalation", async () => {
    const { location } = await createFixture();
    const gate = createFakeGate();
    const tools = await createPineToolDefinitions(location, gate);
    const read = tools.find((tool) => tool.name === "read");
    const edit = tools.find((tool) => tool.name === "edit");
    const write = tools.find((tool) => tool.name === "write");
    if (!read || !edit || !write) throw new Error("File tools are missing.");
    const temporaryPath = path.join(
      path.dirname(location.sessionsRoot),
      "tmp",
      createHash("sha256")
        .update(await realpath(location.cwd))
        .digest("hex")
        .slice(0, 24),
      "artifact.txt",
    );

    await write.execute(
      "write-temporary",
      { content: "before", path: temporaryPath },
      undefined,
      undefined,
      undefined as never,
    );
    await edit.execute(
      "edit-temporary",
      {
        edits: [{ newText: "after", oldText: "before" }],
        path: temporaryPath,
      },
      undefined,
      undefined,
      undefined as never,
    );
    await read.execute(
      "read-temporary",
      { path: temporaryPath },
      undefined,
      undefined,
      undefined as never,
    );

    await expect(readFile(temporaryPath, "utf8")).resolves.toBe("after");
    expect(gate.reviewDenial).not.toHaveBeenCalled();
  });

  it("separates shell read grants from write grants without unrestricted reads", async () => {
    const { location, readOnly, readWrite } = await createFixture();
    const policy = await PineToolAccessPolicy.create(
      location.cwd,
      location.folders,
    );
    const config = createSandboxConfig(policy, []);
    expect(config.filesystem.denyRead).toEqual(["/"]);
    expect(config.filesystem.allowRead).toContain(await realpath(readOnly));
    expect(config.filesystem.allowWrite).toEqual([await realpath(readWrite)]);
    expect(config.network.allowedDomains).toEqual([]);
  });

  describe("ui_present_file", () => {
    const TOOL_NAME = "ui_present_file";

    async function setup(
      overrides: {
        approvalMode?: "let-me-review" | "auto-approve" | "YOLO";
        attachedPaths?: PineAttachedPathAccess;
        gate?: ReturnType<typeof createFakeGate>;
      } = {},
    ) {
      const fixture = await createFixture();
      const gate = overrides.gate ?? createFakeGate();
      const presentFile = vi.fn();
      const approvalMode = overrides.approvalMode ?? "auto-approve";
      const tools = await createPineToolDefinitions(
        fixture.location,
        gate,
        overrides.attachedPaths,
        {
          getApprovalMode: () => approvalMode,
          getGate: () => gate,
          presentFile,
        },
      );
      const tool = tools.find((candidate) => candidate.name === TOOL_NAME);
      const present = (filePath: string) =>
        tool!.execute(
          "present-call",
          { path: filePath },
          undefined,
          undefined,
          undefined as never,
        );
      return { ...fixture, approvalMode, gate, present, presentFile, tools };
    }

    it("is only offered when the host can open a tab", async () => {
      const { location } = await createFixture();
      const withoutHost = await createPineToolDefinitions(location);
      expect(withoutHost.map((tool) => tool.name)).not.toContain(TOOL_NAME);

      const { tools } = await setup();
      expect(tools.map((tool) => tool.name)).toContain(TOOL_NAME);
    });

    it("presents a project file by its canonical absolute path", async () => {
      const { present, presentFile, readOnly } = await setup();
      const target = path.join(readOnly, "notes.md");
      await writeFile(target, "# Notes");

      const result = await present(target);

      // The path is realpath'd, so the renderer is handed the same canonical
      // path the access policy approved.
      const canonical = path.join(await realpath(readOnly), "notes.md");
      expect(presentFile).toHaveBeenCalledWith("present-call", canonical);
      expect(result.content[0]).toMatchObject({
        text: `Opened ${canonical} in a new background tab. The user was not switched to it.`,
      });
    });

    it("resolves a relative path against the session folder", async () => {
      const { present, presentFile, readWrite } = await setup();
      await writeFile(path.join(readWrite, "notes.md"), "# Notes");

      await present("notes.md");

      expect(presentFile).toHaveBeenCalledWith(
        "present-call",
        path.join(await realpath(readWrite), "notes.md"),
      );
    });

    it("presents an attached file without approval", async () => {
      const { present, gate, outside } = await setup();
      const attached = path.join(outside, "attached.txt");
      await writeFile(attached, "attached");
      // Grants canonicalize their targets, so the file must exist first.
      const attachments = new PineAttachedPathAccess();
      await attachments.grant([attached]);
      const withAttachment = await setup({ attachedPaths: attachments });

      await withAttachment.present(attached);

      expect(withAttachment.presentFile).toHaveBeenCalledWith(
        "present-call",
        await realpath(attached),
      );
      expect(withAttachment.gate.reviewDenial).not.toHaveBeenCalled();
      // Presenting the same path without the grant is what needs approval.
      await present(attached);
      expect(gate.reviewDenial).toHaveBeenCalledTimes(1);
    });

    it("escalates an outside path to the gate and presents it once approved", async () => {
      const { present, presentFile, gate, outside } = await setup();
      const external = path.join(outside, "report.pdf");
      await writeFile(external, "pdf");

      await present(external);

      expect(gate.reviewDenial).toHaveBeenCalledWith(
        "authorize",
        expect.objectContaining({ toolName: TOOL_NAME }),
      );
      expect(presentFile).toHaveBeenCalledWith(
        "present-call",
        await realpath(external),
      );
    });

    it("keeps an unapproved outside path out of the renderer", async () => {
      const denied = createFakeGate({
        reviewDenial: () => Promise.resolve({ kind: "deny" as const }),
      });
      const { present, presentFile, outside } = await setup({ gate: denied });
      await writeFile(path.join(outside, "secret.txt"), "secret");

      await expect(present(path.join(outside, "secret.txt"))).rejects.toThrow(
        "outside the folders shared with Pine",
      );
      expect(presentFile).not.toHaveBeenCalled();
    });

    it("asks the user before presenting in let-me-review mode", async () => {
      const rejected = createFakeGate({
        reviewFileCall: () =>
          Promise.resolve({ kind: "deny" as const, reason: "not now" }),
      });
      const { present, presentFile, readWrite } = await setup({
        approvalMode: "let-me-review",
        gate: rejected,
      });
      await writeFile(path.join(readWrite, "notes.md"), "# Notes");

      await expect(present("notes.md")).rejects.toThrow("not now");
      expect(presentFile).not.toHaveBeenCalled();
    });

    it("rejects directories, missing files, and empty paths", async () => {
      const { present, presentFile, readWrite } = await setup();
      await mkdir(path.join(readWrite, "folder"));

      await expect(present("folder")).rejects.toThrow(
        "Expected a readable file",
      );
      await expect(present("missing.md")).rejects.toThrow();
      await expect(present("   ")).rejects.toThrow("A file path is required.");
      expect(presentFile).not.toHaveBeenCalled();
    });
  });

  it("tells the agent to use privileged bash for external reads", async () => {
    const { location } = await createFixture();
    const tools = await createPineToolDefinitions(location, createFakeGate());
    const bash = tools.find((tool) => tool.name === "bash")!;
    const privileged = tools.find((tool) => tool.name === "privileged_bash")!;
    expect(bash.description).toContain(
      "Reading or listing other external paths",
    );
    expect(bash.promptSnippet).toContain(
      "use privileged_bash directly to read or list",
    );
    expect(privileged.description).toContain(
      "out-of-project filesystem access",
    );
    expect(privileged.description).toContain(
      "Every call requires a fresh approval",
    );
  });

  describe.runIf(process.platform === "darwin" && !process.env.CODEX_SANDBOX)(
    "native shell read boundaries",
    () => {
      const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

      async function setup() {
        const fixture = await createFixture();
        const attachments = new PineAttachedPathAccess();
        const gate = createFakeGate();
        const tools = await createPineToolDefinitions(
          fixture.location,
          gate,
          attachments,
        );
        const bash = tools.find((tool) => tool.name === "bash")!;
        const run = (command: string) =>
          bash.execute(
            "read-boundary",
            { command, description: "test read boundaries" },
            undefined,
            undefined,
            undefined as never,
          );
        return { ...fixture, attachments, gate, run };
      }

      it("reads shared folders and temporary files using system and Bun tools", async () => {
        const { readWrite, readOnly, run } = await setup();
        await writeFile(path.join(readWrite, "local.txt"), "local-content");
        await writeFile(path.join(readOnly, "context.txt"), "shared-content");
        const result = await run(
          `/bin/cat local.txt ${quote(path.join(readOnly, "context.txt"))}; printf temporary-content > "$TMPDIR/probe"; /bin/cat "$TMPDIR/probe"; bun --version`,
        );
        expect(result.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              text: expect.stringContaining(
                "local-contentshared-contenttemporary-content",
              ),
            }),
          ]),
        );
      });

      it("preserves child environments and supports heredocs in paths with spaces", async () => {
        const { run, location } = await setup();
        const tmp = await realpath(
          path.join(
            path.dirname(location.sessionsRoot),
            "tmp",
            createHash("sha256")
              .update(await realpath(location.cwd))
              .digest("hex")
              .slice(0, 24),
          ),
        );
        await run(
          `cat > "$TMPDIR/probe.js" <<'JS'\nawait Bun.write(process.env.TMPDIR + "/result.txt", process.env.HOME + "\\n" + process.env.TMPDIR);\nJS\nbun "$TMPDIR/probe.js"`,
        );
        expect(await readFile(path.join(tmp, "result.txt"), "utf8")).toBe(
          `${process.env.HOME}\n${tmp}`,
        );
      });

      it("allows ancestor discovery without reading sibling files", async () => {
        const { run, readWrite } = await setup();
        const parent = path.dirname(readWrite);
        const sibling = path.join(parent, "private.txt");
        await writeFile(sibling, "unshared-content");
        await expect(run(`/bin/ls ${quote(parent)}`)).resolves.toBeDefined();
        await expect(run(`/bin/cat ${quote(sibling)}`)).rejects.toThrow(
          "Use privileged_bash",
        );
      });

      it("preserves successful diagnostic output and nonzero exit status", async () => {
        const { run } = await setup();
        await expect(
          run("printf 'permission denied\\n'; exit 0"),
        ).resolves.toBeDefined();
        await expect(run("exit 141")).rejects.toThrow("141");
        await expect(
          run("printf 'permission denied\\n' >&2; exit 1"),
        ).rejects.toThrow("may be a sandbox restriction");
      });

      it("stops a child that ignores SIGTERM on timeout", async () => {
        const { location } = await setup();
        const tools = await createPineToolDefinitions(location);
        const bash = tools.find((tool) => tool.name === "bash")!;
        await expect(
          bash.execute(
            "timeout",
            {
              command: "trap '' TERM; while true; do /bin/sleep 1; done",
              description: "test timeout",
              timeout: 0.2,
            },
            undefined,
            undefined,
            undefined as never,
          ),
        ).rejects.toThrow("timed out");
      });

      it("runs the system launcher without implicitly granting native temporary storage", async () => {
        const selected = await realpath("/var/select/developer_dir").catch(
          () => null,
        );
        if (!selected) return;
        vi.stubEnv("TMPDIR", "/private/tmp");
        let runtime: Awaited<ReturnType<typeof setup>>;
        try {
          runtime = await setup();
        } finally {
          vi.unstubAllEnvs();
        }
        const result = await runtime.run(
          `/usr/bin/python3 -c 'import os; print("python-ok"); print(os.environ["TMPDIR"])'`,
        );
        expect(result.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              text: expect.stringContaining("python-ok"),
            }),
          ]),
        );
      });

      it("runs a MacPorts shell with its dynamic libraries", async () => {
        const macPortsBash = await realpath("/opt/local/bin/bash").catch(
          () => null,
        );
        if (!macPortsBash) return;
        const { run } = await setup();
        const result = await run(
          `${quote(macPortsBash)} -c 'printf macports-bash-ok'`,
        );
        expect(result.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              text: expect.stringContaining("macports-bash-ok"),
            }),
          ]),
        );
      });

      it("blocks external files, directory listings and symlink escapes without escalating", async () => {
        const { readWrite, outside, run, gate } = await setup();
        const secret = path.join(outside, "secret.txt");
        await writeFile(secret, "external-secret-content");
        await symlink(outside, path.join(readWrite, "escape"));
        for (const command of [
          `/bin/cat ${quote(secret)}`,
          `/bin/ls ${quote(outside)}`,
          "/bin/cat escape/secret.txt",
          `bun -e ${quote(`console.log(await Bun.file(${JSON.stringify(secret)}).text())`)}`,
        ]) {
          const error = await run(command).catch((error: unknown) => error);
          expect(error).toBeInstanceOf(Error);
          expect((error as Error).message).toContain("Use privileged_bash");
          expect((error as Error).message).not.toContain(
            "external-secret-content",
          );
        }
        expect(gate.reviewBashCommand).not.toHaveBeenCalled();
        expect(gate.reviewDenial).not.toHaveBeenCalled();
        expect(gate.reviewPrivilegedCall).not.toHaveBeenCalled();
      });

      it("picks up new attachments without granting siblings or writes", async () => {
        const { outside, readOnly, attachments, run } = await setup();
        const attachment = path.join(outside, "attachment.txt");
        const sibling = path.join(outside, "sibling.txt");
        const directory = path.join(outside, "attached-directory");
        await mkdir(directory);
        await writeFile(attachment, "attached-file");
        await writeFile(sibling, "private-sibling");
        await writeFile(path.join(directory, "child.txt"), "attached-child");
        await expect(run(`/bin/cat ${quote(attachment)}`)).rejects.toThrow(
          "Use privileged_bash",
        );
        await attachments.grant([attachment, directory]);
        const result = await run(
          `/bin/cat ${quote(attachment)} ${quote(path.join(directory, "child.txt"))}`,
        );
        expect(result.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              text: expect.stringContaining("attached-fileattached-child"),
            }),
          ]),
        );
        await expect(run(`/bin/cat ${quote(sibling)}`)).rejects.toThrow(
          "Use privileged_bash",
        );
        for (const target of [
          attachment,
          path.join(directory, "child.txt"),
          path.join(readOnly, "new.txt"),
        ]) {
          await expect(
            run(`printf changed > ${quote(target)}`),
          ).rejects.toThrow("Use privileged_bash");
        }
        expect(await readFile(attachment, "utf8")).toBe("attached-file");
      });

      it("does not report a shell terminated by a signal as successful", async () => {
        const { run } = await setup();
        await expect(run("kill -TERM $$")).rejects.toThrow(
          "Shell terminated by signal SIGTERM",
        );
      });

      it("requires privileged approval before reading an external file", async () => {
        const { location, outside, run, gate } = await setup();
        const target = path.join(outside, "reviewed.txt");
        await writeFile(target, "approved-external-content");
        const command = `/bin/cat ${quote(target)}`;
        await expect(run(command)).rejects.toThrow("Use privileged_bash");
        const tools = await createPineToolDefinitions(location, gate);
        const privileged = tools.find(
          (tool) => tool.name === "privileged_bash",
        )!;
        const readExternal = () =>
          privileged.execute(
            "privileged-read",
            { command, description: "read the requested external file" },
            undefined,
            undefined,
            undefined as never,
          );
        gate.reviewPrivilegedCall.mockResolvedValueOnce({
          kind: "deny",
          reason: "External read was denied",
        });
        await expect(readExternal()).rejects.toThrow(
          "External read was denied",
        );
        const approved = await readExternal();
        expect(approved.content).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              type: "text",
              text: expect.stringContaining("approved-external-content"),
            }),
          ]),
        );
        expect(gate.reviewPrivilegedCall).toHaveBeenCalledTimes(2);
      });
    },
  );

  describe("hasPermissionDiagnostic", () => {
    it("recognizes permission diagnostics without assigning their source", () => {
      expect(
        hasPermissionDiagnostic("zsh:1: operation not permitted: ps"),
      ).toBe(true);
      expect(
        hasPermissionDiagnostic(
          "_LSOpenURLsWithCompletionHandler() failed for the application /System/Applications/Music.app with error -54.",
        ),
      ).toBe(false);
      expect(
        hasPermissionDiagnostic(
          "sandbox_extension_issue_file failed for /System/Library/CoreServices/System Events.app: 1 (Operation not permitted)",
        ),
      ).toBe(true);
      expect(
        hasPermissionDiagnostic(
          "32:44: execution error: Music got an error: Application isn’t running. (-600)",
        ),
      ).toBe(false);
      expect(
        hasPermissionDiagnostic(
          "40:83: execution error: File permission error. (-54)",
        ),
      ).toBe(true);
      expect(hasPermissionDiagnostic("Error: EACCES: access denied")).toBe(
        true,
      );
      expect(
        hasPermissionDiagnostic(
          "Reason: tried: '/opt/local/lib/libncurses.6.dylib' (blocked by sandbox)",
        ),
      ).toBe(true);
    });

    it("ignores ordinary command failures", () => {
      expect(
        hasPermissionDiagnostic("cat: missing.txt: No such file or directory"),
      ).toBe(false);
      expect(hasPermissionDiagnostic("Application isn’t running. (-601)")).toBe(
        false,
      );
    });
  });

  it.runIf(process.platform === "darwin" && !process.env.CODEX_SANDBOX)(
    "reports denials that hide inside pipelines without escalating",
    async () => {
      const { location } = await createFixture();
      const gate = createFakeGate();
      const tools = await createPineToolDefinitions(location, gate);
      const bash = tools.find((tool) => tool.name === "bash");
      if (!bash) throw new Error("Bash tool was not registered.");

      // pipefail makes the denied `ps` stage visible even though `head`
      // succeeds, but ordinary bash never escalates itself.
      await expect(
        bash.execute(
          "p1",
          { command: "ps aux | head -20", description: "list processes" },
          undefined,
          undefined,
          undefined as never,
        ),
      ).rejects.toThrow("Use privileged_bash");
      expect(gate.reviewDenial).not.toHaveBeenCalled();
    },
  );

  it.runIf(process.platform === "darwin" && !process.env.CODEX_SANDBOX)(
    "preserves denial diagnostics when a later command exits zero",
    async () => {
      const { location } = await createFixture();
      const gate = createFakeGate();
      const tools = await createPineToolDefinitions(location, gate);
      const bash = tools.find((tool) => tool.name === "bash");
      if (!bash) throw new Error("Bash tool was not registered.");
      const target = spawn("/bin/sleep", ["30"], { stdio: "ignore" });
      if (!target.pid) throw new Error("Test process did not start.");

      try {
        await expect(
          bash.execute(
            "signal-process",
            {
              command: `/bin/kill ${target.pid} 2>&1; /usr/bin/true`,
              description: "stop a process",
            },
            undefined,
            undefined,
            undefined as never,
          ),
        ).resolves.toMatchObject({
          content: [
            expect.objectContaining({
              text: expect.stringContaining("Operation not permitted"),
            }),
          ],
        });
        expect(gate.reviewDenial).not.toHaveBeenCalled();
      } finally {
        target.kill("SIGKILL");
      }
    },
  );

  it.runIf(process.platform === "darwin" && !process.env.CODEX_SANDBOX)(
    "preserves application failures without automatic native replay",
    async () => {
      const { location } = await createFixture();
      const gate = createFakeGate();
      const tools = await createPineToolDefinitions(location, gate);
      const bash = tools.find((tool) => tool.name === "bash");
      if (!bash) throw new Error("Bash tool was not registered.");

      // Application-specific error codes are not verified sandbox evidence.
      // Preserve the failure; native access always needs an explicit new call.
      await expect(
        bash.execute(
          "apple-events",
          {
            command:
              "osascript -e 'tell application \"Finder\" to get name of startup disk'",
            description: "probe Apple Events",
          },
          undefined,
          undefined,
          undefined as never,
        ),
      ).rejects.toThrow();

      expect(gate.reviewDenial).not.toHaveBeenCalled();
    },
  );

  it.runIf(process.platform === "darwin" && !process.env.CODEX_SANDBOX)(
    "enforces writable and read-only grants for shell commands",
    async () => {
      const { location, readOnly, readWrite } = await createFixture();
      const tools = await createPineToolDefinitions(location);
      const bash = tools.find((tool) => tool.name === "bash");
      if (!bash) throw new Error("Bash tool was not registered.");

      const allowedPath = path.join(readWrite, "allowed.txt");
      const deniedPath = path.join(readOnly, "denied.txt");
      const readablePath = path.join(readOnly, "readable.txt");
      await writeFile(readablePath, "context");
      await bash.execute(
        "allowed",
        { command: `printf allowed > ${JSON.stringify(allowedPath)}` },
        undefined,
        undefined,
        undefined as never,
      );
      await expect(
        bash.execute(
          "denied",
          { command: `printf denied > ${JSON.stringify(deniedPath)}` },
          undefined,
          undefined,
          undefined as never,
        ),
      ).rejects.toThrow("operation not permitted");

      await expect(readFile(allowedPath, "utf8")).resolves.toBe("allowed");
      await expect(readFile(deniedPath, "utf8")).rejects.toThrow();
      await expect(
        bash.execute(
          "read-context",
          { command: `cat ${JSON.stringify(readablePath)}` },
          undefined,
          undefined,
          undefined as never,
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          content: [expect.objectContaining({ text: "context" })],
        }),
      );

      const outputResult = await bash.execute(
        "stdout",
        { command: "printf 'hello\\n'; pwd; ls -1" },
        undefined,
        undefined,
        undefined as never,
      );
      expect(outputResult.content).toEqual([
        expect.objectContaining({
          text: expect.stringContaining("hello"),
        }),
      ]);
      expect(outputResult.content[0]).toEqual(
        expect.objectContaining({
          text: expect.stringContaining(await realpath(readWrite)),
        }),
      );
      expect(outputResult.content[0]).toEqual(
        expect.objectContaining({
          text: expect.stringContaining("allowed.txt"),
        }),
      );

      await expect(
        bash.execute(
          "pine-temp",
          {
            command:
              'printf temporary > "$TMPDIR/pi_test_out"; cat "$TMPDIR/pi_test_out"',
          },
          undefined,
          undefined,
          undefined as never,
        ),
      ).resolves.toEqual(
        expect.objectContaining({
          content: [expect.objectContaining({ text: "temporary" })],
        }),
      );

      await expect(
        bash.execute(
          "system-temp",
          { command: "printf denied > /tmp/pine_pi_test_out" },
          undefined,
          undefined,
          undefined as never,
        ),
      ).rejects.toThrow("operation not permitted");
    },
  );

  it("escalates authorize denials and writes beyond grants on approval", async () => {
    const { location, outside } = await createFixture();
    const gate = createFakeGate();
    const tools = await createPineToolDefinitions(location, gate);
    const write = tools.find((tool) => tool.name === "write");
    if (!write) throw new Error("Write tool is missing.");
    const outsideFile = path.join(outside, "approved.txt");

    await write.execute(
      "approved-write",
      { content: "granted", path: outsideFile },
      undefined,
      undefined,
      undefined as never,
    );

    await expect(readFile(outsideFile, "utf8")).resolves.toBe("granted");
    expect(gate.reviewFileCall).toHaveBeenCalledWith(
      expect.objectContaining({ toolName: "write", path: outsideFile }),
    );
    expect(gate.reviewDenial).toHaveBeenCalledWith(
      "authorize",
      expect.objectContaining({ subject: outsideFile }),
    );
  });

  it("escalates out-of-scope reads through the gate on approval", async () => {
    const { location, outside } = await createFixture();
    const gate = createFakeGate();
    const tools = await createPineToolDefinitions(location, gate);
    const read = tools.find((tool) => tool.name === "read");
    if (!read) throw new Error("Read tool was not registered.");
    const outsideFile = path.join(outside, "secret.txt");
    await writeFile(outsideFile, "elevated-read");

    await expect(
      read.execute(
        "r1",
        { path: outsideFile },
        undefined,
        undefined,
        undefined as never,
      ),
    ).resolves.toBeDefined();
    expect(gate.reviewDenial).toHaveBeenCalledWith(
      "authorize",
      expect.objectContaining({ toolName: "read", subject: outsideFile }),
    );
  });

  it("reads attached paths without review but still reviews edits", async () => {
    const { location, outside } = await createFixture();
    const attachedFile = path.join(outside, "attached.txt");
    await writeFile(attachedFile, "before");
    const attachedPaths = new PineAttachedPathAccess();
    await attachedPaths.grant([attachedFile]);
    const gate = createFakeGate({
      reviewDenial: () =>
        Promise.resolve({ kind: "deny" as const, reason: "write denied" }),
    });
    const tools = await createPineToolDefinitions(
      location,
      gate,
      attachedPaths,
    );
    const read = tools.find((tool) => tool.name === "read");
    const edit = tools.find((tool) => tool.name === "edit");
    if (!read || !edit) throw new Error("File tools are missing.");

    await expect(
      read.execute(
        "read-attachment",
        { path: attachedFile },
        undefined,
        undefined,
        undefined as never,
      ),
    ).resolves.toBeDefined();
    expect(gate.reviewDenial).not.toHaveBeenCalled();

    await expect(
      edit.execute(
        "edit-attachment",
        {
          edits: [{ newText: "after", oldText: "before" }],
          path: attachedFile,
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("write denied");
    expect(gate.reviewDenial).toHaveBeenCalledWith(
      "authorize",
      expect.objectContaining({ toolName: "edit", subject: attachedFile }),
    );
  });

  it("propagates the gate's pre-execution denial for file tools", async () => {
    const { location } = await createFixture();
    const gate = createFakeGate({
      reviewFileCall: () =>
        Promise.resolve({ kind: "deny" as const, reason: "not allowed" }),
    });
    const tools = await createPineToolDefinitions(location, gate);
    const write = tools.find((tool) => tool.name === "write");
    if (!write) throw new Error("Write tool is missing.");

    await expect(
      write.execute(
        "denied-write",
        { content: "x", path: path.join(location.cwd, "in-grant.txt") },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("not allowed");
  });

  it("rejects bash commands denied before execution", async () => {
    const { location: fixtureLocation } = await createFixture();
    const location = {
      ...fixtureLocation,
      approvalMode: "let-me-review" as const,
    };
    const gate = createFakeGate({
      reviewBashCommand: () =>
        Promise.resolve({ kind: "deny" as const, reason: "user said no" }),
    });
    const tools = await createPineToolDefinitions(location, gate);
    const bash = tools.find((tool) => tool.name === "bash");
    if (!bash) throw new Error("Bash tool was not registered.");

    await expect(
      bash.execute(
        "b1",
        { command: "echo hi", description: "greet" },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("user said no");
    expect(gate.reviewBashCommand).toHaveBeenCalledWith(
      expect.objectContaining({ command: "echo hi" }),
    );
  });

  it("reviews every privileged bash call in automatic mode", async () => {
    const { location } = await createFixture();
    const gate = createFakeGate();
    const tools = await createPineToolDefinitions(location, gate);
    const privileged = tools.find((tool) => tool.name === "privileged_bash");
    if (!privileged)
      throw new Error("Privileged bash tool was not registered.");

    await expect(
      privileged.execute(
        "privileged-1",
        { command: "printf privileged", description: "test native shell" },
        undefined,
        undefined,
        undefined as never,
      ),
    ).resolves.toBeDefined();
    await expect(
      privileged.execute(
        "privileged-2",
        { command: "printf privileged", description: "test native shell" },
        undefined,
        undefined,
        undefined as never,
      ),
    ).resolves.toBeDefined();
    expect(gate.reviewPrivilegedCall).toHaveBeenCalledTimes(2);
    expect(gate.reviewPrivilegedCall).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        toolCallId: "privileged-1",
        toolName: "privileged_bash",
        subject: "printf privileged",
      }),
    );
    expect(privileged.description).not.toContain("always allowed");
    expect(privileged.promptSnippet).not.toContain("fixed-allow");
  });

  it("reviews privileged bash once in let-me-review mode", async () => {
    const { location: fixtureLocation } = await createFixture();
    const location = {
      ...fixtureLocation,
      approvalMode: "let-me-review" as const,
    };
    const gate = createFakeGate();
    const tools = await createPineToolDefinitions(location, gate);
    const privileged = tools.find((tool) => tool.name === "privileged_bash");
    if (!privileged)
      throw new Error("Privileged bash tool was not registered.");

    await privileged.execute(
      "privileged-ask",
      { command: "printf privileged", description: "test native shell" },
      undefined,
      undefined,
      undefined as never,
    );
    expect(gate.reviewPrivilegedCall).toHaveBeenCalledOnce();
  });

  it("does not execute privileged bash when its fresh review is denied", async () => {
    const { location } = await createFixture();
    const gate = createFakeGate({
      reviewPrivilegedCall: () =>
        Promise.resolve({ kind: "deny" as const, reason: "unsafe" }),
    });
    const tools = await createPineToolDefinitions(location, gate);
    const privileged = tools.find((tool) => tool.name === "privileged_bash");
    if (!privileged)
      throw new Error("Privileged bash tool was not registered.");

    await expect(
      privileged.execute(
        "privileged-denied",
        { command: "printf privileged", description: "test native shell" },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("unsafe");
  });

  it("exposes privileged bash without review in yolo mode", async () => {
    const { location } = await createFixture();
    const gate = createFakeGate({
      reviewPrivilegedCall: () =>
        Promise.resolve({
          kind: "deny" as const,
          reason: "should be skipped",
        }),
    });
    const tools = await createPineToolDefinitions(
      { ...location, approvalMode: "YOLO" },
      gate,
    );
    const privileged = tools.find((tool) => tool.name === "privileged_bash");
    if (!privileged)
      throw new Error("Privileged bash tool was not registered.");

    await expect(
      privileged.execute(
        "privileged-yolo",
        { command: "printf yolo", description: "test native shell" },
        undefined,
        undefined,
        undefined as never,
      ),
    ).resolves.toBeDefined();
    expect(gate.reviewPrivilegedCall).not.toHaveBeenCalled();
  });

  it("uses the latest approval mode without rebuilding the session tools", async () => {
    const { location } = await createFixture();
    let approvalMode: "auto-approve" | "YOLO" = "auto-approve";
    const gate = createFakeGate();
    const tools = await createPineToolDefinitions(location, gate, undefined, {
      getApprovalMode: () => approvalMode,
      getGate: () => gate,
    });
    const privileged = tools.find((tool) => tool.name === "privileged_bash");
    if (!privileged)
      throw new Error("Privileged bash tool was not registered.");

    await privileged.execute(
      "privileged-reviewed",
      { command: "printf reviewed", description: "test reviewed shell" },
      undefined,
      undefined,
      undefined as never,
    );
    approvalMode = "YOLO";
    await privileged.execute(
      "privileged-yolo",
      { command: "printf yolo", description: "test yolo shell" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(gate.reviewPrivilegedCall).toHaveBeenCalledOnce();
    expect(gate.reviewPrivilegedCall).toHaveBeenCalledWith(
      expect.objectContaining({ toolCallId: "privileged-reviewed" }),
    );
  });

  it.runIf(process.platform === "darwin" && !process.env.CODEX_SANDBOX)(
    "directs sandbox-denied commands to privileged bash without escalating",
    async () => {
      const { location, outside } = await createFixture();
      const gate = createFakeGate();
      const tools = await createPineToolDefinitions(location, gate);
      const bash = tools.find((tool) => tool.name === "bash");
      if (!bash) throw new Error("Bash tool was not registered.");
      const outsideFile = path.join(outside, "elevated.txt");

      await expect(
        bash.execute(
          "elevated",
          {
            command: `printf elevated > ${JSON.stringify(outsideFile)}`,
            description: "write outside the project",
          },
          undefined,
          undefined,
          undefined as never,
        ),
      ).rejects.toThrow("Use privileged_bash");

      expect(gate.reviewDenial).not.toHaveBeenCalled();
      await expect(readFile(outsideFile, "utf8")).rejects.toThrow();
    },
  );

  it("carries the captured output as review evidence", () => {
    const error = new SandboxCommandPermissionError(
      "zsh:1: operation not permitted: ps",
    );
    expect(error.outputTail).toContain("operation not permitted");
  });

  it("executes the approved parameter snapshot even if the caller mutates its object", async () => {
    const { location } = await createFixture();
    const params = {
      command: "printf approved",
      description: "verify approval binding",
    };
    const gate = createFakeGate({
      reviewPrivilegedCall: () => {
        params.command = "printf changed";
        return Promise.resolve({ kind: "allow" });
      },
    });
    const tools = await createPineToolDefinitions(location, gate);
    const privileged = tools.find((tool) => tool.name === "privileged_bash")!;
    const result = await privileged.execute(
      "snapshot",
      params,
      undefined,
      undefined,
      undefined as never,
    );
    expect(result.content).toEqual([
      expect.objectContaining({ text: "approved" }),
    ]);
  });

  it("does not execute a privileged call cancelled while approval was pending", async () => {
    const { location, outside } = await createFixture();
    const controller = new AbortController();
    const gate = createFakeGate({
      reviewPrivilegedCall: () => {
        controller.abort();
        return Promise.resolve({ kind: "allow" });
      },
    });
    const tools = await createPineToolDefinitions(location, gate);
    const privileged = tools.find((tool) => tool.name === "privileged_bash")!;
    const target = path.join(outside, "cancelled");
    await expect(
      privileged.execute(
        "cancelled",
        {
          command: `touch ${JSON.stringify(target)}`,
          description: "cancelled native call",
        },
        controller.signal,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("aborted");
    await expect(readFile(target)).rejects.toThrow();
  });

  it("fails closed when manual review has no approval gate", async () => {
    const { location, readWrite } = await createFixture();
    const tools = await createPineToolDefinitions({
      ...location,
      approvalMode: "let-me-review",
    });
    for (const [name, params] of [
      [
        "bash",
        {
          command: "printf unexpected",
          description: "must require approval",
        },
      ],
      [
        "write",
        { path: path.join(readWrite, "unexpected"), content: "unexpected" },
      ],
    ] as const) {
      const tool = tools.find((candidate) => candidate.name === name)!;
      await expect(
        tool.execute(
          "missing-gate",
          params,
          undefined,
          undefined,
          undefined as never,
        ),
      ).rejects.toThrow("without an approval gate");
    }
  });

  it("preserves native TMPDIR after privileged approval", async () => {
    const { location } = await createFixture();
    const gate = createFakeGate();
    vi.stubEnv("TMPDIR", "/private/tmp");
    try {
      const tools = await createPineToolDefinitions(location, gate);
      const privileged = tools.find((tool) => tool.name === "privileged_bash")!;
      const result = await privileged.execute(
        "native-env",
        {
          command: 'printf "%s" "$TMPDIR"',
          description: "inspect native temp",
        },
        undefined,
        undefined,
        undefined as never,
      );
      expect(result.content).toEqual([
        expect.objectContaining({ text: "/private/tmp" }),
      ]);
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("YOLO mode lets file tools bypass shared-folder restrictions", async () => {
    const { location, outside } = await createFixture();
    const gate = createFakeGate();
    const tools = await createPineToolDefinitions(
      { ...location, approvalMode: "YOLO" },
      gate,
    );
    const write = tools.find((tool) => tool.name === "write");
    if (!write) throw new Error("Write tool is missing.");
    const outsideFile = path.join(outside, "yolo.txt");
    await write.execute(
      "write-yolo",
      { content: "YOLO", path: outsideFile },
      undefined,
      undefined,
      undefined as never,
    );
    await expect(readFile(outsideFile, "utf8")).resolves.toBe("YOLO");
    expect(gate.reviewFileCall).not.toHaveBeenCalled();
    expect(gate.reviewDenial).not.toHaveBeenCalled();
  });

  it("applies unrestricted file access after switching to YOLO", async () => {
    const { location, outside } = await createFixture();
    let approvalMode: "auto-approve" | "YOLO" = "auto-approve";
    const gate = createFakeGate();
    const tools = await createPineToolDefinitions(location, gate, undefined, {
      getApprovalMode: () => approvalMode,
      getGate: () => gate,
    });
    const write = tools.find((tool) => tool.name === "write");
    if (!write) throw new Error("Write tool is missing.");
    const outsideFile = path.join(outside, "dynamic-yolo.txt");

    approvalMode = "YOLO";
    await write.execute(
      "dynamic-write-yolo",
      { content: "unrestricted", path: outsideFile },
      undefined,
      undefined,
      undefined as never,
    );

    await expect(readFile(outsideFile, "utf8")).resolves.toBe("unrestricted");
    expect(gate.reviewFileCall).not.toHaveBeenCalled();
  });

  it("YOLO mode disables ordinary bash and only runs privileged bash", async () => {
    const { location, outside } = await createFixture();
    const tools = await createPineToolDefinitions({
      ...location,
      approvalMode: "YOLO",
    });
    const bash = tools.find((tool) => tool.name === "bash");
    const privileged = tools.find((tool) => tool.name === "privileged_bash");
    if (!bash || !privileged) throw new Error("Bash tools are missing.");
    const outsideFile = path.join(outside, "yolo-shell.txt");
    await expect(
      bash.execute(
        "yolo-shell",
        {
          command: `printf yolo > ${JSON.stringify(outsideFile)}`,
          description: "test disabled shell",
        },
        undefined,
        undefined,
        undefined as never,
      ),
    ).rejects.toThrow("Ordinary bash is disabled in YOLO mode");
    await privileged.execute(
      "privileged-yolo-shell",
      {
        command: `printf yolo > ${JSON.stringify(outsideFile)}`,
        description: "test native shell",
      },
      undefined,
      undefined,
      undefined as never,
    );
    await expect(readFile(outsideFile, "utf8")).resolves.toBe("yolo");
  });
});
