// Handlers: new sessions search use last history stop queue unqueue rename
// delete. Read commands use `loadMessages` and the bridge's cache,
// never `resume`. Calls that act on a session go through `ctx.sessions.actor`,
// ask responses through `responder`, holds and reads through the bridge's own
// client id.

import type { PineApprovalMode } from "../../../shared/agent";
import {
  isTemporaryWorkspace,
  TEMPORARY_WORKSPACE_PROJECT_ID,
  type PineProject,
} from "../../../shared/projects";
import {
  contentBlocksToText,
  type PineSessionSummary,
  type PineTextMessage,
  type ProjectSessionSearchResult,
} from "../../../shared/sessions";
import { WECHAT_CLIENT_ID } from "../../../shared/wechatRemote";
import { RespondApprovalRequestSchema } from "../../core/requestSchemas";
import {
  listAllRecentSessions,
  listProjectSessions,
  searchAllSessions,
} from "../../recentSessions";
import { specOf } from "../commandSpec";
import { HANDLE_TTL_MS, PAGE_ROWS, PUSH_SLOT } from "../constants";
import { notice } from "../notices";
import { resolveRef } from "../parseCommand";
import {
  joinReplies,
  render,
  renderLastPages,
  type SessionRef,
} from "../replies";
import {
  clampMode,
  projectLabel,
  refuse,
  type SessionView,
} from "../sessionDirectory";
import {
  expandInterfaceBlocks,
  interfaceChoices,
  type InterfaceChoice,
} from "../interfaceMarkdown";
import { toPlainText } from "../text";
import type { HandleRow, ParsedCommand } from "../types";
import type { CommandContext, CommandHandlers, CommandResult } from "./types";

const APPROVAL_GONE = "This approval request is no longer pending.";

const W = WECHAT_CLIENT_ID;

/** Sessions a list or search reply covers (five pages of eight). */
const SESSION_LIST_MAX = 5 * PAGE_ROWS;
/** Transcript messages read for `.last`. */
const LAST_LOAD = 40;
/** Transcript messages read for `.history`. */
const HISTORY_LOAD = 120;
const HISTORY_DEFAULT = 3;
const HISTORY_MAX = 10;

// ---------------------------------------------------------------------------
// Small helpers

function argsError(ctx: CommandContext, command: ParsedCommand): CommandResult {
  return { text: render("E-ARGS", ctx.lang, { spec: specOf(command.name) }) };
}

function noSession(ctx: CommandContext): CommandResult {
  return { text: render("E-NOSESSION", ctx.lang) };
}

function refError(
  ctx: CommandContext,
  n: number | string,
  list: string,
): CommandResult {
  return { text: render("E-REF", ctx.lang, { n, list }) };
}

function refOf(view: Pick<SessionView, "project" | "title">): SessionRef {
  return { project: view.project, title: view.title };
}

function titleOf(summary: PineSessionSummary | undefined): string {
  return summary?.name ?? summary?.preview ?? "";
}

/** Splits rows into pages of PAGE_ROWS. */
function chunks<T>(items: readonly T[]): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += PAGE_ROWS)
    pages.push(items.slice(index, index + PAGE_ROWS));
  return pages;
}

/** The session's summary: live, else stored (the project must be held). */
async function describeSession(
  ctx: CommandContext,
  sessionId: string,
  projectId: string,
): Promise<PineSessionSummary | undefined> {
  const live = ctx.core.runtimes.summaryOfLiveSession(sessionId);
  if (live) return live;
  try {
    const service = ctx.core.sessionLibrary().openSessionService(projectId);
    return service
      ? (await service.describeSession(sessionId)).summary
      : undefined;
  } catch {
    return undefined;
  }
}

/** `E-VIEW` / `E-VIEWRUN` for a view-only session, else undefined. */
async function viewOnlyRefusal(
  ctx: CommandContext,
  sessionId: string,
  projectId: string,
  title: string,
): Promise<CommandResult | undefined> {
  const reason = await ctx.sessions.viewOnlyReason(sessionId, projectId);
  if (reason === "automation-run")
    return { text: render("E-VIEWRUN", ctx.lang, { title }) };
  if (reason === "ceiling")
    return {
      text: render("E-VIEW", ctx.lang, {
        title,
        mode: await ctx.sessions.sessionMode(sessionId, projectId),
        ceiling: ctx.settings.ceilingMode,
      }),
    };
  return undefined;
}

