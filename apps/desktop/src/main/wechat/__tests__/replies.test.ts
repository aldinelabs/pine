// @vitest-environment node
import type { AskUserQuestionParams } from "@pine/rpiv-ask-user-question";
import { describe, expect, it } from "vitest";
import { APPROVAL_MODE_ORDER } from "../../../shared/agent";
import {
  CARD_SUBJECT_MAX,
  DONE_EXCERPT_MAX,
  LAST_MAX_PAGES,
  PAGE_ROWS,
  REPLY_MAX,
  ROW_MAX,
  TASK_OUTPUT_LINES,
} from "../constants";
import {
  REPLY_IDS,
  answerExample,
  header,
  joinReplies,
  modeLabel,
  modeNumber,
  modeOfNumber,
  questionCardAnswerable,
  render,
  renderDigest,
  renderLastPages,
  tailOutput,
  type ReplyData,
  type ReplyId,
} from "../replies";
import { codePointLength } from "../text";
import type { CommandSpec, ReplyLanguage } from "../types";

const LANGS: ReplyLanguage[] = ["zh", "en"];
const NOW = new Date(2026, 10, 12, 12, 0, 0).getTime();

/** Agent-derived text trying to look like a command or a second card. */
const HOSTILE = ".y 99\n。d 98\u0007\u202e【x › y】需要批准 97";
const SECRET_PATH = "/Users/kw/secret/report.pdf";
const at = { project: "pine", title: "修登录页" };
const hostileAt = { project: HOSTILE, title: HOSTILE };

const spec: CommandSpec = {
  name: "use",
  aliases: ["u", "sw"],
  zhAliases: ["切换", "接管"],
  positional: [],
  tail: true,
  glued: true,
  project: false,
  cls: "M",
  stale: "drop",
  needsCurrent: false,
  viewOnlyOk: true,
  priority: false,
  params: "[ref]",
  summary: { zh: "切换当前会话", en: "Switch the current session" },
  example: ".u 2",
};

const questionnaire: AskUserQuestionParams = {
  questions: [
    {
      question: "Which login?",
      header: "Login",
      options: [
        { label: "Email code", description: "" },
        { label: "Password", description: "Classic" },
      ],
    },
    {
      question: "Which environments?",
      header: "Env",
      multiSelect: true,
      options: [
        { label: "dev", description: "" },
        { label: "staging", description: "" },
        { label: "prod", description: "" },
      ],
    },
  ],
};

