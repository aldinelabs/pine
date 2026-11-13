// Handlers: help status info lang pause more drop. None of them
// writes a WeChat or Pine setting (invariant 6): `.lang` changes only the
// reply language kept in the bridge state, and `.pause` can only turn the
// bridge off; resuming is local.

import { lookupCommand, specOf, suggestCommand } from "../commandSpec";
import { notice } from "../notices";
import { render, type AskSummary, type SessionState } from "../replies";
import { clampMode, projectLabel } from "../sessionDirectory";
import type { Ask, HandleRow, ReplyLanguage } from "../types";
import type { CommandContext, CommandHandlers, CommandResult } from "./types";

/** Other running or waiting tracked sessions `.status` lists. */
const STATUS_OTHERS_MAX = 5;

function argsError(
  ctx: CommandContext,
  name: Parameters<typeof specOf>[0],
): CommandResult {
  return { text: render("E-ARGS", ctx.lang, { spec: specOf(name) }) };
}

function askSummary(ask: Ask, title?: string): AskSummary {
  return {
    number: ask.number,
    kind: ask.kind,
    ...(ask.kind === "approval" ? { tool: ask.toolName } : {}),
    ...(title ? { title } : {}),
  };
}

const LANGUAGES: Record<string, ReplyLanguage | "auto"> = {
  zh: "zh",
  cn: "zh",
  中文: "zh",
  en: "en",
  english: "en",
  英文: "en",
  auto: "auto",
  自动: "auto",
};

export const metaHandlers: CommandHandlers = {
  help: (ctx, command) => {
    const topic = command.args[0]?.replace(/^[.。．｡]+/u, "");
    if (topic === undefined || topic === "")
      return Promise.resolve({
        text: render("R-HELP", ctx.lang, {
          computer: ctx.host.computerName,
          ceiling: ctx.settings.ceilingMode,
          files: ctx.settings.allowFileSending,
        }),
      });
    if (topic === "2")
      return Promise.resolve({ text: render("R-HELP2", ctx.lang) });
    const name = lookupCommand(topic);
    if (name)
      return Promise.resolve({
        text: render("R-HELP1", ctx.lang, { spec: specOf(name) }),
      });
    const suggestion = suggestCommand(topic);
    return Promise.resolve({
      text: render("E-UNKNOWN", ctx.lang, {
        token: topic,
        ...(suggestion ? { suggestion } : {}),
      }),
    });
  },

  status: async (ctx) => {
    const state = ctx.store.get();
    const current = state.current;
    if (!current) {
      const projectId = state.currentProjectId;
      let project = projectLabel(undefined, ctx.lang);
      if (projectId !== undefined) {
        try {
          project = projectLabel(
            await ctx.core.repository.get(projectId),
            ctx.lang,
          );
        } catch {
          // A project that went away reads as "No Project".
        }
      }
      return {
        text: render("R-STATUS0", ctx.lang, {
          project,
          mode: clampMode(ctx.settings.defaultMode, ctx.settings.ceilingMode),
        }),
      };
    }
    const view = await ctx.sessions.view(current.sessionId, current.projectId);
    const others: {
      n: number;
      state: SessionState;
      title: string;
      project: string;
    }[] = [];
    const rows: HandleRow[] = [];
    for (const entry of state.tracked) {
      if (others.length >= STATUS_OTHERS_MAX) break;
      if (entry.sessionId === current.sessionId) continue;
      const runState = ctx.sessions.runState(entry.sessionId);
      if (runState !== "running" && runState !== "waiting") continue;
      try {
        const other = await ctx.sessions.view(entry.sessionId, entry.projectId);
        others.push({
          n: others.length + 1,
          state: runState,
          title: other.title,
          project: other.project,
        });
        rows.push({
          id: entry.sessionId,
          label: other.title,
          projectId: entry.projectId,
        });
      } catch {
        // A session whose project cannot be opened is left out.
      }
    }
    if (rows.length > 0) ctx.handles.set("session", rows);
    const usage = view.contextUsage;
    return {
      text: render("R-STATUS", ctx.lang, {
        at: { project: view.project, title: view.title },
        state: view.state,
        ...(view.runStartedAtMs !== undefined
          ? { runningMs: ctx.now - view.runStartedAtMs }
          : {}),
        ...(view.todos ? { todos: view.todos } : {}),
        ...(usage?.percent !== undefined && usage.percent !== null
          ? { contextPercent: usage.percent }
          : {}),
        ...(usage && usage.cost > 0 ? { costUsd: usage.cost } : {}),
        asks: view.asks.map((ask) => askSummary(ask)),
        others,
      }),
      ...(rows.length > 0 ? { numbered: { kind: "session" as const } } : {}),
    };
  },

  info: (ctx) => {
    const secure = ctx.store.secure();
    return Promise.resolve({
      text: render("R-INFO", ctx.lang, {
        computer: ctx.host.computerName,
        version: ctx.host.version,
        ceiling: ctx.settings.ceilingMode,
        defaultMode: clampMode(
          ctx.settings.defaultMode,
          ctx.settings.ceilingMode,
        ),
        highRisk: ctx.settings.allowHighRiskApprovals,
        files: ctx.settings.allowFileSending,
        language: ctx.store.get().language,
        ...(secure.owner ? { boundAt: secure.owner.boundAt } : {}),
      }),
    });
  },

  lang: async (ctx, command) => {
    const arg = command.args[0];
    const language = arg === undefined ? undefined : LANGUAGES[arg];
    if (language === undefined) return argsError(ctx, "lang");
    await ctx.store.update((draft) => {
      draft.language = language;
    });
    // The confirmation is already in the chosen language; "auto" keeps the
    // current one until the next message resolves it.
    const replyLang = language === "auto" ? ctx.lang : language;
    return { text: render("R-LANG", replyLang, { language }) };
  },

  pause: async (ctx, command) => {
    const arg = command.args[0];
    if (arg !== undefined && arg !== "all") return argsError(ctx, "pause");
    let stopped = 0;
    if (arg === "all") {
      // After pausing nothing is accepted, so `all` acts first.
      const tracked = ctx.store.get().tracked;
      for (const sessionId of ctx.sessions.runningWeChatSessions()) {
        if (!ctx.sessions.isLive(sessionId)) continue;
        const projectId =
          tracked.find((entry) => entry.sessionId === sessionId)?.projectId ??
          "";
        const result = await ctx.core.runtimes
          .abort(ctx.sessions.actor(sessionId, projectId), sessionId)
          .catch(() => ({ aborted: false }));
        if (result.aborted) stopped += 1;
      }
    }
    await ctx.bridge.pause();
    const running = ctx.sessions.runningWeChatSessions().length;
    try {
      ctx.host.notify({
        kind: "paused",
        ...notice("paused", ctx.lang, { running }),
      });
    } catch {
      // A failed notification never blocks the reply.
    }
    return {
      text:
        arg === "all"
          ? render("R-PAUSEALL", ctx.lang, { stopped })
          : render("R-PAUSE", ctx.lang, { running }),
    };
  },

  more: (ctx) => {
    const page = ctx.pager.next();
    if (!page) return Promise.resolve({ text: render("R-NOMORE", ctx.lang) });
    if (!page.list) return Promise.resolve({ text: page.text });
    ctx.handles.set(page.list.kind, page.list.rows, page.list.sessionId);
    return Promise.resolve({
      text: page.text,
      numbered: { kind: page.list.kind },
    });
  },

  drop: async (ctx) => {
    const count = await ctx.attachments.drop();
    return { text: render("R-DROP", ctx.lang, { count }) };
  },
};
