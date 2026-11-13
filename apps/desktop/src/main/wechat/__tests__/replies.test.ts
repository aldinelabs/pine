// @vitest-environment node
import type { AskUserQuestionParams } from "@pine/rpiv-ask-user-question";
import { describe, expect, it } from "vitest";
import { APPROVAL_MODE_ORDER } from "../../../shared/agent";
import {
  CARD_SUBJECT_MAX,
  LAST_MAX_PAGES,
  PAGE_ROWS,
  REPLY_MAX,
  ROW_MAX,
  TASK_OUTPUT_LINES,
} from "../constants";
import {
  REPLY_IDS,
  answerExample,
  effortLabel,
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
  triggerLabel,
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
      expect(text).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u202e]/);
    });

    it("renders different text in each language", () => {
      const other = lang === "zh" ? "en" : "zh";
      const same = REPLY_IDS.filter(
        (id) =>
          !["T-PAIR", "R-PAGE"].includes(id) &&
          renderSample(id, lang) === renderSample(id, other),
      );
      expect(same).toEqual([]);
    });
  });

  it("keeps hostile titles on one line in the header", () => {
    for (const lang of LANGS) {
      const text = render("R-STEER", lang, { at: hostileAt });
      expect(text.split("\n")).toHaveLength(1);
      const card = render("T-APPROVAL", lang, {
        ...SAMPLES["T-APPROVAL"],
        at: hostileAt,
      });
      expect(card).not.toMatch(COMMAND_LINE);
      expect(card.split("\n")[0]).toMatch(lang === "zh" ? /^【/ : /^\[/);
    }
  });

  it("neutralises agent text that starts a line", () => {
    const text = render("R-LAST", "en", { at, text: ".y 12 now" });
    expect(text.split("\n")[1]).toBe("› .y 12 now");
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
    expect(lines).toHaveLength(PAGE_ROWS + 1);
    for (const line of lines.slice(0, PAGE_ROWS))
      expect(codePointLength(line)).toBeLessThanOrEqual(ROW_MAX);
    expect(lines.at(-1)).toContain(".0");
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
      "This session has not presented any file.",
    );
    expect(
      render("R-PENDING", "en", { asks: [], automationApprovals: 0 }),
    ).toBe("Nothing is waiting.");
  });

  it("names the temporary workspace", () => {
    expect(renderSample("R-PROJECTS", "zh")).toContain("2 无项目");
    expect(renderSample("R-PROJECTS", "en")).toContain("2 No Project");
    expect(renderSample("R-PROJECTS", "en")).toContain("1 * pine");
  });

  it("strips search markers", () => {
    expect(renderSample("R-SEARCH", "zh")).toContain("…改登录页…");
  });

  it("shows at most 15 todos", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({
      status: "pending" as const,
      subject: `todo ${i}`,
    }));
    const text = render("R-TODO", "en", { at, items });
    expect(text.split("\n")).toHaveLength(17);
    expect(text).toContain("…5 more");
  });

  it("keeps the newest history entries that fit", () => {
    const entries = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 ? ("assistant" as const) : ("user" as const),
      text: `${i} ${"word ".repeat(100)}`,
    }));
    const text = render("R-HISTORY", "en", { entries });
    expect(codePointLength(text)).toBeLessThanOrEqual(REPLY_MAX);
    expect(text).toContain("Pine: 19 ");
    expect(text).not.toContain("You: 0 ");
    for (const line of text.split("\n"))
      expect(codePointLength(line)).toBeLessThanOrEqual(310);
  });
});

