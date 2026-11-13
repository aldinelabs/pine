// Every message the WeChat bridge sends, in Chinese and English (commands
// spec section 10). Pure renderers: no I/O, no Electron, no renderer catalogs.
//
// Fields that come from the agent, a file, a title or a snippet are display
// data and are cleaned here; the size caps of commands spec 11.3 are applied
// here too, so a handler cannot send an oversized or command-like reply.

import type { AskUserQuestionParams } from "@pine/rpiv-ask-user-question";
import {
  APPROVAL_MODE_ORDER,
  type PineApprovalMode,
  type PineApprovalTrigger,
} from "../../shared/agent";
import type { PineThinkingLevel } from "../../shared/models";
import {
  CARD_DESCRIPTION_MAX,
  CARD_SUBJECT_MAX,
  DONE_EXCERPT_MAX,
  ECHO_MAX,
  HISTORY_ENTRY_MAX,
  LAST_MAX_PAGES,
  PAGE_ROWS,
  REPLY_MAX,
  ROW_MAX,
  SHOW_INPUT_MAX,
  TASK_OUTPUT_LINES,
  TASK_OUTPUT_MAX,
  TITLE_MAX,
} from "./constants";
import {
  baseName,
  cleanInline,
  codePointLength,
  formatAge,
  formatDate,
  formatDuration,
  formatSize,
  formatWhen,
  isCut,
  neutralise,
  neutraliseText,
  paginate,
  stripSearchMarkers,
  toPlainText,
  truncate,
} from "./text";
import type {
  Ask,
  CommandSpec,
  DigestItem,
  HandleKind,
  ReplyLanguage,
} from "./types";

type L = ReplyLanguage;

// ---------------------------------------------------------------------------
// Shared pieces

/** The session a reply is about; rendered as the header. */
export interface SessionRef {
  project: string;
  title: string;
}

export type SessionState = "running" | "idle" | "waiting" | "failed";

/** One open ask, as lists and errors name it. */
export interface AskSummary {
  number: number;
  kind: Ask["kind"];
  /** Tool name of an approval. */
  tool?: string;
  /** Title of the session the ask belongs to. */
  title?: string;
}

export interface PageInfo {
  index: number;
  count: number;
  /** The text went on beyond the last page that is sent. */
  truncated: boolean;
}

const MODE_LABELS: Record<PineApprovalMode, Record<L, string>> = {
  "let-me-review": { zh: "让我过目", en: "Let Me Review" },
  "auto-approve": { zh: "自动审批", en: "Auto Approve" },
  autonomous: { zh: "自主工作", en: "Autonomous Work" },
  YOLO: { zh: "干就完了", en: "YOLO" },
};

const TRIGGER_LABELS: Record<PineApprovalTrigger, Record<L, string>> = {
  "pre-execution": { zh: "执行前确认", en: "before running" },
  "sandbox-denied": { zh: "沙箱拒绝", en: "sandbox denied" },
  "authorize-denied": { zh: "授权被拒", en: "authorization denied" },
  "destructive-pattern": { zh: "危险命令", en: "destructive command" },
  "privileged-execution": {
    zh: "不受沙箱约束的原生执行",
    en: "native execution outside the sandbox",
  },
  "long-context-activation": { zh: "上下文较长", en: "long context" },
};

const EFFORT_LABELS: Record<PineThinkingLevel, Record<L, string>> = {
  off: { zh: "关闭", en: "Off" },
  minimal: { zh: "最少", en: "Minimal" },
  low: { zh: "低", en: "Low" },
  medium: { zh: "中", en: "Medium" },
  high: { zh: "高", en: "High" },
  xhigh: { zh: "超高", en: "Extra high" },
  max: { zh: "最大", en: "Maximum" },
};

const KIND_NOUNS: Record<HandleKind | "ask", Record<L, string>> = {
  session: { zh: "会话", en: "session" },
  project: { zh: "项目", en: "project" },
  model: { zh: "模型", en: "model" },
  effort: { zh: "推理强度", en: "effort level" },
  mode: { zh: "审批模式", en: "approval mode" },
  file: { zh: "文件", en: "file" },
  task: { zh: "后台进程", en: "background process" },
  queue: { zh: "排队消息", en: "queued message" },
  automation: { zh: "自动化", en: "automation" },
  run: { zh: "运行记录", en: "run" },
  ask: { zh: "待处理项", en: "waiting item" },
};

/** Pine's own label of an approval mode (`composer.approval`). */
export function modeLabel(lang: L, mode: PineApprovalMode): string {
  return MODE_LABELS[mode][lang];
}

/** The fixed number of a mode in `.mode N`: 1 Let Me Review … 4 YOLO. */
export function modeNumber(mode: PineApprovalMode): number {
  return APPROVAL_MODE_ORDER.indexOf(mode) + 1;
}

/** The mode of `.mode N`, or undefined outside 1–4. */
export function modeOfNumber(n: number): PineApprovalMode | undefined {
  return Number.isInteger(n) ? APPROVAL_MODE_ORDER[n - 1] : undefined;
}

const MODE_WORDS: Record<string, PineApprovalMode> = {
  review: "let-me-review",
  "let-me-review": "let-me-review",
  过目: "let-me-review",
  auto: "auto-approve",
  "auto-approve": "auto-approve",
  自动: "auto-approve",
  autonomous: "autonomous",
  自主: "autonomous",
  yolo: "YOLO",
  干就完了: "YOLO",
};

/** The mode a `.mode` argument names: its number or one of its words. */
export function parseMode(arg: string): PineApprovalMode | undefined {
  const value = arg.trim().normalize("NFKC");
  if (/^\d+$/.test(value)) return modeOfNumber(Number(value));
  return MODE_WORDS[value.toLowerCase()];
}

/** Why an approval card appeared, in words (`T-TRIGGER`). */
export function triggerLabel(lang: L, trigger: PineApprovalTrigger): string {
  return TRIGGER_LABELS[trigger][lang];
}

/** Pine's own label of a reasoning effort level (`thinkingLevels`). */
export function effortLabel(lang: L, level: PineThinkingLevel): string {
  return EFFORT_LABELS[level][lang];
}

function displayTitle(title: string): string {
  return truncate(cleanInline(title), TITLE_MAX) || "…";
}

/** `【{project} › {title}】` / `[{project} › {title}]`. */
export function header(lang: L, project: string, title: string): string {
  const name = `${displayTitle(project)} › ${displayTitle(title)}`;
  return lang === "zh" ? `【${name}】` : `[${name}]`;
}

/** The header as the start of a line: English gets a space before the text. */
function head(lang: L, at: SessionRef): string {
  const text = header(lang, at.project, at.title);
  return lang === "zh" ? text : `${text} `;
}

function pick(lang: L, zh: string, en: string): string {
  return lang === "zh" ? zh : en;
}

function list(lang: L, items: readonly string[]): string {
  return items.join(lang === "zh" ? "、" : ", ");
}

/** How `R-QUEUEWAIT` says a waiting card can be answered. */
export type QueueWaitVariant =
  "approval" | "question" | "question-local" | "display-only" | "long-context";

function queueWaitItem(lang: L, n: number, variant: QueueWaitVariant): string {
  switch (variant) {
    case "approval":
      return pick(
        lang,
        `${n} 审批（.y ${n} 批准，.d ${n} 拒绝）`,
        `${n} approval (.y ${n} approves, .d ${n} rejects)`,
      );
    case "question":
      return pick(
        lang,
        `${n} 问题（.a ${n} 你的回答，.d ${n} 取消）`,
        `${n} question (.a ${n} your answer, .d ${n} cancels)`,
      );
    case "question-local":
      return pick(
        lang,
        `${n} 问题（需在 Pine 中回答，.d ${n} 取消）`,
        `${n} question (answer it in Pine, .d ${n} cancels)`,
      );
    case "display-only":
      return pick(
        lang,
        `${n} 只能在电脑上批准（.d ${n} 拒绝）`,
        `${n} approve on the computer (.d ${n} rejects)`,
      );
    case "long-context":
      return pick(
        lang,
        `${n} 上下文较长（.c ${n} 先压缩再继续，.d ${n} 停止）`,
        `${n} long context (.c ${n} compress, then continue, .d ${n} stop)`,
      );
  }
}

function echo(text: string): string {
  return truncate(cleanInline(text), ECHO_MAX);
}

function row(text: string): string {
  return truncate(text, ROW_MAX);
}

function rows<T>(items: readonly T[]): readonly T[] {
  return items.slice(0, PAGE_ROWS);
}