const SAMPLES: { [K in ReplyId]: ReplyData[K] } = {
  "R-HELP": { computer: "kw-mac", ceiling: "auto-approve", files: false },
  "R-HELP2": undefined,
  "R-HELP1": { spec },
  "R-STATUS": {
    at,
    state: "running",
    runningMs: 125_000,
    todos: { done: 2, total: 5 },
    contextPercent: 41.6,
    costUsd: 0.234,
    asks: [{ number: 12, kind: "approval", tool: "bash" }],
    others: [{ n: 1, state: "waiting", title: HOSTILE, project: "site" }],
  },
  "R-STATUS0": { project: "pine", mode: "auto-approve" },
  "R-INFO": {
    computer: "kw-mac",
    version: "1.4.2",
    ceiling: "autonomous",
    defaultMode: "auto-approve",
    highRisk: false,
    files: true,
    language: "auto",
    boundAt: NOW,
  },
  "R-LANG": { language: "zh" },
  "R-PAUSE": { running: 2 },
  "R-PAUSEALL": { stopped: 3 },
  "R-NOMORE": undefined,
  "R-PAGE": { index: 1, count: 3, truncated: false },
  "R-DROP": { count: 2 },
  "R-ATTACH": { name: SECRET_PATH, sizeBytes: 2048 },
  "R-NEW": {
    project: "pine",
    text: "跑一遍测试".repeat(20),
    mode: "auto-approve",
    model: "claude",
  },
  "R-NEWARMED": { project: "pine" },
  "R-STEER": { at },
  "R-ROUTE": { at },
  "R-WELCOME": { computer: "kw-mac", ceiling: "auto-approve", files: true },
  "R-SESSIONS": {
    now: NOW,
    rows: [
      {
        n: 1,
        title: HOSTILE,
        project: "pine",
        atMs: NOW - 60 * 60_000,
        marks: ["running", "wechat"],
      },
    ],
  },
  "R-SEARCH": {
    query: "登录",
    rows: [
      {
        n: 1,
        title: "修登录页",
        project: "pine",
        snippet: "改\u0001登录\u0002页",
      },
    ],
  },
  "R-MATCHES": { query: "登", rows: [{ n: 1, label: HOSTILE }] },
  "R-USE": {
    title: "修登录页",
    project: "pine",
    state: "idle",
    mode: "auto-approve",
    count: 42,
  },
  "R-USEVIEW": {
    title: "修登录页",
    project: "pine",
    state: "idle",
    reason: "ceiling",
    mode: "YOLO",
    ceiling: "auto-approve",
  },
  "R-LAST": { at, text: HOSTILE },
  "R-NOREPLY": undefined,
  "R-HISTORY": {
    entries: [
      { role: "user", text: "hi" },
      { role: "assistant", text: HOSTILE },
    ],
  },
  "R-STOP": { title: "修登录页", backgroundTasks: 1 },
  "R-STOPNONE": undefined,
  "R-STOPALL": { count: 2 },
  "R-QUEUED": undefined,
  "R-QUEUEWAIT": {
    at: { project: "p", title: "修登录页" },
    asks: [{ number: 12, variant: "approval" }],
  },
  "R-QUEUE": { rows: [{ n: 1, text: HOSTILE }] },
  "R-UNQUEUE": { text: "later" },
  "R-RENAME": { title: "新标题" },
  "R-DELETE-ASK": { title: "旧的调研", project: "pine", count: 42, ask: 14 },
  "R-DELETED": { title: "旧的调研" },
  "R-MODELS": {
    rows: [{ n: 1, model: "claude-x", provider: "Anthropic", current: true }],
  },
  "R-MODEL": { at, model: "claude-x", effort: "high" },
  "R-EFFORTS": {
    rows: [
      { n: 1, level: "low", current: false },
      { n: 2, level: "high", current: true },
    ],
  },
  "R-EFFORT": { level: "medium" },
  "R-MODES": { current: "auto-approve", ceiling: "autonomous" },
  "R-MODE": { at, mode: "autonomous", ceiling: "autonomous" },
  "R-MODE-REVIEW": { at, mode: "let-me-review", ceiling: "autonomous" },
  "R-YOLO-ASK": { title: "修登录页", ask: 15 },
  "R-USAGE": {
    at,
    model: "claude-x",
    effort: "high",
    mode: "auto-approve",
    ceiling: "autonomous",
    contextTokens: 41_200,
    contextWindow: 200_000,
    cacheHitPercent: 87,
    costUsd: 1.5,
    count: 12,
  },
  "R-USAGE-NONE": undefined,
  "R-COMPACTING": undefined,
  "R-COMPACTED": { at },
  "R-COMPACT-IDLE": undefined,
  "R-TODO": {
    at,
    items: [
      { status: "completed", subject: "a" },
      { status: "in_progress", subject: HOSTILE },
      { status: "pending", subject: "c" },
    ],
  },
  "R-PENDING": {
    asks: [
      { number: 12, kind: "approval", tool: "bash", title: "修登录页" },
      { number: 13, kind: "question", title: "修登录页" },
    ],
    automationApprovals: 1,
  },
  "R-APPROVED": { ask: 12, subject: "rm -rf build/" },
  "R-REJECTED": { ask: 12 },
  "R-GUIDED": { ask: 12 },
  "R-ANSWERED": { ask: 13, summary: "Password; dev, prod" },
  "R-CANCELLED": { ask: 13 },
  "R-FILES": {
    at,
    canSend: false,
    rows: [{ n: 1, path: SECRET_PATH, sizeBytes: 4096 }],
  },
  "R-SENDING": { name: SECRET_PATH, sizeBytes: 4096 },
  "R-TASKS": {
    rows: [
      {
        n: 1,
        title: "dev server",
        running: true,
        runningMs: 90_000,
        command: "bun run dev --port 5173",
      },
      { n: 2, title: "build", running: false, exitCode: 1, command: "make" },
    ],
  },
  "R-TASK": { title: "dev server", output: `ready\n${HOSTILE}` },
  "R-KILLED": { title: "dev server" },
  "R-PROJECTS": {
    rows: [
      { n: 1, name: "pine", current: true },
      { n: 2, name: "", current: false, temporary: true },
    ],
  },
  "R-PROJECT": {
    name: "pine",
    folders: [
      { path: "/Users/kw/code/pine", access: "read-write" },
      { path: "/Users/kw/docs", access: "read-only" },
    ],
    count: 12,
  },
  "R-AUTOS": {
    now: NOW,
    rows: [
      {
        n: 1,
        name: "nightly",
        project: "pine",
        state: "on",
        nextAtMs: NOW + 3 * 3_600_000,
        lastResult: "ok",
      },
    ],
  },
  "R-AUTO": {
    name: "nightly",
    project: "pine",
    enabled: true,
    triggers: "every day 02:00",
    reads: "project",
    writes: "none",
    hosts: "github.com",
  },
  "R-AUTO-OFF": { name: "nightly" },
  "R-AUTO-ON": { name: "nightly" },
  "R-AUTO-ALREADY": { name: "nightly" },
  "R-AUTO-ON-PENDING": { name: "nightly" },
  "R-AUTO-RUN-ASK": { name: "nightly", ask: 16 },
  "R-AUTO-RUN": { name: "nightly" },
  "R-RUNS": {
    now: NOW,
    rows: [
      {
        n: 1,
        name: "nightly",
        result: "ok",
        atMs: NOW - 3_600_000,
        unread: true,
      },
    ],
  },
  "R-RUN": {
    name: "nightly",
    atMs: NOW - 3_600_000,
    now: NOW,
    result: "ok",
    summary: `**All good.**\n\n${HOSTILE}`,
  },
  "R-SKILLS": {
    rows: [
      {
        n: 1,
        name: "review",
        scope: "global",
        enabled: true,
        description: "Reviews code",
      },
    ],
  },
  "R-MCP": {
    rows: [
      { name: "github", scope: "project", status: "connected", tools: 12 },
    ],
  },
  "T-APPROVAL": {
    at,
    ask: 12,
    tool: "bash",
    trigger: "sandbox-denied",
    subject: "rm -rf build/ && make",
    description: "Clean build",
    external: true,
  },
  "T-CUT": { ask: 12 },
  "T-APPROVAL-LOCAL": {
    at,
    ask: 12,
    tool: "bash",
    trigger: "privileged-execution",
    subject: "sudo ls",
    external: false,
    reason: "high-risk",
  },
  "T-SHOW": {
    at,
    ask: 12,
    tool: "bash",
    trigger: "pre-execution",
    subject: "x".repeat(800),
    evidence: "stderr: denied",
    external: false,
    local: false,
  },
  "T-LONGCTX": { at, ask: 17 },
  "T-EXTERNAL": undefined,
  "T-TRIGGER": { trigger: "authorize-denied" },
  "T-MORECARDS": { count: 2 },
  "T-QCARD": { at, ask: 13, questionnaire },
  "T-QCARD-LOCAL": { at, ask: 13, questionnaire },
  "T-DONE": {
    at,
    durationMs: 200_000,
    costUsd: 0.12,
    text: "Done **it**",
    files: 2,
    current: false,
  },
  "T-FAILED": { at, error: "boom\nstack" },
  "T-PROGRESS": { at, todos: { done: 1, total: 3 } },
  "T-AUTORUN": { name: "nightly", result: "ok" },
  "T-AUTO-ON": { name: "nightly", result: "approved" },
  "T-PAIR": { code: "123456" },
  "T-INTERRUPTED": { items: [".new run tests", HOSTILE] },
  "T-OVERFLOW": { items: [".new run tests", HOSTILE] },
  "T-BUDGET": undefined,
  "T-DIGEST": {
    items: [
      { kind: "done", title: "修登录页" },
      { kind: "ask", number: 12 },
    ],
  },
  "T-STALE": {
    held: [".new @pine 跑一遍测试", "把结果发我"],
    notRun: [".y 12"],
    oldestAgeMs: 3 * 3_600_000,
    ask: 15,
  },
  "E-UNKNOWN": { token: "stpo", suggestion: "stop" },
  "E-ARGS": { spec },
  "E-REF": { n: 3, list: ".l" },
  "E-NOMATCH": { query: "xyz", kind: "session" },
  "E-NOSESSION": undefined,
  "E-VIEW": { title: "修登录页", mode: "YOLO", ceiling: "auto-approve" },
  "E-VIEWRUN": { title: "nightly run" },
  "E-CEIL": { ceiling: "auto-approve" },
  "E-LOCAL": { ask: 12 },
  "E-SWITCH": undefined,
  "E-CODE": { ask: 44 },
  "E-DONE": { ask: 12 },
  "E-WHICH": {
    asks: [
      { number: 12, kind: "approval", tool: "bash", title: "a" },
      { number: 13, kind: "question", title: "b" },
    ],
  },
  "E-AMBIG": { n: 2, ask: 13, list: ".u" },
  "E-SHOWFIRST": { ask: 12 },
  "E-TEXT": undefined,
  "E-QUOTE": undefined,
  "E-AUTOOFF": { name: "nightly" },
  "E-NGUARD": { ask: 12 },
  "E-ANSWER": { ask: 13, count: 2, example: "1; 1,2" },
  "E-BUSY": { variant: "running", title: "修登录页" },
  "E-NOTOWN": { title: "修登录页" },
  "E-SIZE": {
    variant: "file",
    name: SECRET_PATH,
    sizeBytes: 200 * 1024 * 1024,
  },
  "E-GONE": { variant: "item", kind: "file" },
  "E-OTHERWIN": undefined,
  "E-PAUSED": undefined,
  "E-VOICE": undefined,
  "E-FAIL": undefined,
};

function renderSample(id: ReplyId, lang: ReplyLanguage): string {
  const call = render as (
    id: ReplyId,
    lang: ReplyLanguage,
    data?: unknown,
  ) => string;
  return call(id, lang, SAMPLES[id]);
}

/** A line that WeChat would read as one of the hostile commands. */
const COMMAND_LINE = /^[.。．｡][yd] 9[789]/m;

/** Titles that would be Markdown if they were not escaped. */
const markdownAt = { project: "a*b_c", title: "[x](y) <b>`t`</b>" };
const ESCAPED_MARKDOWN_HEADER = "**a\\*b\\_c › \\[x\\](y) \\<b>\\`t\\`\\</b>**";

