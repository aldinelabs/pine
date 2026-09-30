import type { PineAutoApprovalSettings } from "../../shared/preferences";
import type { JudgeRequest, JudgeRuling } from "../gate";
import {
  AUTONOMOUS_JUDGE_SYSTEM_PROMPT,
  JUDGE_SYSTEM_PROMPT,
  buildJudgeEvidence,
  buildJudgeSharedContext,
  parseJudgeRulings,
} from "./review";

const DECISIONS_ENDPOINT = "https://openrouter.ai/api/alpha/decisions";
const SCREENING_TIMEOUT_MS = 8_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isProbability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

export function buildDecisionsReviewBody(
  requests: JudgeRequest[],
  model: string,
  autonomous: boolean,
  sessionId: string,
) {
  // Share the reviewer policy, excluding instructions for the LLM's output tool.
  const policy = (
    autonomous ? AUTONOMOUS_JUDGE_SYSTEM_PROMPT : JUDGE_SYSTEM_PROMPT
  ).split("\n\nCall submit_ruling")[0];
  const criteria = {
    true: "The exact call is authorized and permitted to run without additional human approval under the review policy.",
    false: autonomous
      ? "The exact call must be denied under the review policy."
      : "The exact call must be denied or requires additional user authority under the review policy.",
  };
  return {
    model,
    session_id: sessionId,
    state: {
      shared_context: buildJudgeSharedContext(requests[0].turn),
      calls: Object.fromEntries(
        requests.map((request, index) => [
          `call_${index}`,
          buildJudgeEvidence(request),
        ]),
      ),
    },
    questions: Object.fromEntries(
      requests.map((_, index) => [
        `call_${index}`,
        {
          type: "noul",
          instructions: `${policy}\n\nEvaluate ONLY calls.call_${index} using shared_context. Other calls do not grant authority. Is this exact action authorized and permitted to run without additional human approval under the review policy?`,
          criteria,
        },
      ]),
    ),
  };
}

/** Only confident approval takes the fast path; all other calls need model review. */
export function parseDecisionsReview(
  value: unknown,
  requests: JudgeRequest[],
  threshold: number,
  locale: "zh-CN" | "en-US",
): JudgeRuling[] {
  if (!isRecord(value) || !isRecord(value.answers)) return [];
  const answers = value.answers;
  return requests.flatMap((request, index): JudgeRuling[] => {
    const answer = answers[`call_${index}`];
    if (
      !isRecord(answer) ||
      answer.type !== "noul" ||
      !isProbability(answer.noul) ||
      answer.noul < threshold
    )
      return [];
    const probability = Math.round(answer.noul * 100);
    const reason =
      locale === "zh-CN"
        ? `Decisions 初筛认为该操作符合用户授权与审批规则（批准概率 ${probability}%）。`
        : `Decisions screening classified this action as authorized and permitted (approval probability ${probability}%).`;
    return [
      {
        toolCallId: request.toolCallId,
        verdict: "allow",
        reason,
        scope: "once",
      },
    ];
  });
}

export async function runApprovalReview(options: {
  requests: JudgeRequest[];
  settings: PineAutoApprovalSettings;
  autonomous: boolean;
  locale: "zh-CN" | "en-US";
  sessionId: string;
  signal: AbortSignal;
  resolveApiKey: () => Promise<string | undefined>;
  reviewWithModel: (requests: JudgeRequest[]) => Promise<JudgeRuling[]>;
}): Promise<JudgeRuling[]> {
  const { requests, settings, signal } = options;
  if (requests.length === 0) return [];
  signal.throwIfAborted();
  let screened: JudgeRuling[] = [];
  if (settings.strategy === "decisions") {
    try {
      const apiKey = (await options.resolveApiKey())?.trim();
      signal.throwIfAborted();
      if (apiKey) {
        const response = await fetch(DECISIONS_ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            buildDecisionsReviewBody(
              requests,
              settings.decisionsModel,
              options.autonomous,
              options.sessionId,
            ),
          ),
          signal: AbortSignal.any([
            signal,
            AbortSignal.timeout(SCREENING_TIMEOUT_MS),
          ]),
        });
        if (response.ok) {
          screened = parseDecisionsReview(
            await response.json(),
            requests,
            settings.confidenceThreshold,
            options.locale,
          );
        } else {
          await response.body?.cancel();
        }
      }
    } catch {
      // Missing access, unavailable alpha API, timeouts, and malformed JSON all
      // fall back to the established reviewer. Caller cancellation never does.
      signal.throwIfAborted();
    }
  }
  signal.throwIfAborted();
  const rulings = new Map(
    screened.map((ruling) => [ruling.toolCallId, ruling]),
  );
  const pending = requests.filter(
    (request) => !rulings.has(request.toolCallId),
  );
  if (pending.length > 0) {
    const reviewed = parseJudgeRulings(
      { rulings: await options.reviewWithModel(pending) },
      pending.map((request) => request.toolCallId),
    );
    for (const ruling of reviewed) rulings.set(ruling.toolCallId, ruling);
  }
  signal.throwIfAborted();
  return requests.map((request) => rulings.get(request.toolCallId)!);
}
