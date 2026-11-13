// Plain text and bare numbers.
//
// Plain text always goes to the current session; it is never held because a
// push was about another session. The reply is silent when the routing cannot
// surprise the user, `R-ROUTE` otherwise, and `R-STEER` when it steers a
// running turn. While an approval or question card of the current session is
// open, the text joins the steering queue (delivered after the card is
// handled) and `R-QUEUEWAIT` names the cards still waiting. Plain text that
// is only a number of the last reply's interactive choices sends that
// choice's message instead (`R-CHOICE`). A bare number is
// turned into the command it stands for and run through `ctx.bridge.dispatch`,
// so every gate of that command applies.

import { bareAnswerAllowed } from "../asks";
import { specOf } from "../commandSpec";
import { ASK_MAX, ASK_MIN, PUSH_SLOT } from "../constants";
import { render, type QueueWaitVariant } from "../replies";
import type {
  ApprovalAsk,
  CommandName,
  HandleKind,
  ParsedCommand,
  QuestionAsk,
} from "../types";
import { currentChoices, sessionHandlers } from "./sessions";
import type {
  CommandContext,
  CommandResult,
  MessageHandler,
  NumberHandler,
} from "./types";

/** The command a bare row number of the last list stands for. */
const PICK: Record<HandleKind, CommandName | undefined> = {
  session: "use",
  project: "projects",
  model: "model",
  effort: "effort",
  mode: "mode",
  file: "file",
  task: "task",
  automation: "auto",
  run: "runs",
  // A bare number never withdraws a queued message.
  queue: undefined,
};

/** How `E-AMBIG` writes the list reading out. */
const PICK_COMMAND: Record<HandleKind, string> = {
  session: ".u",
  project: ".p",
  model: ".m",
  effort: ".e",
  mode: ".mode",
  file: ".file",
  task: ".task",
  automation: ".auto",
  run: ".runs",
  queue: ".qx",
};

async function cardVariant(
  ctx: CommandContext,
  ask: ApprovalAsk | QuestionAsk,
): Promise<QueueWaitVariant> {
  if (ask.kind !== "approval")
    return ask.answerable ? "question" : "question-local";
  const verdict = await ctx.sessions.verdict(ask);
  if (verdict.kind === "display-only") return "display-only";
  if (verdict.kind === "long-context") return "long-context";
  return "approval";
}

function command(name: CommandName, args: string[] = []): ParsedCommand {
  return { kind: "command", name, args };
}

export const handlePlainMessage: MessageHandler = async (ctx, text) => {
  const body = text.trim();
  const quote = ctx.inbound.quotedText?.trim();
  if (!body && !quote) return {};
  // A new plain message drops a held batch.
  if (!ctx.heldConfirmed)
    ctx.asks.closeWhere((ask) => ask.kind === "held", "invalidated");
  const current = ctx.store.get().current;
  if (!current) {
    // No current session: same path as `.new text`. A quote alone is refused
    // there (`E-QUOTE`).
    const start = sessionHandlers.new;
    if (!start) throw new Error("The .new handler is missing.");
    if (!body) return { text: render("E-QUOTE", ctx.lang) };
    return start(ctx, { kind: "command", name: "new", args: [], tail: body });
  }
  const { sessionId, projectId } = current;
  const view = await ctx.sessions.view(sessionId, projectId);
  const at = { project: view.project, title: view.title };
  const route = ctx.sessions.routeFor(ctx.now);
  // While a card is open the text is queued, never refused: `send` still
  // applies every gate (view-only, quote-only, attachments).
  const queued = ctx.sessions.asksOf(sessionId).length > 0;
  const running = view.live && view.state === "running";
  // A bare number answers a numbered choice of the last reply: it sends what
  // the button would send in Pine. Anything else is sent as typed.
  const number =
    quote || ctx.attachments.list().length > 0 ? undefined : choiceNumber(body);
  const choice =
    number === undefined || running
      ? undefined
      : (await currentChoices(ctx, sessionId, projectId)).find(
          (entry) => entry.number === number,
        );
  await ctx.sessions.send({
    sessionId,
    projectId,
    text: choice?.message ?? body,
    ...(ctx.inbound.quotedText !== undefined
      ? { quotedText: ctx.inbound.quotedText }
      : {}),
    ...(queued || running ? { behavior: "steer" as const } : {}),
    attachments: ctx.attachments.list().length > 0,
  });
  if (queued) {
    // Read the cards again: one may have been answered, or the run ended,
    // while `send` was awaiting.
    const open = ctx.sessions.asksOf(sessionId);
    if (open.length > 0) {
      const asks = await Promise.all(
        open.map(async (ask) => ({
          number: ask.number,
          variant: await cardVariant(ctx, ask),
        })),
      );
      return { text: render("R-QUEUEWAIT", ctx.lang, { at, asks }) };
    }
  }
  const steered = queued
    ? ctx.sessions.runState(sessionId) === "running"
    : running;
  if (choice)
    return {
      text: render("R-CHOICE", ctx.lang, { at, label: choice.label, steered }),
    };
  if (steered) return { text: render("R-STEER", ctx.lang, { at }) };
  if (route.kind === "ack")
    return { text: render("R-ROUTE", ctx.lang, { at }) };
  return {};
};