/** Each sample, and each sample about a session with Markdown-like titles. */
function variants(id: ReplyId): unknown[] {
  const sample = SAMPLES[id] as unknown;
  if (sample && typeof sample === "object" && "at" in sample)
    return [sample, { ...sample, at: markdownAt }];
  return [sample];
}

/** The lines outside fenced code blocks; fails on an unclosed fence. */
function proseLines(text: string): string[] {
  const out: string[] = [];
  let open: string | undefined;
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (open) {
      const character = open[0] ?? "`";
      if (
        trimmed.length >= open.length &&
        [...trimmed].every((point) => point === character)
      )
        open = undefined;
      continue;
    }
    const fence = /^(`{3,}|~{3,})/.exec(trimmed);
    if (fence) {
      open = fence[1];
      continue;
    }
    out.push(line);
  }
  expect(open, `unclosed fence in ${JSON.stringify(text)}`).toBeUndefined();
  return out;
}

/** Every `**` opens next to a line start or a space and closes before a space or the line end. */
function boldIsFlanked(line: string): boolean {
  const plain = line.replace(/\\./g, "  ").replace(/`[^`]*`/g, "``");
  const positions = [...plain.matchAll(/\*\*/g)].map((match) => match.index);
  if (positions.length % 2 !== 0) return false;
  return positions.every((index, n) =>
    n % 2 === 0
      ? index === 0 || plain[index - 1] === " "
      : index + 2 === plain.length || plain[index + 2] === " ",
  );
}

/** Cells of a table line, split at unescaped pipes as GFM does. */
function cellCount(line: string): number {
  return line.replace(/\\./g, "  ").split("|").length - 2;
}

/**
 * Every table is a block of its own (blank line or edge on both sides), has a
 * `|---|` delimiter row, at most three columns, and the same number of cells
 * on every row, so no title can add or split a column.
 */
function expectTables(prose: readonly string[]): void {
  prose.forEach((line, index) => {
    if (!line.startsWith("|")) return;
    const previous = prose[index - 1];
    const next = prose[index + 1];
    expect(
      previous === undefined || previous === "" || previous.startsWith("|"),
      line,
    ).toBe(true);
    expect(
      next === undefined || next === "" || next.startsWith("|"),
      line,
    ).toBe(true);
    expect(line.endsWith(" |") || /^\|(?:---\|)+$/.test(line), line).toBe(true);
    if (previous === undefined || previous === "") {
      const columns = cellCount(line);
      expect(columns).toBeGreaterThanOrEqual(1);
      expect(columns).toBeLessThanOrEqual(3);
      expect(next).toBe(`|${Array(columns).fill("---").join("|")}|`);
      for (let row = index + 2; prose[row]?.startsWith("|"); row += 1)
        expect(cellCount(prose[row] ?? ""), prose[row]).toBe(columns);
    }
  });
}

function render1(id: ReplyId, lang: ReplyLanguage, data: unknown): string {
  const call = render as (
    id: ReplyId,
    lang: ReplyLanguage,
    data?: unknown,
  ) => string;
  return call(id, lang, data);
}

describe("render", () => {
  it("covers every template id of commands spec section 10", () => {
    expect(new Set(REPLY_IDS)).toEqual(new Set(Object.keys(SAMPLES)));
    expect(REPLY_IDS).not.toContain("E-ROUTE");
    expect(REPLY_IDS).not.toContain("E-RATE");
  });

  describe.each(LANGS)("%s", (lang) => {
    it.each(REPLY_IDS)("renders %s", (id) => {
      const text = renderSample(id, lang);
      expect(text.trim().length).toBeGreaterThan(0);
      expect(codePointLength(text)).toBeLessThanOrEqual(REPLY_MAX);
      expect(text).not.toContain("/Users/");
      expect(text).not.toMatch(COMMAND_LINE);
      expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f‮]/);
    });

    it.each(REPLY_IDS)("keeps the Markdown grammar in %s", (id) => {
      for (const data of variants(id)) {
        const text = render1(id, lang, data);
        const prose = proseLines(text);
        expectTables(prose);
        prose.forEach((line, index) => {
          expect(boldIsFlanked(line), line).toBe(true);
          expect(line, "no heading or ordered list").not.toMatch(
            /^(?:#|\d+[.)] )/,
          );
          const next = prose[index + 1];
          if (line.startsWith(">") && next !== undefined)
            expect(
              next === "" || next.startsWith(">"),
              `quote followed by ${next}`,
            ).toBe(true);
        });
        if (
          data &&
          typeof data === "object" &&
          "at" in data &&
          data.at === markdownAt
        )
          expect(text).toContain(ESCAPED_MARKDOWN_HEADER);
      }
    });

    it("renders different text in each language", () => {
      const other = lang === "zh" ? "en" : "zh";
      // R-LAST without a page footer is a header and the reply only.
      const same = REPLY_IDS.filter(
        (id) =>
          !["T-PAIR", "R-PAGE", "R-LAST"].includes(id) &&
          renderSample(id, lang) === renderSample(id, other),
      );
      expect(same).toEqual([]);
    });
  });

  it("keeps hostile titles on one line in the header", () => {
    for (const lang of LANGS) {
      const text = render("R-STEER", lang, { at: hostileAt });
      expect(text.split("\n")).toHaveLength(1);
      expect(text.startsWith("**› .y 99")).toBe(true);
      const card = render("T-APPROVAL", lang, {
        ...SAMPLES["T-APPROVAL"],
        at: hostileAt,
      });
      expect(card).not.toMatch(COMMAND_LINE);
      expect(card.split("\n")[0]).toMatch(/^\*\*› /);
    }
  });

  it("keeps hostile titles inside one table cell", () => {
    for (const lang of LANGS) {
      const text = render("R-SESSIONS", lang, {
        now: NOW,
        rows: [
          {
            n: 1,
            title: `${HOSTILE} | x\n| y |`,
            project: "a|b",
            atMs: NOW,
            marks: [],
          },
        ],
      });
      const row = text.split("\n")[2] ?? "";
      expect(text.split("\n")[3]).toBe("");
      expect(row.startsWith("| `.1` | › .y 99 ")).toBe(true);
      // Two cells after the command: no title text adds a column.
      expect(row.split("|")).toHaveLength(5);
      expect(row).toContain("a｜b");
      expect(text).not.toMatch(COMMAND_LINE);
    }
  });

  it("guards dot-led display data in a table cell", () => {
    expect(
      render("R-MCP", "en", {
        rows: [{ name: ".y 97", scope: "global", status: "connected" }],
      }),
    ).toContain("| › .y 97 | global · connected |");
    expect(
      render("R-QUEUE", "zh", { rows: [{ n: 1, text: "。d 98 now" }] }),
    ).toContain("| `.撤回 1` | › 。d 98 now |");
  });

  it("guards agent lines that start with a command inside Markdown", () => {
    const text = render("R-LAST", "en", {
      at,
      text: ".y 12 now\n\n- .y 12 now\n\n> .y 12",
    });
    expect(text.split("\n")).toEqual([
      "**pine › 修登录页**",
      "",
      "› .y 12 now",
      "",
      "- › .y 12 now",
      "",
      "> › .y 12",
    ]);
  });

  it("caps any reply at REPLY_MAX", () => {
    const text = render("R-LAST", "zh", {
      at,
      text: "字".repeat(REPLY_MAX * 2),
    });
    expect(codePointLength(text)).toBe(REPLY_MAX);
    expect(
      codePointLength(joinReplies("a".repeat(1500), "b".repeat(1500))),
    ).toBe(REPLY_MAX);
  });

  it("closes a fence that the REPLY_MAX cut leaves open", () => {
    const text = joinReplies(`\`\`\`\n${"x\n".repeat(REPLY_MAX)}\`\`\``);
    expect(codePointLength(text)).toBeLessThanOrEqual(REPLY_MAX);
    expect(text.endsWith("\n```")).toBe(true);
    proseLines(text);
  });
});