/** A plain message or `.new` drops a held batch. */
function dropHeldBatches(ctx: CommandContext): void {
  if (ctx.heldConfirmed) return;
  ctx.asks.closeWhere((ask) => ask.kind === "held", "invalidated");
}

// ---------------------------------------------------------------------------
// Projects and session lists

async function projectNames(
  ctx: CommandContext,
): Promise<{ projects: PineProject[]; names: Map<string, string> }> {
  const projects = await ctx.core.repository.list();
  return {
    projects,
    names: new Map(
      projects.map((project) => [project.id, projectLabel(project, ctx.lang)]),
    ),
  };
}

type Resolved<T> =
  { kind: "ok"; value: T } | { kind: "reply"; result: CommandResult };

/** `@N` (project table) or `@name`. */
async function resolveProject(
  ctx: CommandContext,
  ref: string,
): Promise<Resolved<PineProject>> {
  if (/^\d+$/.test(ref)) {
    const row = ctx.handles.resolve("project", Number(ref));
    if (!row) return { kind: "reply", result: refError(ctx, ref, ".p") };
    try {
      return { kind: "ok", value: await ctx.core.repository.get(row.id) };
    } catch {
      return {
        kind: "reply",
        result: {
          text: render("E-GONE", ctx.lang, {
            variant: "item",
            kind: "project",
          }),
        },
      };
    }
  }
  const { projects } = await projectNames(ctx);
  const rows = projects.map((project) => ({
    project,
    label: projectLabel(project, ctx.lang),
  }));
  const match = resolveRef(rows, ref);
  if (match.kind === "one") return { kind: "ok", value: match.row.project };
  if (match.kind === "none")
    return {
      kind: "reply",
      result: {
        text: render("E-NOMATCH", ctx.lang, { query: ref, kind: "project" }),
      },
    };
  const matches = match.rows.slice(0, PAGE_ROWS);
  ctx.handles.set(
    "project",
    matches.map((entry) => ({ id: entry.project.id, label: entry.label })),
  );
  return {
    kind: "reply",
    result: {
      text: render("R-MATCHES", ctx.lang, {
        query: ref,
        rows: matches.map((entry, index) => ({
          n: index + 1,
          label: entry.label,
        })),
      }),
      numbered: { kind: "project" },
    },
  };
}

async function recentSessions(
  ctx: CommandContext,
  projectId?: string,
): Promise<{
  sessions: ProjectSessionSearchResult[];
  names: Map<string, string>;
}> {
  const { projects, names } = await projectNames(ctx);
  const library = ctx.core.sessionLibrary();
  if (projectId !== undefined) {
    const project =
      projects.find((candidate) => candidate.id === projectId) ??
      (await ctx.core.repository.get(projectId));
    names.set(project.id, projectLabel(project, ctx.lang));
    const sessions = await listProjectSessions(project, library);
    return { sessions: sessions.slice(0, SESSION_LIST_MAX), names };
  }
  const sessions = await listAllRecentSessions(
    projects,
    library,
    SESSION_LIST_MAX,
  );
  return { sessions: sessions.slice(0, SESSION_LIST_MAX), names };
}

function sessionRow(
  session: ProjectSessionSearchResult,
  names: Map<string, string>,
): HandleRow & { title: string; project: string } {
  const title = titleOf(session);
  return {
    id: session.id,
    label: title,
    projectId: session.projectId,
    title,
    project: names.get(session.projectId) ?? "",
  };
}

interface SessionTarget {
  sessionId: string;
  projectId: string;
}

