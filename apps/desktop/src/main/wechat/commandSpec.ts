// The dot-command table. Parser, `.help` and the view-only matrix
// are derived from it. Pure: no I/O.
import { COMMAND_NAMES, type CommandName, type CommandSpec } from "./types";

type Row = Omit<
  CommandSpec,
  | "positional"
  | "tail"
  | "glued"
  | "project"
  | "needsCurrent"
  | "viewOnlyOk"
  | "priority"
  | "aliases"
  | "zhAliases"
> &
  Partial<
    Pick<
      CommandSpec,
      | "positional"
      | "tail"
      | "glued"
      | "project"
      | "needsCurrent"
      | "viewOnlyOk"
      | "priority"
      | "aliases"
      | "zhAliases"
    >
  >;

function row(spec: Row): CommandSpec {
  return {
    aliases: [],
    zhAliases: [],
    positional: [],
    tail: false,
    glued: false,
    project: false,
    needsCurrent: false,
    viewOnlyOk: true,
    priority: false,
    ...spec,
  };
}

/**
 * `cls` is the class of the command's mutating form; a handler refines it per
 * form (`.model` without a parameter is a read, `.mode yolo` and `.auto N run`
 * are D with a confirmation). `stale` likewise: `.mode` tightening and
 * `.auto N off` are `guard`, which the inbound pipeline recognises before it
 * drops the other forms. `viewOnlyOk` is false only
 * for commands refused on a view-only session in every form; commands with a
 * read form (`.model`, `.effort`, `.mode`, `.queue`) keep it true and their
 * handler refuses the mutating form.
 */