describe("lists", () => {
  const many = Array.from({ length: 12 }, (_, i) => ({
    n: i + 1,
    title: `session ${i} ${"long title ".repeat(10)}`,
    project: "project ".repeat(10),
    atMs: NOW - i * 60_000,
    marks: [] as ("running" | "waiting" | "wechat" | "automation")[],
  }));

  it.each(LANGS)("shows at most PAGE_ROWS rows of ROW_MAX (%s)", (lang) => {
    const text = render("R-SESSIONS", lang, { now: NOW, rows: many });
    const lines = text.split("\n");
    expect(lines).toHaveLength(PAGE_ROWS + 4);
    for (const line of lines.slice(2, PAGE_ROWS + 2)) {
      const cells = /^\| `\.\d+` \| (.*) \| (.*) \|$/.exec(line);
      expect(cells, line).not.toBeNull();
      for (const cell of cells?.slice(1) ?? [])
        expect(codePointLength(cell)).toBeLessThanOrEqual(ROW_MAX);
    }
    expect(lines.at(-2)).toBe("");
    expect(lines.at(-1)).toMatch(/^> .*`\.0`/);
  });

  it("shows only base names of files and folders", () => {
    for (const lang of LANGS) {
      expect(renderSample("R-FILES", lang)).toContain("report.pdf");
      const project = renderSample("R-PROJECT", lang);
      expect(project).toContain("pine");
      expect(project).toContain("docs");
      expect(project).not.toContain("/");
    }
  });

  it("renders empty lists", () => {
    expect(render("R-QUEUE", "zh", { rows: [] })).toBe("没有排队的消息。");
    expect(render("R-TASKS", "en", { rows: [] })).toBe(
      "No background processes.",
    );
    expect(render("R-FILES", "en", { at, canSend: true, rows: [] })).toBe(
      "This session has no artifacts yet.",
    );
    expect(
      render("R-PENDING", "en", { asks: [], automationApprovals: 0 }),
    ).toBe("Nothing is waiting.");
  });

  it("names the temporary workspace and marks the current project", () => {
    expect(renderSample("R-PROJECTS", "zh")).toContain("| `.2` | 无项目 |");
    expect(renderSample("R-PROJECTS", "en")).toContain("| `.2` | No Project |");
    expect(renderSample("R-PROJECTS", "en")).toContain(
      "| `.1` | pine · current |",
    );
  });

  it("strips search markers", () => {
    expect(renderSample("R-SEARCH", "zh")).toContain("…改登录页…");
  });

  it("escapes file names", () => {
    const text = render("R-FILES", "en", {
      at,
      canSend: true,
      rows: [{ n: 1, path: "/tmp/my_file_v2.md" }],
    });
    expect(text).toContain("| `.1` | my\\_file\\_v2.md |");
  });

  it("shows at most 15 todos", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      status: "pending" as const,
      subject: `todo ${i}`,
    }));
    const text = render("R-TODO", "en", { at, items });
    const lines = text.split("\n");
    expect(lines.filter((line) => line.startsWith("- ○ "))).toHaveLength(15);
    expect(lines.at(-1)).toBe("…5 more");
  });

  it("keeps the newest history entries that fit", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 ? ("assistant" as const) : ("user" as const),
      text: `${i} ${"word ".repeat(100)}`,
    }));
    const text = render("R-HISTORY", "en", { entries });
    expect(codePointLength(text)).toBeLessThanOrEqual(REPLY_MAX);
    expect(text).toContain("- **Pine:** 19 ");
    expect(text).not.toContain("**You:** 0 ");
    expect(text.split("\n").at(-1)).toBe("> `.r` for the full last reply");
    for (const line of text.split("\n"))
      expect(codePointLength(line)).toBeLessThanOrEqual(320);
  });
});

describe("pages", () => {
  it("sends short text as one page without a footer, Markdown kept", () => {
    const pages = renderLastPages("en", at, "Short **reply**.");
    expect(pages).toEqual(["**pine › 修登录页**\n\nShort **reply**."]);
  });

  it("answers an empty reply with R-NOREPLY", () => {
    expect(renderLastPages("zh", at, "  ")).toEqual(["这个会话还没有回复。"]);
  });

  it("paginates with footers and stops after LAST_MAX_PAGES", () => {
    const paragraph = "word ".repeat(80).trim();
    const markdown = Array.from({ length: 60 }, () => paragraph).join("\n\n");
    for (const lang of LANGS) {
      const pages = renderLastPages(lang, at, markdown);
      expect(pages).toHaveLength(LAST_MAX_PAGES);
      for (const page of pages) {
        expect(codePointLength(page)).toBeLessThanOrEqual(REPLY_MAX);
        expect(page.split("\n")[0]).toBe(header(lang, at.project, at.title));
      }
      expect(pages[0]).toContain(
        lang === "zh"
          ? `> （1/${LAST_MAX_PAGES}，回 \`.0\` 看下一段）`
          : `> (1/${LAST_MAX_PAGES}, reply \`.0\``,
      );
      expect(pages.at(-1)).toContain(
        lang === "zh"
          ? "> （完整内容请在 Pine 中查看）"
          : "> (Open Pine for the full text)",
      );
    }
  });

  it("ends a complete multi-page text without the open-Pine line", () => {
    const markdown = Array.from({ length: 6 }, () => "word ".repeat(80)).join(
      "\n\n",
    );
    const pages = renderLastPages("en", at, markdown);
    expect(pages.length).toBeGreaterThan(1);
    expect(pages.length).toBeLessThan(LAST_MAX_PAGES);
    expect(pages.at(-1)).not.toContain("Open Pine");
    expect(pages.at(-1)).not.toContain("reply `.0`");
  });

  it("closes and reopens a long fenced block on every page", () => {
    const code = Array.from({ length: 250 }, (_, i) => `echo ${i}`).join("\n");
    const pages = renderLastPages(
      "en",
      at,
      `Run **this**:\n\n\`\`\`sh\n${code}\n\`\`\``,
    );
    expect(pages.length).toBeGreaterThan(1);
    expect(pages[0]).toContain("Run **this**:");
    for (const [index, page] of pages.entries()) {
      expect(codePointLength(page)).toBeLessThanOrEqual(REPLY_MAX);
      proseLines(page);
      if (index > 0) expect(page.split("\n")[2]).toBe("```sh");
    }
  });

  it("never starts a page line with a command", () => {
    const markdown = Array.from({ length: 400 }, (_, i) => `.y 97 ${i}`).join(
      "\n",
    );
    const pages = renderLastPages("en", at, markdown);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page).not.toMatch(COMMAND_LINE);
      expect(codePointLength(page)).toBeLessThanOrEqual(REPLY_MAX);
    }
  });

  it("keeps the tail of process output", () => {
    const output = Array.from({ length: 100 }, (_, i) => `line ${i}`).join(
      "\n",
    );
    const tail = tailOutput(output);
    expect(tail.split("\n")).toHaveLength(TASK_OUTPUT_LINES);
    expect(tail.endsWith("line 99")).toBe(true);
    expect(codePointLength(tailOutput("x".repeat(5000)))).toBe(1500);
  });

  it("renders the page footer as a quote", () => {
    expect(
      render("R-PAGE", "zh", { index: 1, count: 3, truncated: false }),
    ).toBe("> （1/3，回 `.0` 看下一段）");
    expect(
      render("R-PAGE", "en", { index: 1, count: 3, truncated: false }),
    ).toBe("> (1/3, reply `.0` for the next part)");
    expect(
      render("R-PAGE", "en", { index: 3, count: 3, truncated: true }),
    ).toBe("> (Open Pine for the full text)");
  });
});

