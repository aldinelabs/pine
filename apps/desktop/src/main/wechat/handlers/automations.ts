// Handlers: autos auto runs. WeChat never enables an automation
// itself: `.auto N on` raises the same approval card an agent request would
// (marked as from WeChat) and returns at once; the outcome is pushed later.
// `.auto N run` needs an Autonomous ceiling, an enabled automation and a
// confirmation. Replies carry facts only, never the spec or a secret.

import { approvalModeWithin } from "../../../shared/agent";
import type {
  AutomationFacts,
  AutomationFolderLabel,
  AutomationRunStatus,
  AutomationSummary,
  AutomationTriggerFact,
} from "../../../shared/automation";
import { specOf } from "../commandSpec";
import { PAGE_ROWS } from "../constants";
import { notice } from "../notices";
import { autoActionOf as actionOf, resolveRef } from "../parseCommand";
import { joinReplies, render } from "../replies";
import type {
  CommandName,
  HandleKind,
  HandleRow,
  ParsedCommand,
  ReplyLanguage,
} from "../types";
import type {
  CommandContext,
  CommandHandler,
  CommandHandlers,
  CommandResult,
} from "./types";

/** How many runs `.runs` lists (across pages). */
const RUNS_LIMIT = 40;

type Picked<T> = { value: T } | { result: CommandResult };

function chunk<T>(items: readonly T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let index = 0; index < items.length; index += size)
    pages.push(items.slice(index, index + size));
  return pages;
}

/** A list reply: page 1 now, the rest behind `.more`; rows numbered 1–8 per page. */
function numberedList<T>(
  ctx: CommandContext,
  kind: HandleKind,
  items: readonly T[],
  handle: (item: T) => HandleRow,
  renderPage: (page: { n: number; item: T }[]) => string,
): CommandResult {
  const pages = chunk(items, PAGE_ROWS);
  if (pages.length === 0) {
    ctx.pager.clear();
    return { text: renderPage([]) };
  }
  const built = pages.map((page, index) => {
    const body = renderPage(page.map((item, i) => ({ n: i + 1, item })));
    const footer =
      pages.length > 1
        ? render("R-PAGE", ctx.lang, {
            index: index + 1,
            count: pages.length,
            truncated: false,
          })
        : "";
    return {
      text: joinReplies(body, footer),
      rows: page.map(handle),
    };
  });
  const [first, ...rest] = built;
  if (!first) return {};
  ctx.handles.set(kind, first.rows);
  ctx.pager.set(
    rest.map((page) => ({ text: page.text, list: { kind, rows: page.rows } })),
  );
  return { text: first.text, numbered: { kind } };
}

/** A handle (all digits) or a name matched against `rows`. */
async function pickRow(
  ctx: CommandContext,
  kind: HandleKind,
  ref: string,
  listCommand: string,
  rows: () => Promise<HandleRow[]>,
): Promise<Picked<HandleRow>> {
  if (/^\d+$/.test(ref)) {
    const row = ctx.handles.resolve(kind, Number(ref));
    return row
      ? { value: row }
      : {
          result: {
            text: render("E-REF", ctx.lang, { n: ref, list: listCommand }),
          },
        };
  }
  const match = resolveRef(await rows(), ref);
  if (match.kind === "one") return { value: match.row };
  if (match.kind === "none")
    return {
      result: { text: render("E-NOMATCH", ctx.lang, { query: ref, kind }) },
    };
  return {
    result: numberedList(
      ctx,
      kind,
      match.rows,
      (row) => row,
      (page) =>
        render("R-MATCHES", ctx.lang, {
          query: ref,
          rows: page.map(({ n, item }) => ({ n, label: item.label })),
        }),
    ),
  };
}

function usage(ctx: CommandContext, name: CommandName): CommandResult {
  return { text: render("E-ARGS", ctx.lang, { spec: specOf(name) }) };
}

function automationRow(automation: AutomationSummary): HandleRow {
  return {
    id: automation.id,
    label: automation.name,
    projectId: automation.projectId,
  };
}

function stateOf(automation: AutomationSummary): "on" | "off" | "paused" {
  if (automation.status === "active") return "on";
  return automation.status === "paused" ? "paused" : "off";
}

const RUN_STATUS: Record<AutomationRunStatus, Record<ReplyLanguage, string>> = {
  running: { zh: "运行中", en: "running" },
  findings: { zh: "有发现", en: "findings" },
  nothing: { zh: "无事发生", en: "nothing found" },
  failed: { zh: "失败", en: "failed" },
  interrupted: { zh: "中断", en: "interrupted" },
  skipped: { zh: "跳过", en: "skipped" },
};

function runStatus(lang: ReplyLanguage, status: AutomationRunStatus): string {
  return RUN_STATUS[status][lang];
}