/** A session handle, `9` (latest push) when allowed, or a title. */
async function resolveSession(
  ctx: CommandContext,
  command: ParsedCommand,
  options: { pushSlot: boolean },
): Promise<Resolved<SessionTarget>> {
  const arg = command.args[0];
  if (arg !== undefined) {
    const n = Number(arg);
    if (options.pushSlot && n === PUSH_SLOT) {
      const push = ctx.store.get().lastPush;
      if (!push || ctx.now - push.atMs > HANDLE_TTL_MS)
        return { kind: "reply", result: refError(ctx, n, ".l") };
      return {
        kind: "ok",
        value: { sessionId: push.sessionId, projectId: push.projectId },
      };
    }
    const row = ctx.handles.resolve("session", n);
    if (!row?.projectId)
      return { kind: "reply", result: refError(ctx, arg, ".l") };
    return {
      kind: "ok",
      value: { sessionId: row.id, projectId: row.projectId },
    };
  }
  const query = (command.tail ?? "").trim();
  const { sessions, names } = await recentSessions(ctx);
  const rows = sessions.map((session) => sessionRow(session, names));
  const match = resolveRef(rows, query);
  if (match.kind === "one")
    return {
      kind: "ok",
      value: {
        sessionId: match.row.id,
        projectId: match.row.projectId ?? "",
      },
    };
  if (match.kind === "none")
    return {
      kind: "reply",
      result: {
        text: render("E-NOMATCH", ctx.lang, { query, kind: "session" }),
      },
    };
  const matches = match.rows.slice(0, PAGE_ROWS);
  ctx.handles.set(
    "session",
    matches.map(({ id, label, projectId }) => ({ id, label, projectId })),
  );
  return {
    kind: "reply",
    result: {
      text: render("R-MATCHES", ctx.lang, {
        query,
        rows: matches.map((row, index) => ({
          n: index + 1,
          label: row.project ? `${row.title} · ${row.project}` : row.title,
        })),
      }),
      numbered: { kind: "session" },
    },
  };
}

/** Renders a list in pages: the first is the reply, the rest go to `.more`. */
function pagedList<T>(
  ctx: CommandContext,
  rows: readonly (T & HandleRow)[],
  page: (rows: (T & HandleRow & { n: number })[]) => string,
): CommandResult {
  const pages = chunks(rows).map((chunk) => {
    const numbered = chunk.map((row, index) => ({ ...row, n: index + 1 }));
    return {
      text: page(numbered),
      rows: chunk.map(({ id, label, projectId }) => ({
        id,
        label,
        ...(projectId !== undefined ? { projectId } : {}),
      })),
    };
  });
  const [first, ...rest] = pages;
  ctx.pager.set(
    rest.map((entry) => ({
      text: entry.text,
      list: { kind: "session" as const, rows: entry.rows },
    })),
  );
  if (!first) return { text: page([]) };
  ctx.handles.set("session", first.rows);
  return { text: first.text, numbered: { kind: "session" } };
}

// ---------------------------------------------------------------------------
// Transcript reading

function messageText(message: PineTextMessage): string {
  return contentBlocksToText(message.blocks).trim();
}

/** The latest assistant message's text, as the done push shows it. */
function finalMessage(messages: readonly PineTextMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const text = messageText(message);
    if (text) return text;
  }
  return "";
}

function sameChoices(
  a: readonly InterfaceChoice[],
  b: readonly InterfaceChoice[],
): boolean {
  return (
    a.length === b.length &&
    a.every(
      (choice, index) =>
        choice.label === b[index]?.label &&
        choice.message === b[index]?.message,
    )
  );
}

/**
 * The choices a bare number answers in the current session: those the done
 * push numbered in its final reply. None while it runs, since a new reply is
 * on its way (the caller checks).
 */
export async function currentChoices(
  ctx: CommandContext,
  sessionId: string,
  projectId: string,
): Promise<InterfaceChoice[]> {
  try {
    const page = await ctx.core.runtimes.loadMessages(
      W,
      projectId,
      sessionId,
      undefined,
      LAST_LOAD,
    );
    return interfaceChoices(finalMessage(page.messages));
  } catch {
    // A transcript that cannot be read never stops the text being sent.
    return [];
  }
}

/** Final assistant text of the last turn; the latest assistant text otherwise. */
function finalReply(messages: readonly PineTextMessage[]): string {
  const turn: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (!message) continue;
    if (message.role === "user") break;
    const text = messageText(message);
    if (text) turn.unshift(text);
  }
  if (turn.length > 0) return turn.join("\n\n");
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") continue;
    const text = messageText(message);
    if (text) return text;
  }
  return "";
}

