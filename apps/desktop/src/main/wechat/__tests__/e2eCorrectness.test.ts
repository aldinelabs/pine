// @vitest-environment node
// Correctness probes (review round 2) against the mock iLink server.
import { afterEach, describe, expect, it } from "vitest";
import { type Harness, createHarness, sleep, waitFor } from "./e2eHarness";

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

describe("WeChat correctness probes", { timeout: 30_000 }, () => {
  it("cancels the typing indicator once the run a silent message started has ended", async () => {
    const h = await harness();
    const reply = await h.say(".new fix the bug");
    expect(reply).toContain("Started in Garden");
    const sessionId = h.createdSession(0);
    h.running(sessionId);
    h.finish(sessionId, "First run done.");
    await h.sent((text) => text.includes("First run done."));

    // A follow-up to the idle current session is forwarded silently (typing on).
    h.push("and add a test");
    await waitFor(() => h.mock.typing.some((entry) => entry.status === 1));
    h.running(sessionId);
    h.finish(sessionId, "Second run done.");
    await h.sent((text) => text.includes("Second run done."));
    await sleep(300);
    // Typing is cancelled (status 2) once the agent is done.
    expect(h.mock.typing.at(-1)?.status).toBe(2);
  });

  it("does not run a message again when iLink re-delivers it after a re-scan", async () => {
    const h = await harness();
    const first = h.push(".new fix the bug");
    await h.sent((text) => text.includes("Started in Garden"));
    await h.settle();
    expect(h.agentHost.createSession).toHaveBeenCalledTimes(1);

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

    // The new token's first poll starts from an empty cursor; the server may
    // hand back what it already delivered. The message id is the dedupe key.
    h.mock.pushUserMessage({
      ...first,
      create_time_ms: Date.now(),
    });
    await h.settle();
    await sleep(300);
    expect(h.agentHost.createSession).toHaveBeenCalledTimes(1);
  });
});
