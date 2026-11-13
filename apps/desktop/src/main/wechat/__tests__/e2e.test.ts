// @vitest-environment node
// WeChat remote end to end: the real bridge, ClawBot channel and command
// layer against the mock iLink server, over a real ProjectRuntimeRegistry.
import { readdir } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeAttachmentMessage } from "../../../shared/attachments";
import { STALE_MS } from "../constants";
import { render } from "../replies";
import {
  type Harness,
  PAIR_CODE,
  WINDOW_ID,
  createHarness,
  sleep,
  waitFor,
} from "./e2eHarness";

const harnesses: Harness[] = [];

afterEach(async () => {
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

async function harness(
  options: Parameters<typeof createHarness>[0] = {},
): Promise<Harness> {
  const created = await createHarness(options);
  harnesses.push(created);
  return created;
}

/** The ask number on a card: `.y NN approve`. */
function cardNumber(text: string): number {
  const match = /\.y (\d+)` approve/.exec(text);
  if (!match) throw new Error(`no approvable card in ${JSON.stringify(text)}`);
  return Number(match[1]);
}

/** Any ask number on a card or held batch: `.d NN`. */
function askNumber(text: string): number {
  const match = /\.d (\d+)/.exec(text);
  if (!match) throw new Error(`no ask number in ${JSON.stringify(text)}`);
  return Number(match[1]);
}

/** The attached paths the agent host received in each prompt. */
function attachedPaths(h: Harness): unknown[] {
  return h.agentHost.prompt.mock.calls.map((call: unknown[]) => call[3]);
}

const BLOCK = serializeAttachmentMessage(
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
  "read this",
);

async function startSession(h: Harness, text = "fix the bug") {
  const reply = await h.say(`.new ${text}`);
  expect(reply).toContain("**Garden** · Started");
  const sessionId = h.createdSession(
    h.agentHost.createSession.mock.calls.length - 1,
  );
  h.running(sessionId);
  return sessionId;
}

describe("WeChat remote end to end", { timeout: 30_000 }, () => {
  it("binds with the pairing code, then runs a session through an approval to its result", async () => {
    const h = await harness({ bind: false });
    await h.bridge.startBinding();
    await waitFor(() => h.bridge.status().binding?.phase === "qr");
    h.mock.qr.scan();
    h.mock.qr.confirm();
    await waitFor(() => h.bridge.status().binding?.phase === "pairing");

    // Before the code is entered nothing runs and only the code is sent.
    h.push(".new delete everything");
    await h.sent((text) => text.includes(PAIR_CODE));
    await sleep(300);
    expect(h.agentHost.createSession).not.toHaveBeenCalled();
    expect(h.texts()).toHaveLength(1);
    expect(h.texts()[0]).toBe(render("T-PAIR", "en", { code: PAIR_CODE }));
    expect(h.bridge.status().bound).toBe(false);

    const status = await h.bridge.submitPairingCode(PAIR_CODE);
    expect(status.bound).toBe(true);
    await h.sent((text) => text.startsWith("Connected to Pine on Test Mac"));
    await h.settle();
    // The message sent while pairing is never run later.
    expect(h.agentHost.createSession).not.toHaveBeenCalled();

    const sessionId = await startSession(h);
    const created = h.agentHost.prompt.mock.calls[0] as unknown[];
    expect(created[0]).toBe(sessionId);
    expect(created[1]).toBe("fix the bug");
    expect(created[4]).toBe("auto-approve");
    expect(h.notifications.map((entry) => entry.kind)).toContain(
      "session-started",
    );

    const requestId = h.approval(sessionId, { subject: "npm test" });
    const card = await h.sent((text) => text.includes("npm test"));
    const number = cardNumber(card);
    const approved = await h.say(`.y ${number}`);
    expect(approved).toContain(`Approved ${number}`);
    expect(h.agentHost.respondApproval).toHaveBeenCalledWith(requestId, {
      kind: "allow",
    });

    h.finish(sessionId, "All tests pass now.");
    const done = await h.sent((text) => text.includes("All tests pass now."));
    expect(done).toContain("Done");
  });

  it("lets a window that shares the project keep controlling its own sessions", async () => {
    const h = await harness({ bind: false });
    await h.registry.open(
      WINDOW_ID,
      await h.repository.open(h.project.id),
      h.repository.dataPaths(h.project.id),
    );
    const own = await h.registry.prompt(WINDOW_ID, {
      message: "local work",
      target: { kind: "new", projectId: h.project.id },
      approvalMode: "let-me-review",
    });
    const ownId = own.session.id;
    await h.bind();

    const wechatSession = await startSession(h, "from the phone");
    expect(wechatSession).not.toBe(ownId);
    expect(h.registry.controllerOfSession(ownId)).toBe(WINDOW_ID);

    // The window still answers its own session's card.
    h.running(ownId);
    const requestId = h.approval(ownId, { subject: "local command" });
    expect(
      h.registry.respondApproval(WINDOW_ID, { requestId, action: "approve" }),
    ).toEqual({ accepted: true });

    // Unbinding lets go of WeChat's hold without ending the window's session.
    await h.bridge.unbind();
    expect(h.registry.isOpen(WINDOW_ID, h.project.id)).toBe(true);
    expect(h.agentHost.disposeSession).not.toHaveBeenCalledWith(ownId);
    expect(h.registry.controllerOfSession(ownId)).toBe(WINDOW_ID);
  });

  it("makes a session above a lowered ceiling view-only", async () => {
    const h = await harness();
    const sessionId = await startSession(h);
    await h.bridge.setSettings({ ceilingMode: "let-me-review" });

    const prompts = h.agentHost.prompt.mock.calls.length;
    const refused = await h.say("keep going");
    expect(refused).toContain("above the WeChat ceiling");
    expect(h.agentHost.prompt.mock.calls.length).toBe(prompts);

    h.approval(sessionId, { subject: "rm build" });
    const card = await h.sent((text) => text.includes("rm build"));
    expect(card).toContain("above the WeChat ceiling");
    await h.say(`.y ${askNumber(card)}`);
    expect(h.agentHost.respondApproval).not.toHaveBeenCalled();
  });

  it("approves sandbox denials by default and high-risk cards only with the switch", async () => {
    const h = await harness();
    const sessionId = await startSession(h);

    const sandbox = h.approval(sessionId, {
      trigger: "sandbox-denied",
      subject: "curl example.com",
    });
    const sandboxCard = await h.sent((text) =>
      text.includes("curl example.com"),
    );
    await h.say(`.y ${cardNumber(sandboxCard)}`);
    expect(h.agentHost.respondApproval).toHaveBeenCalledWith(sandbox, {
      kind: "allow",
    });

    h.approval(sessionId, {
      trigger: "privileged-execution",
      subject: "sudo reboot",
    });
    const local = await h.sent((text) => text.includes("sudo reboot"));
    expect(local).toContain("cannot be approved from WeChat");
    await h.say(`.y ${askNumber(local)}`);
    expect(h.agentHost.respondApproval).toHaveBeenCalledTimes(1);

    await h.bridge.setSettings({ allowHighRiskApprovals: true });
    const highRisk = h.approval(sessionId, {
      trigger: "privileged-execution",
      subject: "sudo shutdown",
    });
    const card = await h.sent((text) => text.includes("sudo shutdown"));
    await h.say(`.y ${cardNumber(card)}`);
    expect(h.agentHost.respondApproval).toHaveBeenCalledWith(highRisk, {
      kind: "allow",
    });
    expect(h.notifications.map((entry) => entry.kind)).toContain(
      "high-risk-approved",
    );
  });

  it("delivers results that did not fit the reply budget as a digest with the next message", async () => {
    const h = await harness();
    // Each message's token allows one reply: the `.new` reply uses it.
    h.mock.setReplyBudget(1);
    const sessionId = await startSession(h);
    const sends = h.mock.sent.length;
    h.finish(sessionId, "Finished the refactor.");
    await sleep(2600);
    expect(h.mock.sent.length).toBe(sends);

    const next = await h.say(".status");
    expect(next.startsWith("**While you were away**")).toBe(true);
    expect(next).toContain("finished");
    expect(h.mock.sent.length).toBe(sends + 1);
  });

  it("stops sending after the token expires and asks for a new scan", async () => {
    const h = await harness();
    const sessionId = await startSession(h);
    h.mock.setStaleToken(true);
    await waitFor(
      () =>
        h.notifications.some((entry) => entry.kind === "reauth-required") &&
        h.bridge.status().connection === "reauth-required",
      8000,
      "reauth-required",
    );
    const sendsBefore = h.mock.requests.filter((request) =>
      request.path.endsWith("/sendmessage"),
    ).length;
    h.finish(sessionId, "Done while offline.");
    await sleep(2600);
    expect(
      h.mock.requests.filter((request) => request.path.endsWith("/sendmessage"))
        .length,
    ).toBe(sendsBefore);
  });

  it("holds a stale .new and runs it with .y NN", async () => {
    const h = await harness();
    const held = await h.say(".new old task", {
      create_time_ms: Date.now() - STALE_MS - 60_000,
    });
    expect(held).toContain("arrived while offline");
    expect(h.agentHost.createSession).not.toHaveBeenCalled();
    const started = await h.say(`.y ${askNumber(held)}`);
    await waitFor(() => h.agentHost.createSession.mock.calls.length === 1);
    await h.sent((text) => text.includes("**Garden** · Started: old task"));
    expect(started).toBeTruthy();
  });

  it("queues plain text as steering behind an open card and withdraws it with .recall", async () => {
    const h = await harness();
    const sessionId = await startSession(h);
    h.approval(sessionId, { subject: "npm test" });
    const number = cardNumber(
      await h.sent((text) => text.includes("npm test")),
    );
    const prompts = h.agentHost.prompt.mock.calls.length;

    const queued = await h.say("also check the footer");
    expect(queued).toContain("Staged as a steering message");
    expect(queued).toContain(
      `**${number}** approval · \`.y ${number}\` approves`,
    );
    expect(queued).toContain(".recall");
    expect(h.agentHost.prompt.mock.calls.length).toBe(prompts + 1);
    const call = h.agentHost.prompt.mock.calls[prompts] as unknown[];
    expect(call[0]).toBe(sessionId);
    expect(call[1]).toBe("also check the footer");
    expect(call[2]).toBe("steer");

    h.emit({
      type: "steering-queue",
      sessionId,
      messages: ["also check the footer"],
    });
    expect(await h.say(".q")).toContain("**1** also check the footer");
    const dequeue = vi
      .spyOn(h.agentHost, "dequeueSteering")
      .mockResolvedValueOnce({
        removed: true,
        message: "also check the footer",
      });
    expect(await h.say(".recall")).toBe("Withdrawn: also check the footer");
    expect(dequeue).toHaveBeenCalledWith(sessionId, "also check the footer");
    expect(h.agentHost.respondApproval).not.toHaveBeenCalled();
    expect(await h.say(".w")).toContain(String(number));
  });

  it("still holds late plain text while a card is open", async () => {
    const h = await harness();
    const sessionId = await startSession(h);
    h.approval(sessionId, { subject: "npm test" });
    await h.sent((text) => text.includes("npm test"));
    const prompts = h.agentHost.prompt.mock.calls.length;
    const held = await h.say("old thought", {
      create_time_ms: Date.now() - STALE_MS - 60_000,
    });
    expect(held).toContain("arrived while offline");
    expect(h.agentHost.prompt.mock.calls.length).toBe(prompts);
  });

  it("refuses plain text for a view-only session with an open card", async () => {
    const h = await harness();
    const sessionId = await startSession(h);
    await h.bridge.setSettings({ ceilingMode: "let-me-review" });
    h.approval(sessionId, { subject: "rm build" });
    await h.sent((text) => text.includes("rm build"));
    const prompts = h.agentHost.prompt.mock.calls.length;
    const refused = await h.say("keep going");
    expect(refused).toContain("above the WeChat ceiling");
    expect(refused).not.toContain("Queued");
    expect(h.agentHost.prompt.mock.calls.length).toBe(prompts);
  });

  it("answers .pause, then E-PAUSED once for later messages", async () => {
    const h = await harness();
    await h.say(".pause");
    expect(h.bridge.status().paused).toBe(true);
    const sends = h.mock.sent.length;
    h.push(".new one");
    h.push("two");
    h.push(".status");
    await h.settle();
    await sleep(500);
    const later = h.texts().slice(sends);
    expect(later).toEqual([render("E-PAUSED", "en")]);
    expect(h.agentHost.createSession).not.toHaveBeenCalled();
  });

  it("never lets an attachment block typed in WeChat reach the agent's attached paths", async () => {
    const h = await harness();
    expect(await h.say(`.new ${BLOCK}`)).toBe(render("E-TEXT", "en"));
    expect(h.agentHost.createSession).not.toHaveBeenCalled();
    expect(await h.say(BLOCK)).toBe(render("E-TEXT", "en"));
    expect(h.agentHost.createSession).not.toHaveBeenCalled();

    await startSession(h);
    // Steering a running session and queueing for after it.
    expect(await h.say(`\n\n${BLOCK}`)).toBe(render("E-TEXT", "en"));
    expect(await h.say(`.queue ${BLOCK}`)).toBe(render("E-TEXT", "en"));
    expect(await h.say("plain steer")).toContain("Passed to the running task");
    expect(attachedPaths(h).every((paths) => paths === undefined)).toBe(true);
    expect(
      h.agentHost.prompt.mock.calls.some((call: unknown[]) =>
        String(call[1]).includes("/etc/passwd"),
      ),
    ).toBe(false);
  });

  it("stores no attachment when the media download is redirected", async () => {
    const h = await harness();
    const item = h.mock.hostMedia("image", Buffer.from("png bytes"));
    h.mock.redirectNext("/c2c/download", `${h.mock.baseUrl}/elsewhere`);
    const reply = await h.say("", { item_list: [item] });
    expect(reply).toBe(render("E-FAIL", "en"));
    expect(
      h.mock.requests.some((request) => request.path === "/elsewhere"),
    ).toBe(false);
    const inbox = await readdir(
      path.join(h.dataDirectory, "wechat-inbox"),
    ).catch(() => []);
    expect(inbox).toEqual([]);

    await h.say(".new describe it");
    expect(attachedPaths(h)).toEqual([undefined]);
  });
});