function cost(usd: number): string {
  if (!Number.isFinite(usd) || usd < 0) return "$?";
  if (usd > 0 && usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(2)}`;
}

function tokens(count: number): string {
  if (count >= 1_000_000)
    return `${Math.round(count / 100_000) / 10}M`.replace(".0M", "M");
  if (count >= 1000)
    return `${Math.round(count / 100) / 10}k`.replace(".0k", "k");
  return String(Math.max(0, Math.round(count)));
}

function percent(value: number): string {
  return String(Math.round(Math.min(100, Math.max(0, value))));
}

function stateLabel(lang: L, state: SessionState, runningMs?: number): string {
  switch (state) {
    case "running":
      return runningMs === undefined
        ? pick(lang, "运行中", "Running")
        : pick(
            lang,
            `运行中 ${formatDuration(runningMs, lang)}`,
            `Running ${formatDuration(runningMs, lang)}`,
          );
    case "idle":
      return pick(lang, "空闲", "Idle");
    case "waiting":
      return pick(lang, "等待处理", "Waiting for you");
    case "failed":
      return pick(lang, "失败", "Failed");
  }
}

function askWhat(lang: L, ask: AskSummary): string {
  switch (ask.kind) {
    case "approval":
      return ask.tool ? cleanInline(ask.tool) : pick(lang, "批准", "approval");
    case "question":
      return pick(lang, "问题", "question");
    case "confirm":
      return pick(lang, "确认", "confirm");
    case "held":
      return pick(lang, "待执行消息", "held messages");
  }
}

function onOff(lang: L, on: boolean): string {
  return on ? pick(lang, "开", "on") : pick(lang, "关", "off");
}

function languageLabel(lang: L, language: L | "auto"): string {
  if (language === "zh") return "中文";
  if (language === "en") return "English";
  return pick(lang, "跟随 Pine", "follows Pine");
}

function confirmLine(lang: L, ask: number): string {
  return pick(
    lang,
    `2 分钟内回 .y ${ask} 确认，.d ${ask} 取消。`,
    `Reply .y ${ask} within 2 minutes to confirm, .d ${ask} to cancel.`,
  );
}

function lines(...parts: (string | false | undefined)[]): string {
  return parts
    .filter((part): part is string => typeof part === "string" && part !== "")
    .join("\n");
}

/** Cuts a finished reply to one WeChat message. */
function finish(text: string): string {
  return truncate(text.replace(/\s+$/, ""), REPLY_MAX);
}

/** Several rendered parts as one reply (for example `.use` followed by cards), capped. */
export function joinReplies(...parts: (string | undefined)[]): string {
  return finish(
    parts.filter((part): part is string => Boolean(part?.trim())).join("\n\n"),
  );
}

// ---------------------------------------------------------------------------
// Help

const HELP_LINES: Record<L, readonly string[]> = {
  zh: [
    "Pine 微信命令（以 . 或 。开头）",
    "直接发文字 = 发给当前会话",
    ".  状态　.n 新会话　.l 会话列表",
    ".f 搜索　.u 切换　.r 最后回复",
    ".x 停止　.p 项目　.o 文件",
    ".y 批准　.d 拒绝　.a 回答",
    ".w 待处理　.0 更多　.数字 选列表项",
    ".? 2 更多命令　.pause 立即停用",
    "以点开头的普通文字请用两个点开头",
  ],
  en: [
    "Pine WeChat commands (start with . or 。)",
    "Plain text goes to the current session",
    ".  status   .n new session   .l sessions",
    ".f search   .u switch   .r last reply",
    ".x stop   .p projects   .o files",
    ".y approve   .d reject   .a answer",
    ".w waiting   .0 more   .number picks a list row",
    ".? 2 more commands   .pause turn off now",
    "Start with two dots to send text that begins with a dot",
  ],
};

const HELP2_LINES: Record<L, readonly string[]> = {
  zh: [
    ".m 模型　.e 推理强度　.mode 审批模式",
    ".i 用量　.c 压缩　.t 待办",
    ".b 后台进程　.k 结束进程　.q 排队",
    ".hi 历史　.rn 改名　.del 删除",
    ".au 自动化　.ar 运行记录　.sk 技能　.mcp",
    ".cfg 设置　.lang 语言　.drop 丢弃附件",
    ".? 命令名 查看用法",
  ],
  en: [
    ".m model   .e effort   .mode approval mode",
    ".i usage   .c compact   .t todos",
    ".b processes   .k kill   .q queue",
    ".hi history   .rn rename   .del delete",
    ".au automations   .ar runs   .sk skills   .mcp",
    ".cfg settings   .lang language   .drop attachments",
    ".? name shows a command's usage",
  ],
};

function helpFooter(
  lang: L,
  data: { computer: string; ceiling: PineApprovalMode; files: boolean },
): string {
  const computer = truncate(cleanInline(data.computer), TITLE_MAX);
  return pick(
    lang,
    `电脑：${computer} · 最高模式：${modeLabel(lang, data.ceiling)} · 发文件：${onOff(lang, data.files)}`,
    `Computer: ${computer} · Highest mode: ${modeLabel(lang, data.ceiling)} · Files: ${onOff(lang, data.files)}`,
  );
}

/** `.help name`: usage and aliases of one command, from its spec. */
function helpOne(lang: L, spec: CommandSpec): string {
  const usage = `.${spec.name}${spec.params ? ` ${spec.params}` : ""} — ${spec.summary[lang]}`;
  const aliases = [...spec.aliases, ...spec.zhAliases]
    .filter((alias) => alias !== spec.name)
    .map((alias) => `.${alias}`)
    .join(" ");
  return lines(
    usage,
    aliases ? pick(lang, `别名：${aliases}`, `Aliases: ${aliases}`) : undefined,
    spec.example
      ? pick(lang, `例如：${spec.example}`, `Example: ${spec.example}`)
      : undefined,
  );
}

// ---------------------------------------------------------------------------
// Cards

function subjectLines(
  subject: string | undefined,
  max: number,
): { text?: string; cut: boolean } {
  if (subject === undefined) return { cut: false };
  const clean = neutraliseText(subject);
  if (!clean) return { cut: false };
  return { text: truncate(clean, max), cut: isCut(clean, max) };
}

function descriptionLine(description: string | undefined): string | undefined {
  if (description === undefined) return undefined;
  const clean = neutralise(description);
  return clean ? truncate(clean, CARD_DESCRIPTION_MAX) : undefined;
}

interface ApprovalCardData {
  at: SessionRef;
  ask: number;
  tool: string;
  trigger: PineApprovalTrigger;
  subject?: string;
  description?: string;
  /** The session read external content before the request (`T-EXTERNAL`). */
  external: boolean;
  /** The caller already cut the subject (for example `approvalCardText`). */
  cut?: boolean;
}

function approvalHead(lang: L, data: ApprovalCardData, local: boolean) {
  const what = local
    ? pick(
        lang,
        `需在电脑上批准 ${data.ask}`,
        `Approve on the computer ${data.ask}`,
      )
    : pick(lang, `需要批准 ${data.ask}`, `Approval needed ${data.ask}`);
  const subject = subjectLines(data.subject, CARD_SUBJECT_MAX);
  return {
    text: lines(
      `${head(lang, data.at)}${what}`,
      `${truncate(cleanInline(data.tool), 40)} · ${triggerLabel(lang, data.trigger)}`,
      subject.text,
      descriptionLine(data.description),
      data.external ? render("T-EXTERNAL", lang) : undefined,
    ),
    cut: subject.cut || data.cut === true,
  };
}

/** Example answer for a question card: `2; 1,3`. */
export function answerExample(questionnaire: AskUserQuestionParams): string {
  return questionnaire.questions
    .map((question) => (question.multiSelect ? "1,2" : "1"))
    .join("; ");
}

/**
 * Whether a question card can be answered in text: no option previews, no code
 * blocks, and the card fits in one reply. Otherwise it is `T-QCARD-LOCAL`.
 */
export function questionCardAnswerable(
  lang: L,
  at: SessionRef,
  ask: number,
  questionnaire: AskUserQuestionParams,
): boolean {
  const hasRich = questionnaire.questions.some(
    (question) =>
      question.question.includes("```") ||
      question.options.some(
        (option) =>
          Boolean(option.preview?.trim()) ||
          option.label.includes("```") ||
          option.description.includes("```"),
      ),
  );
  if (hasRich) return false;
  return (
    codePointLength(questionCard(lang, at, ask, questionnaire)) <= REPLY_MAX
  );
}

function questionCard(
  lang: L,
  at: SessionRef,
  ask: number,
  questionnaire: AskUserQuestionParams,
): string {
  const body = questionnaire.questions.flatMap((question, index) => {
    const kind = question.multiSelect
      ? pick(lang, "可多选", "pick any")
      : pick(lang, "单选", "pick one");
    const title = cleanInline(question.question);
    return [
      pick(
        lang,
        `Q${index + 1} ${title}（${kind}）`,
        `Q${index + 1} ${title} (${kind})`,
      ),
      ...question.options.map((option, optionIndex) => {
        const description = cleanInline(option.description);
        return row(
          ` ${optionIndex + 1} ${cleanInline(option.label)}${description ? ` · ${truncate(description, 40)}` : ""}`,
        );
      }),
    ];
  });
  const example = answerExample(questionnaire);
  return lines(
    `${head(lang, at)}${pick(lang, `问题 ${ask}`, `Question ${ask}`)}`,
    ...body,
    pick(
      lang,
      `回答：.a ${ask} ${example} · 自己写：.a ${ask} =文字 · 取消：.d ${ask}`,
      `Answer: .a ${ask} ${example} · own words: .a ${ask} =text · cancel: .d ${ask}`,
    ),
  );
}

/** `T-DIGEST`: what happened while the replies were used up. */
export function renderDigest(lang: L, items: readonly DigestItem[]): string {
  const parts: string[] = [];
  const quote = (title: string) =>
    pick(lang, `「${displayTitle(title)}」`, `"${displayTitle(title)}"`);
  const asks: number[] = [];
  for (const item of items) {
    switch (item.kind) {
      case "done":
        parts.push(
          pick(
            lang,
            `${quote(item.title)}已完成`,
            `${quote(item.title)} finished`,
          ),
        );
        break;
      case "failed":
        parts.push(
          pick(lang, `${quote(item.title)}失败`, `${quote(item.title)} failed`),
        );
        break;
      case "ask":
        if (!asks.includes(item.number)) asks.push(item.number);
        break;
      case "autorun":
        parts.push(
          pick(
            lang,
            `自动化${quote(item.name)}运行结束：${truncate(cleanInline(item.result), 40)}`,
            `automation ${quote(item.name)} finished: ${truncate(cleanInline(item.result), 40)}`,
          ),
        );
        break;
      case "auto-on":
        parts.push(
          pick(
            lang,
            `开启${quote(item.name)}的请求${{ approved: "已批准", denied: "被拒绝", timeout: "已失效" }[item.result]}`,
            `request to turn on ${quote(item.name)} ${{ approved: "approved", denied: "declined", timeout: "expired" }[item.result]}`,
          ),
        );
        break;
    }
  }
  if (asks.length > 0)
    parts.push(
      pick(
        lang,
        `${asks.length} 项待处理（${list(lang, asks.map(String))}）`,
        `${asks.length} waiting (${list(lang, asks.map(String))})`,
      ),
    );
  if (parts.length === 0) return "";
  return finish(
    pick(
      lang,
      `你不在时：${list(lang, parts)}。`,
      `While you were away: ${list(lang, parts)}.`,
    ),
  );
}

// ---------------------------------------------------------------------------
// Paged text

function pageFooter(lang: L, page: PageInfo): string | undefined {
  if (page.index < page.count)
    return pick(
      lang,
      `（${page.index}/${page.count}，回 .0 看下一段）`,
      `(${page.index}/${page.count}, reply .0 for the next part)`,
    );
  if (page.truncated)
    return pick(
      lang,
      "（完整内容请在 Pine 中查看）",
      "(Open Pine for the full text)",
    );
  return undefined;
}

const FOOTER_RESERVE = 40;

/**
 * Splits text under a fixed first line into replies of at most REPLY_MAX code
 * points, each with its `R-PAGE` footer; at most `maxPages` pages, the last
 * one saying "open Pine" when the text went on.
 */
export function pagedText(
  lang: L,
  first: string | undefined,
  text: string,
  maxPages: number,
): string[] {
  const reserve = (first ? codePointLength(first) + 1 : 0) + FOOTER_RESERVE;
  // Pages are trimmed, so each one is neutralised again: a page may start
  // with a line whose guarding space the cut removed.
  const all = paginate(neutraliseText(text), REPLY_MAX - reserve).map(
    neutraliseText,
  );
  const kept = all.slice(0, Math.max(1, maxPages));
  const truncated = all.length > kept.length;
  if (kept.length === 0) return first ? [finish(first)] : [];
  return kept.map((page, index) =>
    finish(
      lines(
        first,
        page,
        pageFooter(lang, { index: index + 1, count: kept.length, truncated }),
      ),
    ),
  );
}

/** `.last`: the final reply as plain text, in pages for `.more`. */
export function renderLastPages(
  lang: L,
  at: SessionRef,
  markdown: string,
): string[] {
  const text = toPlainText(markdown, lang);
  if (!text) return [render("R-NOREPLY", lang)];
  return pagedText(
    lang,
    header(lang, at.project, at.title),
    text,
    LAST_MAX_PAGES,
  );
}