function turnsOf(
  messages: readonly PineTextMessage[],
): { user: string; assistant: string }[] {
  const turns: { user: string; assistant: string[] }[] = [];
  for (const message of messages) {
    const text = messageText(message);
    if (message.role === "user") {
      turns.push({ user: text, assistant: [] });
      continue;
    }
    if (!text) continue;
    const last = turns.at(-1);
    if (last) last.assistant.push(text);
    else turns.push({ user: "", assistant: [text] });
  }
  return turns.map((turn) => ({
    user: turn.user,
    assistant: turn.assistant.at(-1) ?? "",
  }));
}

// ---------------------------------------------------------------------------
// `.delete` checks

async function deleteRefusal(
  ctx: CommandContext,
  target: SessionTarget,
  title: string,
): Promise<CommandResult | undefined> {
  const origin = ctx.sessions.origin(target.sessionId);
  if (origin?.kind !== "started")
    return { text: render("E-NOTOWN", ctx.lang, { title }) };
  // An automation run is view-only (`E-VIEWRUN`); so is a session above the ceiling.
  const viewOnly = await viewOnlyRefusal(
    ctx,
    target.sessionId,
    target.projectId,
    title,
  );
  if (viewOnly) return viewOnly;
  const state = ctx.sessions.runState(target.sessionId);
  if (state === "running" || state === "waiting")
    return {
      text: render("E-BUSY", ctx.lang, { variant: "running", title }),
    };
  if (origin.touchedLocally)
    return { text: render("E-BUSY", ctx.lang, { variant: "local", title }) };
  return undefined;
}

async function executeDelete(
  ctx: CommandContext,
  target: SessionTarget,
): Promise<CommandResult> {
  const { sessionId, projectId } = target;
  const held = await ctx.sessions.hold(projectId);
  const summary = await describeSession(ctx, sessionId, projectId);
  const title = titleOf(summary) || ctx.confirmed?.resolved.title || "";
  if (!summary && !ctx.sessions.isLive(sessionId))
    return {
      text: render("E-GONE", ctx.lang, { variant: "item", kind: "session" }),
    };
  const refusal = await deleteRefusal(ctx, target, title);
  if (refusal) return refusal;
  await ctx.core.runtimes.deleteSession(W, projectId, sessionId);
  const project = await ctx.core.repository.get(projectId).catch(() => held);
  const groups = project.sessionGroups ?? [];
  if (groups.some((group) => group.sessionIds.includes(sessionId))) {
    await ctx.core.repository.updateSessionGroups(
      projectId,
      groups.map((group) => ({
        ...group,
        sessionIds: group.sessionIds.filter((id) => id !== sessionId),
      })),
    );
    ctx.core.notifyLibraryChanged("projects");
  }
  ctx.core.notifyLibraryChanged("sessions");
  await ctx.store.update((draft) => {
    draft.tracked = draft.tracked.filter(
      (entry) => entry.sessionId !== sessionId,
    );
    draft.origins = draft.origins.filter(
      (entry) => entry.sessionId !== sessionId,
    );
    delete draft.modeOverride[sessionId];
    if (draft.current?.sessionId === sessionId) delete draft.current;
    if (draft.lastPush?.sessionId === sessionId) delete draft.lastPush;
  });
  try {
    ctx.host.notify({
      kind: "session-deleted",
      ...notice("session-deleted", ctx.lang, {
        project: projectLabel(project, ctx.lang),
        title,
      }),
      projectId,
    });
  } catch {
    // A failed notification never blocks the reply.
  }
  return { text: render("R-DELETED", ctx.lang, { title }) };
}

// ---------------------------------------------------------------------------
// Handlers

