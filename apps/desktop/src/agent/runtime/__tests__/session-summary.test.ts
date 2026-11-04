import { describe, expect, it, vi } from "vitest";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { normalizeContext } from "@earendil-works/pi-ai";
import {
  SESSION_SUMMARY_OUTPUT_BUFFER_TOKENS,
  SUBMIT_SESSION_SUMMARY_TOOL_NAME,
  createSessionSummaryCompactionExtension,
  createSubmitSessionSummaryToolDefinition,
  extractSessionSummary,
  requestSessionSummary,
} from "../session-summary";

const usage = { input: 10, output: 5, cacheRead: 100, cacheWrite: 0 };

function assistant(content: unknown[], stopReason = "toolUse") {
  return { role: "assistant", content, stopReason, usage, timestamp: 2 };
}

const history = [
  { role: "user", content: [{ type: "text", text: "hello" }], timestamp: 1 },
  assistant([{ type: "text", text: "hi" }], "stop"),
];

function fakeSession(options: {
  api?: string;
  response?: unknown;
  stream?: ReturnType<typeof vi.fn>;
}) {
  const stream =
    options.stream ??
    vi.fn(() =>
      Promise.resolve({
        result: () =>
          Promise.resolve(
            options.response ??
              assistant([
                {
                  type: "toolCall",
                  id: "1",
                  name: SUBMIT_SESSION_SUMMARY_TOOL_NAME,
                  arguments: { summary: "  ## Goal\nship it  " },
                },
              ]),
          ),
      }),
    );
  const transformContext = vi.fn((messages: unknown[]) =>
    Promise.resolve(messages),
  );
  const convertToLlm = vi.fn((messages: unknown[]) => messages);
  const session = {
    model: { contextWindow: 200_000 },
    agent: {
      state: {
        model: { api: options.api ?? "anthropic-messages", provider: "p" },
        thinkingLevel: "high",
      },
      transformContext,
      convertToLlm,
      getApiKey: () => "key",
      streamFunction: stream,
      sessionId: "session-1",
      transport: "sse",
      thinkingBudgets: { high: 1000 },
      maxRetryDelayMs: 5000,
      onPayload: undefined,
    },
    sessionManager: {
      buildSessionProjection: () => ({ messages: history }),
    },
  };
  return { session: session as unknown as AgentSession, stream, convertToLlm };
}

describe("extractSessionSummary", () => {
  it("reads the submitted summary", () => {
    expect(
      extractSessionSummary({
        content: [
          {
            type: "toolCall",
            id: "1",
            name: SUBMIT_SESSION_SUMMARY_TOOL_NAME,
            arguments: { summary: " done " },
          },
        ],
      } as never),
    ).toBe("done");
  });

  it("falls back to the text reply when the tool was skipped", () => {
    expect(
      extractSessionSummary({
        content: [{ type: "text", text: "  plain summary " }],
      } as never),
    ).toBe("plain summary");
  });

  it("returns nothing for an empty reply", () => {
    expect(extractSessionSummary({ content: [] })).toBeUndefined();
  });
});

describe("submit_session_summary tool", () => {
  it("rejects calls outside a compaction", async () => {
    const tool = createSubmitSessionSummaryToolDefinition();
    expect(tool.name).toBe(SUBMIT_SESSION_SUMMARY_TOOL_NAME);
    await expect(
      (tool.execute as unknown as () => Promise<unknown>)(),
    ).rejects.toThrow(/No summary was requested/);
  });
});

describe("requestSessionSummary", () => {
  it("sends the conversation's own messages with one request appended", async () => {
    const { session, stream, convertToLlm } = fakeSession({});
    const result = await requestSessionSummary(
      session,
      new AbortController().signal,
    );
    expect(result?.summary).toBe("## Goal\nship it");

    // The main request's pipeline over the same projection.
    const main = normalizeContext({
      messages: convertToLlm(history) as never,
    });
    const [, context, options] = stream.mock.calls[0] as [
      unknown,
      { messages: unknown[] },
      Record<string, unknown>,
    ];
    expect(context.messages.slice(0, -1)).toEqual(main.messages);
    expect(context.messages).toHaveLength(main.messages.length + 1);
    const last = context.messages.at(-1) as { role: string };
    expect(last.role).toBe("user");

    // Routing and reasoning match the conversation's own requests.
    expect(options).toMatchObject({
      apiKey: "key",
      sessionId: "session-1",
      transport: "sse",
      reasoning: "high",
      maxRetryDelayMs: 5000,
    });
  });

  it("does not ask a virtual model", async () => {
    const { session, stream } = fakeSession({ api: "pi-virtual" });
    expect(
      await requestSessionSummary(session, new AbortController().signal),
    ).toBeUndefined();
    expect(stream).not.toHaveBeenCalled();
  });

  it("discards a reply that was cut off", async () => {
    const { session } = fakeSession({
      response: assistant([{ type: "text", text: "partial" }], "length"),
    });
    expect(
      await requestSessionSummary(session, new AbortController().signal),
    ).toBeUndefined();
  });
});

describe("session summary compaction extension", () => {
  async function setup(enabled = true, session?: AgentSession) {
    let handler: ((event: unknown) => unknown) | undefined;
    const extension = createSessionSummaryCompactionExtension({
      getSession: () => session ?? fakeSession({}).session,
      isEnabled: () => enabled,
    });
    await extension.factory({
      on: (name: string, fn: (event: unknown) => unknown) => {
        if (name === "session_before_compact") handler = fn;
      },
    } as never);
    return handler!;
  }
  const event = (overrides: Record<string, unknown> = {}) => ({
    reason: "threshold",
    signal: new AbortController().signal,
    preparation: { tokensBefore: 150_000, firstKeptEntryId: "entry-9" },
    ...overrides,
  });

  it("returns the summary with pi's cut point", async () => {
    const result = await (await setup())(event());
    expect(result).toEqual({
      compaction: {
        summary: "## Goal\nship it",
        firstKeptEntryId: "entry-9",
        tokensBefore: 150_000,
        usage,
      },
    });
  });

  it("leaves other routes and overflow recovery to pi", async () => {
    expect(await (await setup(false))(event())).toBeUndefined();
    expect(
      await (
        await setup()
      )(event({ reason: "overflow" })),
    ).toBeUndefined();
  });

  it("leaves a context with no room for the reply to pi", async () => {
    const tooLong = 200_000 - SESSION_SUMMARY_OUTPUT_BUFFER_TOKENS + 1;
    expect(
      await (
        await setup()
      )(
        event({
          preparation: { tokensBefore: tooLong, firstKeptEntryId: "e" },
        }),
      ),
    ).toBeUndefined();
  });

  it("falls back to pi when the request fails", async () => {
    const stream = vi.fn(() => Promise.reject(new Error("boom")));
    const { session } = fakeSession({ stream });
    expect(await (await setup(true, session))(event())).toBeUndefined();
  });
});