/** The last TASK_OUTPUT_LINES lines of process output, at most TASK_OUTPUT_MAX code points. */
export function tailOutput(output: string): string {
  const tail = output
    .replace(/\r\n?/g, "\n")
    .trimEnd()
    .split("\n")
    .slice(-TASK_OUTPUT_LINES)
    .join("\n");
  const points = Array.from(tail);
  return points.length <= TASK_OUTPUT_MAX
    ? tail
    : `…${points.slice(points.length - TASK_OUTPUT_MAX + 1).join("")}`;
}

// ---------------------------------------------------------------------------
// Template data

export interface ReplyData {
  // 10.1 Command replies
  "R-HELP": { computer: string; ceiling: PineApprovalMode; files: boolean };
  "R-HELP2": undefined;
  "R-HELP1": { spec: CommandSpec };
  "R-STATUS": {
    at: SessionRef;
    state: SessionState;
    runningMs?: number;
    todos?: { done: number; total: number };
    contextPercent?: number;
    costUsd?: number;
    asks: AskSummary[];
    /** Other tracked sessions that are running or waiting; at most 5 are shown. */
    others: {
      n: number;
      state: SessionState;
      title: string;
      project: string;
    }[];
  };
  "R-STATUS0": { project: string; mode: PineApprovalMode };
  "R-INFO": {
    computer: string;
    version: string;
    ceiling: PineApprovalMode;
    defaultMode: PineApprovalMode;
    highRisk: boolean;
    files: boolean;
    language: L | "auto";
    boundAt?: number;
  };
  "R-LANG": { language: L | "auto" };
  "R-PAUSE": { running: number };
  "R-PAUSEALL": { stopped: number };
  "R-NOMORE": undefined;
  "R-PAGE": PageInfo;
  "R-DROP": { count: number };
  "R-ATTACH": { name: string; sizeBytes: number };
  "R-NEW": {
    project: string;
    text: string;
    mode: PineApprovalMode;
    model?: string;
  };
  "R-NEWARMED": { project: string };
  "R-STEER": { at: SessionRef };
  "R-ROUTE": { at: SessionRef };
  "R-WELCOME": { computer: string; ceiling: PineApprovalMode; files: boolean };
  "R-SESSIONS": {
    now: number;
    rows: {
      n: number;
      title: string;
      project: string;
      atMs: number;
      marks: ("running" | "waiting" | "wechat" | "automation")[];
    }[];
  };
  "R-SEARCH": {
    query: string;
    total?: number;
    rows: { n: number; title: string; project: string; snippet?: string }[];
  };
  "R-MATCHES": { query: string; rows: { n: number; label: string }[] };
  "R-USE": {
    title: string;
    project: string;
    state: SessionState;
    mode: PineApprovalMode;
    count: number;
  };
  "R-USEVIEW": {
    title: string;
    project: string;
    state: SessionState;
    reason: "ceiling" | "automation-run";
    mode?: PineApprovalMode;
    ceiling?: PineApprovalMode;
  };
  /** One page; use `renderLastPages` for the whole reply. */
  "R-LAST": { at: SessionRef; text: string; page?: PageInfo };
  "R-NOREPLY": undefined;
  "R-HISTORY": { entries: { role: "user" | "assistant"; text: string }[] };
  "R-STOP": { title: string; backgroundTasks: number };
  "R-STOPNONE": undefined;
  "R-STOPALL": { count: number };
  "R-QUEUED": undefined;
  /** Plain text queued as steering while cards of the session are open. */
  "R-QUEUEWAIT": {
    at: SessionRef;
    asks: { number: number; variant: QueueWaitVariant }[];
  };
  "R-QUEUE": { rows: { n: number; text: string }[] };
  "R-UNQUEUE": { text: string };
  "R-RENAME": { title: string };
  "R-DELETE-ASK": {
    title: string;
    project: string;
    count: number;
    ask: number;
  };
  "R-DELETED": { title: string };
  "R-MODELS": {
    rows: { n: number; model: string; provider: string; current: boolean }[];
  };
  "R-MODEL": { at: SessionRef; model: string; effort?: PineThinkingLevel };
  "R-EFFORTS": {
    rows: { n: number; level: PineThinkingLevel; current: boolean }[];
  };
  "R-EFFORT": { level: PineThinkingLevel };
  "R-MODES": { current?: PineApprovalMode; ceiling: PineApprovalMode };
  "R-MODE": {
    at: SessionRef;
    mode: PineApprovalMode;
    ceiling: PineApprovalMode;
  };
  "R-MODE-REVIEW": {
    at: SessionRef;
    mode: PineApprovalMode;
    ceiling: PineApprovalMode;
  };
  "R-YOLO-ASK": { title: string; ask: number };
  "R-USAGE": {
    at: SessionRef;
    model?: string;
    effort?: PineThinkingLevel;
    mode: PineApprovalMode;
    ceiling: PineApprovalMode;
    contextTokens?: number;
    contextWindow?: number;
    contextPercent?: number;
    cacheHitPercent?: number;
    costUsd?: number;
    count: number;
  };
  "R-USAGE-NONE": undefined;
  "R-COMPACTING": undefined;
  "R-COMPACTED": { at: SessionRef; error?: string };
  "R-COMPACT-IDLE": undefined;
  "R-TODO": {
    at: SessionRef;
    items: {
      status: "pending" | "in_progress" | "completed";
      subject: string;
    }[];
  };
  "R-PENDING": { asks: AskSummary[]; automationApprovals: number };
  "R-APPROVED": { ask: number; subject?: string };
  "R-REJECTED": { ask: number };
  "R-GUIDED": { ask: number };
  "R-ANSWERED": { ask: number; summary: string };
  "R-CANCELLED": { ask: number };
  "R-FILES": {
    at: SessionRef;
    canSend: boolean;
    /** `path` may be absolute; only its base name is shown. */
    rows: { n: number; path: string; sizeBytes?: number }[];
  };
  "R-SENDING": { name: string; sizeBytes: number };
  "R-TASKS": {
    rows: {
      n: number;
      title: string;
      running: boolean;
      runningMs?: number;
      exitCode?: number;
      command: string;
    }[];
  };
  /** `output` is the whole output; its tail is shown. */
  "R-TASK": { title: string; output: string };
  "R-KILLED": { title: string };
  "R-PROJECTS": {
    rows: { n: number; name: string; current: boolean; temporary?: boolean }[];
  };
  "R-PROJECT": {
    name: string;
    temporary?: boolean;
    folders: { path: string; access: "read-only" | "read-write" }[];
    count: number;
  };
  "R-AUTOS": {
    now: number;
    rows: {
      n: number;
      name: string;
      project: string;
      state: "on" | "off" | "paused";
      nextAtMs?: number;
      lastResult?: string;
    }[];
  };
  "R-AUTO": {
    name: string;
    project: string;
    enabled: boolean;
    triggers: string;
    reads: string;
    writes: string;
    hosts: string;
  };
  "R-AUTO-OFF": { name: string };
  "R-AUTO-ON": { name: string };
  "R-AUTO-ALREADY": { name: string };
  "R-AUTO-ON-PENDING": { name: string };
  "R-AUTO-RUN-ASK": { name: string; ask: number };
  "R-AUTO-RUN": { name: string };
  "R-RUNS": {
    now: number;
    rows: {
      n: number;
      name: string;
      result: string;
      atMs: number;
      unread: boolean;
    }[];
  };
  "R-RUN": {
    name: string;
    atMs: number;
    now: number;
    result: string;
    summary: string;
  };
  "R-SKILLS": {
    rows: {
      n: number;
      name: string;
      scope: "global" | "project";
      enabled: boolean;
      description?: string;
    }[];
  };
  "R-MCP": {
    rows: {
      name: string;
      scope: "global" | "project";
      status: "connected" | "failed" | "unknown";
      tools?: number;
    }[];
  };

  // 10.2 Cards and pushed messages
  "T-APPROVAL": ApprovalCardData;
  "T-CUT": { ask: number };
  "T-APPROVAL-LOCAL": ApprovalCardData & {
    reason: "view-only" | "high-risk" | "automation";
    /** For `view-only`: why the session is view-only. */
    viewOnly?: "ceiling" | "automation-run";
  };
  /** `.show`: the card again, subject up to SHOW_INPUT_MAX, plus the evidence. */
  "T-SHOW": ApprovalCardData & { evidence?: string; local: boolean };
  "T-LONGCTX": { at: SessionRef; ask: number };
  "T-EXTERNAL": undefined;
  "T-TRIGGER": { trigger: PineApprovalTrigger };
  "T-MORECARDS": { count: number };
  "T-QCARD": {
    at: SessionRef;
    ask: number;
    questionnaire: AskUserQuestionParams;
  };
  "T-QCARD-LOCAL": {
    at: SessionRef;
    ask: number;
    questionnaire: AskUserQuestionParams;
  };
  "T-DONE": {
    at: SessionRef;
    durationMs?: number;
    costUsd?: number;
    /** The final reply, Markdown. */
    text: string;
    files: number;
    /** It is the current session; otherwise the last line offers `.u 9`. */
    current: boolean;
  };
  "T-FAILED": { at: SessionRef; error: string };
  "T-PROGRESS": { at: SessionRef; todos?: { done: number; total: number } };
  "T-AUTORUN": { name: string; result: string };
  "T-AUTO-ON": { name: string; result: "approved" | "denied" | "timeout" };
  "T-PAIR": { code: string };
  "T-INTERRUPTED": { items: string[] };
  "T-OVERFLOW": { items: string[] };
  "T-BUDGET": undefined;
  "T-DIGEST": { items: DigestItem[] };
  "T-STALE": {
    /** Messages kept for `.y {ask}`, in order. */
    held: string[];
    /** Commands that were not run, as the user typed them. */
    notRun: string[];
    oldestAgeMs: number;
    /** Present when `held` is not empty. */
    ask?: number;
  };

  // 10.3 Errors
  "E-UNKNOWN": { token: string; suggestion?: string };
  "E-ARGS": {
    spec: Pick<CommandSpec, "name" | "params" | "example">;
    hint?: string;
  };
  "E-REF": { n: number | string; list: string };
  "E-NOMATCH": { query: string; kind: HandleKind };
  "E-NOSESSION": undefined;
  "E-VIEW": {
    title: string;
    mode: PineApprovalMode;
    ceiling: PineApprovalMode;
  };
  "E-VIEWRUN": { title: string };
  "E-CEIL": { ceiling: PineApprovalMode };
  /** With `ask`: a display-only card; without: a local-only action. */
  "E-LOCAL": { ask?: number };
  "E-SWITCH": undefined;
  "E-CODE": { ask: number };
  "E-DONE": { ask: number };
  "E-WHICH": { asks: AskSummary[]; command?: string };
  "E-AMBIG": { n: number; ask: number; list: string };
  "E-SHOWFIRST": { ask: number };
  "E-TEXT": undefined;
  "E-QUOTE": undefined;
  "E-AUTOOFF": { name: string };
  "E-NGUARD": { ask: number };
  "E-ANSWER": {
    ask: number;
    count: number;
    example: string;
    problem?:
      | { kind: "single"; part: number }
      | { kind: "option"; part: number; option: number };
  };
  "E-BUSY": { variant: "running" | "local"; title: string };
  "E-NOTOWN": { title: string };
  "E-SIZE":
    { variant: "file"; name: string; sizeBytes: number } | { variant: "text" };
  "E-GONE":
    | { variant: "item"; kind: HandleKind | "ask" }
    | { variant: "file-changed" }
    | { variant: "folders"; name: string };
  "E-OTHERWIN": undefined;
  "E-PAUSED": undefined;
  "E-VOICE": undefined;
  "E-FAIL": undefined;
}