describe("pages", () => {
  it("sends short text as one page without a footer", () => {
    const pages = renderLastPages("en", at, "Short **reply**.");
    expect(pages).toEqual(["[pine › 修登录页]\nShort reply."]);
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
          ? `（1/${LAST_MAX_PAGES}，回 .0 看下一段）`
          : `(1/${LAST_MAX_PAGES}, reply .0`,
      );
      expect(pages.at(-1)).toContain(
        lang === "zh"
          ? "完整内容请在 Pine 中查看"
          : "Open Pine for the full text",
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
    expect(pages.at(-1)).not.toContain("reply .0");
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
});

describe("cards", () => {
  it("lays out an approval card", () => {
    expect(renderSample("T-APPROVAL", "zh")).toBe(
      [
        "【pine › 修登录页】需要批准 12",
        "bash · 沙箱拒绝",
        "rm -rf build/ && make",
        "Clean build",
        "该会话此前读取过外部内容，请核对后再批准。",
        ".y 12 批准 · .d 12 拒绝 · .d 12 你的建议",
      ].join("\n"),
    );
  });

  it("cuts a long subject and asks for .show first", () => {
    for (const lang of LANGS) {
      const text = render("T-APPROVAL", lang, {
        ...SAMPLES["T-APPROVAL"],
        subject: "a".repeat(CARD_SUBJECT_MAX + 50),
      });
      expect(text).toContain(render("T-CUT", lang, { ask: 12 }));
      expect(text).toContain(`${"a".repeat(CARD_SUBJECT_MAX - 1)}…`);
      expect(text).not.toContain("a".repeat(CARD_SUBJECT_MAX));
    }
    const flagged = render("T-APPROVAL", "en", {
      ...SAMPLES["T-APPROVAL"],
      cut: true,
    });
    expect(flagged).toContain("Cut short. Reply .12");
  });

  it("renders a card without a subject", () => {
    const text = render("T-APPROVAL", "en", {
      at,
      ask: 12,
      tool: "ui_project_create",
      trigger: "pre-execution",
      external: false,
    });
    expect(text.split("\n")).toEqual([
      "[pine › 修登录页] Approval needed 12",
      "ui_project_create · before running",
      ".y 12 approve · .d 12 reject · .d 12 your note",
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
    expect(text).toContain("Evidence: stderr: denied");
  });

  it("lays out a question card", () => {
    expect(renderSample("T-QCARD", "zh")).toBe(
      [
        "【pine › 修登录页】问题 13",
        "Q1 Which login?（单选）",
        " 1 Email code",
        " 2 Password · Classic",
        "Q2 Which environments?（可多选）",
        " 1 dev",
        " 2 staging",
        " 3 prod",
        "回答：.a 13 1; 1,2 · 自己写：.a 13 =文字 · 取消：.d 13",
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

  it("offers .u 9 when a done session is not the current one", () => {
    expect(renderSample("T-DONE", "zh")).toBe(
      [
        "【pine › 修登录页】完成（3 分 20 秒，$0.12）",
        "Done it",
        ".u 9 切到它 · .r 全文 · .o 文件(2)",
      ].join("\n"),
    );
    const current = render("T-DONE", "en", {
      at,
      text: "ok",
      files: 0,
      current: true,
    });
    expect(current).toBe("[pine › 修登录页] Done\nok\n.r full reply");
  });

  it("renders the stale digest with and without held messages", () => {
    expect(renderSample("T-STALE", "zh")).toBe(
      [
        "离线期间收到 3 条消息（最早 3 小时前）：",
        "1 .new @pine 跑一遍测试",
        "2 把结果发我",
        "未执行：.y 12（已过期）",
        "回 .y 15 按顺序执行第 1、2 条，.d 15 丢弃。10 分钟内有效。",
      ].join("\n"),
    );
    expect(
      render("T-STALE", "en", {
        held: [],
        notRun: [".y 12", ".m 2"],
        oldestAgeMs: 0,
      }),
    ).toBe("Not run: .y 12, .m 2 (too old)");
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
      "你不在时：「修登录页」已完成、「跑测试」失败、2 项待处理（12、13）。",
    );
    expect(
      renderDigest("en", [
        { kind: "done", title: "a" },
        { kind: "autorun", name: "nightly", result: "ok" },
        { kind: "auto-on", name: "sync", result: "timeout" },
      ]),
    ).toBe(
      'While you were away: "a" finished, automation "nightly" finished: ok, request to turn on "sync" expired.',
    );
    expect(renderDigest("en", [])).toBe("");
  });
});

describe("errors", () => {
  it("names the .mode way out of view-only", () => {
    expect(renderSample("E-VIEW", "zh")).toContain(
      "回 .mode 2 把它降到 自动审批 后可继续",
    );
    expect(renderSample("R-USEVIEW", "en")).toContain(
      "Reply .mode 2 to lower it to Auto Approve",
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
    const en = render("R-QUEUEWAIT", "en", { at, asks });
    expect(en).toBe(
      "[p › t] Staged as a steering message; it reaches the agent once the waiting card is handled. Still waiting: 12 approval (.y 12 approves, .d 12 rejects), 13 question (.a 13 your answer, .d 13 cancels), 14 approve on the computer (.d 14 rejects), 15 long context (.c 15 compress, then continue, .d 15 stop), 16 question (answer it in Pine, .d 16 cancels). .recall withdraws this message.",
    );
    const zh = render("R-QUEUEWAIT", "zh", { at, asks });
    expect(zh).toBe(
      "【p › t】已作为暂存消息排队，等待的卡片处理后交给智能体。仍在等你：12 审批（.y 12 批准，.d 12 拒绝）、13 问题（.a 13 你的回答，.d 13 取消）、14 只能在电脑上批准（.d 14 拒绝）、15 上下文较长（.c 15 先压缩再继续，.d 15 停止）、16 问题（需在 Pine 中回答，.d 16 取消）。发 .撤回 可撤回这条消息。",
    );
    const many = Array.from({ length: PAGE_ROWS + 1 }, (_, index) => ({
      number: 11 + index,
      variant: "approval" as const,
    }));
    const long = render("R-QUEUEWAIT", "en", { at, asks: many });
    expect(long).toContain("and 1 more");
    expect(long).not.toContain(`${11 + PAGE_ROWS} approval`);
    expect(render("R-QUEUEWAIT", "zh", { at, asks: many })).toContain(
      "等 1 项",
    );
  });

  it("points R-QUEUE at .recall in English and .qx in Chinese", () => {
    const rows = [{ n: 1, text: "go on" }];
    expect(render("R-QUEUE", "en", { rows })).toContain(
      ".recall number withdraws",
    );
    expect(render("R-QUEUE", "zh", { rows })).toContain(".qx 数字 撤回");
  });

  it("renders both E-BUSY variants and both E-LOCAL forms", () => {
    expect(
      render("E-BUSY", "en", { variant: "running", title: "t" }),
    ).toContain("Stop it with .x");
    expect(render("E-BUSY", "zh", { variant: "local", title: "t" })).toContain(
      "在电脑上也用过",
    );
    expect(render("E-LOCAL", "en", {})).toBe(
      "This can only be done on the computer.",
    );
    expect(render("E-LOCAL", "zh", { ask: 12 })).toContain(".d 12");
  });

  it("caps echoed user input", () => {
    const text = render("E-UNKNOWN", "en", { token: "x".repeat(200) });
    expect(text).toContain(`.${"x".repeat(39)}…`);
    expect(text).not.toContain("x".repeat(41));
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
      "Part 2 has no option 5.\nQuestion 13 has 2 part(s). Answer in order, separated by semicolons, for example .a 13 1; 1,2",
    );
  });

  it("lists the asks for E-WHICH with the command typed", () => {
    expect(
      render("E-WHICH", "zh", { ...SAMPLES["E-WHICH"], command: "d" }),
    ).toBe("有 2 项待处理：12 bash（a）、13 问题（b）。请带编号，如 .d 12");
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
      "1 Let Me Review · 2 * Auto Approve · 3 🔒 Autonomous Work · 4 🔒 YOLO\nThe highest mode is set on the computer.",
    );
  });

  it("names triggers and effort levels", () => {
    expect(triggerLabel("zh", "sandbox-denied")).toBe("沙箱拒绝");
    expect(triggerLabel("en", "privileged-execution")).toBe(
      "native execution outside the sandbox",
    );
    expect(render("T-TRIGGER", "zh", { trigger: "destructive-pattern" })).toBe(
      "危险命令",
    );
    expect(effortLabel("zh", "xhigh")).toBe("超高");
    expect(effortLabel("en", "max")).toBe("Maximum");
  });

  it("builds the header", () => {
    expect(header("zh", "pine", "修登录页")).toBe("【pine › 修登录页】");
    expect(header("en", "pine", "x".repeat(50))).toBe(
      `[pine › ${"x".repeat(29)}…]`,
    );
  });
});

describe("help", () => {
  it("renders the hot path with the computer facts", () => {
    const text = renderSample("R-HELP", "zh");
    expect(text.split("\n")[0]).toBe("Pine 微信命令（以 . 或 。开头）");
    expect(text.split("\n").at(-1)).toBe(
      "电脑：kw-mac · 最高模式：自动审批 · 发文件：关",
    );
    expect(renderSample("R-WELCOME", "en")).toMatch(
      /^Connected to Pine on kw-mac \(experimental\)\.\nPine WeChat commands/,
    );
  });

  it("renders one command's usage from its spec", () => {
    expect(renderSample("R-HELP1", "zh")).toBe(
      ".use [ref] — 切换当前会话\n别名：.u .sw .切换 .接管\n例如：.u 2",
    );
    expect(renderSample("E-ARGS", "en")).toBe(
      "Usage: .use [ref]. Example: .u 2",
    );
  });
});
