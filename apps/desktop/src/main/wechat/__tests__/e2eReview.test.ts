// @vitest-environment node
// Adversarial review probes against the mock iLink server.
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { render } from "../replies";
import {
  type Harness,
  WINDOW_ID,
  createHarness,
  sleep,
  waitFor,
} from "./e2eHarness";

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const h of harnesses.splice(0)) await h.close();
});

async function harness(
  options: Parameters<typeof createHarness>[0] = {},
): Promise<Harness> {
  const created = await createHarness(options);
  harnesses.push(created);
  return created;
}

function askNumber(text: string): number {
  const match = /\.d (\d+)/.exec(text);
  if (!match) throw new Error(`no ask number in ${JSON.stringify(text)}`);
  return Number(match[1]);
}

async function startSession(h: Harness, text = "fix the bug") {
  const reply = await h.say(`.new ${text}`);
  expect(reply).toContain("**Garden** · Started");
  const sessionId = h.createdSession(
    h.agentHost.createSession.mock.calls.length - 1,
  );
  h.running(sessionId);
  return sessionId;
}

describe("WeChat review probes", { timeout: 30_000 }, () => {
  it("polls with the persisted cursor after a restart and handles a message sent while down once", async () => {
    const first = await createHarness();
    await first.say(".status");
    await first.settle();
    const stored = JSON.parse(
      await readFile(
        path.join(first.agentDirectory, "wechat-remote.json"),
        "utf8",
      ),
    ) as { cursor: string };
    expect(stored.cursor).toMatch(/^cursor-/);
    await first.bridge.stop();
    first.bridge.dispose();
    await first.bridge.state.flush();
    await first.registry.dispose(-2).catch(() => undefined);

    const polls = first.mock.requests.length;
    const before = first.mock.sent.length;
    const second = await harness({ reuse: first, bind: false });
    // The mock does not redeliver what an aborted poll of the old run took.
    await sleep(400);
    first.mock.pushUserText(".status");
    harnesses.push({
      ...first,
      close: async () => {
        await first.mock.close();
        await rm(path.dirname(first.dataDirectory), {
          recursive: true,
          force: true,
        });
      },
    });
    await waitFor(() => first.mock.sent.length > before, 8000, "a reply").catch(
      (error: unknown) => {
        throw new Error(
          `${String(error)} status=${JSON.stringify(second.bridge.status())} reqs=${JSON.stringify(first.mock.requests.slice(polls).map((r) => r.path))} inbox=${JSON.stringify(second.bridge.state.get().inbox)} seen=${second.bridge.state.get().seenMessageIds.length}`,
        );
      },
    );
    const poll = first.mock.requests
      .slice(polls)
      .find((request) => request.path.endsWith("/getupdates"));
    expect((poll?.body as { get_updates_buf?: string }).get_updates_buf).toBe(
      stored.cursor,
    );
    await second.settle();
    expect(first.mock.sent.length).toBe(before + 1);
  });

  it("re-scans after -14 with the same account and keeps working", async () => {
    const h = await harness();
    const sessionId = await startSession(h);
    h.mock.setStaleToken(true);
    await waitFor(
      () => h.bridge.status().connection === "reauth-required",
      8000,
      "reauth",
    );
    h.mock.setStaleToken(false);
    await h.bridge.startBinding();
    await waitFor(() => h.bridge.status().binding?.phase === "qr");
    h.mock.qr.scan();
    h.mock.qr.confirm({ botToken: "second-token" });
    await waitFor(
      () =>
        h.bridge.status().binding === undefined &&
        h.bridge.status().connection === "online",
      8000,
      "online after re-scan",
    );
    const reply = await h.say(".status");
    expect(reply.length).toBeGreaterThan(0);
    h.finish(sessionId, "Finished after the re-scan.");
    await h.sent((text) => text.includes("Finished after the re-scan."));
  });

  it("answers E-DONE when the desktop decided the approval first", async () => {
    const h = await harness();
    const sessionId = await startSession(h);
    const requestId = h.approval(sessionId, { subject: "npm test" });
    const card = await h.sent((text) => text.includes("npm test"));
    const n = askNumber(card);
    // The desktop window, viewing the WeChat session, decides first.
    h.registry.forgetApproval(requestId);
    h.emit({
      type: "approval-decided",
      sessionId,
      requestId,
      toolCallId: "t",
      verdict: "approved",
      decidedBy: "user",
    });
    const reply = await h.say(`.y ${n}`);
    expect(reply).toBe(render("E-DONE", "en", { ask: n }));
    expect(h.agentHost.respondApproval).not.toHaveBeenCalled();
  });

  it("lets the WeChat answer win and the desktop then sees no pending request", async () => {
    const h = await harness();
    const sessionId = await startSession(h);
    const requestId = h.approval(sessionId, { subject: "npm test" });
    const card = await h.sent((text) => text.includes("npm test"));
    await h.say(`.y ${askNumber(card)}`);
    expect(() =>
      h.registry.respondApproval(WINDOW_ID, { requestId, action: "reject" }),
    ).toThrow(/no longer pending|does not belong/);
    expect(h.agentHost.respondApproval).toHaveBeenCalledTimes(1);
  });

  it("refuses an inbound file declared above 100 MB without downloading it", async () => {
    const h = await harness();
    const item = h.mock.hostMedia("file", Buffer.from("tiny"), "big.bin");
    if (item.file_item) item.file_item.len = String(200 * 1024 * 1024);
    const reply = await h.say("", { item_list: [item] });
    expect(reply).toContain("big.bin");
    expect(
      h.mock.requests.some((request) => request.path.endsWith("/download")),
    ).toBe(false);
  });

  it("executes a stale .mode that tightens the current session (CMD §5.5 guard)", async () => {
    const h = await harness();
    await startSession(h);
    // The session was already current when the offline message was written.
    const writtenAt = Date.now() - 11 * 60_000;
    await h.bridge.state.update((draft) => {
      if (draft.current) draft.current.usedAtMs = writtenAt - 60_000;
    });
    const reply = await h.say(".mode review", { create_time_ms: writtenAt });
    expect(reply).not.toContain("too old");
    expect(reply).toContain("Let Me Review");
  });

  it("expires a held stale batch after ten minutes", async () => {
    const h = await harness();
    const held = await h.say(".new old task", {
      create_time_ms: Date.now() - 11 * 60_000,
    });
    const n = askNumber(held);
    const reply = await h.say(`.d ${n}`);
    expect(reply).toContain(String(n));
    await sleep(10);
    expect(h.agentHost.createSession).not.toHaveBeenCalled();
  });
});
