// @vitest-environment node
// Interactive answers through the real bridge: a reply's numbered choices
// and a bare number that answers one.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LoadSessionMessagesResult } from "../../../shared/sessions";
import { ProjectRuntimeRegistry } from "../../projectRuntime";
import { type Harness, createHarness } from "./e2eHarness";

const harnesses: Harness[] = [];
/** Each session's transcript; the harness writes no session files. */
const transcripts = new Map<string, string[]>();

let loadMessages: ReturnType<typeof spyLoadMessages>;

function spyLoadMessages() {
  return vi
    .spyOn(ProjectRuntimeRegistry.prototype, "loadMessages")
    .mockImplementation(
      (_window, _project, sessionId): Promise<LoadSessionMessagesResult> =>
        Promise.resolve({
          hasMore: false,
          messages: (transcripts.get(sessionId) ?? []).map((text, index) => ({
            createdAt: "2026-11-12T08:00:00.000Z",
            id: `m${index}`,
            role: "assistant",
            blocks: [{ type: "text", text }],
          })),
        }),
    );
}

beforeEach(() => {
  loadMessages = spyLoadMessages();
});

afterEach(async () => {
  vi.restoreAllMocks();
  transcripts.clear();
  await Promise.all(harnesses.splice(0).map((harness) => harness.close()));
});

/** The agent finishes its run with `text` as its final reply. */
function finish(h: Harness, sessionId: string, text: string): void {
  transcripts.set(sessionId, [...(transcripts.get(sessionId) ?? []), text]);
  h.finish(sessionId, text);
}

async function started(): Promise<{ h: Harness; sessionId: string }> {
  const h = await createHarness();
  harnesses.push(h);
  const reply = await h.say(".new plan the trip");
  expect(reply).toContain("**Garden** · Started");
  const sessionId = h.createdSession(
    h.agentHost.createSession.mock.calls.length - 1,
  );
  h.running(sessionId);
  return { h, sessionId };
}

/** Sends plain text that gets no reply, and waits until it is handled. */
async function tell(h: Harness, text: string): Promise<void> {
  h.push(text);
  await h.settle();
}

/** The text of the agent host's latest prompt. */
function lastPrompt(h: Harness): unknown {
  return (h.agentHost.prompt.mock.calls.at(-1) as unknown[] | undefined)?.[1];
}

const BUTTONS = [
  "Which one?",
  "```openui",
  "root = Stack([yes, no])",
  'yes = Button("Yes", @ToAssistant("Yes, book it"))',
  'no = Button("No")',
  "```",
].join("\n");

const PICKER = [
  "```openui",
  'root = Card([size, go], "Size")',
  '$size = "M"',
  'size = Select($size, ["S", "M", "L"])',
  'go = Button("Continue", @ToAssistant("Use this size"))',
  "```",
].join("\n");

describe("WeChat interactive answers", { timeout: 30_000 }, () => {
  it("numbers the buttons and sends a button's message for its number", async () => {
    const { h, sessionId } = await started();
    finish(h, sessionId, BUTTONS);
    const done = await h.sent((text) => text.includes("Which one?"));
    expect(done).toContain("- **1** Yes\n- **2** No");
    expect(done).toContain("(Reply with a number to choose.)");

    const prompts = h.agentHost.prompt.mock.calls.length;
    const reply = await h.say("1");
    expect(reply).toContain("Chose **Yes**");
    expect(h.agentHost.prompt.mock.calls).toHaveLength(prompts + 1);
    expect(lastPrompt(h)).toBe("Yes, book it");

    // Once the answer starts a run, a number is plain text again.
    h.running(sessionId);
    await h.say("1");
    expect(lastPrompt(h)).toBe("1");
  });

  it("sends a button without an action as its label, full-width digits too", async () => {
    const { h, sessionId } = await started();
    finish(h, sessionId, BUTTONS);
    await h.sent((text) => text.includes("Which one?"));
    await h.say("２");
    expect(lastPrompt(h)).toBe("No");
  });

  it("numbers a single picker's options and sends them through its button", async () => {
    const { h, sessionId } = await started();
    finish(h, sessionId, PICKER);
    const done = await h.sent((text) => text.includes("**Size**"));
    expect(done).toContain("- **1** S\n- **2** M\n- **3** L");
    expect(done).not.toContain("Continue");
    const reply = await h.say("3");
    expect(reply).toContain("Chose **L**");
    expect(lastPrompt(h)).toBe("Use this size\n\n(size: L)");
  });

  it("drops the choices when a new run starts", async () => {
    const { h, sessionId } = await started();
    finish(h, sessionId, BUTTONS);
    await h.sent((text) => text.includes("Which one?"));
    // A run started elsewhere (the Pine window) makes the numbers stale.
    h.running(sessionId);
    const reply = await h.say("1");
    expect(reply).toContain("Passed to the running task.");
    expect(lastPrompt(h)).toBe("1");
  });

  it("sends other numbers and text as typed", async () => {
    const { h, sessionId } = await started();
    finish(h, sessionId, BUTTONS);
    await h.sent((text) => text.includes("Which one?"));
    await tell(h, "7");
    expect(lastPrompt(h)).toBe("7");
    await tell(h, "the first one");
    expect(lastPrompt(h)).toBe("the first one");
  });

  it("numbers .r like the done push, unless an earlier message of the turn has choices", async () => {
    const { h, sessionId } = await started();
    finish(h, sessionId, BUTTONS);
    await h.sent((text) => text.includes("Which one?"));
    expect(await h.say(".r")).toContain("- **1** Yes\n- **2** No");

    transcripts.set(sessionId, [PICKER, BUTTONS]);
    const last = await h.say(".r");
    expect(last).toContain("- Yes\n- No");
    expect(last).not.toContain("**1**");
    // The number still answers the final message, as the done push showed.
    await h.say("2");
    expect(lastPrompt(h)).toBe("No");
  });

  it("sends the number as typed when the transcript cannot be read", async () => {
    const { h, sessionId } = await started();
    finish(h, sessionId, BUTTONS);
    await h.sent((text) => text.includes("Which one?"));
    loadMessages.mockRejectedValue(new Error("gone"));
    await tell(h, "1");
    expect(lastPrompt(h)).toBe("1");
  });
});
