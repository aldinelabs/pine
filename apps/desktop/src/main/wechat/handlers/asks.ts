// Handlers: pending show approve reject guide answer.
//
// Every response to an ask is re-checked here right before it is sent to the
// runtime: the ask is still open and unchanged, the session is not view-only,
// the card policy allows it, and a cut subject was read with `.show` first.
// Responses go out as `responder(session)`; requests are validated with the
// same schemas the router uses.

import {
  resolveAskUserQuestionSubmission,
  type AskUserQuestionParams,
} from "@pine/rpiv-ask-user-question";
import {
  RespondApprovalRequestSchema,
  RespondQuestionnaireRequestSchema,
} from "../../core/requestSchemas";
import { bareApproveAllowed } from "../asks";
import { approvalCardText } from "../cardPolicy";
import { specOf } from "../commandSpec";
import {
  ASK_SKEW_MS,
  FUTURE_SKEW_MS,
  SHOW_INPUT_MAX,
  STALE_MS,
} from "../constants";
import { classify } from "../inbound";
import { notice } from "../notices";
import { parseAnswers, splitAskPrefix } from "../parseCommand";
import {
  answerExample,
  joinReplies,
  render,
  type AskSummary,
  type ReplyData,
  type SessionRef,
} from "../replies";
import { neutraliseText, paginate } from "../text";
import type {
  ApprovalAsk,
  Ask,
  ConfirmAsk,
  HeldAsk,
  ParsedCommand,
  QuestionAsk,
} from "../types";
import type { CommandContext, CommandHandlers, CommandResult } from "./types";

const APPROVAL_GONE = "This approval request is no longer pending.";
const QUESTION_GONE = "This questionnaire is no longer pending.";

// ---------------------------------------------------------------------------
// Shared pieces

/** Missing, zero, non-finite, too old or too far ahead. */
function isStale(ctx: CommandContext): boolean {
  const created = ctx.inbound.createdAtMs;
  if (!Number.isFinite(created) || created <= 0) return true;
  if (created > ctx.now + FUTURE_SKEW_MS) return true;
  return ctx.now - created > STALE_MS;
}

function notRun(ctx: CommandContext, typed: string): CommandResult {
  return {
    text: render("T-STALE", ctx.lang, {
      held: [],
      notRun: [typed],
      oldestAgeMs: Math.max(0, ctx.now - ctx.inbound.createdAtMs),
    }),
  };
}

function reply(text: string): CommandResult {
  return { text };
}

function titleOf(ctx: CommandContext, sessionId: string): string | undefined {
  const live = ctx.core.runtimes.summaryOfLiveSession(sessionId);
  return live?.name ?? live?.preview ?? undefined;
}

function summarise(ctx: CommandContext, ask: Ask): AskSummary {
  const summary: AskSummary = { number: ask.number, kind: ask.kind };
  if (ask.kind === "approval") summary.tool = ask.toolName;
  if (ask.kind === "approval" || ask.kind === "question") {
    const title = titleOf(ctx, ask.sessionId);
    if (title) summary.title = title;
  }
  return summary;
}

async function sessionRef(
  ctx: CommandContext,
  sessionId: string,
  projectId: string,
): Promise<SessionRef> {
  try {
    const view = await ctx.sessions.view(sessionId, projectId);
    return { project: view.project, title: view.title };
  } catch {
    return { project: "", title: titleOf(ctx, sessionId) ?? "" };
  }
}

/** `E-VIEWRUN` for an automation run, else `E-VIEW` with the way out. */
async function viewRefusal(
  ctx: CommandContext,
  sessionId: string,
  projectId: string,
): Promise<CommandResult> {
  const at = await sessionRef(ctx, sessionId, projectId);
  const reason = await ctx.sessions.viewOnlyReason(sessionId, projectId);
  if (reason === "automation-run")
    return reply(render("E-VIEWRUN", ctx.lang, { title: at.title }));
  return reply(
    render("E-VIEW", ctx.lang, {
      title: at.title,
      mode: await ctx.sessions.sessionMode(sessionId, projectId),
      ceiling: ctx.settings.ceilingMode,
    }),
  );
}