export const COMMANDS: readonly CommandSpec[] = [
  row({
    name: "help",
    aliases: ["h"],
    zhAliases: ["帮助"],
    positional: ["topic"],
    glued: true,
    cls: "R",
    stale: "drop",
    params: "[command | 2]",
    summary: {
      zh: "常用命令；.h 2 看其余命令",
      en: "Common commands; .h 2 for the rest",
    },
    example: ".h new",
  }),
  row({
    name: "status",
    aliases: ["s", "st"],
    zhAliases: ["状态"],
    cls: "R",
    stale: "drop",
    params: "",
    summary: {
      zh: "当前会话和待处理事项",
      en: "Current session and open asks",
    },
    example: ".",
  }),
  row({
    name: "info",
    aliases: ["cfg", "about", "version"],
    zhAliases: ["设置", "关于"],
    cls: "R",
    stale: "drop",
    params: "",
    summary: {
      zh: "这台电脑和微信遥控的设置",
      en: "This computer and the WeChat remote settings",
    },
    example: ".info",
  }),
  row({
    name: "lang",
    zhAliases: ["语言"],
    positional: ["language"],
    cls: "M",
    stale: "drop",
    params: "zh | en | auto",
    summary: { zh: "回复语言", en: "Reply language" },
    example: ".lang en",
  }),
  row({
    name: "pause",
    zhAliases: ["暂停"],
    positional: ["all"],
    cls: "M-",
    stale: "run",
    priority: true,
    params: "[all]",
    summary: {
      zh: "暂停微信遥控；all 同时停止运行中的会话。只能在电脑上恢复",
      en: "Pause the WeChat remote; all also stops running sessions. Resume on the computer",
    },
    example: ".pause",
  }),
  row({
    name: "more",
    zhAliases: ["更多", "下一页"],
    cls: "R",
    stale: "drop",
    params: "",
    summary: { zh: "下一页（也可以发 .0）", en: "Next page (or send .0)" },
    example: ".0",
  }),
  row({
    name: "drop",
    aliases: ["clear"],
    zhAliases: ["丢弃"],
    cls: "M-",
    stale: "drop",
    params: "",
    summary: {
      zh: "丢弃还没发出的附件",
      en: "Discard attachments not sent yet",
    },
    example: ".drop",
  }),
  row({
    name: "new",
    aliases: ["n"],
    zhAliases: ["新", "新建"],
    tail: true,
    project: true,
    cls: "M",
    stale: "hold",
    params: "[@project] [text]",
    summary: {
      zh: "新建会话；不带文字则下一条消息开新会话",
      en: "Start a session; without text the next message starts one",
    },
    example: ".n 修一下登录页",
  }),
  row({
    name: "sessions",
    aliases: ["l", "ls"],
    zhAliases: ["会话", "列表"],
    project: true,
    cls: "R",
    stale: "drop",
    params: "[@project]",
    summary: { zh: "最近的会话", en: "Recent sessions" },
    example: ".l",
  }),
  row({
    name: "search",
    aliases: ["f", "find"],
    zhAliases: ["搜", "搜索"],
    tail: true,
    cls: "R+",
    stale: "drop",
    params: "words",
    summary: { zh: "搜索所有会话", en: "Search all sessions" },
    example: ".f 登录页",
  }),
  row({
    name: "use",
    aliases: ["u", "sw"],
    zhAliases: ["切换", "接管"],
    positional: ["ref"],
    tail: true,
    glued: true,
    cls: "M",
    stale: "drop",
    params: "[ref]",
    summary: {
      zh: "切换当前会话（.u 9 = 最新推送的会话）",
      en: "Switch the current session (.u 9 = latest push)",
    },
    example: ".u 2",
  }),
  row({
    name: "last",
    aliases: ["r", "result"],
    zhAliases: ["结果"],
    needsCurrent: true,
    cls: "R+",
    stale: "drop",
    params: "",
    summary: { zh: "最后一轮的回复", en: "Final reply of the last turn" },
    example: ".r",
  }),
  row({
    name: "history",
    aliases: ["hi", "hist"],
    zhAliases: ["历史"],
    positional: ["n"],
    needsCurrent: true,
    cls: "R+",
    stale: "drop",
    params: "[n]",
    summary: {
      zh: "最近几轮对话（默认 3，最多 10）",
      en: "Last turns (default 3, at most 10)",
    },
    example: ".hi 5",
  }),
  row({
    name: "stop",
    aliases: ["x"],
    zhAliases: ["停", "停止"],
    positional: ["all"],
    needsCurrent: true,
    priority: true,
    cls: "M-",
    stale: "guard",
    params: "[all]",
    summary: {
      zh: "停止当前运行；all 停止所有",
      en: "Stop the current run; all stops every run",
    },
    example: ".x",
  }),
  row({
    name: "queue",
    aliases: ["q"],
    zhAliases: ["排队", "稍后"],
    tail: true,
    needsCurrent: true,
    cls: "M",
    stale: "hold",
    params: "[text]",
    summary: {
      zh: "加入插话队列，智能体下一步读到；不带文字则列出队列",
      en: "Add to the steering queue, read at the agent's next step; without text list the queue",
    },
    example: ".q 顺便跑一下测试",
  }),
  row({
    name: "unqueue",
    aliases: ["qx", "recall"],
    zhAliases: ["撤回"],
    positional: ["n"],
    glued: true,
    needsCurrent: true,
    cls: "M-",
    stale: "guard",
    params: "[N]",
    summary: {
      zh: "撤回排队的消息（默认最新一条）",
      en: "Withdraw a queued message (default: the newest)",
    },
    example: ".qx 1",
  }),
  row({
    name: "rename",
    aliases: ["rn"],
    zhAliases: ["重命名", "改名"],
    tail: true,
    needsCurrent: true,
    viewOnlyOk: false,
    cls: "M",
    stale: "drop",
    params: "title",
    summary: { zh: "重命名当前会话", en: "Rename the current session" },
    example: ".rn 登录页修复",
  }),
  row({
    name: "delete",
    aliases: ["del"],
    zhAliases: ["删除"],
    positional: ["ref"],
    tail: true,
    viewOnlyOk: false,
    cls: "D",
    stale: "drop",
    params: "ref",
    summary: {
      zh: "删除从微信新建的会话（需确认）",
      en: "Delete a session started from WeChat (confirmed)",
    },
    example: ".del 2",
  }),
  row({
    name: "model",
    aliases: ["m", "models"],
    zhAliases: ["模型"],
    positional: ["ref"],
    tail: true,
    glued: true,
    cls: "M",
    stale: "drop",
    params: "[ref]",
    summary: {
      zh: "列出模型，或切换当前会话的模型",
      en: "List models, or switch the current session's model",
    },
    example: ".m 2",
  }),
  row({
    name: "effort",
    aliases: ["e"],
    zhAliases: ["推理", "思考"],
    positional: ["level"],
    glued: true,
    needsCurrent: true,
    cls: "M",
    stale: "drop",
    params: "[N | level]",
    summary: { zh: "推理强度", en: "Reasoning effort" },
    example: ".e high",
  }),
  row({
    name: "mode",
    aliases: ["mo"],
    zhAliases: ["模式"],
    positional: ["mode"],
    glued: true,
    needsCurrent: true,
    cls: "M",
    stale: "drop",
    params: "[N | mode]",
    summary: {
      zh: "审批模式（不超过电脑上设的上限）",
      en: "Approval mode (up to the limit set on the computer)",
    },
    example: ".mo 1",
  }),
  row({
    name: "usage",
    aliases: ["i", "ctx", "cost"],
    zhAliases: ["用量", "上下文"],
    needsCurrent: true,
    cls: "R",
    stale: "drop",
    params: "",
    summary: { zh: "上下文和费用", en: "Context and cost" },
    example: ".i",
  }),
  row({
    name: "compact",
    aliases: ["c"],
    zhAliases: ["压缩"],
    positional: ["ask"],
    glued: true,
    needsCurrent: true,
    viewOnlyOk: false,
    cls: "M",
    stale: "drop",
    params: "[ask]",
    summary: { zh: "压缩上下文", en: "Compact the context" },
    example: ".c",
  }),
  row({
    name: "todo",
    aliases: ["t", "todos"],
    zhAliases: ["待办"],
    needsCurrent: true,
    cls: "R+",
    stale: "drop",
    params: "",
    summary: { zh: "智能体的待办列表", en: "The agent's todo list" },
    example: ".t",
  }),
  row({
    name: "pending",
    aliases: ["w", "approvals"],
    zhAliases: ["待处理"],
    cls: "R+",
    stale: "drop",
    params: "",
    summary: {
      zh: "所有等你处理的审批和问题",
      en: "Every approval and question waiting for you",
    },
    example: ".w",
  }),
  row({
    name: "show",
    zhAliases: ["详情"],
    positional: ["ask"],
    glued: true,
    cls: "R+",
    stale: "drop",
    params: "ask",
    summary: {
      zh: "完整显示一张卡片（也可以发 .编号）",
      en: "Show a card in full (or send .number)",
    },
    example: ".show 12",
  }),
  row({
    name: "approve",
    aliases: ["y", "yes", "ok"],
    zhAliases: ["批准", "同意", "确认"],
    positional: ["ask"],
    glued: true,
    viewOnlyOk: false,
    cls: "M",
    stale: "drop",
    params: "[ask]",
    summary: { zh: "批准或确认", en: "Approve or confirm" },
    example: ".y 12",
  }),
  row({
    name: "reject",
    aliases: ["d", "no", "deny", "cancel"],
    zhAliases: ["拒绝", "取消"],
    tail: true,
    glued: true,
    priority: true,
    cls: "M-",
    stale: "guard",
    params: "[ask] [guidance]",
    summary: {
      zh: "拒绝或取消，可附上指导",
      en: "Reject or cancel, optionally with guidance",
    },
    example: ".d 12 别删 build",
  }),
  row({
    name: "guide",
    aliases: ["g"],
    zhAliases: ["指导", "建议"],
    tail: true,
    priority: true,
    cls: "M-",
    stale: "guard",
    params: "[ask] text",
    summary: {
      zh: "拒绝并告诉智能体怎么做",
      en: "Reject and tell the agent what to do instead",
    },
    example: ".g 12 先跑测试",
  }),
  row({
    name: "answer",
    aliases: ["a", "ans"],
    zhAliases: ["回答", "答"],
    tail: true,
    glued: true,
    viewOnlyOk: false,
    cls: "M",
    stale: "drop",
    params: "[ask] answers",
    summary: {
      zh: "回答问题卡片，多个问题用 ; 分隔",
      en: "Answer a question card; separate questions with ;",
    },
    example: ".a 13 2; 1,3",
  }),
  row({
    name: "files",
    aliases: ["o", "out"],
    zhAliases: ["文件", "产物"],
    positional: ["n"],
    glued: true,
    needsCurrent: true,
    cls: "R",
    stale: "drop",
    params: "[N]",
    summary: {
      zh: "智能体提交的产出文件",
      en: "Files the agent submitted as artifacts",
    },
    example: ".o",
  }),
  row({
    name: "file",
    aliases: ["send"],
    zhAliases: ["发送"],
    positional: ["n"],
    glued: true,
    needsCurrent: true,
    cls: "D",
    stale: "drop",
    params: "N",
    summary: { zh: "把一个文件发到微信", en: "Send one file to WeChat" },
    example: ".file 1",
  }),
  row({
    name: "tasks",
    aliases: ["b", "bg"],
    zhAliases: ["后台", "进程"],
    needsCurrent: true,
    cls: "R+",
    stale: "drop",
    params: "",
    summary: { zh: "后台进程", en: "Background processes" },
    example: ".b",
  }),
  row({
    name: "task",
    zhAliases: ["输出"],
    positional: ["n"],
    glued: true,
    needsCurrent: true,
    cls: "R+",
    stale: "drop",
    params: "N",
    summary: {
      zh: "一个后台进程的输出",
      en: "Output of one background process",
    },
    example: ".task 1",
  }),
  row({
    name: "kill",
    aliases: ["k", "bx"],
    zhAliases: ["结束"],
    positional: ["n"],
    glued: true,
    needsCurrent: true,
    priority: true,
    cls: "M-",
    stale: "guard",
    params: "N",
    summary: { zh: "结束一个后台进程", en: "Stop one background process" },
    example: ".k 1",
  }),
  row({
    name: "projects",
    aliases: ["p", "project", "proj"],
    zhAliases: ["项目"],
    positional: ["ref"],
    tail: true,
    glued: true,
    cls: "M",
    stale: "drop",
    params: "[ref]",
    summary: {
      zh: "列出项目，或选择新会话用的项目",
      en: "List projects, or pick the project for new sessions",
    },
    example: ".p 2",
  }),
  row({
    name: "autos",
    aliases: ["au"],
    zhAliases: ["自动化"],
    project: true,
    cls: "R",
    stale: "drop",
    params: "[@project]",
    summary: { zh: "自动化列表", en: "Automations" },
    example: ".au",
  }),
  row({
    name: "auto",
    positional: ["n", "action"],
    glued: true,
    cls: "M",
    stale: "drop",
    params: "N [on | off | run]",
    summary: {
      zh: "一个自动化的详情、开关或立即运行",
      en: "One automation: details, on, off or run now",
    },
    example: ".auto 2 off",
  }),
  row({
    name: "runs",
    aliases: ["ar"],
    zhAliases: ["运行记录"],
    positional: ["n"],
    glued: true,
    cls: "R+",
    stale: "drop",
    params: "[N]",
    summary: { zh: "自动化的运行记录", en: "Automation runs" },
    example: ".ar",
  }),
  row({
    name: "skills",
    aliases: ["sk"],
    zhAliases: ["技能"],
    cls: "R",
    stale: "drop",
    params: "",
    summary: { zh: "当前项目的技能", en: "Skills of the current project" },
    example: ".sk",
  }),
  row({
    name: "mcp",
    zhAliases: ["工具服务"],
    cls: "R",
    stale: "drop",
    params: "",
    summary: { zh: "MCP 服务器", en: "MCP servers" },
    example: ".mcp",
  }),
];

