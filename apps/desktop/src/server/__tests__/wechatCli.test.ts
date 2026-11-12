// @vitest-environment node
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_WECHAT_SETTINGS,
  DEFAULT_WECHAT_STATUS,
  type WeChatStatus,
} from "../../shared/wechatRemote";
import { ProjectRepository } from "../../main/projects/projectRepository";
import { WeChatStore } from "../../main/wechat/store";
import { fileCredentialStorage } from "../credentialStorage";
import {
  WECHAT_BIND_NEEDS_TTY,
  WECHAT_SIGHUP_HINT,
  WECHAT_YOLO_WARNING,
  WeChatTerminalBinding,
  canBindInteractively,
  describeWeChatChange,
  formatWeChatBinding,
  formatWeChatNotification,
  runWeChatAction,
  wechatStorePaths,
  type TerminalPrompt,
  type WeChatBindingTarget,
} from "../wechatCli";

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "pine-wechat-cli-"));
});
afterEach(() => rm(directory, { recursive: true, force: true }));

function openStore(): WeChatStore {
  return new WeChatStore({
    ...wechatStorePaths(directory),
    storage: fileCredentialStorage,
  });
}

async function bindAccount(): Promise<void> {
  const store = openStore();
  await store.load();
  await store.updateSecure((draft) => {
    draft.token = "secret-bot-token";
    draft.owner = {
      userId: "someone@im.wechat",
      botId: "bot@im.bot",
      baseUrl: "https://ilinkai.weixin.qq.com",
      boundAt: Date.UTC(2026, 10, 12),
    };
    draft.settings = {
      ...draft.settings,
      ceilingMode: "autonomous",
      allowFileSending: true,
    };
  });
  await store.update((draft) => {
    draft.cursor = "cursor-7";
  });
}

async function createProject(): Promise<string> {
  const folder = path.join(directory, "folder");
  await mkdir(folder);
  const folderId = "cde9a86c-7632-43ac-96d6-c41ddeddce0e";
  const project = await new ProjectRepository(
    path.join(directory, "projects"),
  ).create({
    defaultFolderId: folderId,
    folders: [
      { access: "read-write", id: folderId, name: "src", path: folder },
    ],
    name: "Garden",
  });
  return project.id;
}

