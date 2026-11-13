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
});