describe("cards", () => {
  it("lays out an approval card", () => {
    expect(renderSample("T-APPROVAL", "zh")).toBe(
      [
        "**pine › 修登录页** · 需要批准 12",
        "`bash` · 沙箱拒绝",
        "",
        "```",
        "rm -rf build/ && make",
        "```",
        "",
        "Clean build",
        "",
        "> 该会话此前读取过外部内容，请核对后再批准。",
        "> `.y 12` 批准 · `.d 12` 拒绝 · `.d 12 你的建议`",
      ].join("\n"),
    );
    expect(renderSample("T-APPROVAL", "en")).toBe(
      [
        "**pine › 修登录页** · Approval needed 12",
        "`bash` · sandbox denied",
        "",
        "```",
        "rm -rf build/ && make",
        "```",
        "",
        "Clean build",
        "",
        "> This session has read external content. Check before approving.",
        "> `.y 12` approve · `.d 12` reject · `.d 12 your note`",
      ].join("\n"),
    );
  });

  it("puts backticks in a subject inside a longer fence", () => {
    const text = render("T-APPROVAL", "en", {
      ...SAMPLES["T-APPROVAL"],
      subject: "echo ```x``` `y`",
    });
    expect(text).toContain("````\necho ```x``` `y`\n````");
  });

  it("cuts a long subject and asks for .show first", () => {
    for (const lang of LANGS) {
      const text = render("T-APPROVAL", lang, {
        ...SAMPLES["T-APPROVAL"],
        subject: "a".repeat(CARD_SUBJECT_MAX + 50),
      });
      expect(text).toContain(`> ${render("T-CUT", lang, { ask: 12 })}`);
      expect(text).toContain(`${"a".repeat(CARD_SUBJECT_MAX - 1)}…`);
      expect(text).not.toContain("a".repeat(CARD_SUBJECT_MAX));
    }
    expect(
      render("T-APPROVAL", "zh", { ...SAMPLES["T-APPROVAL"], cut: true }),
    ).toBe(
      [
        "**pine › 修登录页** · 需要批准 12",
        "`bash` · 沙箱拒绝",
        "",
        "```",
        "rm -rf build/ && make",
        "```",
        "",
        "Clean build",
        "",
        "> （内容已截断。先回 `.12` 看全文，再批准。）",
        "> 该会话此前读取过外部内容，请核对后再批准。",
        "> `.y 12` 批准 · `.d 12` 拒绝 · `.d 12 你的建议`",
      ].join("\n"),
    );
    expect(
      render("T-APPROVAL", "en", { ...SAMPLES["T-APPROVAL"], cut: true }),
    ).toContain(
      "> (Cut short. Reply `.12` to read all of it before approving.)",
    );
  });

  it("renders a card without a subject", () => {
    const data = {
      at,
      ask: 12,
      tool: "ui_project_create",
      trigger: "pre-execution" as const,
      external: false,
    };
    expect(render("T-APPROVAL", "en", data).split("\n")).toEqual([
      "**pine › 修登录页** · Approval needed 12",
      "`ui_project_create` · before running",
      "",
      "> `.y 12` approve · `.d 12` reject · `.d 12 your note`",
    ]);
    expect(render("T-APPROVAL", "zh", data).split("\n")).toEqual([
      "**pine › 修登录页** · 需要批准 12",
      "`ui_project_create` · 执行前确认",
      "",
      "> `.y 12` 批准 · `.d 12` 拒绝 · `.d 12 你的建议`",
    ]);
  });

  it("gives each display-only reason its own line", () => {
    const base = SAMPLES["T-APPROVAL-LOCAL"];
    const highRisk = render("T-APPROVAL-LOCAL", "en", base);
    expect(highRisk).toContain("Approve on the computer 12");
    expect(highRisk).toContain("cannot be approved from WeChat");
    expect(highRisk).not.toContain(".y 12");
    const view = render("T-APPROVAL-LOCAL", "zh", {
      ...base,
      reason: "view-only",
    });
    expect(view).toContain("审批模式高于微信上限");
    const run = render("T-APPROVAL-LOCAL", "zh", {
      ...base,
      reason: "view-only",
      viewOnly: "automation-run",
    });
    expect(run).toContain("自动化运行");
    expect(
      render("T-APPROVAL-LOCAL", "en", { ...base, reason: "automation" }),
    ).toContain("cannot be approved from WeChat");
  });

  it("shows a long subject in .show up to its own cap", () => {
    const text = renderSample("T-SHOW", "en");
    expect(text).toContain("x".repeat(800));
    expect(text).toContain("Evidence:\n```\nstderr: denied\n```");
  });

  it("lays out a question card", () => {
    expect(renderSample("T-QCARD", "zh")).toBe(
      [
        "**pine › 修登录页** · 问题 13",
        "",
        "**Q1** Which login?（单选）",
        "- **1** Email code",
        "- **2** Password · Classic",
        "",
        "**Q2** Which environments?（可多选）",
        "- **1** dev",
        "- **2** staging",
        "- **3** prod",
        "",
        "> 回答：`.a 13 1; 1,2` · 自己写：`.a 13 =文字` · 取消：`.d 13`",
      ].join("\n"),
    );
    expect(renderSample("T-QCARD", "en")).toBe(
      [
        "**pine › 修登录页** · Question 13",
        "",
        "**Q1** Which login? (pick one)",
        "- **1** Email code",
        "- **2** Password · Classic",
        "",
        "**Q2** Which environments? (pick any)",
        "- **1** dev",
        "- **2** staging",
        "- **3** prod",
        "",
        "> Answer: `.a 13 1; 1,2` · own words: `.a 13 =text` · cancel: `.d 13`",
      ].join("\n"),
    );
    expect(answerExample(questionnaire)).toBe("1; 1,2");
  });

  it("knows when a question card cannot be answered in text", () => {
    expect(questionCardAnswerable("en", at, 13, questionnaire)).toBe(true);
    const preview: AskUserQuestionParams = {
      questions: [
        {
          question: "Which?",
          header: "x",
          options: [
            { label: "a", description: "", preview: "```ts\nx\n```" },
            { label: "b", description: "" },
          ],
        },
      ],
    };
    expect(questionCardAnswerable("en", at, 13, preview)).toBe(false);
  });

  it("renders a finished run with the reply as Markdown", () => {
    expect(renderSample("T-DONE", "zh")).toBe(
      [
        "**pine › 修登录页** · 完成 · 3 分 20 秒 · $0.12",
        "",
        "Done **it**",
        "",
        "> `.u 9` 切到它 · `.o` 文件 (2)",
      ].join("\n"),
    );
    expect(renderSample("T-DONE", "en")).toBe(
      [
        "**pine › 修登录页** · Done · 3m 20s · $0.12",
        "",
        "Done **it**",
        "",
        "> `.u 9` switch to it · `.o` files (2)",
      ].join("\n"),
    );
    const current = { at, text: "ok", files: 0, current: true };
    // The whole reply fits, so there is no footer at all.
    expect(render("T-DONE", "en", current)).toBe(
      "**pine › 修登录页** · Done\n\nok",
    );
    expect(render("T-DONE", "zh", current)).toBe(
      "**pine › 修登录页** · 完成\n\nok",
    );
    const long = { ...current, text: "word ".repeat(200) };
    expect(
      render("T-DONE", "en", long).endsWith("…\n\n> `.r` full reply"),
    ).toBe(true);
    expect(render("T-DONE", "zh", long).endsWith("…\n\n> `.r` 全文")).toBe(
      true,
    );
  });

  it("closes a T-DONE excerpt cut inside a list-item fence within the item", () => {
    const text = render("T-DONE", "en", {
      at,
      text: `1. Install:\n   \`\`\`bash\n${"   npm i some-package\n".repeat(40)}   \`\`\``,
      files: 0,
      current: true,
    });
    const [excerpt = "", footer] = text.split("\n\n").slice(1);
    expect(excerpt.endsWith("…\n   ```")).toBe(true);
    expect(footer).toBe("> `.r` full reply");
    // Exactly one opener and one closer, both at the list item's indent.
    expect(text.match(/^ *```/gm)).toEqual(["   ```", "   ```"]);
  });

  it("cuts the T-DONE excerpt and closes its fence", () => {
    const text = render("T-DONE", "en", {
      at,
      text: `Intro\n\n\`\`\`\n${"code line\n".repeat(200)}\`\`\``,
      files: 0,
      current: true,
    });
    const excerpt = text.split("\n\n").slice(1, -1).join("\n\n");
    expect(codePointLength(excerpt)).toBeLessThanOrEqual(DONE_EXCERPT_MAX);
    expect(excerpt.endsWith("…\n```")).toBe(true);
    proseLines(text);
  });

  it("renders the stale digest with and without held messages", () => {
    expect(renderSample("T-STALE", "zh")).toBe(
      [
        "离线期间收到 3 条消息（最早 3 小时前）：",
        "- **1** `.new @pine 跑一遍测试`",
        "- **2** 把结果发我",
        "",
        "未执行：`.y 12`（已过期）",
        "",
        "> 回 `.y 15` 按顺序执行第 1、2 条，`.d 15` 丢弃。10 分钟内有效。",
      ].join("\n"),
    );
    expect(renderSample("T-STALE", "en")).toBe(
      [
        "3 message(s) arrived while offline (oldest 3 hours ago):",
        "- **1** `.new @pine 跑一遍测试`",
        "- **2** 把结果发我",
        "",
        "Not run: `.y 12` (too old)",
        "",
        "> Reply `.y 15` to run 1, 2 in order, `.d 15` to discard. Valid for 10 minutes.",
      ].join("\n"),
    );
    expect(
      render("T-STALE", "en", {
        held: [],
        notRun: [".y 12", ".m 2"],
        oldestAgeMs: 0,
      }),
    ).toBe("Not run: `.y 12`, `.m 2` (too old)");
  });
});