describe("runWeChatAction", () => {
  it("uses the files the core reads", () => {
    expect(wechatStorePaths("/srv/pine")).toEqual({
      statePath: "/srv/pine/agent/wechat-remote.json",
      securePath: "/srv/pine/wechat-remote-secure",
    });
  });

  it("shows the defaults when nothing is bound", async () => {
    const text = await runWeChatAction(directory, { kind: "status" });
    expect(text).toContain("WeChat: not connected");
    expect(text).toContain("Listening: yes");
    expect(text).toContain("Ceiling: auto-approve");
    expect(text).toContain("Default mode: auto-approve");
    expect(text).toContain("Default project: none");
    expect(text).toContain("Allow high-risk approvals: no");
    expect(text).toContain("Send files to WeChat: no");
    expect(text).toContain("Reply language: auto");
    expect(text).not.toContain(WECHAT_SIGHUP_HINT);
  });

  it("shows a bound account by digest only", async () => {
    await bindAccount();
    const text = await runWeChatAction(directory, { kind: "status" });
    expect(text).toMatch(
      /connected to account [0-9A-F]{4}-[0-9A-F]{4} since 2026-11-12/,
    );
    expect(text).toContain("Ceiling: autonomous");
    expect(text).toContain("Send files to WeChat: yes");
    expect(text).not.toContain("secret-bot-token");
    expect(text).not.toContain("someone@im.wechat");
  });

  it("unbinds, resets the permissions and keeps the language", async () => {
    await bindAccount();
    await runWeChatAction(directory, {
      kind: "config",
      patch: {},
      language: "en",
    });
    const text = await runWeChatAction(directory, { kind: "unbind" });
    expect(text).toContain("Disconnected WeChat.");
    expect(text).toContain(WECHAT_SIGHUP_HINT);
    const store = openStore();
    await store.load();
    expect(store.secure().token).toBeUndefined();
    expect(store.secure().owner).toBeUndefined();
    expect(store.secure().settings.allowFileSending).toBe(false);
    expect(store.get().cursor).toBe("");
    expect(store.get().language).toBe("en");
  });

  it("changes each setting and prints the result", async () => {
    const projectId = await createProject();
    const text = await runWeChatAction(directory, {
      kind: "config",
      patch: {
        ceilingMode: "autonomous",
        defaultMode: "autonomous",
        defaultProjectId: projectId,
        allowHighRiskApprovals: true,
        allowFileSending: true,
      },
      language: "zh",
    });
    expect(text).toContain("Ceiling: autonomous");
    expect(text).toContain("Default mode: autonomous");
    expect(text).toContain(`Default project: Garden (${projectId})`);
    expect(text).toContain("Allow high-risk approvals: yes");
    expect(text).toContain("Send files to WeChat: yes");
    expect(text).toContain("Reply language: zh");
    expect(text).toContain(WECHAT_SIGHUP_HINT);
    expect(text).not.toContain(WECHAT_YOLO_WARNING);

    const store = openStore();
    await store.load();
    expect(store.secure().settings).toEqual({
      ...DEFAULT_WECHAT_SETTINGS,
      ceilingMode: "autonomous",
      defaultMode: "autonomous",
      defaultProjectId: projectId,
      allowHighRiskApprovals: true,
      allowFileSending: true,
    });
    expect(store.get().language).toBe("zh");
  });

  it("clears the default project with none", async () => {
    const projectId = await createProject();
    await runWeChatAction(directory, {
      kind: "config",
      patch: { defaultProjectId: projectId },
    });
    const text = await runWeChatAction(directory, {
      kind: "config",
      patch: { defaultProjectId: null },
    });
    expect(text).toContain("Default project: none");
    const store = openStore();
    await store.load();
    expect(store.secure().settings.defaultProjectId).toBeUndefined();
  });

  it("refuses a project that does not exist", async () => {
    await expect(
      runWeChatAction(directory, {
        kind: "config",
        patch: { defaultProjectId: "missing" },
      }),
    ).rejects.toThrow('No project "missing"');
  });

  it("pauses and resumes", async () => {
    let text = await runWeChatAction(directory, {
      kind: "config",
      patch: {},
      paused: true,
    });
    expect(text).toContain("Listening: no, paused");
    text = await runWeChatAction(directory, {
      kind: "config",
      patch: {},
      paused: false,
    });
    expect(text).toContain("Listening: yes");
  });

  it("warns about a YOLO ceiling and says when the default mode is lowered", async () => {
    const text = await runWeChatAction(directory, {
      kind: "config",
      patch: { ceilingMode: "YOLO" },
    });
    expect(text).toContain("Ceiling: yolo");
    expect(text).toContain(WECHAT_YOLO_WARNING);

    const lowered = await runWeChatAction(directory, {
      kind: "config",
      patch: { ceilingMode: "let-me-review", defaultMode: "autonomous" },
    });
    expect(lowered).toContain("Default mode: let-me-review");
    expect(lowered).toContain("lowered to let-me-review");
  });

  it("keeps a change another store instance made in between", async () => {
    const running = openStore();
    await running.load();
    await runWeChatAction(directory, {
      kind: "config",
      patch: { allowFileSending: true },
    });
    // The running server writes after the offline edit; the edit survives.
    await running.updateSecure((draft) => {
      draft.paused = true;
    });
    // And an offline edit after the server's write keeps the server's change.
    await runWeChatAction(directory, {
      kind: "config",
      patch: { ceilingMode: "let-me-review" },
    });
    const store = openStore();
    await store.load();
    expect(store.secure()).toMatchObject({
      paused: true,
      settings: {
        allowFileSending: true,
        ceilingMode: "let-me-review",
        defaultMode: "let-me-review",
      },
    });
  });

  it("reports an unreadable sealed file", async () => {
    const { securePath } = wechatStorePaths(directory);
    await mkdir(path.dirname(securePath), { recursive: true });
    await writeFile(securePath, "not base64 json");
    const text = await runWeChatAction(directory, { kind: "status" });
    expect(text).toContain("could not be read");
    expect(text).toContain("Listening: no, paused");
  });

  it("never writes the token to the plain state file", async () => {
    await bindAccount();
    await runWeChatAction(directory, {
      kind: "config",
      patch: { allowFileSending: false },
    });
    const plain = await readFile(wechatStorePaths(directory).statePath, "utf8");
    expect(plain).not.toContain("secret-bot-token");
  });
});

