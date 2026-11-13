// Which approval cards WeChat may approve, and the text a card shows.
//
// Approval cards work from WeChat the way they work on the computer: a card
// of any tool and any trigger is approvable with its short code. The only
// exceptions are high-risk triggers without the local switch, automation
// approvals (local only on every remote surface) and view-only sessions.

import {
  UI_SESSION_DELETE_TOOL_NAME,
  UI_SESSION_NEW_TOOL_NAME,
  type PineApprovalMode,
  type PineApprovalTrigger,
  type PineJsonValue,
} from "../../shared/agent";
import type { WeChatSettings } from "../../shared/wechatRemote";
import {
  CARD_DESCRIPTION_MAX,
  CARD_RISK_MAX,
  CARD_RISKS_MAX,
  CARD_SUBJECT_MAX,
  CARD_SUMMARY_MAX,
  SHOW_INPUT_MAX,
} from "./constants";
import { neutraliseText } from "./text";
import type { ApprovalAsk } from "./types";

/**
 * Tools whose results bring content from outside the computer into a
 * session (`TINYFISH_TOOL_NAMES` of `agent/tinyfishTools.ts`; copied because
 * main does not load agent tool modules, and a test keeps the two equal).
 * MCP tools count too, but their names are not fixed; the session directory
 * recognises them separately.
 */
export const EXTERNAL_CONTENT_TOOLS: ReadonlySet<string> = new Set([
  "web_search",
  "web_fetch",
]);

/** Triggers that need "Allow approving high-risk actions from WeChat". */
export const HIGH_RISK_TRIGGERS: ReadonlySet<PineApprovalTrigger> = new Set([
  "privileged-execution",
  "destructive-pattern",
]);

export type CardVerdict =
  | { kind: "approvable"; needsShow: boolean; highRisk: boolean }
  | { kind: "display-only"; reason: "view-only" | "high-risk" | "automation" }
  | { kind: "long-context" };

/** Automation create / change / enable approvals: never approvable from WeChat. */
export const AUTOMATION_APPROVAL_VERDICT: CardVerdict = {
  kind: "display-only",
  reason: "automation",
};

export interface CardPolicyContext {
  settings: Pick<WeChatSettings, "allowHighRiskApprovals">;
  /** `modeFor(sessionId)` of the asking session. */
  mode: PineApprovalMode | "view-only";
}

/** First matching row wins. */
export function approvalCardPolicy(
  ask: Pick<
    ApprovalAsk,
    "trigger" | "toolName" | "input" | "evidence" | "subjectCut"
  >,
  context: CardPolicyContext,
): CardVerdict {
  if (context.mode === "view-only") {
    return { kind: "display-only", reason: "view-only" };
  }
  if (ask.trigger === "long-context-activation")
    return { kind: "long-context" };
  const highRisk = HIGH_RISK_TRIGGERS.has(ask.trigger);
  if (highRisk && !context.settings.allowHighRiskApprovals) {
    return { kind: "display-only", reason: "high-risk" };
  }
  const needsShow = ask.subjectCut || approvalCardText(ask).subjectCut;
  return { kind: "approvable", needsShow, highRisk };
}

export interface ApprovalCardText {
  /** The card's subject line, cut to CARD_SUBJECT_MAX code points. */
  subject?: string;
  /** The whole subject, for `.show` (which pages it). */
  fullSubject?: string;
  /** Cut to CARD_DESCRIPTION_MAX code points. */
  description?: string;
  /** The reviewer's summary, cut to CARD_SUMMARY_MAX code points. */
  summary?: string;
  /** The reviewer's first risks for `.show`, each cut to CARD_RISK_MAX. */
  risks?: string[];
  /** The card cannot show the whole subject: `.show` before `.approve`. */
  subjectCut: boolean;
  /** Longer than `.show` shows on one page. */
  tooLong: boolean;
}

const SUBJECT_FALLBACK_KEYS = ["command", "path", "file_path", "url"] as const;

/** Subject, optional description, and whether the subject was cut; from `input.subject` first. */
export function approvalCardText(
  ask: Pick<ApprovalAsk, "toolName" | "input" | "evidence" | "explanation">,
): ApprovalCardText {
  const input = objectOf(ask.input);
  let subject = nonEmptyString(input?.subject);
  for (const key of SUBJECT_FALLBACK_KEYS) {
    if (subject !== undefined) break;
    subject = nonEmptyString(input?.[key]);
  }
  if (
    subject === undefined &&
    (ask.toolName === UI_SESSION_NEW_TOOL_NAME ||
      ask.toolName === UI_SESSION_DELETE_TOOL_NAME)
  ) {
    subject = nonEmptyString(ask.evidence);
  }
  const description = nonEmptyString(input?.description);
  const summary = nonEmptyString(ask.explanation?.summary);
  const risks = (ask.explanation?.risks ?? [])
    .map((risk) => risk.trim())
    .filter(Boolean)
    .slice(0, CARD_RISKS_MAX)
    .map((risk) => cutCodePoints(risk, CARD_RISK_MAX));
  // Measured on the text the card shows (`subjectLines` of replies.ts), which
  // marks dot-led lines and so can be longer than the raw subject.
  const length =
    subject === undefined ? 0 : codePointLength(neutraliseText(subject));
  return {
    ...(subject !== undefined
      ? {
          subject: cutCodePoints(subject, CARD_SUBJECT_MAX),
          fullSubject: subject,
        }
      : {}),
    ...(description !== undefined
      ? { description: cutCodePoints(description, CARD_DESCRIPTION_MAX) }
      : {}),
    ...(summary !== undefined
      ? { summary: cutCodePoints(summary, CARD_SUMMARY_MAX) }
      : {}),
    ...(risks.length > 0 ? { risks } : {}),
    subjectCut: length > CARD_SUBJECT_MAX,
    tooLong: length > SHOW_INPUT_MAX,
  };
}

function objectOf(
  value: PineJsonValue | undefined,
): { [key: string]: PineJsonValue | undefined } | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }
  return value;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function codePointLength(text: string): number {
  return Array.from(text).length;
}

/** Keeps at most `max` code points, the last one an ellipsis when cut. */
function cutCodePoints(text: string, max: number): string {
  const points = Array.from(text);
  if (points.length <= max) return text;
  return `${points.slice(0, Math.max(0, max - 1)).join("")}…`;
}
