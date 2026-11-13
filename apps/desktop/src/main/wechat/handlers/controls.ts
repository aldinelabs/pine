// Handlers: model effort mode usage compact todo (CMD §7.3).
//
// Calls that act on a session use `actor(session)`; ask responses use
// `responder(session)`. Liveness is tested first: `compact` and
// `setApprovalMode` throw for a session that is not live.

import {
  APPROVAL_MODE_ORDER,
  approvalModeWithin,
  type PineApprovalMode,
} from "../../../shared/agent";
import type {
  PineModelCatalog,
  PineModelDescriptor,
  PineModelSelection,
  PineThinkingLevel,
} from "../../../shared/models";
import type { PineSessionSummary } from "../../../shared/sessions";
import { WECHAT_CLIENT_ID } from "../../../shared/wechatRemote";
import { RespondApprovalRequestSchema } from "../../core/requestSchemas";
import { specOf } from "../commandSpec";
import { PAGE_ROWS } from "../constants";
import { notice } from "../notices";
import { resolveRef } from "../parseCommand";
import type { PagerPage } from "../handles";
import { parseMode, render, type SessionRef } from "../replies";
import type { ApprovalAsk, HandleRow, ParsedCommand } from "../types";
import type { CommandContext, CommandHandlers, CommandResult } from "./types";

const W = WECHAT_CLIENT_ID;
const APPROVAL_GONE = "This approval request is no longer pending.";