/** The number a plain message is, when it is only digits (full-width too). */
function choiceNumber(text: string): number | undefined {
  const digits = text.normalize("NFKC").trim();
  return /^\d{1,2}$/.test(digits) ? Number(digits) : undefined;
}

function openQuestions(ctx: CommandContext): QuestionAsk[] {
  return ctx.asks
    .list()
    .filter((ask): ask is QuestionAsk => ask.kind === "question");
}

function listReading(
  ctx: CommandContext,
  n: number,
): Promise<CommandResult> | CommandResult {
  const last = ctx.handles.last();
  if (!last) return { text: render("E-REF", ctx.lang, { n, list: ".l" }) };
  const name = PICK[last.kind];
  if (!name)
    return { text: render("E-ARGS", ctx.lang, { spec: specOf("unqueue") }) };
  return ctx.bridge.dispatch(command(name, [String(n)]));
}

export const handleNumber: NumberHandler = (ctx, numbers) => {
  const [first] = numbers;
  if (first === undefined)
    return Promise.resolve({
      text: render("E-REF", ctx.lang, { n: "", list: ".l" }),
    });
  if (numbers.length === 1) {
    if (first === 0) return ctx.bridge.dispatch(command("more"));
    if (first === PUSH_SLOT)
      return ctx.bridge.dispatch(command("use", [String(PUSH_SLOT)]));
    if (first >= ASK_MIN && first <= ASK_MAX)
      return ctx.bridge.dispatch(command("show", [String(first)]));
    if (first < 1 || first > 8)
      return Promise.resolve({
        text: render("E-REF", ctx.lang, { n: first, list: ".l" }),
      });
  }
  const options = numbers.every((n) => n >= 1 && n <= 4);
  const questions = openQuestions(ctx);
  const card = questions.at(-1);
  if (options && card) {
    const last = ctx.handles.last();
    const reading =
      questions.length === 1
        ? bareAnswerAllowed(card, last?.deliveredAtMs, ctx.inbound)
        : last
          ? "ambiguous"
          : "no";
    if (reading === "answer")
      return ctx.bridge.dispatch({
        kind: "command",
        name: "answer",
        args: [],
        tail: `${card.number} ${numbers.join(",")}`,
      });
    if (reading === "ambiguous" && last && numbers.length === 1)
      return Promise.resolve({
        text: render("E-AMBIG", ctx.lang, {
          n: first,
          ask: card.number,
          list: PICK_COMMAND[last.kind],
        }),
      });
  }
  if (numbers.length > 1)
    return Promise.resolve({
      text: render("E-ARGS", ctx.lang, { spec: specOf("answer") }),
    });
  return Promise.resolve(listReading(ctx, first));
};