function parseTime(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

async function pickProject(
  ctx: CommandContext,
  ref: string,
): Promise<Picked<string>> {
  const picked = await pickRow(ctx, "project", ref, ".p", async () =>
    (await ctx.core.repository.list()).map((project) => ({
      id: project.id,
      label: project.name,
    })),
  );
  return "result" in picked ? picked : { value: picked.value.id };
}

/** The automation of `ref`, fresh from the service. */
async function pickAutomation(
  ctx: CommandContext,
  ref: string,
): Promise<Picked<AutomationSummary>> {
  const picked = await pickRow(ctx, "automation", ref, ".au", async () =>
    (await ctx.core.automations.list()).map(automationRow),
  );
  if ("result" in picked) return picked;
  return findAutomation(ctx, picked.value.projectId, picked.value.id);
}

async function findAutomation(
  ctx: CommandContext,
  projectId: string | undefined,
  automationId: string,
): Promise<Picked<AutomationSummary>> {
  const found = (await ctx.core.automations.list(projectId)).find(
    (automation) => automation.id === automationId,
  );
  return found
    ? { value: found }
    : {
        result: {
          text: render("E-GONE", ctx.lang, {
            variant: "item",
            kind: "automation",
          }),
        },
      };
}

// ---------------------------------------------------------------------------
// Facts in words (never the spec)

function folders(labels: readonly AutomationFolderLabel[]): string {
  return labels.map((label) => label.folderName).join(", ");
}

function triggerWords(lang: ReplyLanguage, trigger: AutomationTriggerFact) {
  const zh = lang === "zh";
  switch (trigger.kind) {
    case "schedule":
      return zh ? "定时" : "schedule";
    case "folder":
      return zh
        ? `文件夹 ${trigger.folder.folderName}`
        : `folder ${trigger.folder.folderName}`;
    case "system":
      return zh ? `系统事件 ${trigger.event}` : `system ${trigger.event}`;
    case "script":
      return zh
        ? `脚本（每 ${trigger.every}）`
        : `script (every ${trigger.every})`;
    case "manual":
      return zh ? "手动" : "manual";
  }
}

function factLines(lang: ReplyLanguage, facts: AutomationFacts) {
  return {
    triggers: facts.triggers
      .map((trigger) => triggerWords(lang, trigger))
      .join(", "),
    reads: folders(facts.read),
    writes: folders(facts.write),
    hosts: facts.network.join(", "),
  };
}

// ---------------------------------------------------------------------------
// .autos

const autos: CommandHandler = async (ctx, command) => {
  let projectId: string | undefined;
  if (command.project !== undefined) {
    const picked = await pickProject(ctx, command.project);
    if ("result" in picked) return picked.result;
    projectId = picked.value;
  }
  const list = await ctx.core.automations.list(projectId);
  return numberedList(ctx, "automation", list, automationRow, (page) =>
    render("R-AUTOS", ctx.lang, {
      now: ctx.now,
      rows: page.map(({ n, item }) => {
        const nextAtMs = parseTime(item.nextRunAt);
        return {
          n,
          name: item.name,
          project: item.projectName,
          state: stateOf(item),
          ...(nextAtMs === undefined ? {} : { nextAtMs }),
          ...(item.lastRun
            ? { lastResult: runStatus(ctx.lang, item.lastRun.status) }
            : {}),
        };
      }),
    }),
  );
};

// ---------------------------------------------------------------------------
// .auto N [on | off | run]

async function detail(
  ctx: CommandContext,
  automation: AutomationSummary,
): Promise<CommandResult> {
  const { facts } = await ctx.core.automations.get(
    automation.projectId,
    automation.id,
  );
  return {
    text: render("R-AUTO", ctx.lang, {
      name: automation.name,
      project: automation.projectName,
      enabled: automation.status === "active",
      ...factLines(ctx.lang, facts),
    }),
  };
}

async function turnOff(
  ctx: CommandContext,
  automation: AutomationSummary,
): Promise<CommandResult> {
  await ctx.core.automations.setEnabled(
    { projectId: automation.projectId, source: "web" },
    automation.id,
    false,
  );
  return { text: render("R-AUTO-OFF", ctx.lang, { name: automation.name }) };
}

function turnOn(
  ctx: CommandContext,
  automation: AutomationSummary,
): CommandResult {
  const name = automation.name;
  if (!ctx.host.localAutomationApprovals)
    return { text: render("E-LOCAL", ctx.lang, {}) };
  if (automation.status === "active")
    return { text: render("R-AUTO-ALREADY", ctx.lang, { name }) };
  const waiting =
    ctx.sessions.enablePending(automation.projectId, automation.id) ||
    ctx.core.automations
      .pendingApprovals()
      .some(
        (request) =>
          request.kind === "enable" &&
          request.automationId === automation.id &&
          request.projectId === automation.projectId,
      );
  if (waiting) return { text: render("R-AUTO-ON-PENDING", ctx.lang, { name }) };
  // Not awaited: it settles only on the local decision or after 30 minutes,
  // and would hold the command queue that long.
  ctx.sessions.watchAutomationEnable(
    automation.projectId,
    automation.id,
    name,
    ctx.core.automations.setEnabled(
      { projectId: automation.projectId, source: "agent", via: "wechat" },
      automation.id,
      true,
    ),
  );
  return { text: render("R-AUTO-ON", ctx.lang, { name }) };
}

/** Why the automation cannot run now, as the reply; undefined when it can. */
function runRefusal(
  ctx: CommandContext,
  automation: AutomationSummary,
): CommandResult | undefined {
  const ceiling = ctx.settings.ceilingMode;
  if (!approvalModeWithin("autonomous", ceiling))
    return { text: render("E-CEIL", ctx.lang, { ceiling }) };
  if (automation.status !== "active")
    return { text: render("E-AUTOOFF", ctx.lang, { name: automation.name }) };
  if (automation.running)
    return {
      text: render("E-BUSY", ctx.lang, {
        variant: "running",
        title: automation.name,
      }),
    };
  return undefined;
}

function askToRun(
  ctx: CommandContext,
  command: ParsedCommand,
  automation: AutomationSummary,
): CommandResult {
  const refusal = runRefusal(ctx, automation);
  if (refusal) return refusal;
  const ask = ctx.asks.open({
    kind: "confirm",
    command,
    resolved: {
      projectId: automation.projectId,
      automationId: automation.id,
      name: automation.name,
    },
  });
  if (!ask) throw new Error("No ask number is free.");
  return {
    text: render("R-AUTO-RUN-ASK", ctx.lang, {
      name: automation.name,
      ask: ask.number,
    }),
    shown: [{ ask: ask.number, full: true }],
  };
}

/** The confirmation was approved: re-check against the automation as it is now, then run. */
async function runConfirmed(
  ctx: CommandContext,
  resolved: Record<string, string>,
): Promise<CommandResult> {
  const { projectId, automationId } = resolved;
  if (projectId === undefined || automationId === undefined)
    return {
      text: render("E-GONE", ctx.lang, { variant: "item", kind: "automation" }),
    };
  const found = await findAutomation(ctx, projectId, automationId);
  if ("result" in found) return found.result;
  const automation = found.value;
  const refusal = runRefusal(ctx, automation);
  if (refusal) return refusal;
  try {
    ctx.core.automations.runNow(projectId, automationId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/already running|about to run/i.test(message))
      return {
        text: render("E-BUSY", ctx.lang, {
          variant: "running",
          title: automation.name,
        }),
      };
    if (/resume the automation/i.test(message))
      return {
        text: render("E-AUTOOFF", ctx.lang, { name: automation.name }),
      };
    throw error;
  }
  ctx.sessions.watchAutomationRun(projectId, automationId, automation.name);
  try {
    ctx.host.notify({
      kind: "automation-run",
      ...notice("automation-run", ctx.lang, {
        name: automation.name,
        project: automation.projectName,
      }),
      projectId,
    });
  } catch {
    // A failed notification never blocks the bridge.
  }
  return { text: render("R-AUTO-RUN", ctx.lang, { name: automation.name }) };
}

const auto: CommandHandler = async (ctx, command) => {
  const confirmed = ctx.confirmed;
  if (confirmed?.command.name === "auto")
    return runConfirmed(ctx, confirmed.resolved);
  const ref = command.args[0];
  const action = actionOf(command.args[1]);
  if (ref === undefined || action === undefined) return usage(ctx, "auto");
  const picked = await pickAutomation(ctx, ref);
  if ("result" in picked) return picked.result;
  const automation = picked.value;
  switch (action) {
    case "detail":
      return detail(ctx, automation);
    case "off":
      return turnOff(ctx, automation);
    case "on":
      return turnOn(ctx, automation);
    case "run":
      return askToRun(ctx, command, automation);
  }
};

// ---------------------------------------------------------------------------
// .runs [N]

const runs: CommandHandler = async (ctx, command) => {
  const ref = command.args[0];
  if (ref === undefined) {
    const list = await ctx.core.automations.listRuns({ limit: RUNS_LIMIT });
    return numberedList(
      ctx,
      "run",
      list,
      (run) => ({
        id: run.id,
        label: run.automationName,
        projectId: run.projectId,
      }),
      (page) =>
        render("R-RUNS", ctx.lang, {
          now: ctx.now,
          rows: page.map(({ n, item }) => ({
            n,
            name: item.automationName,
            result: runStatus(ctx.lang, item.status),
            atMs: parseTime(item.startedAt) ?? ctx.now,
            unread: !item.read,
          })),
        }),
    );
  }
  if (!/^\d+$/.test(ref)) return usage(ctx, "runs");
  const row = ctx.handles.resolve("run", Number(ref));
  if (!row) return { text: render("E-REF", ctx.lang, { n: ref, list: ".ar" }) };
  const run = (
    await ctx.core.automations.listRuns({
      ...(row.projectId === undefined ? {} : { projectId: row.projectId }),
      filter: "all",
      limit: 500,
    })
  ).find((candidate) => candidate.id === row.id);
  if (!run)
    return {
      text: render("E-GONE", ctx.lang, { variant: "item", kind: "run" }),
    };
  return {
    text: render("R-RUN", ctx.lang, {
      name: run.automationName,
      atMs: parseTime(run.startedAt) ?? ctx.now,
      now: ctx.now,
      result: runStatus(ctx.lang, run.status),
      summary: run.summary ?? run.error ?? "",
    }),
  };
};

export const automationHandlers: CommandHandlers = { autos, auto, runs };