/** CMD §7.3 order; `.effort N` numbers the supported ones in this order. */
const THINKING_ORDER: readonly PineThinkingLevel[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

/** The GUI's default when a model does not support the current level (`stores/models.ts`). */
const DEFAULT_THINKING_PRIORITY: readonly PineThinkingLevel[] = [
  "medium",
  "high",
  "low",
  "xhigh",
  "max",
  "off",
];

const THINKING_WORDS: Record<string, PineThinkingLevel> = {
  off: "off",
  minimal: "minimal",
  low: "low",
  medium: "medium",
  mid: "medium",
  high: "high",
  xhigh: "xhigh",
  max: "max",
  关: "off",
  最低: "minimal",
  低: "low",
  中: "medium",
  高: "high",
  很高: "xhigh",
  最高: "max",
};

const TODO_STATUSES = ["pending", "in_progress", "completed"] as const;

// ---------------------------------------------------------------------------
// Shared pieces

interface Current {
  sessionId: string;
  projectId: string;
}

function reply(text: string): CommandResult {
  return { text };
}

function pick(ctx: CommandContext, zh: string, en: string): string {
  return ctx.lang === "zh" ? zh : en;
}

function currentOf(ctx: CommandContext): Current | undefined {
  const current = ctx.store.get().current;
  return current
    ? { sessionId: current.sessionId, projectId: current.projectId }
    : undefined;
}

function noSession(ctx: CommandContext): CommandResult {
  return reply(render("E-NOSESSION", ctx.lang));
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

function rank(mode: PineApprovalMode): number {
  return APPROVAL_MODE_ORDER.indexOf(mode);
}

async function sessionRef(
  ctx: CommandContext,
  current: Current,
): Promise<SessionRef> {
  try {
    const view = await ctx.sessions.view(current.sessionId, current.projectId);
    return { project: view.project, title: view.title };
  } catch {
    const live = ctx.core.runtimes.summaryOfLiveSession(current.sessionId);
    return { project: "", title: live?.name ?? live?.preview ?? "" };
  }
}

/** `E-VIEWRUN` for an automation run, else `E-VIEW` with the way out. */
async function viewRefusal(
  ctx: CommandContext,
  current: Current,
): Promise<CommandResult> {
  const at = await sessionRef(ctx, current);
  const reason = await ctx.sessions.viewOnlyReason(
    current.sessionId,
    current.projectId,
  );
  if (reason === "automation-run")
    return reply(render("E-VIEWRUN", ctx.lang, { title: at.title }));
  return reply(
    render("E-VIEW", ctx.lang, {
      title: at.title,
      mode: await ctx.sessions.sessionMode(
        current.sessionId,
        current.projectId,
      ),
      ceiling: ctx.settings.ceilingMode,
    }),
  );
}

async function isViewOnly(
  ctx: CommandContext,
  current: Current,
): Promise<boolean> {
  return (
    (await ctx.sessions.modeFor(current.sessionId, current.projectId)) ===
    "view-only"
  );
}

/** The live summary, else the stored one (the project is held first). */
async function summaryOf(
  ctx: CommandContext,
  current: Current,
): Promise<PineSessionSummary | undefined> {
  const live = ctx.core.runtimes.sessionSummary(current.sessionId);
  if (live) return live;
  try {
    await ctx.sessions.hold(current.projectId);
    const service = ctx.core
      .sessionLibrary()
      .openSessionService(current.projectId);
    return service
      ? (await service.describeSession(current.sessionId)).summary
      : undefined;
  } catch {
    return undefined;
  }
}

async function catalogOf(
  ctx: CommandContext,
): Promise<PineModelCatalog | undefined> {
  try {
    return await ctx.core.runtimes.getModelCatalog();
  } catch {
    return undefined;
  }
}

async function selectionOf(
  ctx: CommandContext,
  current: Current | undefined,
  catalog: PineModelCatalog | undefined,
): Promise<PineModelSelection | undefined> {
  const stored = current
    ? (await summaryOf(ctx, current))?.modelSelection
    : undefined;
  return stored ?? catalog?.selection;
}

function findModel(
  catalog: PineModelCatalog | undefined,
  selection: Pick<PineModelSelection, "providerId" | "modelId"> | undefined,
): PineModelDescriptor | undefined {
  if (!catalog || !selection) return undefined;
  return catalog.models.find(
    (model) =>
      model.providerId === selection.providerId &&
      model.id === selection.modelId,
  );
}

function supportedLevels(model: PineModelDescriptor): PineThinkingLevel[] {
  return THINKING_ORDER.filter((level) =>
    model.supportedThinkingLevels.includes(level),
  );
}

function defaultLevel(model: PineModelDescriptor): PineThinkingLevel {
  return (
    DEFAULT_THINKING_PRIORITY.find((level) =>
      model.supportedThinkingLevels.includes(level),
    ) ?? "off"
  );
}

function modelRowId(model: Pick<PineModelDescriptor, "providerId" | "id">) {
  return JSON.stringify([model.providerId, model.id]);
}

function parseModelRowId(
  id: string,
): { providerId: string; modelId: string } | undefined {
  try {
    const value: unknown = JSON.parse(id);
    if (
      Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "string" &&
      typeof value[1] === "string"
    )
      return { providerId: value[0], modelId: value[1] };
  } catch {
    // Not a model row.
  }
  return undefined;
}

/** Models of configured providers, recommended first (GUI 3.2). */
function offeredModels(catalog: PineModelCatalog): PineModelDescriptor[] {
  const configured = new Set(
    catalog.providers
      .filter((provider) => provider.configured)
      .map((provider) => provider.id),
  );
  const models = catalog.models.filter((model) =>
    configured.has(model.providerId),
  );
  const recommended = catalog.recommendedModelIds ?? [];
  const position = (model: PineModelDescriptor) => {
    const index = recommended.findIndex(
      (id) => id === model.id || id === `${model.providerId}/${model.id}`,
    );
    return index < 0 ? recommended.length : index;
  };
  return models
    .map((model, index) => ({ model, index }))
    .sort((a, b) => position(a.model) - position(b.model) || a.index - b.index)
    .map((entry) => entry.model);
}

/** Selects a model for the current session, `sessionId` always passed (D7). */
async function applyModel(
  ctx: CommandContext,
  current: Current,
  model: PineModelDescriptor,
  thinkingLevel: PineThinkingLevel,
): Promise<void> {
  await ctx.sessions.hold(current.projectId);
  const actor = ctx.sessions.actor(current.sessionId, current.projectId);
  await ctx.core.runtimes.selectModel(actor, {
    providerId: model.providerId,
    modelId: model.id,
    thinkingLevel,
    sessionId: current.sessionId,
    projectId: current.projectId,
  });
}

// ---------------------------------------------------------------------------
// .model

async function model(
  ctx: CommandContext,
  command: ParsedCommand,
): Promise<CommandResult> {
  const current = currentOf(ctx);
  const ref = command.args[0] ?? command.tail;
  const catalog = await catalogOf(ctx);
  const offered = catalog ? offeredModels(catalog) : [];

  if (ref === undefined || ref.trim() === "") {
    const selection = await selectionOf(ctx, current, catalog);
    const rows = offered.map((entry, index) => ({
      n: (index % PAGE_ROWS) + 1,
      model: entry.name,
      provider: entry.providerName,
      current:
        selection?.providerId === entry.providerId &&
        selection.modelId === entry.id,
    }));
    const handleRows = offered.map((entry): HandleRow => ({
      id: modelRowId(entry),
      label: entry.name,
    }));
    if (offered.length === 0)
      return reply(render("R-MODELS", ctx.lang, { rows: [] }));
    const pages: PagerPage[] = [];
    for (let start = PAGE_ROWS; start < rows.length; start += PAGE_ROWS) {
      pages.push({
        text: render("R-MODELS", ctx.lang, {
          rows: rows.slice(start, start + PAGE_ROWS),
        }),
        list: {
          kind: "model",
          rows: handleRows.slice(start, start + PAGE_ROWS),
        },
      });
    }
    if (pages.length > 0) ctx.pager.set(pages);
    ctx.handles.set("model", handleRows.slice(0, PAGE_ROWS));
    const first = render("R-MODELS", ctx.lang, {
      rows: rows.slice(0, PAGE_ROWS),
    });
    return {
      text:
        pages.length > 0
          ? `${first}\n${render("R-PAGE", ctx.lang, { index: 1, count: pages.length + 1, truncated: false })}`
          : first,
      numbered: { kind: "model" },
    };
  }

  if (!current) return noSession(ctx);
  let target: PineModelDescriptor | undefined;
  if (command.args[0] !== undefined) {
    const n = Number(command.args[0]);
    const row = ctx.handles.resolve("model", n);
    const id = row ? parseModelRowId(row.id) : undefined;
    target = id
      ? findModel(catalog, { providerId: id.providerId, modelId: id.modelId })
      : undefined;
    if (!target)
      return reply(
        render("E-REF", ctx.lang, { n: command.args[0], list: ".m" }),
      );
  } else {
    const query = ref.trim();
    const rows = offered.map((entry) => ({ entry, label: entry.name }));
    const match = resolveRef(rows, query);
    if (match.kind === "none") {
      const byId = resolveRef(
        offered.map((entry) => ({ entry, label: entry.id })),
        query,
      );
      if (byId.kind === "one") target = byId.row.entry;
      else
        return reply(render("E-NOMATCH", ctx.lang, { query, kind: "model" }));
    } else if (match.kind === "many") {
      const shown = match.rows.slice(0, PAGE_ROWS);
      ctx.handles.set(
        "model",
        shown.map((row) => ({ id: modelRowId(row.entry), label: row.label })),
      );
      return {
        text: render("R-MATCHES", ctx.lang, {
          query,
          rows: shown.map((row, index) => ({
            n: index + 1,
            label: `${row.entry.name} · ${row.entry.providerName}`,
          })),
        }),
        numbered: { kind: "model" },
      };
    } else {
      target = match.row.entry;
    }
  }

  if (await isViewOnly(ctx, current)) return viewRefusal(ctx, current);
  const selection = await selectionOf(ctx, current, catalog);
  const keep =
    selection &&
    target.supportedThinkingLevels.includes(selection.thinkingLevel)
      ? selection.thinkingLevel
      : defaultLevel(target);
  await applyModel(ctx, current, target, keep);
  return reply(
    render("R-MODEL", ctx.lang, {
      at: await sessionRef(ctx, current),
      model: target.name,
      effort: keep,
    }),
  );
}

// ---------------------------------------------------------------------------
// .effort

async function effort(
  ctx: CommandContext,
  command: ParsedCommand,
): Promise<CommandResult> {
  const current = currentOf(ctx);
  if (!current) return noSession(ctx);
  const catalog = await catalogOf(ctx);
  const selection = await selectionOf(ctx, current, catalog);
  const descriptor = findModel(catalog, selection);
  if (!descriptor || !selection)
    return argsError(
      ctx,
      "effort",
      pick(ctx, "先用 .m 选择模型", "Pick a model with .m first"),
    );
  const levels = supportedLevels(descriptor);
  const arg = command.args[0];

  if (arg === undefined) {
    ctx.handles.set(
      "effort",
      levels.map((level) => ({ id: level, label: level })),
    );
    return {
      text: render("R-EFFORTS", ctx.lang, {
        rows: levels.map((level, index) => ({
          n: index + 1,
          level,
          current: level === selection.thinkingLevel,
        })),
      }),
      numbered: { kind: "effort" },
    };
  }

  const level = /^\d+$/.test(arg)
    ? levels[Number(arg) - 1]
    : THINKING_WORDS[arg.trim()];
  if (!level || !levels.includes(level)) {
    return argsError(
      ctx,
      "effort",
      levels.map((value, index) => `${index + 1} ${value}`).join(" · "),
    );
  }
  if (await isViewOnly(ctx, current)) return viewRefusal(ctx, current);
  await applyModel(ctx, current, descriptor, level);
  return reply(render("R-EFFORT", ctx.lang, { level }));
}

// ---------------------------------------------------------------------------
// .mode

async function mode(
  ctx: CommandContext,
  command: ParsedCommand,
): Promise<CommandResult> {
  const confirmed =
    ctx.confirmed?.command.name === "mode" ? ctx.confirmed : undefined;
  const resolvedSession = confirmed?.resolved.sessionId;
  const resolvedProject = confirmed?.resolved.projectId;
  const current: Current | undefined =
    resolvedSession && resolvedProject
      ? { sessionId: resolvedSession, projectId: resolvedProject }
      : currentOf(ctx);
  if (!current) return noSession(ctx);
  const ceiling = ctx.settings.ceilingMode;
  const base = await ctx.sessions.sessionMode(
    current.sessionId,
    current.projectId,
  );
  const arg = command.args[0];

  if (arg === undefined) {
    ctx.handles.set(
      "mode",
      APPROVAL_MODE_ORDER.map((value) => ({ id: value, label: value })),
    );
    return {
      text: render("R-MODES", ctx.lang, { current: base, ceiling }),
      numbered: { kind: "mode" },
    };
  }

  const target =
    confirmed?.resolved.mode !== undefined
      ? parseMode(confirmed.resolved.mode)
      : parseMode(arg);
  if (!target) return argsError(ctx, "mode");

  const viewOnly = await ctx.sessions.viewOnlyReason(
    current.sessionId,
    current.projectId,
  );
  // An automation run is never changed from WeChat (D8).
  if (viewOnly === "automation-run") return viewRefusal(ctx, current);
  const tightening = rank(target) <= rank(base);
  if (!tightening) {
    if (viewOnly) return viewRefusal(ctx, current);
    if (!approvalModeWithin(target, ceiling))
      return reply(render("E-CEIL", ctx.lang, { ceiling }));
    if (target === "YOLO" && !confirmed) {
      const at = await sessionRef(ctx, current);
      const ask = ctx.asks.open({
        kind: "confirm",
        command,
        resolved: {
          sessionId: current.sessionId,
          projectId: current.projectId,
          mode: target,
        },
      });
      if (!ask) return reply(render("E-FAIL", ctx.lang));
      return reply(
        render("R-YOLO-ASK", ctx.lang, { title: at.title, ask: ask.number }),
      );
    }
  }

  if (ctx.sessions.isLive(current.sessionId)) {
    const actor = ctx.sessions.actor(current.sessionId, current.projectId);
    await ctx.core.runtimes.setApprovalMode(actor, target, current.sessionId);
    if (ctx.store.get().modeOverride[current.sessionId] !== undefined) {
      await ctx.store.update((draft) => {
        delete draft.modeOverride[current.sessionId];
      });
    }
  } else {
    await ctx.store.update((draft) => {
      draft.modeOverride[current.sessionId] = target;
    });
  }

  const at = await sessionRef(ctx, current);
  if (target === "YOLO" && base !== "YOLO") {
    const texts = notice("mode-raised", ctx.lang, {
      project: at.project,
      title: at.title,
      mode: target,
    });
    try {
      ctx.host.notify({
        kind: "mode-raised",
        ...texts,
        projectId: current.projectId,
        sessionId: current.sessionId,
      });
    } catch {
      // A failed notification never undoes the change.
    }
  }
  const data = { at, mode: target, ceiling };
  return reply(
    render(
      target === "let-me-review" ? "R-MODE-REVIEW" : "R-MODE",
      ctx.lang,
      data,
    ),
  );
}

// ---------------------------------------------------------------------------
// .usage

async function usage(ctx: CommandContext): Promise<CommandResult> {
  const current = currentOf(ctx);
  if (!current) return noSession(ctx);
  const view = await ctx.sessions.view(current.sessionId, current.projectId);
  const summary = await summaryOf(ctx, current);
  const catalog = await catalogOf(ctx);
  const selection = summary?.modelSelection ?? catalog?.selection;
  const descriptor = findModel(catalog, selection);
  const usageData = view.contextUsage;
  if (!usageData && !selection) return reply(render("R-USAGE-NONE", ctx.lang));
  const modeNow = await ctx.sessions.sessionMode(
    current.sessionId,
    current.projectId,
  );
  return reply(
    render("R-USAGE", ctx.lang, {
      at: { project: view.project, title: view.title },
      ...(selection ? { model: descriptor?.name ?? selection.modelId } : {}),
      ...(selection ? { effort: selection.thinkingLevel } : {}),
      mode: modeNow,
      ceiling: ctx.settings.ceilingMode,
      ...(usageData?.tokens !== null && usageData?.tokens !== undefined
        ? { contextTokens: usageData.tokens }
        : {}),
      ...(usageData ? { contextWindow: usageData.contextWindow } : {}),
      ...(usageData?.percent !== null && usageData?.percent !== undefined
        ? { contextPercent: usageData.percent }
        : {}),
      ...(usageData?.cacheHitRate !== null &&
      usageData?.cacheHitRate !== undefined
        ? { cacheHitPercent: usageData.cacheHitRate * 100 }
        : {}),
      ...(usageData ? { costUsd: usageData.cost } : {}),
      count: summary?.messageCount ?? 0,
    }),
  );
}

// ---------------------------------------------------------------------------
// .compact

/** Answers a long-context card with "compress, then continue". */
async function compactAsk(
  ctx: CommandContext,
  ask: ApprovalAsk,
): Promise<CommandResult> {
  if (
    (await ctx.sessions.modeFor(ask.sessionId, ask.projectId)) === "view-only"
  )
    return viewRefusal(ctx, {
      sessionId: ask.sessionId,
      projectId: ask.projectId,
    });
  if (ctx.asks.get(ask.number) !== ask)
    return reply(render("E-DONE", ctx.lang, { ask: ask.number }));
  const request = RespondApprovalRequestSchema.parse({
    requestId: ask.requestId,
    action: "compact",
  });
  const responder = ctx.sessions.responder(ask.sessionId, ask.projectId);
  try {
    await Promise.resolve(
      ctx.core.runtimes.respondApproval(responder, request),
    );
  } catch (error) {
    if (!(error instanceof Error && error.message === APPROVAL_GONE))
      throw error;
    ctx.asks.close(ask.number, "decided");
    ctx.outbound.retract(`ask:${ask.number}`);
    return reply(render("E-DONE", ctx.lang, { ask: ask.number }));
  }
  ctx.asks.close(ask.number, "used");
  ctx.outbound.retract(`ask:${ask.number}`);
  return reply(render("R-COMPACTING", ctx.lang));
}

function isLongContext(ask: unknown): ask is ApprovalAsk {
  return (
    typeof ask === "object" &&
    ask !== null &&
    (ask as ApprovalAsk).kind === "approval" &&
    (ask as ApprovalAsk).trigger === "long-context-activation"
  );
}

async function compact(
  ctx: CommandContext,
  command: ParsedCommand,
): Promise<CommandResult> {
  const arg = command.args[0];
  if (arg !== undefined) {
    const n = /^\d+$/.test(arg) ? Number(arg) : Number.NaN;
    const ask = Number.isNaN(n) ? undefined : ctx.asks.get(n);
    if (isLongContext(ask)) return compactAsk(ctx, ask);
    if (!Number.isNaN(n) && ctx.asks.status(n) === "tombstone")
      return reply(render("E-DONE", ctx.lang, { ask: n }));
    // `.c` is not "cancel": another ask number compacts nothing.
    return argsError(
      ctx,
      "compact",
      ask
        ? pick(ctx, `要拒绝 ${n} 请用 .d ${n}`, `To reject ${n}, use .d ${n}`)
        : undefined,
    );
  }

  const current = currentOf(ctx);
  if (!current) return noSession(ctx);
  const open = ctx.asks.list();
  const only = open[0];
  if (
    open.length === 1 &&
    isLongContext(only) &&
    only.sessionId === current.sessionId
  )
    return compactAsk(ctx, only);

  if (await isViewOnly(ctx, current)) return viewRefusal(ctx, current);
  if (!ctx.sessions.isLive(current.sessionId))
    return reply(render("R-COMPACT-IDLE", ctx.lang));
  const actor = ctx.sessions.actor(current.sessionId, current.projectId);
  return {
    text: render("R-COMPACTING", ctx.lang),
    after: async () => {
      let error: string | undefined;
      try {
        const result = await ctx.core.runtimes.compact(
          actor,
          current.sessionId,
        );
        if (!result.compacted)
          error = pick(ctx, "没有可压缩的内容", "nothing to compact");
      } catch (cause) {
        error =
          cause instanceof Error
            ? cause.message
            : pick(ctx, "未知错误", "unknown error");
      }
      await ctx.outbound.reply(
        render("R-COMPACTED", ctx.lang, {
          at: await sessionRef(ctx, current),
          ...(error !== undefined ? { error } : {}),
        }),
      );
    },
  };
}

// ---------------------------------------------------------------------------
// .todo

async function todo(ctx: CommandContext): Promise<CommandResult> {
  const current = currentOf(ctx);
  if (!current) return noSession(ctx);
  await ctx.sessions.hold(current.projectId);
  let tasks: { status: string; subject: string }[] = [];
  try {
    const page = await ctx.core.runtimes.loadMessages(
      W,
      current.projectId,
      current.sessionId,
      undefined,
      1,
      true,
    );
    tasks = page.todos?.tasks ?? [];
  } catch {
    tasks = [];
  }
  const items = tasks.flatMap((task) => {
    const status = TODO_STATUSES.find((value) => value === task.status);
    return status ? [{ status, subject: task.subject }] : [];
  });
  return reply(
    render("R-TODO", ctx.lang, { at: await sessionRef(ctx, current), items }),
  );
}

export const controlHandlers: CommandHandlers = {
  model,
  effort,
  mode,
  usage,
  compact,
  todo,
};