function argsError(
  ctx: CommandContext,
  name: ParsedCommand["name"],
  hint?: string,
): CommandResult {
  return reply(
    render("E-ARGS", ctx.lang, {
      spec: specOf(name),
      ...(hint !== undefined ? { hint } : {}),
    }),
  );
}

function pick(ctx: CommandContext, zh: string, en: string): string {
  return ctx.lang === "zh" ? zh : en;
}

function nothingWaiting(ctx: CommandContext): CommandResult {
  return reply(
    render("R-PENDING", ctx.lang, { asks: [], automationApprovals: 0 }),
  );
}

/** `E-CODE` / `E-DONE` for a number that is not open; undefined when it is. */
function closedReply(
  ctx: CommandContext,
  n: number,
): CommandResult | undefined {
  const status = ctx.asks.status(n);
  if (status === "open") return undefined;
  if (status === "tombstone")
    return reply(render("E-DONE", ctx.lang, { ask: n }));
  return reply(render("E-CODE", ctx.lang, { ask: n }));
}

function askNumber(arg: string | undefined): number | undefined | "bad" {
  if (arg === undefined || arg === "") return undefined;
  const digits = arg.normalize("NFKC");
  return /^\d+$/.test(digits) ? Number(digits) : "bad";
}

/** The ask was answered from WeChat: tombstone it and drop its pushed card. */
function closeUsed(ctx: CommandContext, ask: Ask): void {
  ctx.asks.close(ask.number, "used");
  ctx.outbound.retract(`ask:${ask.number}`);
}

function closeDecided(ctx: CommandContext, ask: Ask): void {
  ctx.asks.close(ask.number, "decided");
  ctx.outbound.retract(`ask:${ask.number}`);
}

function isGone(error: unknown, message: string): boolean {
  return error instanceof Error && error.message === message;
}

/**
 * Sends an approval response as `responder(session)`. Losing the race against
 * another surface (the request was decided there) is `E-DONE`.
 */
async function respondApproval(
  ctx: CommandContext,
  ask: ApprovalAsk,
  action: "approve" | "reject" | "guide" | "compact" | "abort",
  guidance?: string,
): Promise<CommandResult | undefined> {
  const request = RespondApprovalRequestSchema.parse({
    requestId: ask.requestId,
    action,
    ...(guidance !== undefined ? { guidance } : {}),
  });
  const responder = ctx.sessions.responder(ask.sessionId, ask.projectId);
  try {
    await Promise.resolve(
      ctx.core.runtimes.respondApproval(responder, request),
    );
  } catch (error) {
    if (!isGone(error, APPROVAL_GONE)) throw error;
    closeDecided(ctx, ask);
    return reply(render("E-DONE", ctx.lang, { ask: ask.number }));
  }
  closeUsed(ctx, ask);
  return undefined;
}

/** The ask is still the one the reply named: open under its number, same request and digest. */
function unchanged(
  ctx: CommandContext,
  ask: ApprovalAsk | QuestionAsk,
): boolean {
  const now = ctx.asks.get(ask.number);
  if (!now || now !== ask || now.requestId !== ask.requestId) return false;
  const current = ctx.asks.byRequest(ask.requestId);
  if (current !== ask) return false;
  return (
    ask.kind !== "approval" ||
    (current.kind === "approval" && current.actionDigest === ask.actionDigest)
  );
}

// ---------------------------------------------------------------------------
// .pending

function pending(ctx: CommandContext): Promise<CommandResult> {
  const asks = ctx.asks.list().map((ask) => summarise(ctx, ask));
  let automationApprovals = 0;
  try {
    automationApprovals = ctx.core.automations.pendingApprovals().length;
  } catch {
    automationApprovals = 0;
  }
  return Promise.resolve(
    reply(render("R-PENDING", ctx.lang, { asks, automationApprovals })),
  );
}

// ---------------------------------------------------------------------------
// .show