describe("session replies", () => {
  it("announces a new session with its meta in the footer", () => {
    const data = {
      project: "无项目",
      text: "中午好啊",
      mode: "auto-approve" as const,
      model: "deepseek-flash",
    };
    expect(render("R-NEW", "zh", data)).toBe(
      "**无项目** · 已开始：中午好啊\n\n> 自动审批 · deepseek-flash · 完成后通知你，`.x` 可停止",
    );
    expect(render("R-NEW", "en", data)).toBe(
      "**无项目** · Started: 中午好啊\n\n> Auto Approve · deepseek-flash · I'll tell you when it's done; `.x` stops it",
    );
  });

  it("lists sessions as a table with a footer", () => {
    const rows = [
      {
        n: 1,
        title: "修登录页",
        project: "pine",
        atMs: NOW - 5 * 60_000,
        marks: ["running"] as "running"[],
      },
      { n: 2, title: "调研", project: "docs", atMs: NOW, marks: [] },
    ];
    expect(render("R-SESSIONS", "zh", { now: NOW, rows })).toBe(
      [
        "| # | 会话 | 时间 |",
        "|---|---|---|",
        "| `.1` | ▶ 修登录页 · pine | 5 分钟前 |",
        "| `.2` | 调研 · docs | 刚刚 |",
        "",
        "> 回 `.数字` 切换 · `.0` 更多 · `.f` 搜索",
      ].join("\n"),
    );
    expect(render("R-SESSIONS", "en", { now: NOW, rows })).toBe(
      [
        "| # | Session | When |",
        "|---|---|---|",
        "| `.1` | ▶ 修登录页 · pine | 5 min ago |",
        "| `.2` | 调研 · docs | just now |",
        "",
        "> Reply `.number` to switch · `.0` more · `.f` search",
      ].join("\n"),
    );
  });
});

describe("digest", () => {
  it("names finished, failed and waiting items", () => {
    expect(
      renderDigest("zh", [
        { kind: "done", title: "修登录页" },
        { kind: "failed", title: "跑测试" },
        { kind: "ask", number: 12 },
        { kind: "ask", number: 13 },
        { kind: "ask", number: 12 },
      ]),
    ).toBe(
      "**你不在时**\n- 「修登录页」已完成\n- 「跑测试」失败\n- 2 项待处理：12、13",
    );
    expect(
      renderDigest("en", [
        { kind: "done", title: "a" },
        { kind: "autorun", name: "nightly", result: "ok" },
        { kind: "auto-on", name: "sync", result: "timeout" },
      ]),
    ).toBe(
      '**While you were away**\n- "a" finished\n- automation "nightly" finished: ok\n- request to turn on "sync" expired',
    );
    expect(renderDigest("en", [])).toBe("");
  });
});