export type ReplyId = keyof ReplyData;
type Args<K extends ReplyId> = ReplyData[K] extends undefined
  ? []
  : [data: ReplyData[K]];
type Template<K extends ReplyId> = (lang: L, data: ReplyData[K]) => string;

// ---------------------------------------------------------------------------
// Templates

const TEMPLATES: { [K in ReplyId]: Template<K> } = {
  "R-HELP": (lang, data) => lines(...HELP_LINES[lang], helpFooter(lang, data)),
  "R-HELP2": (lang) => lines(...HELP2_LINES[lang]),
  "R-HELP1": (lang, { spec }) => helpOne(lang, spec),
  "R-STATUS": (lang, data) => {
    const facts = [stateLabel(lang, data.state, data.runningMs)];
    if (data.todos)
      facts.push(
        pick(
          lang,
          `待办 ${data.todos.done}/${data.todos.total}`,
          `Todos ${data.todos.done}/${data.todos.total}`,
        ),
      );
    if (data.contextPercent !== undefined)
      facts.push(
        pick(
          lang,
          `上下文 ${percent(data.contextPercent)}%`,
          `Context ${percent(data.contextPercent)}%`,
        ),
      );
    if (data.costUsd !== undefined) facts.push(cost(data.costUsd));
    const asks = data.asks.map((ask) => `${ask.number} ${askWhat(lang, ask)}`);
    const others = data.others.slice(0, 5).map((other) => {
      const mark =
        other.state === "running" ? "▶" : other.state === "waiting" ? "!" : "·";
      return row(
        pick(
          lang,
          `${other.n} ${mark} ${displayTitle(other.title)}（${displayTitle(other.project)}）`,
          `${other.n} ${mark} ${displayTitle(other.title)} (${displayTitle(other.project)})`,
        ),
      );
    });
    return lines(
      `${head(lang, data.at)}${facts.join(" · ")}`,
      asks.length > 0 &&
        pick(
          lang,
          `待处理：${list(lang, asks)}`,
          `Waiting: ${list(lang, asks)}`,
        ),
      others.length > 0 && pick(lang, "其他：", "Others:"),
      ...others,
    );
  },
  "R-STATUS0": (lang, { project, mode }) =>
    pick(
      lang,
      `还没有当前会话。项目：${displayTitle(project)} · 默认模式：${modeLabel(lang, mode)}\n直接发文字开始，或 .l 选择会话。`,
      `No current session. Project: ${displayTitle(project)} · Default mode: ${modeLabel(lang, mode)}\nSend text to start one, or .l to pick a session.`,
    ),
  "R-INFO": (lang, data) => {
    const computer = truncate(cleanInline(data.computer), TITLE_MAX);
    const version = truncate(cleanInline(data.version), 30);
    const bound = data.boundAt === undefined ? "?" : formatDate(data.boundAt);
    return pick(
      lang,
      lines(
        `电脑：${computer} · Pine ${version}（实验性功能）`,
        `最高审批模式 ${modeLabel(lang, data.ceiling)} · 默认 ${modeLabel(lang, data.defaultMode)}`,
        `高风险审批：${data.highRisk ? "允许" : "仅电脑"} · 发文件：${onOff(lang, data.files)}`,
        `回复语言：${languageLabel(lang, data.language)} · 绑定于 ${bound}`,
        "这些设置只能在电脑上修改。",
      ),
      lines(
        `Computer: ${computer} · Pine ${version} (experimental)`,
        `Highest approval mode ${modeLabel(lang, data.ceiling)} · Default ${modeLabel(lang, data.defaultMode)}`,
        `High-risk approvals: ${data.highRisk ? "allowed" : "computer only"} · Files: ${onOff(lang, data.files)}`,
        `Reply language: ${languageLabel(lang, data.language)} · Bound on ${bound}`,
        "These settings can only be changed on the computer.",
      ),
    );
  },
  "R-LANG": (lang, { language }) =>
    pick(
      lang,
      `回复语言：${languageLabel(lang, language)}`,
      `Reply language: ${languageLabel(lang, language)}`,
    ),
  "R-PAUSE": (lang, { running }) =>
    lines(
      pick(
        lang,
        "微信远程已暂停，只能在电脑上恢复。",
        "WeChat remote is paused. It can only be resumed on the computer.",
      ),
      running > 0 &&
        pick(
          lang,
          `仍有 ${running} 个会话在运行，可在电脑上停止。`,
          `${running} session(s) are still running; stop them on the computer.`,
        ),
    ),
  "R-PAUSEALL": (lang, { stopped }) =>
    pick(
      lang,
      `已停止 ${stopped} 个会话并暂停微信远程，只能在电脑上恢复。`,
      `Stopped ${stopped} session(s) and paused WeChat remote. It can only be resumed on the computer.`,
    ),
  "R-NOMORE": (lang) => pick(lang, "没有更多了。", "Nothing more."),
  "R-PAGE": (lang, page) => pageFooter(lang, page) ?? "",
  "R-DROP": (lang, { count }) =>
    pick(lang, `已丢弃 ${count} 个附件。`, `Dropped ${count} attachment(s).`),
  "R-ATTACH": (lang, { name, sizeBytes }) => {
    const file = truncate(cleanInline(baseName(name)), 60);
    return pick(
      lang,
      `已收到 ${file}（${formatSize(sizeBytes)}）。发送说明文字即可带上它，.drop 丢弃。`,
      `Received ${file} (${formatSize(sizeBytes)}). Send your text to include it, or .drop to discard.`,
    );
  },
  "R-NEW": (lang, data) => {
    const facts = [modeLabel(lang, data.mode)];
    if (data.model) facts.push(truncate(cleanInline(data.model), 40));
    return pick(
      lang,
      lines(
        `已在 ${displayTitle(data.project)} 开始：${echo(data.text)}`,
        `${facts.join(" · ")} · 完成后通知你，.x 可停止`,
      ),
      lines(
        `Started in ${displayTitle(data.project)}: ${echo(data.text)}`,
        `${facts.join(" · ")} · I'll tell you when it's done; .x stops it`,
      ),
    );
  },
  "R-NEWARMED": (lang, { project }) =>
    pick(
      lang,
      `下一条消息会在 ${displayTitle(project)} 新开会话。`,
      `Your next message starts a new session in ${displayTitle(project)}.`,
    ),
  "R-STEER": (lang, { at }) =>
    `${head(lang, at)}${pick(lang, "已转给正在运行的任务。", "Passed to the running task.")}`,
  "R-ROUTE": (lang, { at }) =>
    pick(
      lang,
      `→ ${header(lang, at.project, at.title)} · .n 新开会话`,
      `→ ${header(lang, at.project, at.title)} · .n starts a new one`,
    ),
  "R-WELCOME": (lang, data) => {
    const computer = truncate(cleanInline(data.computer), TITLE_MAX);
    return lines(
      pick(
        lang,
        `已连接到 ${computer} 上的 Pine（实验性功能）。`,
        `Connected to Pine on ${computer} (experimental).`,
      ),
      TEMPLATES["R-HELP"](lang, data),
    );
  },
  "R-SESSIONS": (lang, { rows: items, now }) => {
    if (items.length === 0)
      return pick(
        lang,
        "还没有会话。直接发文字开始一个。",
        "No sessions yet. Send text to start one.",
      );
    const markText = {
      running: "▶",
      waiting: "!",
      wechat: pick(lang, "微", "WX"),
      automation: pick(lang, "自动", "auto"),
    };
    return lines(
      ...rows(items).map((item) => {
        const marks = item.marks.map((mark) => markText[mark]).join("");
        return row(
          `${item.n} ${marks ? `${marks} ` : ""}${displayTitle(item.title)} · ${displayTitle(item.project)} · ${formatWhen(item.atMs, now, lang)}`,
        );
      }),
      pick(
        lang,
        "回 .数字 切换 · .0 更多 · .f 搜索",
        "Reply .number to switch · .0 more · .f search",
      ),
    );
  },
  "R-SEARCH": (lang, { query, total, rows: items }) => {
    const q = echo(query);
    if (items.length === 0)
      return pick(lang, `「${q}」没有找到。`, `No results for "${q}".`);
    const count = total ?? items.length;
    return lines(
      pick(
        lang,
        `「${q}」找到 ${count} 个：`,
        `${count} result(s) for "${q}":`,
      ),
      ...rows(items).map((item) => {
        const snippet = item.snippet
          ? ` · …${truncate(cleanInline(stripSearchMarkers(item.snippet)), 40)}…`
          : "";
        return row(
          `${item.n} ${displayTitle(item.title)} · ${displayTitle(item.project)}${snippet}`,
        );
      }),
    );
  },
  "R-MATCHES": (lang, { query, rows: items }) =>
    lines(
      pick(
        lang,
        `「${echo(query)}」匹配多个，回 .数字 选择：`,
        `"${echo(query)}" matches several. Reply .number to choose:`,
      ),
      ...rows(items).map((item) => row(`${item.n} ${cleanInline(item.label)}`)),
    ),
  "R-USE": (lang, data) =>
    pick(
      lang,
      lines(
        `当前会话：${displayTitle(data.title)}（${displayTitle(data.project)}）· ${stateLabel(lang, data.state)} · ${modeLabel(lang, data.mode)} · ${data.count} 条消息`,
        "直接发文字继续 · .r 看上次回复",
      ),
      lines(
        `Current session: ${displayTitle(data.title)} (${displayTitle(data.project)}) · ${stateLabel(lang, data.state)} · ${modeLabel(lang, data.mode)} · ${data.count} messages`,
        "Send text to continue · .r for the last reply",
      ),
    ),
  "R-USEVIEW": (lang, data) => {
    const first = pick(
      lang,
      `当前会话：${displayTitle(data.title)}（${displayTitle(data.project)}）· ${stateLabel(lang, data.state)}`,
      `Current session: ${displayTitle(data.title)} (${displayTitle(data.project)}) · ${stateLabel(lang, data.state)}`,
    );
    if (data.reason === "automation-run" || !data.mode || !data.ceiling)
      return lines(
        first,
        pick(
          lang,
          "只读：这是自动化运行的会话。可查看和停止。",
          "View only: this session belongs to an automation run. You can read and stop it.",
        ),
      );
    const mode = modeLabel(lang, data.mode);
    const ceiling = modeLabel(lang, data.ceiling);
    const n = modeNumber(data.ceiling);
    return lines(
      first,
      pick(
        lang,
        `只读：它的审批模式（${mode}）高于微信上限（${ceiling}）。可查看和停止。`,
        `View only: its approval mode (${mode}) is above the WeChat ceiling (${ceiling}). You can read and stop it.`,
      ),
      pick(
        lang,
        `回 .mode ${n} 把它降到 ${ceiling} 后可继续。`,
        `Reply .mode ${n} to lower it to ${ceiling} and continue.`,
      ),
    );
  },
  "R-LAST": (lang, { at, text, page }) =>
    lines(
      header(lang, at.project, at.title),
      neutraliseText(text),
      page && pageFooter(lang, page),
    ),
  "R-NOREPLY": (lang) =>
    pick(lang, "这个会话还没有回复。", "This session has no reply yet."),
  "R-HISTORY": (lang, { entries }) => {
    const footer = pick(
      lang,
      "（.r 看最后一条全文）",
      "(.r for the full last reply)",
    );
    const kept: string[] = [];
    let used = codePointLength(footer) + 1;
    for (const entry of [...entries].reverse()) {
      const who =
        entry.role === "user"
          ? pick(lang, "你：", "You: ")
          : pick(lang, "Pine：", "Pine: ");
      const line = `${who}${truncate(cleanInline(entry.text), HISTORY_ENTRY_MAX)}`;
      const size = codePointLength(line) + 1;
      if (used + size > REPLY_MAX) break;
      kept.unshift(line);
      used += size;
    }
    if (kept.length === 0) return TEMPLATES["R-NOREPLY"](lang, undefined);
    return lines(...kept, footer);
  },
  "R-STOP": (lang, { title, backgroundTasks }) =>
    pick(
      lang,
      `已停止：${displayTitle(title)}。${backgroundTasks > 0 ? `还有 ${backgroundTasks} 个后台进程在运行（.b）。` : ""}`,
      `Stopped: ${displayTitle(title)}.${backgroundTasks > 0 ? ` ${backgroundTasks} background process(es) still running (.b).` : ""}`,
    ),
  "R-STOPNONE": (lang) =>
    pick(lang, "没有正在运行的回复。", "Nothing is running."),
  "R-STOPALL": (lang, { count }) =>
    pick(lang, `已停止 ${count} 个会话。`, `Stopped ${count} session(s).`),
  "R-QUEUED": (lang) =>
    pick(
      lang,
      "已排队，这一轮结束后发送。",
      "Queued. It will be sent after this turn.",
    ),
  "R-QUEUEWAIT": (lang, { at, asks }) => {
    const items = asks
      .slice(0, PAGE_ROWS)
      .map(({ number: n, variant }) => queueWaitItem(lang, n, variant));
    const extra = asks.length - items.length;
    if (extra > 0)
      items.push(pick(lang, `等 ${extra} 项`, `and ${extra} more`));
    return `${head(lang, at)}${pick(
      lang,
      `已作为暂存消息排队，等待的卡片处理后交给智能体。仍在等你：${list(lang, items)}。发 .撤回 可撤回这条消息。`,
      `Staged as a steering message; it reaches the agent once the waiting card is handled. Still waiting: ${list(lang, items)}. .recall withdraws this message.`,
    )}`;
  },
  "R-QUEUE": (lang, { rows: items }) => {
    if (items.length === 0)
      return pick(lang, "没有排队的消息。", "No queued messages.");
    return lines(
      ...rows(items).map((item) =>
        row(`${item.n} ${truncate(cleanInline(item.text), 80)}`),
      ),
      pick(lang, ".qx 数字 撤回", ".recall number withdraws"),
    );
  },
  "R-UNQUEUE": (lang, { text }) =>
    pick(lang, `已撤回：${echo(text)}`, `Withdrawn: ${echo(text)}`),
  "R-RENAME": (lang, { title }) =>
    pick(
      lang,
      `已重命名为：${displayTitle(title)}`,
      `Renamed to: ${displayTitle(title)}`,
    ),
  "R-DELETE-ASK": (lang, data) =>
    lines(
      pick(
        lang,
        `删除「${displayTitle(data.title)}」（${displayTitle(data.project)}，${data.count} 条消息）？不可恢复。`,
        `Delete "${displayTitle(data.title)}" (${displayTitle(data.project)}, ${data.count} messages)? This cannot be undone.`,
      ),
      confirmLine(lang, data.ask),
    ),
  "R-DELETED": (lang, { title }) =>
    pick(
      lang,
      `已删除：${displayTitle(title)}`,
      `Deleted: ${displayTitle(title)}`,
    ),
  "R-MODELS": (lang, { rows: items }) => {
    if (items.length === 0)
      return pick(
        lang,
        "没有可用的模型。请在电脑上配置模型服务商。",
        "No models available. Set up a provider on the computer.",
      );
    return lines(
      ...rows(items).map((item) =>
        row(
          `${item.n} ${item.current ? "* " : ""}${cleanInline(item.model)} · ${cleanInline(item.provider)}`,
        ),
      ),
      pick(
        lang,
        "回 .数字 切换 · .m 关键词 筛选",
        "Reply .number to switch · .m words to filter",
      ),
    );
  },
  "R-MODEL": (lang, { at, model, effort }) => {
    const level = effort
      ? effortLabel(lang, effort)
      : pick(lang, "默认", "default");
    const name = truncate(cleanInline(model), 60);
    return `${head(lang, at)}${pick(
      lang,
      `模型：${name} · 推理强度 ${level}。下一条回复生效。`,
      `Model: ${name} · effort ${level}. Applies from the next reply.`,
    )}`;
  },
  "R-EFFORTS": (lang, { rows: items }) =>
    lines(
      `${pick(lang, "推理强度：", "Reasoning effort: ")}${items
        .map(
          (item) =>
            `${item.n} ${item.current ? "* " : ""}${effortLabel(lang, item.level)}`,
        )
        .join(" · ")}`,
      pick(lang, "回 .数字 切换", "Reply .number to switch"),
    ),
  "R-EFFORT": (lang, { level }) =>
    pick(
      lang,
      `推理强度：${effortLabel(lang, level)}`,
      `Reasoning effort: ${effortLabel(lang, level)}`,
    ),
  "R-MODES": (lang, { current, ceiling }) => {
    const limit = modeNumber(ceiling);
    return lines(
      APPROVAL_MODE_ORDER.map((mode, index) => {
        const mark = mode === current ? "* " : index + 1 > limit ? "🔒 " : "";
        return `${index + 1} ${mark}${modeLabel(lang, mode)}`;
      }).join(" · "),
      pick(
        lang,
        "最高模式在电脑上设置。",
        "The highest mode is set on the computer.",
      ),
    );
  },
  "R-MODE": (lang, { at, mode, ceiling }) =>
    `${head(lang, at)}${pick(
      lang,
      `审批模式：${modeLabel(lang, mode)}（最高模式 ${modeLabel(lang, ceiling)}）`,
      `Approval mode: ${modeLabel(lang, mode)} (highest mode ${modeLabel(lang, ceiling)})`,
    )}`,
  "R-MODE-REVIEW": (lang, data) =>
    lines(
      TEMPLATES["R-MODE"](lang, data),
      pick(
        lang,
        "每个操作都会发到微信等你批准，回复额度消耗较快。",
        "Every action will be sent here for approval, which uses up replies quickly.",
      ),
    ),
  "R-YOLO-ASK": (lang, { title, ask }) =>
    lines(
      pick(
        lang,
        `为「${displayTitle(title)}」启用“干就完了”？它会关闭一切权限约束和审批，你需自行承担数据不可逆损失等风险。`,
        `Enable YOLO for "${displayTitle(title)}"? It turns off every permission limit and approval; irreversible data loss is at your own risk.`,
      ),
      confirmLine(lang, ask),
    ),
  "R-USAGE": (lang, data) => {
    const model = data.model ? truncate(cleanInline(data.model), 50) : "?";
    const effort = data.effort
      ? effortLabel(lang, data.effort)
      : pick(lang, "默认", "default");
    const context: string[] = [];
    if (data.contextTokens !== undefined && data.contextWindow !== undefined) {
      const share =
        data.contextPercent ??
        (data.contextWindow > 0
          ? (data.contextTokens / data.contextWindow) * 100
          : 0);
      context.push(
        pick(
          lang,
          `上下文 ${tokens(data.contextTokens)}/${tokens(data.contextWindow)}（${percent(share)}%）`,
          `Context ${tokens(data.contextTokens)}/${tokens(data.contextWindow)} (${percent(share)}%)`,
        ),
      );
    } else if (data.contextPercent !== undefined) {
      context.push(
        pick(
          lang,
          `上下文 ${percent(data.contextPercent)}%`,
          `Context ${percent(data.contextPercent)}%`,
        ),
      );
    }
    if (data.cacheHitPercent !== undefined)
      context.push(
        pick(
          lang,
          `缓存命中 ${percent(data.cacheHitPercent)}%`,
          `cache hit ${percent(data.cacheHitPercent)}%`,
        ),
      );
    const spent = data.costUsd === undefined ? "$?" : cost(data.costUsd);
    return lines(
      header(lang, data.at.project, data.at.title),
      pick(
        lang,
        `模型 ${model} · 推理强度 ${effort}`,
        `Model ${model} · effort ${effort}`,
      ),
      pick(
        lang,
        `模式 ${modeLabel(lang, data.mode)}（最高模式 ${modeLabel(lang, data.ceiling)}）`,
        `Mode ${modeLabel(lang, data.mode)} (highest mode ${modeLabel(lang, data.ceiling)})`,
      ),
      context.length > 0 && context.join(" · "),
      pick(
        lang,
        `本会话 ${spent} · ${data.count} 条消息`,
        `This session ${spent} · ${data.count} messages`,
      ),
    );
  },
  "R-USAGE-NONE": (lang) =>
    pick(
      lang,
      "暂无用量数据，下一次回复后更新。",
      "No usage data yet. It updates after the next reply.",
    ),
  "R-COMPACTING": (lang) =>
    pick(lang, "正在压缩上下文…", "Compacting the context…"),
  "R-COMPACTED": (lang, { at, error }) =>
    `${head(lang, at)}${
      error === undefined
        ? pick(lang, "上下文已压缩。", "Context compacted.")
        : pick(
            lang,
            `压缩失败：${truncate(cleanInline(error), 200)}`,
            `Compaction failed: ${truncate(cleanInline(error), 200)}`,
          )
    }`,
  "R-COMPACT-IDLE": (lang) =>
    pick(
      lang,
      "这个会话还没有载入上下文。先发一条消息，再压缩。",
      "Nothing is loaded to compact yet. Send a message first.",
    ),
  "R-TODO": (lang, { at, items }) => {
    if (items.length === 0)
      return pick(lang, "这个会话没有待办。", "This session has no todos.");
    const done = items.filter((item) => item.status === "completed").length;
    const shown = items.slice(0, 15);
    const icon = { completed: "✓", in_progress: "▶", pending: "○" };
    return lines(
      `${head(lang, at)}${pick(lang, `待办 ${done}/${items.length}`, `Todos ${done}/${items.length}`)}`,
      ...shown.map((item) =>
        row(`${icon[item.status]} ${cleanInline(item.subject)}`),
      ),
      items.length > shown.length &&
        pick(
          lang,
          `…还有 ${items.length - shown.length} 项`,
          `…${items.length - shown.length} more`,
        ),
    );
  },
  "R-PENDING": (lang, { asks, automationApprovals }) => {
    const automation =
      automationApprovals > 0 &&
      pick(
        lang,
        `另有 ${automationApprovals} 个自动化变更需在电脑上批准。`,
        `${automationApprovals} automation change(s) need approval on the computer.`,
      );
    if (asks.length === 0)
      return lines(
        pick(lang, "没有待处理项。", "Nothing is waiting."),
        automation,
      );
    return lines(
      pick(lang, `待处理 ${asks.length} 项：`, `${asks.length} waiting:`),
      ...asks.map((ask) =>
        row(
          `${ask.number} ${askWhat(lang, ask)}${ask.title ? ` · ${displayTitle(ask.title)}` : ""}`,
        ),
      ),
      automation,
    );
  },
  "R-APPROVED": (lang, { ask, subject }) => {
    const what = subject ? truncate(cleanInline(subject), 60) : "";
    return pick(
      lang,
      what ? `已批准 ${ask}：${what}` : `已批准 ${ask}。`,
      what ? `Approved ${ask}: ${what}` : `Approved ${ask}.`,
    );
  },
  "R-REJECTED": (lang, { ask }) =>
    pick(lang, `已拒绝 ${ask}。`, `Rejected ${ask}.`),
  "R-GUIDED": (lang, { ask }) =>
    pick(
      lang,
      `已拒绝 ${ask}，并把你的说明交给 Pine。`,
      `Rejected ${ask} and passed your note to Pine.`,
    ),
  "R-ANSWERED": (lang, { ask, summary }) =>
    pick(
      lang,
      `已回答 ${ask}：${echo(summary)}`,
      `Answered ${ask}: ${echo(summary)}`,
    ),
  "R-CANCELLED": (lang, { ask }) =>
    pick(lang, `已取消 ${ask}。`, `Cancelled ${ask}.`),
  "R-FILES": (lang, { at, rows: items, canSend }) => {
    if (items.length === 0)
      return pick(
        lang,
        "这个会话还没有展示过文件。",
        "This session has not presented any file.",
      );
    return lines(
      `${head(lang, at)}${pick(lang, `展示过的文件 ${items.length} 个`, `${items.length} presented file(s)`)}`,
      ...rows(items).map((item) =>
        row(
          `${item.n} ${cleanInline(baseName(item.path))}${item.sizeBytes === undefined ? "" : ` · ${formatSize(item.sizeBytes)}`}`,
        ),
      ),
      canSend
        ? pick(lang, "回 .数字 发送", "Reply .number to send")
        : pick(
            lang,
            "发文件已在电脑上关闭，这里只能看文件名。",
            "Sending files is turned off on the computer; only names are shown.",
          ),
    );
  },
  "R-SENDING": (lang, { name, sizeBytes }) => {
    const file = truncate(cleanInline(baseName(name)), 60);
    return pick(
      lang,
      `正在发送 ${file}（${formatSize(sizeBytes)}）…`,
      `Sending ${file} (${formatSize(sizeBytes)})…`,
    );
  },
  "R-TASKS": (lang, { rows: items }) => {
    if (items.length === 0)
      return pick(lang, "没有后台进程。", "No background processes.");
    return lines(
      ...rows(items).map((item) => {
        const state = item.running
          ? pick(
              lang,
              `运行 ${formatDuration(item.runningMs ?? 0, lang)}`,
              `running ${formatDuration(item.runningMs ?? 0, lang)}`,
            )
          : item.exitCode === undefined
            ? pick(lang, "已结束", "ended")
            : pick(lang, `已退出 ${item.exitCode}`, `exited ${item.exitCode}`);
        return row(
          `${item.n} ${displayTitle(item.title)} · ${state} · ${truncate(cleanInline(item.command), 60)}`,
        );
      }),
      pick(
        lang,
        "回 .数字 看输出 · .k 数字 结束",
        "Reply .number for output · .k number to stop",
      ),
    );
  },
  "R-TASK": (lang, { title, output }) => {
    const tail = neutraliseText(tailOutput(output));
    return lines(
      pick(
        lang,
        `${displayTitle(title)} 最近输出：`,
        `${displayTitle(title)}, latest output:`,
      ),
      tail || pick(lang, "（没有输出）", "(no output)"),
    );
  },
  "R-KILLED": (lang, { title }) =>
    pick(
      lang,
      `已结束：${displayTitle(title)}`,
      `Stopped: ${displayTitle(title)}`,
    ),
  "R-PROJECTS": (lang, { rows: items }) =>
    lines(
      ...rows(items).map((item) => {
        const name = item.temporary
          ? pick(lang, "无项目", "No Project")
          : displayTitle(item.name);
        return row(`${item.n} ${item.current ? "* " : ""}${name}`);
      }),
      pick(lang, "回 .数字 切换", "Reply .number to switch"),
    ),
  "R-PROJECT": (lang, data) => {
    const name = data.temporary
      ? pick(lang, "无项目", "No Project")
      : displayTitle(data.name);
    const folders = list(
      lang,
      data.folders.slice(0, 5).map((folder) => {
        const base = truncate(cleanInline(baseName(folder.path)), 30);
        return folder.access === "read-only"
          ? pick(lang, `${base}（只读）`, `${base} (read-only)`)
          : base;
      }),
    );
    const more =
      data.folders.length > 5
        ? pick(
            lang,
            ` 等 ${data.folders.length} 个`,
            ` +${data.folders.length - 5}`,
          )
        : "";
    const shown = folders
      ? `${folders}${more}`
      : pick(lang, "没有文件夹", "no folders");
    return pick(
      lang,
      `新会话将开在：${name}（${shown}；${data.count} 个会话）`,
      `New sessions will start in: ${name} (${shown}; ${data.count} sessions)`,
    );
  },
  "R-AUTOS": (lang, { rows: items, now }) => {
    if (items.length === 0)
      return pick(lang, "还没有自动化。", "No automations yet.");
    const state = {
      on: pick(lang, "开", "on"),
      off: pick(lang, "关", "off"),
      paused: pick(lang, "已暂停", "paused"),
    };
    return lines(
      ...rows(items).map((item) => {
        const parts = [
          `${item.n} ${displayTitle(item.name)}`,
          displayTitle(item.project),
          state[item.state],
        ];
        if (item.nextAtMs !== undefined)
          parts.push(
            pick(
              lang,
              `下次 ${whenAhead(item.nextAtMs, now, lang)}`,
              `next ${whenAhead(item.nextAtMs, now, lang)}`,
            ),
          );
        if (item.lastResult)
          parts.push(
            pick(
              lang,
              `上次：${cleanInline(item.lastResult)}`,
              `last: ${cleanInline(item.lastResult)}`,
            ),
          );
        return row(parts.join(" · "));
      }),
    );
  },
  "R-AUTO": (lang, data) => {
    const field = (text: string) => truncate(cleanInline(text), 120) || "—";
    return pick(
      lang,
      lines(
        `${displayTitle(data.name)}（${displayTitle(data.project)}）${onOff(lang, data.enabled)}`,
        `触发：${field(data.triggers)}`,
        `读取：${field(data.reads)}`,
        `写入：${field(data.writes)} · 联网：${field(data.hosts)}`,
      ),
      lines(
        `${displayTitle(data.name)} (${displayTitle(data.project)}) ${onOff(lang, data.enabled)}`,
        `Triggers: ${field(data.triggers)}`,
        `Reads: ${field(data.reads)}`,
        `Writes: ${field(data.writes)} · Network: ${field(data.hosts)}`,
      ),
    );
  },
  "R-AUTO-OFF": (lang, { name }) =>
    pick(
      lang,
      `已关闭：${displayTitle(name)}。重新开启需要在电脑上批准。`,
      `Turned off: ${displayTitle(name)}. Turning it back on needs approval on the computer.`,
    ),
  "R-AUTO-ON": (lang, { name }) =>
    pick(
      lang,
      `已在电脑上发起“开启 ${displayTitle(name)}”的请求（标注为来自微信）。批准结果会通知你。`,
      `Asked the computer to turn on ${displayTitle(name)} (marked as requested from WeChat). I'll tell you the outcome.`,
    ),
  "R-AUTO-ALREADY": (lang, { name }) =>
    pick(
      lang,
      `${displayTitle(name)} 已经是开启状态。`,
      `${displayTitle(name)} is already on.`,
    ),
  "R-AUTO-ON-PENDING": (lang, { name }) =>
    pick(
      lang,
      `“开启 ${displayTitle(name)}”的请求已在电脑上等待批准。`,
      `A request to turn on ${displayTitle(name)} is already waiting on the computer.`,
    ),
  "R-AUTO-RUN-ASK": (lang, { name, ask }) =>
    lines(
      pick(
        lang,
        `立即运行「${displayTitle(name)}」？它会按已批准的权限以“自主工作”运行，并产生费用。`,
        `Run "${displayTitle(name)}" now? It runs in Autonomous Work with its approved permissions and costs money.`,
      ),
      confirmLine(lang, ask),
    ),
  "R-AUTO-RUN": (lang, { name }) =>
    pick(
      lang,
      `已开始运行：${displayTitle(name)}。结束后通知你。`,
      `Started: ${displayTitle(name)}. I'll tell you when it ends.`,
    ),
  "R-RUNS": (lang, { rows: items, now }) => {
    if (items.length === 0)
      return pick(lang, "还没有运行记录。", "No runs yet.");
    return lines(
      ...rows(items).map((item) =>
        row(
          [
            `${item.n} ${displayTitle(item.name)}`,
            truncate(cleanInline(item.result), 20),
            formatWhen(item.atMs, now, lang),
            ...(item.unread ? [pick(lang, "未读", "unread")] : []),
          ].join(" · "),
        ),
      ),
    );
  },
  "R-RUN": (lang, data) =>
    lines(
      `${displayTitle(data.name)} · ${formatWhen(data.atMs, data.now, lang)} · ${truncate(cleanInline(data.result), 40)}`,
      pick(
        lang,
        "（以下为自动化生成的摘要）",
        "(Summary written by the automation)",
      ),
      truncate(neutraliseText(toPlainText(data.summary, lang)), 500),
    ),
  "R-SKILLS": (lang, { rows: items }) => {
    if (items.length === 0)
      return pick(lang, "这个项目没有技能。", "This project has no Skills.");
    return lines(
      ...rows(items).map((item) =>
        row(
          [
            `${item.n} ${truncate(cleanInline(item.name), 30)}`,
            item.scope === "global"
              ? pick(lang, "全局", "global")
              : pick(lang, "项目", "project"),
            onOff(lang, item.enabled),
            ...(item.description
              ? [truncate(cleanInline(item.description), 40)]
              : []),
          ].join(" · "),
        ),
      ),
    );
  },
  "R-MCP": (lang, { rows: items }) => {
    if (items.length === 0)
      return pick(lang, "没有 MCP 服务器。", "No MCP servers.");
    const status = {
      connected: pick(lang, "已连接", "connected"),
      failed: pick(lang, "连接失败", "failed"),
      unknown: pick(lang, "状态未知", "unknown"),
    };
    return lines(
      ...rows(items).map((item) =>
        row(
          [
            truncate(cleanInline(item.name), 30),
            item.scope === "global"
              ? pick(lang, "全局", "global")
              : pick(lang, "项目", "project"),
            status[item.status],
            ...(item.tools === undefined
              ? []
              : [pick(lang, `${item.tools} 个工具`, `${item.tools} tools`)]),
          ].join(" · "),
        ),
      ),
    );
  },

  "T-APPROVAL": (lang, data) => {
    const card = approvalHead(lang, data, false);
    return lines(
      card.text,
      card.cut && TEMPLATES["T-CUT"](lang, { ask: data.ask }),
      pick(
        lang,
        `.y ${data.ask} 批准 · .d ${data.ask} 拒绝 · .d ${data.ask} 你的建议`,
        `.y ${data.ask} approve · .d ${data.ask} reject · .d ${data.ask} your note`,
      ),
    );
  },
  "T-CUT": (lang, { ask }) =>
    pick(
      lang,
      `（内容已截断。先回 .${ask} 看全文，再批准。）`,
      `(Cut short. Reply .${ask} to read all of it before approving.)`,
    ),
  "T-APPROVAL-LOCAL": (lang, data) => {
    const card = approvalHead(lang, data, true);
    let reason: string;
    if (data.reason === "view-only" && data.viewOnly === "automation-run")
      reason = pick(
        lang,
        `这个会话属于自动化运行，请在电脑上处理；.d ${data.ask} 可拒绝。`,
        `This session belongs to an automation run. Handle it on the computer; .d ${data.ask} rejects it.`,
      );
    else if (data.reason === "view-only")
      reason = pick(
        lang,
        `这个会话的审批模式高于微信上限，请在电脑上处理；.d ${data.ask} 可拒绝。`,
        `This session's approval mode is above the WeChat ceiling. Handle it on the computer; .d ${data.ask} rejects it.`,
      );
    else
      reason = pick(
        lang,
        `这类操作不能在微信里批准，请在这台电脑或 Pine Remote 中处理。.d ${data.ask} 可在这里拒绝。`,
        `This kind of action cannot be approved from WeChat. Use the computer or Pine Remote. .d ${data.ask} rejects it here.`,
      );
    return lines(card.text, reason);
  },
  "T-SHOW": (lang, data) => {
    const subject = subjectLines(data.subject, SHOW_INPUT_MAX);
    const evidence = data.evidence ? neutraliseText(data.evidence) : "";
    const what = data.local
      ? pick(
          lang,
          `需在电脑上批准 ${data.ask}`,
          `Approve on the computer ${data.ask}`,
        )
      : pick(lang, `需要批准 ${data.ask}`, `Approval needed ${data.ask}`);
    return lines(
      `${head(lang, data.at)}${what}`,
      `${truncate(cleanInline(data.tool), 40)} · ${triggerLabel(lang, data.trigger)}`,
      subject.text,
      subject.cut &&
        pick(
          lang,
          "（内容过长，完整内容请在 Pine 中查看）",
          "(Too long to show in full. Open Pine for all of it.)",
        ),
      descriptionLine(data.description),
      evidence &&
        `${pick(lang, "依据：", "Evidence: ")}${truncate(evidence, 300)}`,
      data.external && render("T-EXTERNAL", lang),
      data.local
        ? pick(
            lang,
            `.d ${data.ask} 拒绝 · .d ${data.ask} 你的建议`,
            `.d ${data.ask} reject · .d ${data.ask} your note`,
          )
        : pick(
            lang,
            `.y ${data.ask} 批准 · .d ${data.ask} 拒绝 · .d ${data.ask} 你的建议`,
            `.y ${data.ask} approve · .d ${data.ask} reject · .d ${data.ask} your note`,
          ),
    );
  },
  "T-LONGCTX": (lang, { at, ask }) =>
    lines(
      `${head(lang, at)}${pick(lang, `上下文较长 ${ask}`, `Long context ${ask}`)}`,
      pick(
        lang,
        "启用新工具会重写已缓存的长上下文。",
        "Turning on new tools would rewrite a long cached context.",
      ),
      pick(
        lang,
        `.c ${ask} 先压缩再继续 · .d ${ask} 停止`,
        `.c ${ask} compress, then continue · .d ${ask} stop`,
      ),
    ),
  "T-EXTERNAL": (lang) =>
    pick(
      lang,
      "该会话此前读取过外部内容，请核对后再批准。",
      "This session has read external content. Check before approving.",
    ),
  "T-TRIGGER": (lang, { trigger }) => triggerLabel(lang, trigger),
  "T-MORECARDS": (lang, { count }) =>
    pick(
      lang,
      `还有 ${count} 项，回 .w 查看。`,
      `${count} more. Reply .w to see them.`,
    ),
  "T-QCARD": (lang, { at, ask, questionnaire }) =>
    questionCard(lang, at, ask, questionnaire),
  "T-QCARD-LOCAL": (lang, { at, ask, questionnaire }) =>
    lines(
      `${head(lang, at)}${pick(lang, `问题 ${ask}`, `Question ${ask}`)}`,
      ...questionnaire.questions.map((question) =>
        row(neutralise(question.question)),
      ),
      pick(
        lang,
        `这个问题需要在 Pine 中回答。.d ${ask} 可取消。`,
        `Answer this one in Pine. .d ${ask} cancels it.`,
      ),
    ),
  "T-DONE": (lang, data) => {
    const facts: string[] = [];
    if (data.durationMs !== undefined)
      facts.push(formatDuration(data.durationMs, lang));
    if (data.costUsd !== undefined) facts.push(cost(data.costUsd));
    const done =
      facts.length > 0
        ? pick(
            lang,
            `完成（${facts.join("，")}）`,
            `Done (${facts.join(", ")})`,
          )
        : pick(lang, "完成", "Done");
    const excerpt = truncate(
      neutraliseText(toPlainText(data.text, lang)),
      DONE_EXCERPT_MAX,
    );
    const actions = [pick(lang, ".r 全文", ".r full reply")];
    if (data.files > 0)
      actions.push(
        pick(lang, `.o 文件(${data.files})`, `.o files (${data.files})`),
      );
    if (!data.current)
      actions.unshift(pick(lang, ".u 9 切到它", ".u 9 switch to it"));
    return lines(
      `${head(lang, data.at)}${done}`,
      excerpt || undefined,
      actions.join(" · "),
    );
  },
  "T-FAILED": (lang, { at, error }) =>
    lines(
      `${head(lang, at)}${pick(lang, "失败：", "Failed: ")}${truncate(cleanInline(error), 200)}`,
      pick(lang, "直接发消息可重试。", "Send a message to retry."),
    ),
  "T-PROGRESS": (lang, { at, todos }) =>
    `${head(lang, at)}${pick(lang, "仍在运行", "Still running")}${
      todos
        ? pick(
            lang,
            ` · 待办 ${todos.done}/${todos.total}`,
            ` · Todos ${todos.done}/${todos.total}`,
          )
        : ""
    }`,
  "T-AUTORUN": (lang, { name, result }) =>
    pick(
      lang,
      `自动化「${displayTitle(name)}」运行结束：${truncate(cleanInline(result), 60)}。.ar 查看`,
      `Automation "${displayTitle(name)}" finished: ${truncate(cleanInline(result), 60)}. .ar to view`,
    ),
  "T-AUTO-ON": (lang, { name, result }) =>
    pick(
      lang,
      `开启「${displayTitle(name)}」的请求：${{ approved: "已在电脑上批准，现已开启", denied: "在电脑上被拒绝", timeout: "30 分钟内无人处理，已失效" }[result]}。`,
      `Request to turn on "${displayTitle(name)}": ${{ approved: "approved on the computer, now on", denied: "declined on the computer", timeout: "not handled within 30 minutes, expired" }[result]}.`,
    ),
  "T-PAIR": (lang, { code }) =>
    pick(
      lang,
      `Pine 配对码：${cleanInline(code)}\n请在电脑上的 Pine 里输入它，完成连接。如果不是你在连接，请忽略这条消息。`,
      `Pine pairing code: ${cleanInline(code)}\nEnter it in Pine on the computer to finish connecting. If you are not connecting Pine, ignore this message.`,
    ),
  "T-INTERRUPTED": (lang, { items }) =>
    lines(
      pick(
        lang,
        `Pine 上次退出时有 ${items.length} 条消息没有处理完，没有重新执行：`,
        `${items.length} message(s) were not finished when Pine last stopped and were not run again:`,
      ),
      ...rows(items).map((item, index) => `${index + 1} ${echo(item)}`),
      items.length > PAGE_ROWS &&
        pick(
          lang,
          `…还有 ${items.length - PAGE_ROWS} 条`,
          `…${items.length - PAGE_ROWS} more`,
        ),
      pick(
        lang,
        "需要的话请重新发送。",
        "Send them again if you still need them.",
      ),
    ),
  "T-OVERFLOW": (lang, { items }) =>
    lines(
      pick(
        lang,
        `一次收到的消息太多，有 ${items.length} 条没有执行：`,
        `Too many messages arrived at once; ${items.length} were not run:`,
      ),
      ...rows(items).map((item, index) => `${index + 1} ${echo(item)}`),
      items.length > PAGE_ROWS &&
        pick(
          lang,
          `…还有 ${items.length - PAGE_ROWS} 条`,
          `…${items.length - PAGE_ROWS} more`,
        ),
      pick(
        lang,
        "需要的话请重新发送。",
        "Send them again if you still need them.",
      ),
    ),
  "T-BUDGET": (lang) =>
    pick(
      lang,
      "回复额度即将用完。之后的通知会在你下次发消息时送达（发 . 即可）。",
      "I'm about to run out of replies. Later notices arrive with your next message (send . to check).",
    ),
  "T-DIGEST": (lang, { items }) => renderDigest(lang, items),
  "T-STALE": (lang, { held, notRun, oldestAgeMs, ask }) => {
    const notRunLine =
      notRun.length > 0 &&
      pick(
        lang,
        `未执行：${list(lang, notRun.slice(0, PAGE_ROWS).map(echo))}（已过期）`,
        `Not run: ${list(lang, notRun.slice(0, PAGE_ROWS).map(echo))} (too old)`,
      );
    if (held.length === 0 || ask === undefined) return notRunLine || "";
    const total = held.length + notRun.length;
    const age = formatAge(oldestAgeMs, lang);
    const shown = rows(held);
    const numbers = list(
      lang,
      shown.map((_, index) => String(index + 1)),
    );
    return lines(
      pick(
        lang,
        `离线期间收到 ${total} 条消息（最早 ${age}前）：`,
        `${total} message(s) arrived while offline (oldest ${age} ago):`,
      ),
      ...shown.map((item, index) => `${index + 1} ${echo(item)}`),
      notRunLine,
      pick(
        lang,
        `回 .y ${ask} 按顺序执行第 ${numbers} 条，.d ${ask} 丢弃。10 分钟内有效。`,
        `Reply .y ${ask} to run ${numbers} in order, .d ${ask} to discard. Valid for 10 minutes.`,
      ),
    );
  },

  "E-UNKNOWN": (lang, { token, suggestion }) => {
    const name = echo(token);
    const hint = suggestion ? echo(suggestion) : undefined;
    return pick(
      lang,
      `没有 .${name} 这个命令。${hint ? `是不是 .${hint}？` : ""}回 .? 看全部。要把以点开头的文字发给 Pine，请用两个点开头。`,
      `There is no .${name} command. ${hint ? `Did you mean .${hint}? ` : ""}Reply .? for the list. To send text that starts with a dot, start it with two dots.`,
    );
  },
  "E-ARGS": (lang, { spec, hint }) =>
    lines(
      pick(
        lang,
        `用法：.${spec.name}${spec.params ? ` ${spec.params}` : ""}。例如 ${spec.example}`,
        `Usage: .${spec.name}${spec.params ? ` ${spec.params}` : ""}. Example: ${spec.example}`,
      ),
      hint ? truncate(cleanInline(hint), ROW_MAX) : undefined,
    ),
  "E-REF": (lang, { n, list: command }) =>
    pick(
      lang,
      `编号 ${echo(String(n))} 已失效，请重新列出（${command}）。`,
      `Number ${echo(String(n))} is no longer valid. List again (${command}).`,
    ),
  "E-NOMATCH": (lang, { query, kind }) =>
    pick(
      lang,
      `没找到匹配「${echo(query)}」的${KIND_NOUNS[kind].zh}。`,
      `Nothing matches "${echo(query)}".`,
    ),
  "E-NOSESSION": (lang) =>
    pick(
      lang,
      "还没有当前会话。直接发文字开始一个，或 .l 选择。",
      "No current session. Send text to start one, or .l to pick one.",
    ),
  "E-VIEW": (lang, { title, mode, ceiling }) => {
    const m = modeLabel(lang, mode);
    const c = modeLabel(lang, ceiling);
    const n = modeNumber(ceiling);
    return pick(
      lang,
      `「${displayTitle(title)}」的审批模式（${m}）高于微信上限（${c}），在微信里只能查看和停止。回 .mode ${n} 把它降到 ${c} 后可继续。`,
      `"${displayTitle(title)}" runs in ${m}, above the WeChat ceiling (${c}). From WeChat you can only read and stop it. Reply .mode ${n} to lower it to ${c} and continue.`,
    );
  },
  "E-VIEWRUN": (lang, { title }) =>
    pick(
      lang,
      `「${displayTitle(title)}」是自动化运行的会话，在微信里只能查看和停止。`,
      `"${displayTitle(title)}" belongs to an automation run. From WeChat you can only read and stop it.`,
    ),
  "E-CEIL": (lang, { ceiling }) =>
    pick(
      lang,
      `微信最高只能用 ${modeLabel(lang, ceiling)}。最高模式只能在电脑上修改。`,
      `WeChat can go no higher than ${modeLabel(lang, ceiling)}. The highest mode can only be changed on the computer.`,
    ),
  "E-LOCAL": (lang, { ask }) =>
    ask === undefined
      ? pick(
          lang,
          "这项操作只能在电脑上完成。",
          "This can only be done on the computer.",
        )
      : pick(
          lang,
          `${ask} 只能在电脑或 Pine Remote 上批准。回 .d ${ask} 可拒绝。`,
          `${ask} can only be approved on the computer or Pine Remote. .d ${ask} rejects it.`,
        ),
  "E-SWITCH": (lang) =>
    pick(
      lang,
      "没有开启“允许通过微信发送文件”。请在电脑上的 Pine 设置中开启。",
      `"Allow sending files to WeChat" is off. Turn it on in Pine's settings on the computer.`,
    ),
  "E-CODE": (lang, { ask }) =>
    pick(
      lang,
      `没有编号 ${ask} 的待处理项。回 .w 查看。`,
      `Nothing is waiting under ${ask}. Reply .w to see what is.`,
    ),
  "E-DONE": (lang, { ask }) =>
    pick(
      lang,
      `${ask} 已经处理过了（在别处，或已过期）。`,
      `${ask} was already handled (elsewhere, or it expired).`,
    ),
  "E-WHICH": (lang, { asks, command }) => {
    const verb = command
      ? cleanInline(command).replace(/^[.。．｡]+/, "") || "y"
      : "y";
    const items = asks.slice(0, PAGE_ROWS).map((ask) => {
      const title = ask.title ? displayTitle(ask.title) : undefined;
      return pick(
        lang,
        `${ask.number} ${askWhat(lang, ask)}${title ? `（${title}）` : ""}`,
        `${ask.number} ${askWhat(lang, ask)}${title ? ` (${title})` : ""}`,
      );
    });
    const first = asks[0]?.number ?? 11;
    return pick(
      lang,
      `有 ${asks.length} 项待处理：${list(lang, items)}。请带编号，如 .${verb} ${first}`,
      `${asks.length} waiting: ${list(lang, items)}. Add the number, for example .${verb} ${first}`,
    );
  },
  "E-AMBIG": (lang, { n, ask, list: command }) =>
    pick(
      lang,
      `.${n} 有两种含义，请写完整：回答问题 ${ask} 用 .a ${ask} ${n}；选择列表第 ${n} 项用 ${command} ${n}。`,
      `.${n} could mean two things. Write it out: .a ${ask} ${n} answers question ${ask}; ${command} ${n} picks row ${n} of the list.`,
    ),
  "E-SHOWFIRST": (lang, { ask }) =>
    pick(
      lang,
      `${ask} 的内容在卡片上被截断了。先回 .${ask} 看全文，再回 .y ${ask}。`,
      `The card for ${ask} was cut short. Reply .${ask} to read all of it, then .y ${ask}.`,
    ),
  "E-TEXT": (lang) =>
    pick(
      lang,
      "这段文字以 Pine 内部的附件标记开头，没有发送。请去掉开头那一段再发。",
      "This text starts with Pine's internal attachment marker and was not sent. Remove that part and send it again.",
    ),
  "E-QUOTE": (lang) =>
    pick(
      lang,
      "只收到了引用的内容。请在引用时写上要 Pine 做什么。",
      "Only a quoted message arrived. Type what you want Pine to do with it.",
    ),
  "E-AUTOOFF": (lang, { name }) =>
    pick(
      lang,
      `「${displayTitle(name)}」处于关闭状态，不能从微信运行。`,
      `"${displayTitle(name)}" is turned off and cannot be run from WeChat.`,
    ),
  "E-NGUARD": (lang, { ask }) =>
    pick(
      lang,
      `要拒绝 ${ask} 请回 .d ${ask}；要新建会话请回 .new 加任务内容。`,
      `To reject ${ask}, reply .d ${ask}. To start a session, reply .new followed by the task.`,
    ),
  "E-ANSWER": (lang, { ask, count, example, problem }) => {
    const shape = pick(
      lang,
      `问题 ${ask} 有 ${count} 题，请按顺序回答，用分号隔开，如 .a ${ask} ${echo(example)}`,
      `Question ${ask} has ${count} part(s). Answer in order, separated by semicolons, for example .a ${ask} ${echo(example)}`,
    );
    if (!problem) return shape;
    const detail =
      problem.kind === "single"
        ? pick(
            lang,
            `第 ${problem.part} 题只能选 1 个。`,
            `Part ${problem.part} takes one option.`,
          )
        : pick(
            lang,
            `第 ${problem.part} 题没有选项 ${problem.option}。`,
            `Part ${problem.part} has no option ${problem.option}.`,
          );
    return lines(detail, shape);
  },
  "E-BUSY": (lang, { variant, title }) =>
    variant === "running"
      ? pick(
          lang,
          `「${displayTitle(title)}」正在运行，先 .x 停止。`,
          `"${displayTitle(title)}" is running. Stop it with .x first.`,
        )
      : pick(
          lang,
          `「${displayTitle(title)}」在电脑上也用过，请在 Pine 中删除。`,
          `"${displayTitle(title)}" has also been used on the computer. Delete it in Pine.`,
        ),
  "E-NOTOWN": (lang, { title }) =>
    pick(
      lang,
      `只能删除从微信发起的会话。「${displayTitle(title)}」请在 Pine 中删除。`,
      `Only sessions started from WeChat can be deleted here. Delete "${displayTitle(title)}" in Pine.`,
    ),
  "E-SIZE": (lang, data) =>
    data.variant === "text"
      ? pick(
          lang,
          "内容超过上限（100 000 字）。",
          "The text is over the limit (100,000 characters).",
        )
      : pick(
          lang,
          `${truncate(cleanInline(baseName(data.name)), 60)} 有 ${formatSize(data.sizeBytes)}，超过 100 MB 上限。`,
          `${truncate(cleanInline(baseName(data.name)), 60)} is ${formatSize(data.sizeBytes)}, over the 100 MB limit.`,
        ),
  "E-GONE": (lang, data) => {
    switch (data.variant) {
      case "item":
        return pick(
          lang,
          `这个${KIND_NOUNS[data.kind].zh}已不存在。`,
          `That ${KIND_NOUNS[data.kind].en} no longer exists.`,
        );
      case "file-changed":
        return pick(
          lang,
          "这个文件在展示之后发生了变化，已取消发送。",
          "The file changed after it was presented, so it was not sent.",
        );
      case "folders":
        return pick(
          lang,
          `项目 ${displayTitle(data.name)} 的文件夹当前不可用。`,
          `The folders of ${displayTitle(data.name)} are not available right now.`,
        );
    }
  },
  "E-OTHERWIN": (lang) =>
    pick(
      lang,
      "这个会话正在另一个 Pine 窗口中使用。",
      "This session is in use in another Pine window.",
    ),
  "E-PAUSED": (lang) =>
    pick(
      lang,
      "微信远程已暂停，请在电脑上恢复。",
      "WeChat remote is paused. Resume it on the computer.",
    ),
  "E-VOICE": (lang) =>
    pick(
      lang,
      "语音没有识别出文字，请打字。",
      "The voice message had no transcript. Please type.",
    ),
  "E-FAIL": (lang) =>
    pick(
      lang,
      "操作失败，没有执行。详情已记录在电脑上的 Pine 日志里。",
      "That failed and nothing was done. Details are in Pine's log on the computer.",
    ),
};

function whenAhead(atMs: number, nowMs: number, lang: L): string {
  const ahead = atMs - nowMs;
  if (ahead <= 60_000) return pick(lang, "马上", "soon");
  return pick(
    lang,
    `${formatDuration(ahead, lang)}后`,
    `in ${formatDuration(ahead, lang)}`,
  );
}

/** Every template id, in the order of commands spec section 10. */
export const REPLY_IDS = Object.keys(TEMPLATES) as ReplyId[];

/**
 * Renders one reply template. The result is plain text of at most REPLY_MAX
 * code points; agent-derived fields in `data` are cleaned and capped.
 */
export function render<K extends ReplyId>(
  id: K,
  lang: L,
  ...data: Args<K>
): string {
  const template = TEMPLATES[id] as Template<K>;
  return finish(template(lang, data[0] as ReplyData[K]));
}