async function show(
  ctx: CommandContext,
  command: ParsedCommand,
): Promise<CommandResult> {
  const n = askNumber(command.args[0]);
  if (n === undefined || n === "bad") return argsError(ctx, "show");
  const closed = closedReply(ctx, n);
  if (closed) return closed;
  const ask = ctx.asks.get(n);
  if (!ask) return reply(render("E-DONE", ctx.lang, { ask: n }));
  if (ask.kind === "question") {
    return {
      text: await ctx.sessions.cardText(ask),
      shown: [{ ask: n, full: false }],
    };
  }
  if (ask.kind !== "approval") {
    return reply(
      render("R-PENDING", ctx.lang, {
        asks: [summarise(ctx, ask)],
        automationApprovals: 0,
      }),
    );
  }
  const verdict = await ctx.sessions.verdict(ask);
  const at = await sessionRef(ctx, ask.sessionId, ask.projectId);
  if (verdict.kind === "long-context") {
    return {
      text: render("T-LONGCTX", ctx.lang, { at, ask: n }),
      shown: [{ ask: n, full: true }],
    };
  }
  const card = approvalCardText(ask);
  // A subject longer than one `.show` page is paged with `.more`.
  const pages =
    card.fullSubject !== undefined && card.tooLong
      ? paginate(neutraliseText(card.fullSubject), SHOW_INPUT_MAX)
      : [];
  const subject = pages.length > 0 ? pages[0] : card.fullSubject;
  const text = render("T-SHOW", ctx.lang, {
    at,
    ask: n,
    tool: ask.toolName,
    trigger: ask.trigger,
    ...(subject !== undefined ? { subject } : {}),
    ...(card.description !== undefined
      ? { description: card.description }
      : {}),
    ...(ask.evidence !== undefined ? { evidence: ask.evidence } : {}),
    external: ask.external,
    local: verdict.kind !== "approvable",
  });
  if (pages.length > 1) {
    ctx.pager.set(
      pages.slice(1).map((page, index) =>
        joinReplies(
          page,
          render("R-PAGE", ctx.lang, {
            index: index + 2,
            count: pages.length,
            truncated: false,
          }),
        ),
      ),
    );
    return {
      text: joinReplies(
        text,
        render("R-PAGE", ctx.lang, {
          index: 1,
          count: pages.length,
          truncated: false,
        }),
      ),
      shown: [{ ask: n, full: true }],
    };
  }
  return { text, shown: [{ ask: n, full: true }] };
}

// ---------------------------------------------------------------------------
// .approve

async function runConfirmed(
  ctx: CommandContext,
  ask: ConfirmAsk,
): Promise<CommandResult> {
  closeUsed(ctx, ask);
  return ctx.bridge.dispatch(ask.command, { confirmed: ask });
}

/** Runs the held messages in order, as if they had just arrived. */
async function runHeld(
  ctx: CommandContext,
  ask: HeldAsk,
): Promise<CommandResult> {
  closeUsed(ctx, ask);
  const texts: string[] = [];
  const shown: NonNullable<CommandResult["shown"]> = [];
  const after: (() => Promise<void>)[] = [];
  let numbered: CommandResult["numbered"];
  for (const item of ask.items) {
    // Media-only items have nothing to dispatch: their staged attachments
    // ride along with the next message. A voice transcript stays a message.
    if (!item.text?.trim()) continue;
    const parsed = classify(item);
    if (!parsed) continue;
    const result = await ctx.bridge.dispatch(parsed, {
      heldConfirmed: true,
      ...(item.quotedText !== undefined ? { quotedText: item.quotedText } : {}),
    });
    if (result.text) texts.push(result.text);
    if (result.shown) shown.push(...result.shown);
    if (result.numbered) numbered = result.numbered;
    if (result.after) after.push(result.after);
  }
  const combined: CommandResult = {};
  if (texts.length > 0) combined.text = joinReplies(...texts);
  if (shown.length > 0) combined.shown = shown;
  if (numbered) combined.numbered = numbered;
  if (after.length > 0) {
    combined.after = async () => {
      for (const step of after) await step();
    };
  }
  return combined;
}

