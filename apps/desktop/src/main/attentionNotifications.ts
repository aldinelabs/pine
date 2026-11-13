import type { AskUserQuestionParams } from "@pine/rpiv-ask-user-question";
import removeMarkdown from "remove-markdown";
import type { PineJsonValue } from "../shared/agent";

/** Argument names whose value says at a glance what a tool call touches. */
const APPROVAL_SUBJECT_KEYS = ["command", "path", "file_path", "url"] as const;

function approvalSubject(input: PineJsonValue | undefined): string | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input))
    return undefined;
  for (const key of APPROVAL_SUBJECT_KEYS) {
    const value = input[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

export function approvalNotificationBody(
  toolName: string,
  input: PineJsonValue | undefined,
  chinese: boolean,
  summary?: string,
): string {
  // The reviewer's plain-language account says more than the raw subject.
  const explained = summary?.trim();
  if (explained)
    return chinese
      ? `Pine 请求批准：${explained}`
      : `Pine wants approval: ${explained}`;
  const subject = approvalSubject(input);
  if (chinese)
    return subject
      ? `Pine 请求批准运行 ${toolName}：${subject}`
      : `Pine 请求批准运行 ${toolName}。`;
  return subject
    ? `Pine wants approval to run ${toolName}: ${subject}`
    : `Pine wants approval to run ${toolName}.`;
}

export function questionnaireNotificationBody(
  questionnaire: AskUserQuestionParams,
  chinese: boolean,
): string {
  const question = questionnaire.questions[0]?.question.trim();
  if (chinese)
    return question
      ? `Pine 需要你回答：${question}`
      : "Pine 需要询问你一些问题。";
  return question
    ? `Pine needs your answer: ${question}`
    : "Pine needs to ask you a few questions.";
}

/** Notification button labels, in the order their action indexes arrive. */
export function approvalNotificationActions(chinese: boolean): string[] {
  return chinese ? ["批准", "拒绝"] : ["Approve", "Deny"];
}

/**
 * A reply's text as a notification body: the model writes Markdown, which a
 * notification would show as literal `**`, `#` and backticks.
 */
export function replyNotificationBody(markdown: string): string {
  return removeMarkdown(markdown, { useImgAltText: true, gfm: true })
    .replaceAll(/\s+/g, " ")
    .trim();
}
