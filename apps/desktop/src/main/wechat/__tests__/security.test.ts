// @vitest-environment node
// One test per security invariant of the WeChat remote (plan section 5.1),
// each against the real bridge, ClawBot channel and mock iLink server.
import { randomUUID } from "node:crypto";
import { readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { MessageItemType, MessageType } from "@pine/wechat-ilink";
import { afterEach, describe, expect, it } from "vitest";
import {
  parseAttachmentMessage,
  serializeAttachmentMessage,
} from "../../../shared/attachments";
import {
  DEFAULT_WECHAT_SETTINGS,
  WECHAT_REQUEST_CHANNELS,
} from "../../../shared/wechatRemote";
import type { PineCore } from "../../core/pineCore";
import { registerCoreRequests } from "../../core/requests";
import { createWebChannels } from "../../webRequestPolicy";
import { STALE_MS } from "../constants";
import { parseCommand } from "../parseCommand";
import { render } from "../replies";
import {
  type Harness,
  PAIR_CODE,
  createHarness,
  sleep,
  waitFor,
} from "./e2eHarness";

const harnesses: Harness[] = [];

afterEach(async () => {
  // Restarted harnesses share the first one's directories: close in reverse.
  for (const harness of harnesses.splice(0).reverse()) await harness.close();
});

async function harness(
  options: Parameters<typeof createHarness>[0] = {},
): Promise<Harness> {
  const created = await createHarness(options);
  harnesses.push(created);
  return created;
}

/** Stops a harness's bridge so another can start on the same files. */
async function stopBridge(h: Harness): Promise<void> {
  await h.bridge.stop();
  h.bridge.dispose();
  await h.bridge.state.flush();
}

function cardNumber(text: string): number {
  const match = /\.y (\d+) approve/.exec(text);
  if (!match) throw new Error(`no approvable card in ${JSON.stringify(text)}`);
  return Number(match[1]);
}

function askNumber(text: string): number {
  const match = /\.d (\d+)/.exec(text);
  if (!match) throw new Error(`no ask number in ${JSON.stringify(text)}`);
  return Number(match[1]);
}

async function startSession(h: Harness, text = "fix the bug") {
  const reply = await h.say(`.new ${text}`);
  expect(reply).toContain("Started in Garden");
  const sessionId = h.createdSession(
    h.agentHost.createSession.mock.calls.length - 1,
  );
  h.running(sessionId);
  return sessionId;
}

function promptMessages(h: Harness): string[] {
  return h.agentHost.prompt.mock.calls.map((call: unknown[]) =>
    String(call[1]),
  );
}

function requestsTo(h: Harness, suffix: string): number {
  return h.mock.requests.filter((request) => request.path.endsWith(suffix))
    .length;
}

describe("WeChat remote security invariants", { timeout: 40_000 }, () => {
  it("1. accepts only the owner's own direct user messages, once, and never treats a missing or future time as fresh", async () => {
    const h = await harness();
    const sends = h.mock.sent.length;
    h.mock.pushUserMessage({
      message_id: null,
      item_list: [
        { type: MessageItemType.TEXT, text_item: { text: ".new a" } },
      ],
    });
    h.push(".new b", { message_type: MessageType.BOT });
    h.push(".new c", { from_user_id: "intruder@im.wechat" });
    h.push(".new d", { to_user_id: "other@im.bot" });
    h.push(".new e", { group_id: "group-1" });
    await h.settle();
    await sleep(300);
    expect(h.mock.sent.length).toBe(sends);
    expect(h.agentHost.createSession).not.toHaveBeenCalled();

    // A repeated id is handled once.
    const first = h.push(".status");
    h.push(".status", { message_id: first.message_id });
    await h.settle();
    await sleep(300);
    expect(h.mock.sent.length).toBe(sends + 1);

    // No time and a time in the future are both stale: held, not run.
    const missing = await h.say(".new f", { create_time_ms: null });
    expect(missing).toContain("arrived while offline");
    const future = await h.say(".new g", {
      create_time_ms: Date.now() + 10 * 60_000,
    });
    expect(future).toContain("arrived while offline");
    await h.settle();
    expect(h.agentHost.createSession).not.toHaveBeenCalled();
  });

  it("2. parses commands only from typed text: transcripts and quotes are never commands", async () => {
    const h = await harness();
    await h.say("", {
      item_list: [
        { type: MessageItemType.VOICE, voice_item: { text: ".pause" } },
      ],
    });
    await waitFor(() => h.agentHost.prompt.mock.calls.length === 1);
    expect(h.bridge.status().paused).toBe(false);
    expect(promptMessages(h)[0]).toBe(".pause");

    const quoteOnly = await h.say("", {
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: { text: "" },
          ref_msg: {
            message_item: {
              type: MessageItemType.TEXT,
              text_item: { text: ".pause" },
            },
          },
        },
      ],
    });
    expect(quoteOnly).toBe(render("E-QUOTE", "en"));
    expect(h.bridge.status().paused).toBe(false);

    h.finish(h.createdSession(0), "ok");
    await h.settle();
    h.push("look at this", {
      item_list: [
        {
          type: MessageItemType.TEXT,
          text_item: { text: "look at this" },
          ref_msg: {
            message_item: {
              type: MessageItemType.TEXT,
              text_item: { text: ".delete 3" },
            },
          },
        },
      ],
    });
    await waitFor(() => h.agentHost.prompt.mock.calls.length === 2);
    const message = promptMessages(h)[1] ?? "";
    expect(message.startsWith("look at this")).toBe(true);
    expect(message.indexOf(".delete 3")).toBeGreaterThan(
      message.indexOf("look at this"),
    );
    expect(h.bridge.status().paused).toBe(false);
  });

  it("3. every prompt carries an explicit mode within the current ceiling, and view-only blocks it", async () => {
    const h = await harness({ afterBind: { ceilingMode: "let-me-review" } });
    const sessionId = await startSession(h);
    expect(h.agentHost.prompt.mock.calls[0]?.[4]).toBe("let-me-review");
    h.finish(sessionId, "first");

    // A stored override above the ceiling, or one Pine does not know (a
    // hand-edited state file), is deleted, never passed.
    for (const [index, override] of ["YOLO", "yolo"].entries()) {
      await h.bridge.state.update((draft) => {
        draft.modeOverride[sessionId] = override as "YOLO";
      });
      h.push(`again ${index}`);
      await waitFor(
        () => h.agentHost.prompt.mock.calls.length === index + 2,
        8000,
        "the prompt",
      );
      expect(h.agentHost.prompt.mock.calls[index + 1]?.[4]).toBe(
        "let-me-review",
      );
      expect(h.bridge.state.get().modeOverride[sessionId]).toBeUndefined();
      h.finish(sessionId, `reply ${index}`);
      await h.settle();
    }

    // A session above the ceiling (started locally in YOLO) is view-only.
    await h.registry.prompt(-2, {
      message: "local",
      target: { kind: "session", projectId: h.project.id, sessionId },
      approvalMode: "YOLO",
    });
    const prompts = h.agentHost.prompt.mock.calls.length;
    expect(await h.say("third")).toContain("above the WeChat ceiling");
    expect(h.agentHost.prompt.mock.calls.length).toBe(prompts);

    // Guidance steers the agent too, so it is refused; a bare reject is not.
    const requestId = h.approval(sessionId, { subject: "npm test" });
    const card = await h.sent((text) => text.includes("npm test"));
    const n = askNumber(card);
    expect(await h.say(`.g ${n} do X`)).toContain("above the WeChat ceiling");
    expect(h.agentHost.respondApproval).not.toHaveBeenCalled();
    await h.say(`.d ${n}`);
    expect(h.agentHost.respondApproval).toHaveBeenCalledTimes(1);
    expect(h.agentHost.respondApproval.mock.calls[0]?.[0]).toBe(requestId);
  });

  it("3b. a WeChat-driven session cannot hand work to a relative above the ceiling", async () => {
    const h = await harness({ afterBind: { ceilingMode: "let-me-review" } });
    const child = await startSession(h, "child task");
    h.finish(child, "done");
    await h.settle();
    const parent = await startSession(h, "parent task");
    h.finish(parent, "done");
    await h.settle();
    const projectId = h.project.id;
    expect(await h.bridge.relayRefusal(child, parent, projectId)).toBe(
      undefined,
    );
    // The parent is then run locally in YOLO.
    await h.registry.prompt(-2, {
      message: "local",
      target: { kind: "session", projectId, sessionId: parent },
      approvalMode: "YOLO",
    });
    expect(await h.bridge.relayRefusal(child, parent, projectId)).toContain(
      "above WeChat's highest approval mode",
    );
    // A session WeChat never drove is not restricted.
    expect(
      await h.bridge.relayRefusal(randomUUID(), parent, projectId),
    ).toBeUndefined();
  });

  it("3c. a local session a WeChat-driven one relayed to is held to the same limits", async () => {
    const h = await harness({ afterBind: { ceilingMode: "auto-approve" } });
    const projectId = h.project.id;
    const sub = await startSession(h, "sub task");
    h.finish(sub, "done");
    await h.settle();
    const sibling = await startSession(h, "sibling task");
    h.finish(sibling, "done");
    await h.settle();
    await h.registry.prompt(-2, {
      message: "local",
      target: { kind: "session", projectId, sessionId: sibling },
      approvalMode: "YOLO",
    });
    // A parent WeChat never drove.
    const parent = randomUUID();
    const automation = { id: "auto-1", name: "Nightly", enabled: true };
    expect(
      await h.bridge.relayRefusal(parent, sibling, projectId),
    ).toBeUndefined();
    expect(h.bridge.automationRunRefusal(parent, automation)).toBeUndefined();

    // The WeChat-driven sub-session hands its reply to the parent.
    await h.bridge.sessionRelayed(sub, parent, projectId);
    expect(await h.bridge.relayRefusal(parent, sibling, projectId)).toContain(
      "above WeChat's highest approval mode",
    );
    expect(h.bridge.automationRunRefusal(parent, automation)).toContain(
      "below Autonomous Work",
    );
  });

  it("4. never approves a display-only card, from a stale message, twice, after the action changed, or before a cut subject was read", async () => {
    const h = await harness();
    const sessionId = await startSession(h);
    const respond = h.agentHost.respondApproval;

    // Display-only (high-risk without the switch).
    h.approval(sessionId, {
      trigger: "privileged-execution",
      subject: "sudo reboot",
    });
    const local = await h.sent((text) => text.includes("sudo reboot"));
    await h.say(`.y ${askNumber(local)}`);
    expect(respond).not.toHaveBeenCalled();

    // A stale `.y` for an approvable card.
    const staleRequest = h.approval(sessionId, { subject: "npm run lint" });
    const staleCard = await h.sent((text) => text.includes("npm run lint"));
    await h.say(`.y ${cardNumber(staleCard)}`, {
      create_time_ms: Date.now() - STALE_MS - 60_000,
    });
    expect(respond).not.toHaveBeenCalled();

    // Approved once; the number is then spent.
    await h.say(`.y ${cardNumber(staleCard)}`);
    expect(respond).toHaveBeenCalledExactlyOnceWith(staleRequest, {
      kind: "allow",
    });
    await h.say(`.y ${cardNumber(staleCard)}`);
    expect(respond).toHaveBeenCalledTimes(1);

    // The same request re-sent with another action gets a new number.
    const requestId = randomUUID();
    h.approval(sessionId, {
      requestId,
      subject: "git push",
      actionDigest: "first",
    });
    const before = await h.sent((text) => text.includes("git push"));
    h.approval(sessionId, {
      requestId,
      subject: "git push --force",
      actionDigest: "second",
    });
    const after = await h.sent((text) => text.includes("git push --force"));
    expect(cardNumber(after)).not.toBe(cardNumber(before));
    await h.say(`.y ${cardNumber(before)}`);
    expect(respond).toHaveBeenCalledTimes(1);
    await h.say(`.y ${cardNumber(after)}`);
    expect(respond).toHaveBeenCalledTimes(2);

    // A cut subject must be read with `.show` first.
    const long = `echo ${"x".repeat(600)}`;
    const cutRequest = h.approval(sessionId, { subject: long });
    const cut = await h.sent((text) => text.includes("Cut short"));
    const number = cardNumber(cut);
    await h.say(`.y ${number}`);
    expect(respond).toHaveBeenCalledTimes(2);
    await h.say(`.show ${number}`);
    // Written right after the full subject went out: the server clock may be
    // ahead of ours, so it waits for a clear margin.
    await h.say(`.y ${number}`);
    expect(respond).toHaveBeenCalledTimes(2);
    await h.say(`.y ${number}`, { create_time_ms: Date.now() + 10_000 });
    expect(respond).toHaveBeenLastCalledWith(cutRequest, { kind: "allow" });
  });

  it("5. sends a file only with the switch on, only from the presented list, and only while its realpath is unchanged", async () => {
    const h = await harness();
    const sessionId = await startSession(h);
    const file = path.join(h.projectFolder, "report.txt");
    const secret = path.join(h.projectFolder, "secret.txt");
    await writeFile(file, "report");
    await writeFile(secret, "secret");
    h.emit({
      type: "present-file",
      sessionId,
      toolCallId: randomUUID(),
      path: file,
    });
    await sleep(100);
    h.finish(sessionId, "Wrote the report.");
    await h.sent((text) => text.includes("Wrote the report."));

    expect(await h.say(".o")).toContain("1 presented file(s)");
    expect(await h.say(".o 1")).toBe(render("E-SWITCH", "en"));
    expect(requestsTo(h, "/getuploadurl")).toBe(0);

    await h.bridge.setSettings({ allowFileSending: true });
    await rm(file);
    await symlink(secret, file);
    await h.say(".o");
    const reply = await h.say(".o 1");
    expect(reply).toBe(render("E-GONE", "en", { variant: "file-changed" }));
    await h.settle();
    expect(requestsTo(h, "/getuploadurl")).toBe(0);
    expect(h.mock.uploads.size).toBe(0);
  });

  it("6. no WeChat command writes a setting, a credential or a folder, and nothing from WeChat resumes a pause", async () => {
    const h = await harness();
    await startSession(h);
    const secure = structuredClone(h.bridge.state.secure());
    const projectBefore = await h.repository.get(h.project.id);
    for (const command of [
      ".mode yolo",
      ".mode 4",
      ".model 1",
      ".effort high",
      ".lang zh",
      ".lang en",
      ".auto 1 on",
    ])
      await h.say(command);
    await h.settle();
    expect(h.bridge.state.secure()).toEqual(secure);
    expect((await h.repository.get(h.project.id)).folders).toEqual(
      projectBefore.folders,
    );

    await h.say(".pause");
    expect(h.bridge.status().paused).toBe(true);
    for (const text of [".resume", ".pause off", "resume", ".y"]) h.push(text);
    await h.settle();
    await sleep(300);
    expect(h.bridge.status().paused).toBe(true);
    expect(parseCommand(".resume").kind).toBe("unknown");
    expect({ ...h.bridge.state.secure(), paused: false }).toEqual({
      ...secure,
      paused: false,
    });
  });

  it("7. no wechat channel is registered on the core router or exposed to the browser", () => {
    const registered: string[] = [];
    const inert: unknown = new Proxy(() => inert, {
      get: () => inert,
      apply: () => inert,
    });
    const core = new Proxy(
      {},
      {
        get: (_target, property) =>
          property === "handle"
            ? (channel: string) => registered.push(channel)
            : inert,
      },
    ) as PineCore;
    registerCoreRequests(core);
    expect(registered.length).toBeGreaterThan(20);
    expect(
      registered.filter((channel) => channel.startsWith("wechat")),
    ).toEqual([]);

    const web = createWebChannels({
      allowAttachment: () => false,
      authorizePresented: () => Promise.resolve(),
      watchDirectories: () => Promise.resolve(),
      watchPreview: () => Promise.resolve(),
      respondWorkbench: () => undefined,
      exportSession: () => Promise.resolve(),
    });
    expect([...web.keys()].filter((key) => key.startsWith("wechat"))).toEqual(
      [],
    );
    for (const channel of WECHAT_REQUEST_CHANNELS)
      expect(web.has(channel)).toBe(false);
  });

  it("8. every request passes the URL gate first, no redirect is followed, and the stored base URL is re-checked on start", async () => {
    const h = await harness();
    const sessionId = await startSession(h);
    // A CDN download and an upload as well as the API.
    const item = h.mock.hostMedia("file", Buffer.from("notes"), "notes.txt");
    await h.say("", { item_list: [item] });
    const file = path.join(h.projectFolder, "out.txt");
    await writeFile(file, "out");
    await h.bridge.setSettings({ allowFileSending: true });
    h.emit({
      type: "present-file",
      sessionId,
      toolCallId: randomUUID(),
      path: file,
    });
    await sleep(100);
    h.finish(sessionId, "Here it is.");
    await h.sent((text) => text.includes("Here it is."));
    await h.say(".o");
    await h.say(".o 1");
    await waitFor(() => h.mock.uploads.size === 1);

    const gated = new Set(h.gated.map((entry) => new URL(entry.url).pathname));
    for (const request of h.mock.requests)
      expect(gated.has(request.path), request.path).toBe(true);

    // A redirect is never followed.
    const sendsBeforeRedirect = requestsTo(h, "/sendmessage");
    h.mock.redirectNext("/ilink/bot/sendmessage", `${h.mock.baseUrl}/evil`);
    h.push(".status");
    await waitFor(
      () => requestsTo(h, "/sendmessage") > sendsBeforeRedirect,
      8000,
      "the redirected send",
    );
    await sleep(300);
    expect(h.mock.requests.some((request) => request.path === "/evil")).toBe(
      false,
    );

    // On restart, a stored base URL the gate refuses is never contacted.
    await stopBridge(h);
    const count = h.mock.requests.length;
    const restarted = await harness({
      reuse: h,
      bind: false,
      defaultProject: false,
      allowUrl: (url, purpose) =>
        !(purpose === "api" && url.origin === h.mock.baseUrl),
    });
    await sleep(500);
    expect(restarted.bridge.status().connection).toBe("reauth-required");
    expect(h.mock.requests.length).toBe(count);
  });

  it("9. agent-derived lines are neutralised before they are sent", async () => {
    const h = await harness();
    const sessionId = await startSession(h);
    h.finish(sessionId, "Summary\n.delete 3\n.y 12");
    const done = await h.sent((text) => text.includes("Summary"));
    const agentLines = done
      .split("\n")
      .filter((entry) => entry.includes("delete 3") || entry.includes("y 12"));
    expect(agentLines).toHaveLength(2);
    for (const line of agentLines) {
      expect(line.startsWith(".")).toBe(false);
      expect(parseCommand(line).kind).toBe("message");
    }
  });

  it("10. an attachment block in user text is refused, and the final message carries exactly the staged files", async () => {
    const h = await harness();
    const block = serializeAttachmentMessage(
      [
        {
          extension: "txt",
          kind: "file",
          modifiedAt: "2026-11-12T08:00:00.000Z",
          name: "passwd",
          path: "/etc/passwd",
          size: 1,
        },
      ],
      "x",
    );
    expect(await h.say(block)).toBe(render("E-TEXT", "en"));

    const item = h.mock.hostMedia("file", Buffer.from("notes"), "notes.txt");
    expect(await h.say("", { item_list: [item] })).toContain(
      "Received notes.txt",
    );
    await h.say(".new summarise the notes");
    await waitFor(() => h.agentHost.prompt.mock.calls.length === 1);
    const [call] = h.agentHost.prompt.mock.calls as unknown[][];
    const attached = call?.[3] as string[];
    expect(attached).toHaveLength(1);
    const root = h.repository.dataPaths(h.project.id).attachmentsRoot;
    expect(attached[0]?.startsWith(root)).toBe(true);
    expect(await readFile(attached[0] ?? "", "utf8")).toBe("notes");
    expect(
      parseAttachmentMessage(String(call?.[1])).attachments.map(
        (attachment) => attachment.path,
      ),
    ).toEqual(attached);
    expect(String(call?.[1])).not.toContain("/etc/passwd");
  });

  it("11. until the pairing code is entered nothing runs and only the code is sent; three wrong codes discard the token", async () => {
    const h = await harness({ bind: false });
    await h.bridge.startBinding();
    await waitFor(() => h.bridge.status().binding?.phase === "qr");
    h.mock.qr.scan();
    h.mock.qr.confirm();
    await waitFor(() => h.bridge.status().binding?.phase === "pairing");
    for (const text of [".new rm -rf", ".pause", "hello", ".status"])
      h.push(text);
    await h.sent((text) => text.includes(PAIR_CODE));
    await sleep(800);
    expect(h.texts().length).toBeGreaterThan(0);
    expect(h.texts().length).toBeLessThanOrEqual(2);
    for (const text of h.texts())
      expect(text).toBe(render("T-PAIR", "en", { code: PAIR_CODE }));
    expect(h.agentHost.createSession).not.toHaveBeenCalled();
    expect(h.agentHost.prompt).not.toHaveBeenCalled();
    expect(h.bridge.status().paused).toBe(false);

    for (const code of ["000000", "111111", "222222"])
      await h.bridge.submitPairingCode(code);
    const status = h.bridge.status();
    expect(status.bound).toBe(false);
    expect(status.error).toBe("pairing-failed");
    expect(h.bridge.state.secure().token).toBeUndefined();
    await expect(h.bridge.submitPairingCode(PAIR_CODE)).rejects.toThrow();
  });

  it("12. permission settings come only from the sealed blob; an unreadable blob starts paused with defaults", async () => {
    const h = await harness({
      afterBind: { ceilingMode: "let-me-review", allowFileSending: true },
    });
    await stopBridge(h);

    // The plain state file cannot widen anything.
    const statePath = path.join(h.agentDirectory, "wechat-remote.json");
    const plain = JSON.parse(await readFile(statePath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      statePath,
      JSON.stringify({
        ...plain,
        settings: { ceilingMode: "YOLO", allowHighRiskApprovals: true },
        paused: false,
        owner: { userId: "intruder@im.wechat" },
      }),
    );
    const second = await harness({
      reuse: h,
      bind: false,
      defaultProject: false,
    });
    expect(second.bridge.status().settings).toMatchObject({
      ceilingMode: "let-me-review",
      allowHighRiskApprovals: false,
      allowFileSending: true,
    });
    expect(second.bridge.status().bound).toBe(true);
    await stopBridge(second);

    // A blob that cannot be decrypted: paused, defaults, told locally.
    const secureFiles = (await readdir(h.dataDirectory)).filter((name) =>
      name.startsWith("wechat-remote-secure"),
    );
    expect(secureFiles.length).toBeGreaterThan(0);
    for (const name of secureFiles)
      await writeFile(path.join(h.dataDirectory, name), "garbage");
    const third = await harness({
      reuse: h,
      bind: false,
      defaultProject: false,
    });
    const status = third.bridge.status();
    expect(status.paused).toBe(true);
    expect(status.bound).toBe(false);
    expect(status.settings).toMatchObject({
      ceilingMode: DEFAULT_WECHAT_SETTINGS.ceilingMode,
      allowHighRiskApprovals: false,
      allowFileSending: false,
    });
    expect(third.notifications.map((entry) => entry.kind)).toContain(
      "settings-reset",
    );
  });

  it("13. a WeChat-driven session starts an automation only at Autonomous Work or above and only when it is enabled", async () => {
    const h = await harness();
    const sessionId = await startSession(h);
    const automation = { id: "auto-1", name: "Nightly", enabled: true };
    expect(h.bridge.automationRunRefusal(sessionId, automation)).toEqual(
      expect.any(String),
    );
    await h.bridge.setSettings({ ceilingMode: "autonomous" });
    expect(
      h.bridge.automationRunRefusal(sessionId, {
        ...automation,
        enabled: false,
      }),
    ).toEqual(expect.any(String));
    expect(h.bridge.automationRunRefusal(sessionId, automation)).toBe(
      undefined,
    );
    // Sessions WeChat never touched keep today's behaviour.
    expect(
      h.bridge.automationRunRefusal(randomUUID(), {
        ...automation,
        enabled: false,
      }),
    ).toBe(undefined);
    expect(h.bridge.automationRunRefusal(undefined, automation)).toBe(
      undefined,
    );
  });
});