async function approve(
  ctx: CommandContext,
  command: ParsedCommand,
): Promise<CommandResult> {
  const arg = askNumber(command.args[0]);
  if (arg === "bad") return argsError(ctx, "approve");
  let n = arg;
  if (n === undefined) {
    const open = ctx.asks.list();
    if (open.length === 0) return nothingWaiting(ctx);
    if (!bareApproveAllowed(ctx.asks, ctx.inbound)) {
      return reply(
        render("E-WHICH", ctx.lang, {
          asks: open.map((ask) => summarise(ctx, ask)),
          command: ".y",
        }),
      );
    }
    n = open[0]?.number;
    if (n === undefined) return nothingWaiting(ctx);
  }
  const closed = closedReply(ctx, n);
  if (closed) return closed;
  if (isStale(ctx)) return notRun(ctx, `.y ${n}`);
  const ask = ctx.asks.get(n);
  if (!ask) return reply(render("E-DONE", ctx.lang, { ask: n }));

  switch (ask.kind) {
    case "question":
      return argsError(
        ctx,
        "approve",
        pick(ctx, `回答问题请用 .a ${n}`, `Answer questions with .a ${n}`),
      );
    case "confirm":
      return runConfirmed(ctx, ask);
    case "held":
      return runHeld(ctx, ask);
    case "approval":
      return approveCard(ctx, ask);
  }
}

async function approveCard(
  ctx: CommandContext,
  ask: ApprovalAsk,
): Promise<CommandResult> {
  const n = ask.number;
  const digest = ask.actionDigest;
  const verdict = await ctx.sessions.verdict(ask);
  // The ask may have been decided, or replaced, while the policy was read.
  if (!unchanged(ctx, ask) || ask.actionDigest !== digest)
    return reply(render("E-DONE", ctx.lang, { ask: n }));
  if (verdict.kind === "long-context") {
    return argsError(
      ctx,
      "approve",
      pick(
        ctx,
        `.c ${n} 先压缩再继续 · .d ${n} 停止`,
        `.c ${n} compress, then continue · .d ${n} stop`,
      ),
    );
  }
  if (verdict.kind === "display-only") {
    if (verdict.reason === "view-only")
      return viewRefusal(ctx, ask.sessionId, ask.projectId);
    return reply(render("E-LOCAL", ctx.lang, { ask: n }));
  }
  if (verdict.needsShow) {
    // Same guard as a bare approve: the full subject went out before this
    // poll started and well before the message was written (server clock).
    const shownAt = ask.shownAtMs;
    if (
      shownAt === undefined ||
      shownAt >= ctx.inbound.pollStartedAtMs ||
      shownAt + ASK_SKEW_MS >= ctx.inbound.createdAtMs
    )
      return reply(render("E-SHOWFIRST", ctx.lang, { ask: n }));
  }
  const card = approvalCardText(ask);
  const at = verdict.highRisk
    ? await sessionRef(ctx, ask.sessionId, ask.projectId)
    : undefined;
  if (!unchanged(ctx, ask) || ask.actionDigest !== digest)
    return reply(render("E-DONE", ctx.lang, { ask: n }));
  const lost = await respondApproval(ctx, ask, "approve");
  if (lost) return lost;
  if (verdict.highRisk && at) {
    const texts = notice("high-risk-approved", ctx.lang, {
      project: at.project,
      title: at.title,
      tool: ask.toolName,
      ...(card.subject !== undefined ? { subject: card.subject } : {}),
    });
    try {
      ctx.host.notify({
        kind: "high-risk-approved",
        ...texts,
        projectId: ask.projectId,
        sessionId: ask.sessionId,
      });
    } catch {
      // A failed notification never undoes the approval.
    }
  }
  return reply(
    render("R-APPROVED", ctx.lang, {
      ask: n,
      ...(card.subject !== undefined ? { subject: card.subject } : {}),
    }),
  );
}

// ---------------------------------------------------------------------------
// .reject / .guide

/** Resolves the ask a `.d` / `.g` / `.a` names, or the only one it can act on. */
function targetAsk(
  ctx: CommandContext,
  tail: string | undefined,
  canActOn: (ask: Ask) => boolean,
  typed: string,
): { ask: Ask; text: string } | { result: CommandResult } {
  const split = splitAskPrefix(tail, ctx.asks.knownNumbers());
  if (split.ask !== undefined) {
    const closed = closedReply(ctx, split.ask);
    if (closed) return { result: closed };
    const ask = ctx.asks.get(split.ask);
    if (!ask)
      return { result: reply(render("E-DONE", ctx.lang, { ask: split.ask })) };
    return { ask, text: split.text };
  }
  const open = ctx.asks.list();
  const candidates = open.filter(canActOn);
  const only = candidates[0];
  if (candidates.length === 1 && only) return { ask: only, text: split.text };
  if (open.length === 0) return { result: nothingWaiting(ctx) };
  return {
    result: reply(
      render("E-WHICH", ctx.lang, {
        asks: (candidates.length > 0 ? candidates : open).map((ask) =>
          summarise(ctx, ask),
        ),
        command: typed,
      }),
    ),
  };
}