describe("errors", () => {
  it("names the .mode way out of view-only", () => {
    expect(renderSample("E-VIEW", "zh")).toContain(
      "> 回 `.mode 2` 把它降到 自动审批 后可继续",
    );
    expect(renderSample("R-USEVIEW", "en")).toContain(
      "> Reply `.mode 2` to lower it to Auto Approve",
    );
    expect(
      render("R-USEVIEW", "en", {
        title: "run",
        project: "pine",
        state: "idle",
        reason: "automation-run",
      }),
    ).not.toContain(".mode");
  });

  it("renders every R-QUEUEWAIT variant and the overflow", () => {
    const at = { project: "p", title: "t" };
    const variants = [
      "approval",
      "question",
      "display-only",
      "long-context",
      "question-local",
    ] as const;
    const asks = variants.map((variant, index) => ({
      number: 12 + index,
      variant,
    }));
    expect(render("R-QUEUEWAIT", "en", { at, asks })).toBe(
      [
        "**p › t** · Staged as a steering message",
        "",
        "It reaches the agent once the waiting cards are handled.",
        "",
        "**Still waiting**",
        "- **12** approval · `.y 12` approves · `.d 12` rejects",
        "- **13** question · `.a 13 your answer` · `.d 13` cancels",
        "- **14** approve on the computer · `.d 14` rejects",
        "- **15** long context · `.c 15` compress, then continue · `.d 15` stop",
        "- **16** question · answer it in Pine · `.d 16` cancels",
        "",
        "> `.recall` withdraws this message",
      ].join("\n"),
    );
    expect(render("R-QUEUEWAIT", "zh", { at, asks })).toBe(
      [
        "**p › t** · 已作为暂存消息排队",
        "",
        "等待的卡片处理后交给智能体。",
        "",
        "**仍在等你**",
        "- **12** 审批 · `.y 12` 批准 · `.d 12` 拒绝",
        "- **13** 问题 · `.a 13 你的回答` · `.d 13` 取消",
        "- **14** 只能在电脑上批准 · `.d 14` 拒绝",
        "- **15** 上下文较长 · `.c 15` 先压缩再继续 · `.d 15` 停止",
        "- **16** 问题 · 需在 Pine 中回答 · `.d 16` 取消",
        "",
        "> 发 `.撤回` 可撤回这条消息",
      ].join("\n"),
    );
    expect(
      render("R-QUEUEWAIT", "en", {
        at,
        asks: [{ number: 11, variant: "approval" }],
      }),
    ).toContain("once the waiting card is handled.");
    const many = Array.from({ length: PAGE_ROWS + 1 }, (_, index) => ({
      number: 11 + index,
      variant: "approval" as const,
    }));
    const long = render("R-QUEUEWAIT", "en", { at, asks: many });
    expect(long).toContain("- and 1 more");
    expect(long).not.toContain(`**${11 + PAGE_ROWS}** approval`);
    expect(render("R-QUEUEWAIT", "zh", { at, asks: many })).toContain(
      "- 等 1 项",
    );
  });

  it("points R-QUEUE at .recall in English and .撤回 in Chinese", () => {
    const rows = [{ n: 1, text: "go on" }];
    expect(render("R-QUEUE", "en", { rows })).toContain(
      "> `.recall number` withdraws",
    );
    expect(render("R-QUEUE", "zh", { rows })).toContain(
      "> 发 `.撤回 数字` 撤回",
    );
  });

  it("does not leave half an escape where a list row is cut", () => {
    const rows = [{ n: 1, text: `${"a".repeat(68)}*b` }];
    const text = render("R-QUEUE", "en", { rows });
    expect(text).toContain(`| \`.recall 1\` | ${"a".repeat(68)}… |`);
    expect(text).not.toContain("\\…");
  });

  it("renders both E-BUSY variants and both E-LOCAL forms", () => {
    expect(
      render("E-BUSY", "en", { variant: "running", title: "t" }),
    ).toContain("Stop it with `.x`");
    expect(render("E-BUSY", "zh", { variant: "local", title: "t" })).toContain(
      "在电脑上也用过",
    );
    expect(render("E-LOCAL", "en", {})).toBe(
      "This can only be done on the computer.",
    );
    expect(render("E-LOCAL", "zh", { ask: 12 })).toContain("`.d 12`");
  });

  it("names the unknown command and the suggestion as code", () => {
    expect(renderSample("E-UNKNOWN", "zh")).toBe(
      "没有 `.stpo` 这个命令。是不是 `.stop`？\n\n> 回 `.?` 看全部。要把以点开头的文字发给 Pine，请用两个点开头。",
    );
    expect(renderSample("E-UNKNOWN", "en")).toBe(
      "There is no `.stpo` command. Did you mean `.stop`?\n\n> Reply `.?` for the list. To send text that starts with a dot, start it with two dots.",
    );
  });

  it("caps echoed user input", () => {
    const text = render("E-UNKNOWN", "en", { token: "x".repeat(200) });
    expect(text).toContain(`\`.${"x".repeat(38)}…\``);
    expect(text).not.toContain("x".repeat(40));
  });

  it("explains an answer that does not fit", () => {
    expect(
      render("E-ANSWER", "en", {
        ask: 13,
        count: 2,
        example: "1; 1,2",
        problem: { kind: "option", part: 2, option: 5 },
      }),
    ).toBe(
      "Part 2 has no option 5.\nQuestion 13 has 2 part(s). Answer in order, separated by semicolons, for example `.a 13 1; 1,2`",
    );
  });

  it("lists the asks for E-WHICH with the command typed", () => {
    expect(
      render("E-WHICH", "zh", { ...SAMPLES["E-WHICH"], command: "d" }),
    ).toBe(
      "有 2 项待处理：\n- **12** bash（a）\n- **13** 问题（b）\n\n> 请带编号，如 `.d 12`",
    );
  });

  it("renders the E-GONE and E-SIZE variants", () => {
    expect(render("E-GONE", "zh", { variant: "item", kind: "session" })).toBe(
      "这个会话已不存在。",
    );
    expect(render("E-GONE", "en", { variant: "file-changed" })).toContain(
      "changed",
    );
    expect(
      render("E-GONE", "en", { variant: "folders", name: "pine" }),
    ).toContain("pine");
    expect(render("E-SIZE", "en", { variant: "text" })).toContain("100,000");
    expect(renderSample("E-SIZE", "en")).toBe(
      "report.pdf is 200 MB, over the 100 MB limit.",
    );
  });
});

describe("labels", () => {
  it("uses Pine's own mode labels and fixed numbers", () => {
    expect(APPROVAL_MODE_ORDER.map((mode) => modeLabel("zh", mode))).toEqual([
      "让我过目",
      "自动审批",
      "自主工作",
      "干就完了",
    ]);
    expect(APPROVAL_MODE_ORDER.map((mode) => modeLabel("en", mode))).toEqual([
      "Let Me Review",
      "Auto Approve",
      "Autonomous Work",
      "YOLO",
    ]);
    expect(APPROVAL_MODE_ORDER.map(modeNumber)).toEqual([1, 2, 3, 4]);
    expect(modeOfNumber(4)).toBe("YOLO");
    expect(modeOfNumber(5)).toBeUndefined();
  });

  it("marks the current mode and the modes above the ceiling", () => {
    expect(
      render("R-MODES", "en", {
        current: "auto-approve",
        ceiling: "auto-approve",
      }),
    ).toBe(
      [
        "- **1** Let Me Review",
        "- **2** Auto Approve · current",
        "- **3** 🔒 Autonomous Work",
        "- **4** 🔒 YOLO",
        "",
        "> The highest mode is set on the computer.",
      ].join("\n"),
    );
  });

  it("builds the header", () => {
    expect(header("zh", "pine", "修登录页")).toBe("**pine › 修登录页**");
    expect(header("en", "pine", "x".repeat(50))).toBe(
      `**pine › ${"x".repeat(29)}…**`,
    );
    expect(header("en", markdownAt.project, markdownAt.title)).toBe(
      ESCAPED_MARKDOWN_HEADER,
    );
  });
});