const BY_NAME = new Map<CommandName, CommandSpec>(
  COMMANDS.map((spec) => [spec.name, spec]),
);

const BY_TOKEN = new Map<string, CommandName>();
for (const spec of COMMANDS) {
  for (const token of [spec.name, ...spec.aliases, ...spec.zhAliases]) {
    BY_TOKEN.set(token, spec.name);
  }
}

/** Chinese aliases, longest first, for the prefix rule. */
const ZH_ALIASES = COMMANDS.flatMap((spec) =>
  spec.zhAliases.map((alias) => ({ name: spec.name, alias })),
).sort((a, b) => [...b.alias].length - [...a.alias].length);

export function specOf(name: CommandName): CommandSpec {
  const spec = BY_NAME.get(name);
  if (!spec) throw new Error(`Unknown command: ${name}`);
  return spec;
}

/** A normalised first token (no prefix, NFKC, lower case) → its command. */
export function lookupCommand(token: string): CommandName | undefined {
  return BY_TOKEN.get(token);
}

/** The longest Chinese alias that `token` starts with, when more characters follow it and `token` is not itself a name. */
export function zhAliasPrefix(
  token: string,
): { name: CommandName; alias: string; rest: string } | undefined {
  if (BY_TOKEN.has(token)) return undefined;
  for (const { name, alias } of ZH_ALIASES) {
    if (token.length > alias.length && token.startsWith(alias)) {
      return { name, alias, rest: token.slice(alias.length) };
    }
  }
  return undefined;
}

