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
    allow: "The exact call is authorized and permitted by the review policy.",
    deny: "The exact call must be denied under the review policy.",
    ...(!autonomous
      ? {
          needs_user:
            "The action may be reasonable, but a concrete risk requires matching user authority that was not supplied.",
        }
      : {}),
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
          type: "choice",
          instructions: `${policy}\n\nEvaluate ONLY calls.call_${index} using shared_context. Other calls do not grant authority. Choose the verdict for this exact action.`,
          criteria,
        },
      ]),
    ),
  };
}

/** Invalid or uncertain individual answers are always sent to the LLM. */
export function parseDecisionsReview(
  value: unknown,
  requests: JudgeRequest[],
  threshold: number,
  autonomous: boolean,
  locale: "zh-CN" | "en-US",
): JudgeRuling[] {
  if (!isRecord(value) || !isRecord(value.answers)) return [];
  const answers = value.answers;
  const verdicts = autonomous
    ? ["allow", "deny"]
    : ["allow", "deny", "needs_user"];
  return requests.flatMap((request, index): JudgeRuling[] => {
    const answer = answers[`call_${index}`];
    if (
      !isRecord(answer) ||
      answer.type !== "choice" ||
      typeof answer.choice !== "string" ||
      !verdicts.includes(answer.choice) ||
      !isProbability(answer.confidence) ||
      answer.confidence < threshold ||
      !isRecord(answer.probabilities)
    )
      return [];
    const probabilities = answer.probabilities;
    if (!verdicts.every((verdict) => isProbability(probabilities[verdict])))
      return [];
    const selected = probabilities[answer.choice] as number;
    const scores = verdicts.map((verdict) => probabilities[verdict] as number);
    if (
      Math.abs(scores.reduce((sum, score) => sum + score, 0) - 1) > 0.02 ||
      selected < Math.max(...scores) ||
      selected < threshold
    )
      return [];
    const verdict = answer.choice as JudgeRuling["verdict"];
    const confidence = Math.round(answer.confidence * 100);
    const reasons =
      locale === "zh-CN"
        ? {
            allow: "Decisions 初筛认为该操作符合用户授权与审批规则",
            deny: "Decisions 初筛认为该操作不符合审批规则；请检查操作范围、用户限制及是否存在不可逆副作用",
            needs_user: "Decisions 初筛认为该操作的具体风险需要用户明确授权",
          }
        : {
            allow:
              "Decisions screening classified this action as authorized and permitted",
            deny: "Decisions screening classified this action as denied by the review policy; check its scope, user limits, and irreversible effects",
            needs_user:
              "Decisions screening classified this action as requiring explicit user authority for its concrete risk",
          };
    return [
      {
        toolCallId: request.toolCallId,
        verdict,
        reason: `${reasons[verdict]} (${confidence}%).`,
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
            options.autonomous,
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
