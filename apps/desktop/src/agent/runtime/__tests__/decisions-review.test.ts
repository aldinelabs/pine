import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "../../../shared/preferences";
import type { JudgeRequest } from "../../gate";
import {
  buildDecisionsReviewBody,
  parseDecisionsReview,
  runApprovalReview,
} from "../decisions-review";

const requests: JudgeRequest[] = ["id-b", "id-a", "id-c"].map((toolCallId) => ({
  toolCallId,
  toolName: "privileged_shell",
  trigger: "privileged-execution",
  subject: `bun test ${toolCallId}`,
  allowSessionScope: false,
  turn: {
    rootGoal: { id: "user-goal", text: "Run the integration tests." },
    recentUserStatements: [
      { id: "user-limit", text: "Do not publish anything." },
    ],
    recentEvents: [
      { id: "assistant-event", kind: "assistant", summary: "I should test." },
    ],
    grants: [],
  },
}));

function answer(choice: string, confidence: number) {
  return {
    type: "choice",
    choice,
    confidence,
    probabilities: Object.fromEntries(
      ["allow", "deny", "needs_user"].map((verdict) => [
        verdict,
        verdict === choice ? confidence : (1 - confidence) / 2,
      ]),
    ),
  };
}

function setup() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        answers: {
          call_0: answer("allow", 0.98),
          call_1: answer("deny", 0.55),
          call_2: answer("needs_user", 0.96),
        },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const reviewWithModel = vi.fn((pending: JudgeRequest[]) =>
    Promise.resolve(
      pending.map((request) => ({
        toolCallId: request.toolCallId,
        verdict: "deny" as const,
        reason: "LLM decision",
        scope: "once" as const,
      })),
    ),
  );
  return {
    fetchMock,
    options: {
      requests,
      settings: {
        ...DEFAULT_AUTO_APPROVAL_SETTINGS,
        strategy: "decisions" as const,
      },
      autonomous: false,
      locale: "zh-CN" as const,
      sessionId: "session-1",
      signal: new AbortController().signal,
      resolveApiKey: vi.fn().mockResolvedValue("test-key"),
      reviewWithModel,
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Decisions approval cascade", () => {
  it("uses the alpha endpoint and screens only, then merges by the original call IDs", async () => {
    const { fetchMock, options } = setup();
    const rulings = await runApprovalReview(options);
    expect(options.reviewWithModel).toHaveBeenCalledExactlyOnceWith([
      requests[1],
    ]);
    expect(
      rulings.map(({ toolCallId, verdict }) => [toolCallId, verdict]),
    ).toEqual([
      ["id-b", "allow"],
      ["id-a", "deny"],
      ["id-c", "needs_user"],
    ]);
    expect(rulings.every((ruling) => ruling.scope === "once")).toBe(true);
    expect(rulings[0].reason).toContain("Decisions 初筛");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://openrouter.ai/api/alpha/decisions");
    expect(init.headers.Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body);
    expect(body.model).toBe("typesafe/jev-1.13");
    expect(body.session_id).toBe("session-1");
    expect(body.state.shared_context).toContain("Do not publish anything.");
    expect(body.state.calls.call_0).toContain("bun test id-b");
    expect(body.questions.call_0.type).toBe("choice");
    expect(body.questions.call_0.instructions).toContain(
      "untrusted operational evidence",
    );
    expect(body.questions.call_0.instructions).not.toContain(
      "Call submit_ruling",
    );
  });

  it("keeps the existing path without calling Decisions or resolving its credential", async () => {
    const { fetchMock, options } = setup();
    await runApprovalReview({
      ...options,
      settings: { ...DEFAULT_AUTO_APPROVAL_SETTINGS, strategy: "model" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(options.resolveApiKey).not.toHaveBeenCalled();
    expect(options.reviewWithModel).toHaveBeenCalledExactlyOnceWith(requests);
  });

  it("uses the default 66% threshold for individual Decisions answers", async () => {
    const { fetchMock, options } = setup();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          answers: {
            call_0: answer("allow", 0.67),
            call_1: answer("allow", 0.65),
            call_2: answer("deny", 0.8),
          },
        }),
      ),
    );
    await runApprovalReview(options);
    expect(options.reviewWithModel).toHaveBeenCalledExactlyOnceWith([
      requests[1],
    ]);
  });

  it("does not require an LLM when every result clears the threshold", async () => {
    const { options } = setup();
    await runApprovalReview({ ...options, requests: [requests[0]] });
    expect(options.reviewWithModel).not.toHaveBeenCalled();
  });

  it("accepts the exact threshold and requires both confidence and selected probability", () => {
    expect(
      parseDecisionsReview(
        { answers: { call_0: answer("allow", 0.9) } },
        [requests[0]],
        0.9,
        false,
        "en-US",
      ),
    ).toHaveLength(1);
    expect(
      parseDecisionsReview(
        {
          answers: {
            call_0: {
              ...answer("allow", 0.6),
              confidence: 0.99,
            },
          },
        },
        [requests[0]],
        0.9,
        false,
        "en-US",
      ),
    ).toEqual([]);
  });

  it.each([
    undefined,
    null,
    { type: "noul", noul: 0.99 },
    { ...answer("allow", 0.99), confidence: "0.99" },
    { ...answer("allow", 0.99), confidence: NaN },
    { ...answer("allow", 0.99), confidence: 1.01 },
    { ...answer("allow", 0.99), probabilities: { allow: 0.99 } },
    {
      ...answer("allow", 0.99),
      probabilities: { allow: 0.99, deny: 0.99, needs_user: 0 },
    },
    { ...answer("allow", 0.99), choice: "execute" },
  ])("falls back for an invalid individual answer: %j", async (invalid) => {
    const { fetchMock, options } = setup();
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          answers: {
            call_0: invalid,
            call_1: answer("allow", 0.98),
            call_2: answer("deny", 0.98),
          },
        }),
      ),
    );
    await runApprovalReview(options);
    expect(options.reviewWithModel).toHaveBeenCalledExactlyOnceWith([
      requests[0],
    ]);
  });

  it.each([401, 402, 404, 429, 500])(
    "falls back for HTTP %s",
    async (status) => {
      const { fetchMock, options } = setup();
      fetchMock.mockResolvedValue(new Response("unavailable", { status }));
      await runApprovalReview(options);
      expect(options.reviewWithModel).toHaveBeenCalledExactlyOnceWith(requests);
    },
  );

  it("falls back for missing credentials, network failures and malformed JSON", async () => {
    const { fetchMock, options } = setup();
    options.resolveApiKey.mockResolvedValueOnce(undefined);
    await runApprovalReview(options);
    expect(fetchMock).not.toHaveBeenCalled();
    fetchMock.mockRejectedValueOnce(new Error("Network unavailable"));
    await runApprovalReview(options);
    fetchMock.mockResolvedValueOnce(new Response("not json"));
    await runApprovalReview(options);
    expect(options.reviewWithModel).toHaveBeenCalledTimes(3);
  });

  it("uses autonomous policy and never accepts needs_user during autonomous screening", async () => {
    const { fetchMock, options } = setup();
    const body = buildDecisionsReviewBody(requests, "model", true, "session");
    expect(body.questions.call_0.criteria).not.toHaveProperty("needs_user");
    expect(body.questions.call_0.instructions).toContain(
      "Never return needs_user",
    );
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          answers: {
            call_0: answer("needs_user", 0.99),
            call_1: {
              type: "choice",
              choice: "allow",
              confidence: 0.95,
              probabilities: { allow: 0.99, deny: 0.01 },
            },
          },
        }),
      ),
    );
    await runApprovalReview({ ...options, autonomous: true });
    expect(options.reviewWithModel).toHaveBeenCalledExactlyOnceWith([
      requests[0],
      requests[2],
    ]);
  });

  it("falls back on a screening timeout without aborting model review", async () => {
    const { fetchMock, options } = setup();
    const controller = new AbortController();
    controller.abort(new DOMException("Screening timed out", "TimeoutError"));
    const timeout = vi
      .spyOn(AbortSignal, "timeout")
      .mockReturnValue(controller.signal);
    fetchMock.mockImplementation((_, init) => {
      expect(init.signal.aborted).toBe(true);
      return Promise.reject(
        new DOMException("Screening timed out", "TimeoutError"),
      );
    });
    await runApprovalReview(options);
    expect(timeout).toHaveBeenCalledWith(8_000);
    expect(options.signal.aborted).toBe(false);
    expect(options.reviewWithModel).toHaveBeenCalledExactlyOnceWith(requests);
  });

  it("does not fall back after caller cancellation", async () => {
    const { fetchMock, options } = setup();
    const controller = new AbortController();
    fetchMock.mockImplementation(() => {
      controller.abort();
      return Promise.reject(new Error("aborted"));
    });
    await expect(
      runApprovalReview({ ...options, signal: controller.signal }),
    ).rejects.toThrow();
    expect(options.reviewWithModel).not.toHaveBeenCalled();
  });

  it("propagates model failures and incomplete rulings without allowing the pending calls", async () => {
    const { options } = setup();
    options.reviewWithModel.mockRejectedValueOnce(new Error("LLM unavailable"));
    await expect(runApprovalReview(options)).rejects.toThrow("LLM unavailable");
    options.reviewWithModel.mockResolvedValueOnce([]);
    await expect(runApprovalReview(options)).rejects.toThrow(
      "one ruling per tool call",
    );
  });

  it("does no work for an empty batch", async () => {
    const { fetchMock, options } = setup();
    expect(await runApprovalReview({ ...options, requests: [] })).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(options.reviewWithModel).not.toHaveBeenCalled();
  });
});