describe("help", () => {
  it("renders the hot path with the computer facts", () => {
    expect(renderSample("R-HELP", "zh")).toBe(
      [
        "**Pine 微信命令**",
        "以 `.` 或 `。` 开头；直接发文字 = 发给当前会话",
        "",
        "| 命令 | 作用 |",
        "|---|---|",
        "| `.` | 状态 |",
        "| `.n` | 新会话 |",
        "| `.l` | 会话列表 |",
        "| `.f` | 搜索 |",
        "| `.u` | 切换会话 |",
        "| `.r` | 最后回复 |",
        "| `.x` | 停止 |",
        "| `.p` | 项目 |",
        "| `.o` | 文件 |",
        "| `.y` / `.d` | 批准 / 拒绝 |",
        "| `.a` | 回答 |",
        "| `.w` | 待处理 |",
        "| `.0` | 下一页 |",
        "| `.数字` | 选列表项 |",
        "| `.pause` | 立即停用 |",
        "",
        "> 更多命令：`.? 2` · 以点开头的普通文字请用两个点开头",
        "> 电脑：kw-mac · 最高模式：自动审批 · 发文件：关",
      ].join("\n"),
    );
    expect(renderSample("R-HELP", "en")).toBe(
      [
        "**Pine WeChat commands**",
        "Start with `.` or `。`; plain text goes to the current session",
        "",
        "| Command | What it does |",
        "|---|---|",
        "| `.` | status |",
        "| `.n` | new session |",
        "| `.l` | sessions |",
        "| `.f` | search |",
        "| `.u` | switch session |",
        "| `.r` | last reply |",
        "| `.x` | stop |",
        "| `.p` | projects |",
        "| `.o` | files |",
        "| `.y` / `.d` | approve / reject |",
        "| `.a` | answer |",
        "| `.w` | waiting |",
        "| `.0` | next page |",
        "| `.number` | pick a list row |",
        "| `.pause` | turn off now |",
        "",
        "> More: `.? 2` · start with two dots to send text that begins with a dot",
        "> Computer: kw-mac · Highest mode: Auto Approve · Files: off",
      ].join("\n"),
    );
    expect(renderSample("R-WELCOME", "en")).toMatch(
      /^Connected to Pine on kw-mac \(experimental\)\.\n\n\*\*Pine WeChat commands\*\*/,
    );
    expect(
      render("R-HELP", "en", { ...SAMPLES["R-HELP"], computer: "my_mac" }),
    ).toContain("> Computer: my\\_mac ·");
  });

  it("lists the other commands", () => {
    expect(renderSample("R-HELP2", "zh")).toBe(
      [
        "**更多命令**",
        "",
        "| 命令 | 作用 |",
        "|---|---|",
        "| `.m` | 模型 |",
        "| `.e` | 推理强度 |",
        "| `.mode` | 审批模式 |",
        "| `.i` | 用量 |",
        "| `.c` | 压缩 |",
        "| `.t` | 待办 |",
        "| `.b` | 后台进程 |",
        "| `.k` | 结束进程 |",
        "| `.q` | 排队 |",
        "| `.hi` | 历史 |",
        "| `.rn` | 改名 |",
        "| `.del` | 删除 |",
        "| `.au` | 自动化 |",
        "| `.ar` | 运行记录 |",
        "| `.sk` | 技能 |",
        "| `.mcp` | MCP |",
        "| `.cfg` | 设置 |",
        "| `.lang` | 语言 |",
        "| `.drop` | 丢弃附件 |",
        "",
        "> `.? 命令名` 查看用法",
      ].join("\n"),
    );
    expect(renderSample("R-HELP2", "en")).toBe(
      [
        "**More commands**",
        "",
        "| Command | What it does |",
        "|---|---|",
        "| `.m` | model |",
        "| `.e` | effort |",
        "| `.mode` | approval mode |",
        "| `.i` | usage |",
        "| `.c` | compact |",
        "| `.t` | todos |",
        "| `.b` | processes |",
        "| `.k` | kill |",
        "| `.q` | queue |",
        "| `.hi` | history |",
        "| `.rn` | rename |",
        "| `.del` | delete |",
        "| `.au` | automations |",
        "| `.ar` | runs |",
        "| `.sk` | skills |",
        "| `.mcp` | MCP |",
        "| `.cfg` | settings |",
        "| `.lang` | language |",
        "| `.drop` | drop attachments |",
        "",
        "> `.? name` shows a command's usage",
      ].join("\n"),
    );
  });

  it("renders one command's usage from its spec", () => {
    expect(renderSample("R-HELP1", "zh")).toBe(
      "`.use [ref]` — 切换当前会话\n\n> 别名：`.u` `.sw` `.切换` `.接管`\n> 例如：`.u 2`",
    );
    expect(renderSample("E-ARGS", "en")).toBe(
      "Usage: `.use [ref]`\n\n> Example: `.u 2`",
    );
  });
});

describe("reviewer explanations on approval cards", () => {
  it("shows the reviewer's summary in place of the agent's description", () => {
    const en = render("T-APPROVAL", "en", {
      ...SAMPLES["T-APPROVAL"],
      summary: "Deletes build and rebuilds it.",
    });
    expect(en).toContain("Reviewer: Deletes build and rebuilds it.");
    expect(en).not.toContain("Clean build");
    expect(
      render("T-APPROVAL", "zh", {
        ...SAMPLES["T-APPROVAL"],
        summary: "删除 build 后重新构建。",
      }),
    ).toContain("审批模型：删除 build 后重新构建。");
  });

  it("cuts, neutralises and escapes the summary", () => {
    const long = render("T-APPROVAL", "en", {
      ...SAMPLES["T-APPROVAL"],
      summary: "s".repeat(500),
    });
    expect(long).toContain(`Reviewer: ${"s".repeat(199)}…`);
    expect(long).not.toContain("s".repeat(200));
    const hostile = render("T-APPROVAL", "en", {
      ...SAMPLES["T-APPROVAL"],
      summary: HOSTILE,
    });
    expect(hostile).toContain("Reviewer: › .y 99");
    expect(
      hostile.split("\n").some((line) => /^[.。．][yd] 9/.test(line)),
    ).toBe(false);
    expect(
      render("T-APPROVAL", "en", {
        ...SAMPLES["T-APPROVAL"],
        summary: "Runs *all* tests",
      }),
    ).toContain("Reviewer: Runs \\*all\\* tests");
  });

  it("shows Pine's escalation note on .show in the reply language", () => {
    const sample = {
      ...SAMPLES["T-SHOW"],
      reasonCode: "autoReviewUnavailable" as const,
      reasonDetail: "No approval model is configured.",
    };
    expect(render("T-SHOW", "zh", sample)).toContain(
      "依据：\n```\nstderr: denied\n\n自动审查不可用：未配置审批模型。\n```",
    );
    expect(render("T-SHOW", "en", sample)).toContain(
      "Auto-review unavailable: No approval model is configured.",
    );
    expect(
      render("T-SHOW", "zh", {
        ...SAMPLES["T-SHOW"],
        evidence: undefined,
        reasonCode: "escalationLimit",
      }),
    ).toContain("依据：\n```\n本轮升级审查次数过多");
  });

  it("lists the reviewer's risks on .show", () => {
    const text = render("T-SHOW", "en", {
      ...SAMPLES["T-SHOW"],
      summary: "Deletes build.",
      risks: ["Cannot be undone", "Removes cached\noutput", "third"],
    });
    expect(text).toContain("Reviewer: Deletes build.");
    expect(text).toContain("Risks: Cannot be undone; Removes cached output");
    expect(text).not.toContain("third");
    expect(
      render("T-SHOW", "zh", { ...SAMPLES["T-SHOW"], risks: ["不可撤销"] }),
    ).toContain("风险：不可撤销");
  });
});