const CJK_START = /^[\u4e00-\u9fff]/u;

/**
 * Suggestion for `E-UNKNOWN`, without the leading dot. A CJK token gets the
 * longest Chinese alias it starts with. An ASCII token of at least four
 * characters gets the canonical name within an edit distance of
 * `min(2, max(1, floor(length / 3)))` (adjacent transpositions count once;
 * ties: the shorter name, then table order). Shorter tokens get nothing, so
 * `.net` is not read as `.new`.
 */
export function suggestCommand(token: string): string | undefined {
  if (token.length === 0) return undefined;
  if (CJK_START.test(token)) {
    for (const { alias } of ZH_ALIASES) {
      if (token.startsWith(alias)) return alias;
    }
    return undefined;
  }
  if (token.length < 4) return undefined;
  const limit = Math.min(2, Math.max(1, Math.floor(token.length / 3)));
  let best: { name: string; distance: number } | undefined;
  for (const name of COMMAND_NAMES) {
    const distance = editDistance(token, name);
    if (distance > limit) continue;
    if (
      !best ||
      distance < best.distance ||
      (distance === best.distance && name.length < best.name.length)
    ) {
      best = { name, distance };
    }
  }
  return best?.name;
}

/** Optimal string alignment distance (Levenshtein plus adjacent transpositions). */
function editDistance(a: string, b: string): number {
  const cols = b.length + 1;
  const d = new Array<number>((a.length + 1) * cols).fill(0);
  const at = (i: number, j: number): number => d[i * cols + j] ?? 0;
  for (let i = 0; i <= a.length; i += 1) d[i * cols] = i;
  for (let j = 0; j <= b.length; j += 1) d[j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(
        at(i - 1, j) + 1,
        at(i, j - 1) + 1,
        at(i - 1, j - 1) + cost,
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        value = Math.min(value, at(i - 2, j - 2) + 1);
      }
      d[i * cols + j] = value;
    }
  }
  return at(a.length, b.length);
}