export const sessionHandlers: CommandHandlers = {
  new: async (ctx, command) => {
    const text = (command.tail ?? "").trim();
    let project: PineProject | undefined;
    if (command.project !== undefined) {
      const resolved = await resolveProject(ctx, command.project);
      if (resolved.kind === "reply") return resolved.result;
      project = resolved.value;
    }
    if (!text) {
      // `.n` is "new", not "no": with an ask open it does nothing.
      const open = ctx.asks.list()[0];
      if (!project && open)
        return { text: render("E-NGUARD", ctx.lang, { ask: open.number }) };
      dropHeldBatches(ctx);
      const projectId =
        project?.id ??
        ctx.store.get().currentProjectId ??
        TEMPORARY_WORKSPACE_PROJECT_ID;
      if (!project && !isTemporaryWorkspace(projectId))
        project = await ctx.core.repository.get(projectId).catch(() => {
          throw refuse("E-GONE", { variant: "item", kind: "project" });
        });
      await ctx.store.update((draft) => {
        delete draft.current;
        draft.currentProjectId = projectId;
      });
      return {
        text: render("R-NEWARMED", ctx.lang, {
          project: projectLabel(project, ctx.lang),
        }),
      };
    }
    dropHeldBatches(ctx);
    const projectId =
      project?.id ??
      ctx.store.get().currentProjectId ??
      TEMPORARY_WORKSPACE_PROJECT_ID;
    if (!project && !isTemporaryWorkspace(projectId))
      project = await ctx.core.repository.get(projectId).catch(() => {
        throw refuse("E-GONE", { variant: "item", kind: "project" });
      });
    const result = await ctx.sessions.startSession({
      projectId,
      text,
      ...(ctx.inbound.quotedText !== undefined
        ? { quotedText: ctx.inbound.quotedText }
        : {}),
      attachments: ctx.attachments.list().length > 0,
    });
    const mode: PineApprovalMode = clampMode(
      ctx.settings.defaultMode,
      ctx.settings.ceilingMode,
    );
    const model = result.session.modelSelection?.modelId;
    return {
      text: render("R-NEW", ctx.lang, {
        project: projectLabel(project, ctx.lang),
        text,
        mode,
        ...(model ? { model } : {}),
      }),
    };
  },

  sessions: async (ctx, command) => {
    let projectId: string | undefined;
    if (command.project !== undefined) {
      const resolved = await resolveProject(ctx, command.project);
      if (resolved.kind === "reply") return resolved.result;
      projectId = resolved.value.id;
    }
    const { sessions, names } = await recentSessions(ctx, projectId);
    const rows = sessions.map((session) => ({
      ...sessionRow(session, names),
      atMs: Date.parse(session.updatedAt) || 0,
      marks: [
        ...(ctx.sessions.runState(session.id) === "running"
          ? (["running"] as const)
          : []),
        ...(ctx.sessions.runState(session.id) === "waiting"
          ? (["waiting"] as const)
          : []),
        ...(ctx.sessions.origin(session.id) ? (["wechat"] as const) : []),
        ...(session.automationRun ||
        ctx.core.automations.isAutomationSession(session.id)
          ? (["automation"] as const)
          : []),
      ],
    }));
    return pagedList(ctx, rows, (page) =>
      render("R-SESSIONS", ctx.lang, {
        now: ctx.now,
        rows: page.map((row) => ({
          n: row.n,
          title: row.title,
          project: row.project,
          atMs: row.atMs,
          marks: [...row.marks],
        })),
      }),
    );
  },

  search: async (ctx, command) => {
    const query = (command.tail ?? "").trim();
    if (!query) return argsError(ctx, command);
    const { projects, names } = await projectNames(ctx);
    const sessions = await searchAllSessions(
      projects,
      query,
      ctx.core.sessionLibrary(),
      SESSION_LIST_MAX,
    );
    const rows = sessions.map(
      (session): ReturnType<typeof sessionRow> & { snippet?: string } => ({
        ...sessionRow(session, names),
        ...(session.snippet ? { snippet: session.snippet } : {}),
      }),
    );
    return pagedList(ctx, rows, (page) =>
      render("R-SEARCH", ctx.lang, {
        query,
        total: rows.length,
        rows: page.map((row) => ({
          n: row.n,
          title: row.title,
          project: row.project,
          ...(row.snippet ? { snippet: row.snippet } : {}),
        })),
      }),
    );
  },

  use: async (ctx, command) => {
    let target: SessionTarget;
    const bare = command.args.length === 0 && !command.tail?.trim();
    if (bare) {
      const current = ctx.store.get().current;
      if (!current) return noSession(ctx);
      target = { sessionId: current.sessionId, projectId: current.projectId };
    } else {
      const resolved = await resolveSession(ctx, command, { pushSlot: true });
      if (resolved.kind === "reply") return resolved.result;
      target = resolved.value;
    }
    const { sessionId, projectId } = target;
    try {
      await ctx.sessions.hold(projectId);
    } catch {
      return {
        text: render("E-GONE", ctx.lang, { variant: "item", kind: "session" }),
      };
    }
    const summary = await describeSession(ctx, sessionId, projectId);
    if (!summary && !ctx.sessions.isLive(sessionId))
      return {
        text: render("E-GONE", ctx.lang, { variant: "item", kind: "session" }),
      };
    if (!bare) {
      const origin = ctx.sessions.origin(sessionId);
      await ctx.sessions.track(
        sessionId,
        projectId,
        origin?.kind === "started" ? "wechat" : "adopted",
      );
      await ctx.sessions.setCurrent({ projectId, sessionId });
    }
    const view = await ctx.sessions.view(sessionId, projectId);
    let head: string;
    if (view.mode === "view-only") {
      head = render("R-USEVIEW", ctx.lang, {
        title: view.title,
        project: view.project,
        state: view.state,
        reason: view.viewOnly ?? "ceiling",
        ...(view.viewOnly === "automation-run"
          ? {}
          : {
              mode: await ctx.sessions.sessionMode(sessionId, projectId),
              ceiling: ctx.settings.ceilingMode,
            }),
      });
    } else {
      head = render("R-USE", ctx.lang, {
        title: view.title,
        project: view.project,
        state: view.state,
        mode: view.mode,
        count: summary?.messageCount ?? 0,
      });
    }
    const cards: string[] = [];
    const shown: { ask: number; full: boolean }[] = [];
    for (const ask of view.asks) {
      if (ask.kind !== "approval" && ask.kind !== "question") continue;
      cards.push(await ctx.sessions.cardText(ask));
      shown.push({ ask: ask.number, full: false });
    }
    return {
      text: joinReplies(head, ...cards),
      ...(shown.length > 0 ? { shown } : {}),
    };
  },

  last: async (ctx) => {
    const current = ctx.store.get().current;
    if (!current) return noSession(ctx);
    const view = await ctx.sessions.view(current.sessionId, current.projectId);
    const page = await ctx.core.runtimes.loadMessages(
      W,
      current.projectId,
      current.sessionId,
      undefined,
      LAST_LOAD,
    );
    const reply = finalReply(page.messages);
    // Numbers only when they are the ones a bare number answers: the final
    // message's, with no earlier message of the turn numbering first.
    const choices = interfaceChoices(reply);
    const pages = renderLastPages(ctx.lang, refOf(view), reply, {
      choices:
        choices.length > 0 &&
        sameChoices(choices, interfaceChoices(finalMessage(page.messages))),
    });
    const [first, ...rest] = pages;
    ctx.pager.set(rest);
    return { text: first ?? render("R-NOREPLY", ctx.lang) };
  },

  history: async (ctx, command) => {
    const current = ctx.store.get().current;
    if (!current) return noSession(ctx);
    const arg = command.args[0];
    let count = HISTORY_DEFAULT;
    if (arg !== undefined) {
      if (!/^\d+$/.test(arg) || Number(arg) < 1) return argsError(ctx, command);
      count = Math.min(HISTORY_MAX, Number(arg));
    }
    await ctx.sessions.hold(current.projectId);
    const page = await ctx.core.runtimes.loadMessages(
      W,
      current.projectId,
      current.sessionId,
      undefined,
      HISTORY_LOAD,
    );
    const entries = turnsOf(page.messages)
      .slice(-count)
      .flatMap((turn) => [
        ...(turn.user
          ? [{ role: "user" as const, text: toPlainText(turn.user, ctx.lang) }]
          : []),
        ...(turn.assistant
          ? [
              {
                role: "assistant" as const,
                text: toPlainText(
                  expandInterfaceBlocks(turn.assistant, ctx.lang, {
                    plain: true,
                  }),
                  ctx.lang,
                ),
              },
            ]
          : []),
      ]);
    return { text: render("R-HISTORY", ctx.lang, { entries }) };
  },

  stop: async (ctx, command) => {
    const arg = command.args[0];
    if (arg !== undefined && arg !== "all") return argsError(ctx, command);
    const { runtimes } = ctx.core;
    if (arg === "all") {
      let count = 0;
      const tracked = ctx.store.get().tracked;
      for (const sessionId of ctx.sessions.runningWeChatSessions()) {
        if (!ctx.sessions.isLive(sessionId)) continue;
        const projectId =
          tracked.find((entry) => entry.sessionId === sessionId)?.projectId ??
          "";
        const result = await runtimes
          .abort(ctx.sessions.actor(sessionId, projectId), sessionId)
          .catch(() => ({ aborted: false }));
        if (result.aborted) count += 1;
      }
      return { text: render("R-STOPALL", ctx.lang, { count }) };
    }
    const current = ctx.store.get().current;
    if (!current) return noSession(ctx);
    const { sessionId, projectId } = current;
    const longContext = ctx.sessions
      .asksOf(sessionId)
      .find(
        (ask) =>
          ask.kind === "approval" && ask.trigger === "long-context-activation",
      );
    if (longContext) {
      const request = RespondApprovalRequestSchema.parse({
        requestId: longContext.requestId,
        action: "abort",
      });
      let answered = true;
      try {
        await Promise.resolve(
          runtimes.respondApproval(
            ctx.sessions.responder(sessionId, projectId),
            request,
          ),
        );
      } catch (error) {
        // Decided on the computer first: stop the run the ordinary way.
        if (!(error instanceof Error && error.message === APPROVAL_GONE))
          throw error;
        answered = false;
      }
      ctx.asks.close(longContext.number, answered ? "used" : "decided");
      ctx.outbound.retract(`ask:${longContext.number}`);
      if (answered) {
        const view = await ctx.sessions.view(sessionId, projectId);
        return {
          text: render("R-STOP", ctx.lang, {
            title: view.title,
            backgroundTasks: view.tasks.filter(
              (task) => task.status === "running",
            ).length,
          }),
        };
      }
    }
    // `abort` throws for a session that is not live.
    const state = ctx.sessions.runState(sessionId);
    if (
      !ctx.sessions.isLive(sessionId) ||
      (state !== "running" && state !== "waiting")
    )
      return { text: render("R-STOPNONE", ctx.lang) };
    const result = await runtimes.abort(
      ctx.sessions.actor(sessionId, projectId),
      sessionId,
    );
    if (!result.aborted) return { text: render("R-STOPNONE", ctx.lang) };
    const view = await ctx.sessions.view(sessionId, projectId);
    return {
      text: render("R-STOP", ctx.lang, {
        title: view.title,
        backgroundTasks: view.tasks.filter((task) => task.status === "running")
          .length,
      }),
    };
  },

  queue: async (ctx, command) => {
    const current = ctx.store.get().current;
    if (!current) return noSession(ctx);
    const { sessionId, projectId } = current;
    const text = (command.tail ?? "").trim();
    if (!text) {
      const view = await ctx.sessions.view(sessionId, projectId);
      const rows = view.queue.slice(0, PAGE_ROWS);
      if (rows.length > 0)
        ctx.handles.set(
          "queue",
          rows.map((message) => ({ id: message, label: message })),
          sessionId,
        );
      return {
        text: render("R-QUEUE", ctx.lang, {
          rows: rows.map((message, index) => ({ n: index + 1, text: message })),
        }),
        ...(rows.length > 0 ? { numbered: { kind: "queue" as const } } : {}),
      };
    }
    const state = ctx.sessions.runState(sessionId);
    // It joins the steering queue (listed by `.q`, withdrawn by `.recall`); an
    // open card keeps the turn streaming ("waiting"), so that case queues too.
    const running =
      ctx.sessions.isLive(sessionId) &&
      (state === "running" || state === "waiting");
    await ctx.sessions.send({
      sessionId,
      projectId,
      text,
      ...(ctx.inbound.quotedText !== undefined
        ? { quotedText: ctx.inbound.quotedText }
        : {}),
      ...(running ? { behavior: "steer" as const } : {}),
      attachments: ctx.attachments.list().length > 0,
    });
    // An idle session takes it as the next message, as plain text does.
    return running ? { text: render("R-QUEUED", ctx.lang) } : {};
  },

  unqueue: async (ctx, command) => {
    const current = ctx.store.get().current;
    if (!current) return noSession(ctx);
    const { sessionId, projectId } = current;
    const empty = { text: render("R-QUEUE", ctx.lang, { rows: [] }) };
    // `dequeueSteering` throws for a session that is not live.
    if (!ctx.sessions.isLive(sessionId)) return empty;
    const arg = command.args[0];
    let message: string | undefined;
    if (arg !== undefined) {
      const row = ctx.handles.resolve("queue", Number(arg), sessionId);
      if (!row) return refError(ctx, arg, ".q");
      message = row.id;
    } else {
      const view = await ctx.sessions.view(sessionId, projectId);
      message = view.queue.at(-1);
      if (message === undefined) return empty;
    }
    const result = await ctx.core.runtimes.dequeueSteering(
      ctx.sessions.actor(sessionId, projectId),
      message,
      sessionId,
    );
    if (!result.removed)
      return {
        text: render("E-GONE", ctx.lang, { variant: "item", kind: "queue" }),
      };
    return { text: render("R-UNQUEUE", ctx.lang, { text: message }) };
  },

  rename: async (ctx, command) => {
    const current = ctx.store.get().current;
    if (!current) return noSession(ctx);
    const name = (command.tail ?? "").replace(/\s+/g, " ").trim();
    if (!name) return argsError(ctx, command);
    const { sessionId, projectId } = current;
    await ctx.sessions.hold(projectId);
    const title = titleOf(await describeSession(ctx, sessionId, projectId));
    const refusal = await viewOnlyRefusal(ctx, sessionId, projectId, title);
    if (refusal) return refusal;
    const renamed = await ctx.core.runtimes.renameSession(
      ctx.sessions.actor(sessionId, projectId),
      projectId,
      sessionId,
      name,
      "user",
    );
    ctx.core.notifyLibraryChanged("sessions");
    return {
      text: render("R-RENAME", ctx.lang, { title: renamed.name ?? name }),
    };
  },

  delete: async (ctx, command) => {
    const confirmed = ctx.confirmed;
    if (confirmed?.command.name === "delete") {
      const { sessionId, projectId } = confirmed.resolved;
      if (!sessionId || !projectId)
        return {
          text: render("E-GONE", ctx.lang, {
            variant: "item",
            kind: "session",
          }),
        };
      return executeDelete(ctx, { sessionId, projectId });
    }
    // Never defaults to the current session.
    if (command.args.length === 0 && !command.tail?.trim())
      return argsError(ctx, command);
    const resolved = await resolveSession(ctx, command, { pushSlot: false });
    if (resolved.kind === "reply") return resolved.result;
    const target = resolved.value;
    let project: PineProject;
    try {
      project = await ctx.sessions.hold(target.projectId);
    } catch {
      return {
        text: render("E-GONE", ctx.lang, { variant: "item", kind: "session" }),
      };
    }
    const summary = await describeSession(
      ctx,
      target.sessionId,
      target.projectId,
    );
    if (!summary && !ctx.sessions.isLive(target.sessionId))
      return {
        text: render("E-GONE", ctx.lang, { variant: "item", kind: "session" }),
      };
    const title = titleOf(summary);
    const refusal = await deleteRefusal(ctx, target, title);
    if (refusal) return refusal;
    const ask = ctx.asks.open({
      kind: "confirm",
      command,
      resolved: {
        sessionId: target.sessionId,
        projectId: target.projectId,
        title,
      },
    });
    if (!ask) throw new Error("No ask number is free.");
    return {
      text: render("R-DELETE-ASK", ctx.lang, {
        title,
        project: projectLabel(project, ctx.lang),
        count: summary?.messageCount ?? 0,
        ask: ask.number,
      }),
      shown: [{ ask: ask.number, full: false }],
    };
  },
};