/** Guard class: a stale message acts only on an ask that existed when it was written. */
function guardFails(ctx: CommandContext, ask: Ask): boolean {
  return isStale(ctx) && ask.createdAtMs > ctx.inbound.createdAtMs;
}

async function rejectOrGuide(
  ctx: CommandContext,
  command: ParsedCommand,
  guideOnly: boolean,
): Promise<CommandResult> {
  const typed = guideOnly ? ".g" : ".d";
  const target = targetAsk(
    ctx,
    command.tail,
    guideOnly ? (ask) => ask.kind === "approval" : () => true,
    typed,
  );
  if ("result" in target) return target.result;
  const { ask, text } = target;
  const n = ask.number;
  if (guardFails(ctx, ask)) return notRun(ctx, `${typed} ${n}`);
  if (guideOnly && text.length === 0) return argsError(ctx, "guide");

  switch (ask.kind) {
    case "confirm":
    case "held":
      if (guideOnly) return argsError(ctx, "guide");
      closeUsed(ctx, ask);
      return reply(render("R-CANCELLED", ctx.lang, { ask: n }));
    case "question": {
      if (guideOnly || text.length > 0)
        return argsError(
          ctx,
          command.name,
          pick(
            ctx,
            `问题请用 .a ${n} 回答，.d ${n} 取消`,
            `Answer with .a ${n}, cancel with .d ${n}`,
          ),
        );
      const request = RespondQuestionnaireRequestSchema.parse({
        requestId: ask.requestId,
        submission: { cancelled: true, answers: [] },
      });
      const lost = await respondQuestion(ctx, ask, request);
      if (lost) return lost;
      return reply(render("R-CANCELLED", ctx.lang, { ask: n }));
    }
    case "approval": {
      if (ask.trigger === "long-context-activation") {
        if (text.length > 0 || guideOnly) {
          return argsError(
            ctx,
            command.name,
            pick(
              ctx,
              `.c ${n} 先压缩再继续 · .d ${n} 停止`,
              `.c ${n} compress, then continue · .d ${n} stop`,
            ),
          );
        }
        const lost = await respondApproval(ctx, ask, "abort");
        if (lost) return lost;
        return reply(render("R-REJECTED", ctx.lang, { ask: n }));
      }
      const guidance = text.length > 0 ? text : undefined;
      // Guidance steers the agent like a typed instruction, so a view-only
      // session refuses it; a bare reject only stops the action.
      if (
        guidance &&
        (await ctx.sessions.modeFor(ask.sessionId, ask.projectId)) ===
          "view-only"
      )
        return viewRefusal(ctx, ask.sessionId, ask.projectId);
      if (!unchanged(ctx, ask))
        return reply(render("E-DONE", ctx.lang, { ask: n }));
      const lost = await respondApproval(
        ctx,
        ask,
        guidance ? "guide" : "reject",
        guidance,
      );
      if (lost) return lost;
      return reply(
        render(guidance ? "R-GUIDED" : "R-REJECTED", ctx.lang, { ask: n }),
      );
    }
  }
}

// ---------------------------------------------------------------------------
// .answer

async function respondQuestion(
  ctx: CommandContext,
  ask: QuestionAsk,
  request: ReturnType<typeof RespondQuestionnaireRequestSchema.parse>,
): Promise<CommandResult | undefined> {
  const responder = ctx.sessions.responder(ask.sessionId, ask.projectId);
  try {
    await Promise.resolve(
      ctx.core.runtimes.respondQuestionnaire(responder, request),
    );
  } catch (error) {
    if (!isGone(error, QUESTION_GONE) && !isGone(error, APPROVAL_GONE))
      throw error;
    closeDecided(ctx, ask);
    return reply(render("E-DONE", ctx.lang, { ask: ask.number }));
  }
  closeUsed(ctx, ask);
  return undefined;
}

