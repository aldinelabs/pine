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
          instructions: `${policy}\n\nEvaluate ONLY calls.call_${index} using shared_context. Other calls do not grant authority. Choose the verdict for this exact action from the supplied criteria.`,
          criteria,
        },
      ]),
    ),
  };
}

/** Apply allow/needs_user directly; denial and malformed answers need model review. */
export function parseDecisionsReview(
  value: unknown,
  requests: JudgeRequest[],
  autonomous: boolean,
  locale: "zh-CN" | "en-US",
): JudgeRuling[] {
  if (!isRecord(value) || !isRecord(value.answers)) return [];
  const answers = value.answers;
  return requests.flatMap((request, index): JudgeRuling[] => {
    const answer = answers[`call_${index}`];
    if (
      !isRecord(answer) ||
      answer.type !== "choice" ||
      (answer.choice !== "allow" &&
        (answer.choice !== "needs_user" || autonomous))
    )
      return [];
    const verdict = answer.choice;
    const reason =
      locale === "zh-CN"
        ? verdict === "allow"
          ? "Decisions 初筛认为该操作符合用户授权与审批规则。"
          : "Decisions 初筛建议由你确认此操作的授权与风险。"
        : verdict === "allow"
          ? "Decisions screening classified this action as authorized and permitted."
          : "Decisions screening requests your confirmation of this action's authority and risks.";
    return [{ toolCallId: request.toolCallId, verdict, reason, scope: "once" }];
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