describe("formatWeChatBinding", () => {
  it("draws the QR code without printing its content", () => {
    const content = "https://liteapp.weixin.qq.com/q/secret-qr?x=1";
    const text = formatWeChatBinding({
      phase: "qr",
      qrContent: content,
      expiresAt: Date.now() + 60_000,
    });
    expect(text).toContain("scan this QR code");
    expect(text).toMatch(/[▀▄█]/);
    expect(text).not.toContain(content);
    expect(text).not.toContain("secret-qr");
    expect(text).toContain("Valid until");
  });

  it("explains each phase", () => {
    expect(formatWeChatBinding({ phase: "scanned" })).toContain("Confirm");
    expect(formatWeChatBinding({ phase: "verify-code" })).toContain(
      "verification code",
    );
    expect(
      formatWeChatBinding({ phase: "verify-code", verifyRetry: true }),
    ).toContain("not accepted");
    expect(
      formatWeChatBinding({
        phase: "pairing",
        pairing: { codeSent: false, attemptsLeft: 3, expiresAt: 0 },
      }),
    ).toContain("send any message");
  });
});

describe("canBindInteractively", () => {
  it("needs a terminal on both ends", () => {
    expect(canBindInteractively({ stdinTTY: true, stdoutTTY: true })).toBe(
      true,
    );
    expect(canBindInteractively({ stdinTTY: undefined, stdoutTTY: true })).toBe(
      false,
    );
    expect(canBindInteractively({ stdinTTY: true, stdoutTTY: false })).toBe(
      false,
    );
    expect(WECHAT_BIND_NEEDS_TTY).toContain("Serving without");
  });
});

function status(patch: Partial<WeChatStatus>): WeChatStatus {
  return { ...DEFAULT_WECHAT_STATUS, ...patch };
}

describe("describeWeChatChange", () => {
  it("logs connection and pause changes once", () => {
    expect(describeWeChatChange(undefined, status({}))).toBeUndefined();
    const online = status({ bound: true, connection: "online" });
    expect(describeWeChatChange(undefined, online)).toBe("WeChat: online.");
    expect(describeWeChatChange(online, online)).toBeUndefined();
    expect(describeWeChatChange(online, { ...online, paused: true })).toBe(
      "WeChat: online, paused.",
    );
    expect(
      describeWeChatChange(online, {
        ...online,
        connection: "reauth-required",
      }),
    ).toContain("needs a new scan");
    expect(
      describeWeChatChange(status({}), status({ error: "binding-expired" })),
    ).toContain("QR code expired");
  });

  it("never mentions the QR content or the pairing state", () => {
    const line = describeWeChatChange(
      undefined,
      status({
        bound: true,
        connection: "online",
        binding: { phase: "qr", qrContent: "https://secret.example/qr" },
      }),
    );
    expect(line).not.toContain("secret");
  });
});

describe("formatWeChatNotification", () => {
  it("prints one line", () => {
    expect(
      formatWeChatNotification({
        kind: "session-started",
        title: "Session started from WeChat",
        body: "Fix the tests\nin Garden",
      }),
    ).toBe("WeChat: Session started from WeChat - Fix the tests in Garden");
  });
});

class FakePrompt implements TerminalPrompt {
  readonly asked: { text: string; resolve: (answer: string) => void }[] = [];
  aborted = 0;
  closed = false;

  question(text: string, signal: AbortSignal): Promise<string> {
    return new Promise((resolve, reject) => {
      this.asked.push({ text, resolve });
      signal.addEventListener("abort", () => {
        this.aborted += 1;
        reject(new Error("aborted"));
      });
    });
  }

  close(): void {
    this.closed = true;
  }

  answer(text: string): void {
    const entry = this.asked.at(-1);
    if (!entry) throw new Error("Nothing was asked.");
    entry.resolve(text);
  }
}

class FakeBridge implements WeChatBindingTarget {
  current: WeChatStatus = status({});
  startError: Error | undefined;
  verifyCodes: string[] = [];
  pairingCodes: string[] = [];
  cancelled = 0;
  onPairingCode: (code: string) => WeChatStatus = () => this.current;

  status(): WeChatStatus {
    return this.current;
  }
  startBinding(): Promise<WeChatStatus> {
    if (this.startError) return Promise.reject(this.startError);
    this.current = status({
      binding: { phase: "qr", qrContent: "https://qr.example/one" },
    });
    return Promise.resolve(this.current);
  }
  cancelBinding(): WeChatStatus {
    this.cancelled += 1;
    return this.current;
  }
  submitVerifyCode(code: string): WeChatStatus {
    this.verifyCodes.push(code);
    this.current = status({ binding: { phase: "confirming" } });
    return this.current;
  }
  submitPairingCode(code: string): Promise<WeChatStatus> {
    this.pairingCodes.push(code);
    this.current = this.onPairingCode(code);
    return Promise.resolve(this.current);
  }
}

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function terminalBinding() {
  const bridge = new FakeBridge();
  const prompt = new FakePrompt();
  const written: string[] = [];
  const binding = new WeChatTerminalBinding({
    bridge,
    prompt,
    write: (text) => written.push(text),
  });
  return { bridge, prompt, written, binding };
}