/** The out-of-range option of one answer part, for `E-ANSWER` (1-based). */
function badOption(
  tail: string,
  questionnaire: AskUserQuestionParams,
  part: number,
): number | undefined {
  const source = tail.replace(/\r\n?/g, "\n").trim();
  const parts =
    questionnaire.questions.length === 1
      ? [source]
      : source
          .split(/[;；\n]/u)
          .map((value) => value.trim())
          .filter((value) => value.length > 0);
  const question = questionnaire.questions[part];
  const raw = parts[part]?.normalize("NFKC") ?? "";
  if (!question) return undefined;
  return raw
    .split(/[,、\s]+/u)
    .map(Number)
    .find((value) => value > question.options.length);
}

function answerError(
  ctx: CommandContext,
  ask: QuestionAsk,
  problem?: ReplyData["E-ANSWER"]["problem"],
): CommandResult {
  return reply(
    render("E-ANSWER", ctx.lang, {
      ask: ask.number,
      count: ask.questionnaire.questions.length,
      example: answerExample(ask.questionnaire),
      ...(problem ? { problem } : {}),
    }),
  );
}

async function answer(
  ctx: CommandContext,
  command: ParsedCommand,
): Promise<CommandResult> {
  const target = targetAsk(
    ctx,
    command.tail,
    (ask) => ask.kind === "question",
    ".a",
  );
  if ("result" in target) return target.result;
  const { ask, text } = target;
  if (ask.kind !== "question") {
    return argsError(
      ctx,
      "answer",
      ask.kind === "approval"
        ? pick(
            ctx,
            `批准用 .y ${ask.number}，拒绝用 .d ${ask.number}`,
            `Approve with .y ${ask.number}, reject with .d ${ask.number}`,
          )
        : pick(ctx, `确认用 .y ${ask.number}`, `Confirm with .y ${ask.number}`),
    );
  }
  if (isStale(ctx)) return notRun(ctx, `.a ${ask.number}`);
  if (
    (await ctx.sessions.modeFor(ask.sessionId, ask.projectId)) === "view-only"
  )
    return viewRefusal(ctx, ask.sessionId, ask.projectId);
  if (!ask.answerable)
    return reply(render("E-LOCAL", ctx.lang, { ask: ask.number }));
  if (!unchanged(ctx, ask))
    return reply(render("E-DONE", ctx.lang, { ask: ask.number }));

  const parsed = parseAnswers(text, ask.questionnaire);
  if (!parsed.ok) {
    const part = parsed.question;
    if (parsed.reason === "multi" && part !== undefined)
      return answerError(ctx, ask, { kind: "single", part: part + 1 });
    if (parsed.reason === "range" && part !== undefined) {
      const option = badOption(text, ask.questionnaire, part);
      return answerError(
        ctx,
        ask,
        option !== undefined
          ? { kind: "option", part: part + 1, option }
          : undefined,
      );
    }
    return answerError(ctx, ask);
  }
  const checked = RespondQuestionnaireRequestSchema.safeParse({
    requestId: ask.requestId,
    submission: parsed.submission,
  });
  if (!checked.success) return answerError(ctx, ask);
  // The rules the GUI applies: every question gets an answer.
  const resolved = resolveAskUserQuestionSubmission(
    ask.questionnaire,
    parsed.submission,
  );
  if (
    resolved.cancelled ||
    resolved.answers.length !== ask.questionnaire.questions.length
  )
    return answerError(ctx, ask);

  const lost = await respondQuestion(ctx, ask, checked.data);
  if (lost) return lost;
  const summary = resolved.answers
    .map((item) =>
      item.kind === "multi"
        ? (item.selected ?? []).join(", ")
        : (item.answer ?? ""),
    )
    .join("; ");
  return reply(render("R-ANSWERED", ctx.lang, { ask: ask.number, summary }));
}

export const askHandlers: CommandHandlers = {
  pending,
  show,
  approve,
  reject: (ctx, command) => rejectOrGuide(ctx, command, false),
  guide: (ctx, command) => rejectOrGuide(ctx, command, true),
  answer,
};
