import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AUTO_APPROVAL_SETTINGS } from "../../../shared/preferences";
import type { JudgeRequest, JudgeRuling } from "../../gate";
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

function answer(probability: number) {
  return { type: "noul", noul: probability };
}

function setup() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        answers: {
          call_0: answer(0.98),
          call_1: answer(0.05),
          call_2: answer(0.6),
        },
      }),
    ),
  );
  vi.stubGlobal("fetch", fetchMock);
  const reviewWithModel = vi.fn<
    (pending: JudgeRequest[]) => Promise<JudgeRuling[]>
  >((pending) =>
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
      requests[2],
    ]);
    expect(
      rulings.map(({ toolCallId, verdict }) => [toolCallId, verdict]),
    ).toEqual([
      ["id-b", "allow"],
      ["id-a", "deny"],
      ["id-c", "deny"],
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
    expect(body.questions.call_0.type).toBe("noul");
    expect(body.questions.call_0.criteria).toHaveProperty("true");
    expect(body.questions.call_0.criteria).toHaveProperty("false");
    expect(rulings[1].reason).toBe("LLM decision");
    expect(rulings[2].reason).toBe("LLM decision");
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
            call_0: answer(0.67),
            call_1: answer(0.65),
            call_2: answer(0.2),
          },
        }),
      ),
    );
    await runApprovalReview(options);
    expect(options.reviewWithModel).toHaveBeenCalledExactlyOnceWith([
      requests[1],
      requests[2],
    ]);
  });

  it("does not require an LLM when every result clears the threshold", async () => {
    const { options } = setup();
    await runApprovalReview({ ...options, requests: [requests[0]] });
    expect(options.reviewWithModel).not.toHaveBeenCalled();
  });

  it("accepts the exact approval threshold and sends lower probabilities to review", () => {
    expect(
      parseDecisionsReview(
        { answers: { call_0: answer(0.66) } },
        [requests[0]],
        0.66,
        "en-US",
      ),
    ).toHaveLength(1);
    expect(
      parseDecisionsReview(
        { answers: { call_0: answer(0.659) } },
        [requests[0]],
        0.66,
        "en-US",
      ),
    ).toEqual([]);
  });

  it.each(["allow", "deny", "needs_user"] as const)(
    "uses the model's final %s decision and rationale after the classifier rejects",
    async (verdict) => {
      const { fetchMock, options } = setup();
      fetchMock.mockResolvedValue(
        Response.json({ answers: { call_0: answer(0.01) } }),
      );
      const reviewed: JudgeRuling = {
        toolCallId: requests[0].toolCallId,
        verdict,
        reason: "Concrete rationale from the review model",
        scope: "once",
      };
      options.reviewWithModel.mockResolvedValueOnce([reviewed]);
      const rulings = await runApprovalReview({
        ...options,
        requests: [requests[0]],
      });
      expect(options.reviewWithModel).toHaveBeenCalledExactlyOnceWith([
        requests[0],
      ]);
      expect(rulings).toEqual([reviewed]);
    },
  );

  it.each([
    undefined,
    null,
    { type: "choice", choice: "allow", confidence: 0.99 },
    { type: "noul", noul: "0.99" },
    { type: "noul", noul: NaN },
    { type: "noul", noul: 1.01 },
    { type: "noul", noul: -0.01 },
    { type: "noul" },
  ])("falls back for an invalid individual answer: %j", async (invalid) => {
    const { fetchMock, options } = setup();
    fetchMock.mockResolvedValue(
      Response.json({
        answers: {
          call_0: invalid,
          call_1: answer(0.98),
          call_2: answer(0.98),
        },
      }),
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

  it("uses autonomous policy while sending all non-approved calls to model review", async () => {
    const { fetchMock, options } = setup();
    const body = buildDecisionsReviewBody(requests, "model", true, "session");
    expect(body.questions.call_0.type).toBe("noul");
    expect(body.questions.call_0.criteria.false).not.toContain(
      "additional user authority",
    );
    expect(body.questions.call_0.instructions).toContain(
      "Never return needs_user",
    );
    fetchMock.mockResolvedValue(
      Response.json({
        answers: {
          call_0: answer(0.01),
          call_1: answer(0.95),
        },
      }),
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