describe("WeChatTerminalBinding", () => {
  it("walks through QR, verification code and pairing code", async () => {
    const { bridge, prompt, written, binding } = terminalBinding();
    await binding.start();
    expect(written).toHaveLength(1);
    expect(written[0]).toContain("scan this QR code");

    // A refreshed QR code is drawn again; the same one is not.
    binding.update(bridge.current);
    bridge.current = status({
      binding: { phase: "qr", qrContent: "https://qr.example/two" },
    });
    binding.update(bridge.current);
    expect(written).toHaveLength(2);

    bridge.current = status({ binding: { phase: "verify-code" } });
    binding.update(bridge.current);
    expect(prompt.asked.map((entry) => entry.text)).toEqual([
      "Verification code: ",
    ]);
    prompt.answer(" 1234 ");
    await settle();
    expect(bridge.verifyCodes).toEqual(["1234"]);

    bridge.current = status({
      binding: {
        phase: "pairing",
        pairing: { codeSent: false, attemptsLeft: 3, expiresAt: 0 },
      },
    });
    binding.update(bridge.current);
    expect(prompt.asked).toHaveLength(1);
    expect(written.at(-1)).toContain("send any message");

    bridge.current = status({
      binding: {
        phase: "pairing",
        pairing: { codeSent: true, attemptsLeft: 3, expiresAt: 0 },
      },
    });
    binding.update(bridge.current);
    expect(prompt.asked.at(-1)?.text).toBe("Pairing code from WeChat: ");

    bridge.onPairingCode = (code) =>
      code === "654321"
        ? status({
            bound: true,
            connection: "online",
            owner: { userDigest: "A1B2-C3D4", boundAt: 1 },
          })
        : status({
            binding: {
              phase: "pairing",
              pairing: { codeSent: true, attemptsLeft: 2, expiresAt: 0 },
            },
          });
    prompt.answer("111111");
    await settle();
    expect(prompt.asked.at(-1)?.text).toContain("Wrong code, 2 attempts left");
    prompt.answer("654321");
    await settle();
    expect(bridge.pairingCodes).toEqual(["111111", "654321"]);
    expect(written.at(-1)).toContain("WeChat is connected (account A1B2-C3D4)");
    expect(await binding.done).toBe("bound");
    expect(prompt.closed).toBe(true);
    expect(written.join("\n")).not.toContain("654321");
    expect(written.join("\n")).not.toContain("qr.example");
  });

  it("drops a question whose phase has passed", async () => {
    const { bridge, prompt, binding } = terminalBinding();
    await binding.start();
    bridge.current = status({ binding: { phase: "verify-code" } });
    binding.update(bridge.current);
    bridge.current = status({
      binding: { phase: "qr", qrContent: "https://qr.example/three" },
    });
    binding.update(bridge.current);
    await settle();
    expect(prompt.aborted).toBe(1);
    expect(bridge.verifyCodes).toEqual([]);
  });

  it("asks again after an empty answer", async () => {
    const { bridge, prompt, binding } = terminalBinding();
    await binding.start();
    bridge.current = status({ binding: { phase: "verify-code" } });
    binding.update(bridge.current);
    prompt.answer("   ");
    await settle();
    expect(bridge.verifyCodes).toEqual([]);
    expect(prompt.asked).toHaveLength(2);
  });

  it("reports a failed binding", async () => {
    const { bridge, written, binding } = terminalBinding();
    await binding.start();
    bridge.current = status({ error: "binding-expired" });
    binding.update(bridge.current);
    expect(written.at(-1)).toContain("QR code expired");
    expect(await binding.done).toBe("failed");
  });

  it("reports why binding could not start", async () => {
    const { bridge, written, binding, prompt } = terminalBinding();
    bridge.startError = new Error(
      "WeChat is already connected. Disconnect it first.",
    );
    await binding.start();
    expect(written).toEqual([
      "WeChat is already connected. Disconnect it first.",
    ]);
    expect(await binding.done).toBe("failed");
    expect(prompt.closed).toBe(true);
    // Later status changes are ignored.
    binding.update(status({ binding: { phase: "verify-code" } }));
    expect(prompt.asked).toHaveLength(0);
  });

  it("cancels the binding when the server stops", async () => {
    const { bridge, binding } = terminalBinding();
    await binding.start();
    binding.cancel();
    expect(bridge.cancelled).toBe(1);
    expect(await binding.done).toBe("failed");
  });
});
