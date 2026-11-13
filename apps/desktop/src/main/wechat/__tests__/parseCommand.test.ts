// @vitest-environment node
import type { AskUserQuestionParams } from "@pine/rpiv-ask-user-question";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "../commandSpec";
import {
  parseAnswers,
  parseCommand,
  resolveRef,
  splitAskPrefix,
} from "../parseCommand";
import type { Parsed } from "../types";

function cmd(
  name: string,
  extra: { project?: string; args?: string[]; tail?: string } = {},
): Parsed {
  return { kind: "command", name, args: [], ...extra } as Parsed;
}

describe("parseCommand: CMD §2.6 vectors", () => {
  const vectors: [string, Parsed][] = [
    ["修一下登录页", { kind: "message", text: "修一下登录页" }],
    ["。", cmd("status")],
    [".", cmd("status")],
    ["。S", cmd("status")],
    ["．ｓ", cmd("status")],
    [".status", cmd("status")],
    [".状态", cmd("status")],
    [". s", { kind: "message", text: ". s" }],
    [".?", cmd("help")],
    ["。？", cmd("help")],
    [".3", { kind: "number", numbers: [3] }],
    ["。３", { kind: "number", numbers: [3] }],
    [".0", { kind: "number", numbers: [0] }],
    [".1,3", { kind: "number", numbers: [1, 3] }],
    ["。1，3", { kind: "number", numbers: [1, 3] }],
    [".1、3", { kind: "number", numbers: [1, 3] }],
    [".u3", cmd("use", { args: ["3"] })],
    [".切换3", cmd("use", { args: ["3"] })],
    [".use 3", cmd("use", { args: ["3"] })],
    [".y12", cmd("approve", { args: ["12"] })],
    [".批准 12", cmd("approve", { args: ["12"] })],
    [".n 修一下登录页", cmd("new", { tail: "修一下登录页" })],
    [
      ".n @2 修一下\n登录页",
      cmd("new", { project: "2", tail: "修一下\n登录页" }),
    ],
    [
      '.new @"my site" fix nav',
      cmd("new", { project: "my site", tail: "fix nav" }),
    ],
    [".new ＠pine", cmd("new", { project: "pine" })],
    [".d 12 别删 build", cmd("reject", { tail: "12 别删 build" })],
    [".d 30 秒太短了", cmd("reject", { tail: "30 秒太短了" })],
    [".a 13 2; 1,3; 自定义", cmd("answer", { tail: "13 2; 1,3; 自定义" })],
    [".auto 2 run", cmd("auto", { args: ["2", "run"] })],
    [".AUTO 2 RUN", cmd("auto", { args: ["2", "run"] })],
    [".x all 现在", { kind: "invalid", name: "stop", reason: "args" }],
    [
      "..env 没加进 gitignore",
      { kind: "message", text: ".env 没加进 gitignore" },
    ],
    ["。。好的", { kind: "message", text: "。好的" }],
    ["...", { kind: "message", text: "..." }],
    ["。。。然后呢", { kind: "message", text: "。。。然后呢" }],
    [".5倍", { kind: "message", text: ".5倍" }],
    [".env.local 里", { kind: "message", text: ".env.local 里" }],
    ["./run.sh", { kind: "message", text: "./run.sh" }],
    [".statsu", { kind: "unknown", token: "statsu", suggestion: "status" }],
    [".gitignore", { kind: "unknown", token: "gitignore" }],
    [".net 8", { kind: "unknown", token: "net" }],
    [".停止吧", { kind: "unknown", token: "停止吧", suggestion: "停止" }],
    [
      ".停止这个任务吧",
      { kind: "unknown", token: "停止这个任务吧", suggestion: "停止" },
    ],
    [".新修一下登录页", cmd("new", { tail: "修一下登录页" })],
    [".切换修登录", cmd("use", { tail: "修登录" })],
    [".n2", { kind: "unknown", token: "n2", suggestion: "n 2" }],
    [".q2", { kind: "unknown", token: "q2", suggestion: "q 2" }],
    [".rn2", { kind: "unknown", token: "rn2", suggestion: "rn 2" }],
    [".f3", { kind: "unknown", token: "f3", suggestion: "f 3" }],
    [".g12", { kind: "unknown", token: "g12", suggestion: "g 12" }],
    [".新2", { kind: "unknown", token: "新2", suggestion: "新 2" }],
    ['.model "gpt 5"', cmd("model", { tail: '"gpt 5"' })],
  ];
  it.each(vectors)("%j", (input, expected) => {
    expect(parseCommand(input)).toEqual(expected);
  });
});

describe("parseCommand: classification rules", () => {
  it("rule 1: no prefix is a message, trimmed", () => {
    expect(parseCommand("  hello  ")).toEqual({
      kind: "message",
      text: "hello",
    });
  });

  it("rule 2: every prefix alone is status", () => {
    for (const prefix of [".", "。", "．", "｡"])
      expect(parseCommand(` ${prefix} `)).toEqual(cmd("status"));
  });

  it("rules 3-5: escapes and spaced dots stay messages", () => {
    expect(parseCommand("..gitignore 没提交")).toEqual({
      kind: "message",
      text: ".gitignore 没提交",
    });
    expect(parseCommand("．．好")).toEqual({ kind: "message", text: "．好" });
    expect(parseCommand(".\t好的")).toEqual({
      kind: "message",
      text: ".\t好的",
    });
    expect(parseCommand(".　好的")).toEqual({
      kind: "message",
      text: ".　好的",
    });
    expect(parseCommand("..")).toEqual({ kind: "message", text: ".." });
  });

  it("rule 6: ? and ？ are help, with a topic", () => {
    expect(parseCommand(".? new")).toEqual(cmd("help", { args: ["new"] }));
  });

  it("rule 7: a number followed by text is neither a number nor a prompt", () => {
    expect(parseCommand(".3 个文件")).toEqual({ kind: "unknown", token: "3" });
    expect(parseCommand(".011")).toEqual({ kind: "number", numbers: [11] });
  });

  it("rule 8: names are case-insensitive and NFKC-folded", () => {
    expect(parseCommand(".Status")).toEqual(cmd("status"));
    expect(parseCommand(".ＮＥＷ 做点事")).toEqual(
      cmd("new", { tail: "做点事" }),
    );
    expect(parseCommand(".project 2")).toEqual(
      cmd("projects", { args: ["2"] }),
    );
    expect(parseCommand(".cancel 12")).toEqual(cmd("reject", { tail: "12" }));
  });

  it(".recall is .unqueue, with a spaced or glued row number", () => {
    expect(parseCommand(".recall")).toEqual(cmd("unqueue"));
    expect(parseCommand(".recall 2")).toEqual(cmd("unqueue", { args: ["2"] }));
    expect(parseCommand(".recall2")).toEqual(cmd("unqueue", { args: ["2"] }));
    expect(parseCommand(".RECALL")).toEqual(cmd("unqueue"));
  });

  it("rule 9: glued digits only for glued commands", () => {
    expect(parseCommand(".a1,3")).toEqual(cmd("answer", { tail: "1,3" }));
    expect(parseCommand(".a13 2; 1")).toEqual(
      cmd("answer", { tail: "13 2; 1" }),
    );
    expect(parseCommand(".d12")).toEqual(cmd("reject", { tail: "12" }));
    expect(parseCommand(".auto2 off")).toEqual(
      cmd("auto", { args: ["2", "off"] }),
    );
    expect(parseCommand(".h2")).toEqual(cmd("help", { args: ["2"] }));
    expect(parseCommand(".ｕ３")).toEqual(cmd("use", { args: ["3"] }));
    expect(parseCommand(".u3 extra")).toEqual({
      kind: "invalid",
      name: "use",
      reason: "args",
    });
    expect(parseCommand(".y12 13")).toEqual({
      kind: "invalid",
      name: "approve",
      reason: "args",
    });
    expect(parseCommand(".n1,2")).toEqual({
      kind: "unknown",
      token: "n1,2",
      suggestion: "n 1,2",
    });
    for (const spec of COMMANDS.filter((entry) => !entry.glued)) {
      const parsed = parseCommand(`.${spec.name}2`);
      expect(parsed.kind, spec.name).toBe("unknown");
    }
  });

  it("rule 10: a Chinese alias starts a tail only for tail commands", () => {
    expect(parseCommand(".新建一个会话 跑测试")).toEqual(
      cmd("new", { tail: "一个会话 跑测试" }),
    );
    expect(parseCommand(".搜登录")).toEqual(cmd("search", { tail: "登录" }));
    expect(parseCommand(".排队跑一下ｔｅｓｔ")).toEqual(
      cmd("queue", { tail: "跑一下ｔｅｓｔ" }),
    );
    expect(parseCommand(".新年快乐")).toEqual(cmd("new", { tail: "年快乐" }));
    expect(parseCommand(".删除旧的调研")).toEqual({
      kind: "unknown",
      token: "删除旧的调研",
      suggestion: "删除",
    });
    expect(parseCommand(".批准吧")).toEqual({
      kind: "unknown",
      token: "批准吧",
      suggestion: "批准",
    });
  });

  it("rule 11: name-shaped tokens are unknown, never prompts", () => {
    expect(parseCommand(".你好")).toEqual({ kind: "unknown", token: "你好" });
    expect(parseCommand(".abc")).toEqual({ kind: "unknown", token: "abc" });
  });

  it("rule 12: anything else is a message", () => {
    expect(parseCommand(".你好呀朋友们")).toEqual({
      kind: "message",
      text: ".你好呀朋友们",
    });
    expect(parseCommand(".-v")).toEqual({ kind: "message", text: ".-v" });
  });
});

describe("parseCommand: normalisation and parameters", () => {
  it("removes zero-width characters but keeps emoji joiners", () => {
    expect(parseCommand("​.s‌")).toEqual(cmd("status"));
    expect(parseCommand(".ap‍prove 12")).toEqual(
      cmd("approve", { args: ["12"] }),
    );
    expect(parseCommand("﻿.n 看 👨‍👩‍👧")).toEqual(cmd("new", { tail: "看 👨‍👩‍👧" }));
  });

  it("never NFKC-folds a tail", () => {
    expect(parseCommand(".n ＡＢＣ　１２")).toEqual(
      cmd("new", { tail: "ＡＢＣ　１２" }),
    );
  });

  it("folds full-width numbers in positional parameters and @project", () => {
    expect(parseCommand(".auto ２ ＯＦＦ")).toEqual(
      cmd("auto", { args: ["2", "off"] }),
    );
    expect(parseCommand(".n ＠２ 做")).toEqual(
      cmd("new", { project: "2", tail: "做" }),
    );
    expect(parseCommand(".l @Pine")).toEqual(
      cmd("sessions", { project: "Pine" }),
    );
    expect(parseCommand(".u ３")).toEqual(cmd("use", { args: ["3"] }));
  });

  it("groups quoted parameters and keeps an unterminated quote literal", () => {
    expect(parseCommand(".l @“my site”")).toEqual(
      cmd("sessions", { project: "my site" }),
    );
    expect(parseCommand('.lang "en')).toEqual(cmd("lang", { args: ['"en'] }));
    expect(parseCommand('.help "a b"')).toEqual(cmd("help", { args: ["a b"] }));
  });

  it("refuses extra parameters and stray @project", () => {
    expect(parseCommand(".s now")).toEqual({
      kind: "invalid",
      name: "status",
      reason: "args",
    });
    expect(parseCommand(".auto 2 run now")).toEqual({
      kind: "invalid",
      name: "auto",
      reason: "args",
    });
    expect(parseCommand(".info @2")).toEqual({
      kind: "invalid",
      name: "info",
      reason: "args",
    });
    expect(parseCommand(".n @")).toEqual({
      kind: "invalid",
      name: "new",
      reason: "args",
    });
  });

  it("reads a name after a [ref] command as the tail", () => {
    expect(parseCommand(".use 修 登录")).toEqual(
      cmd("use", { tail: "修 登录" }),
    );
    expect(parseCommand(".u 9")).toEqual(cmd("use", { args: ["9"] }));
    expect(parseCommand(".del 2")).toEqual(cmd("delete", { args: ["2"] }));
    expect(parseCommand(".del 旧的调研")).toEqual(
      cmd("delete", { tail: "旧的调研" }),
    );
  });

  it("keeps line breaks and trims a tail at both ends only", () => {
    expect(parseCommand(".q\n  第一行\n\n第二行  ")).toEqual(
      cmd("queue", { tail: "第一行\n\n第二行" }),
    );
  });
});

describe("splitAskPrefix", () => {
  const known = new Set([12, 13]);
  it("takes a known two-digit number", () => {
    expect(splitAskPrefix("12 别删 build", known)).toEqual({
      ask: 12,
      text: "别删 build",
    });
    expect(splitAskPrefix("１３", known)).toEqual({ ask: 13, text: "" });
  });
  it("keeps everything as text otherwise", () => {
    expect(splitAskPrefix("30 秒太短了", known)).toEqual({
      text: "30 秒太短了",
    });
    expect(splitAskPrefix("1 2", known)).toEqual({ text: "1 2" });
    expect(splitAskPrefix("123 x", new Set([12]))).toEqual({ text: "123 x" });
    expect(splitAskPrefix(undefined, known)).toEqual({ text: "" });
  });
});

function card(
  ...questions: { multi?: boolean; options?: number }[]
): AskUserQuestionParams {
  return {
    questions: questions.map((question, index) => ({
      question: `Q${index + 1}?`,
      header: `H${index + 1}`,
      multiSelect: question.multi ?? false,
      options: Array.from({ length: question.options ?? 4 }, (_, option) => ({
        label: `option ${option + 1}`,
        description: "",
      })),
    })),
  };
}

describe("parseAnswers", () => {
  it("maps 1-based options to 0-based indexes in question order", () => {
    expect(
      parseAnswers("2; 1,3; 自定义", card({}, { multi: true }, {})),
    ).toEqual({
      ok: true,
      submission: {
        cancelled: false,
        answers: [
          { questionIndex: 0, selectedOptionIndexes: [1] },
          { questionIndex: 1, selectedOptionIndexes: [0, 2] },
          {
            questionIndex: 2,
            selectedOptionIndexes: [],
            customAnswer: "自定义",
          },
        ],
      },
    });
  });

  it("accepts ；, line breaks, full-width digits and Chinese commas", () => {
    const result = parseAnswers(
      "２；1，3\n1、2",
      card({}, { multi: true }, { multi: true }),
    );
    expect(
      result.ok &&
        result.submission.answers.map((answer) => answer.selectedOptionIndexes),
    ).toEqual([[1], [0, 2], [0, 1]]);
  });

  it("reads a leading = as literal text", () => {
    expect(parseAnswers("=2", card({}))).toEqual({
      ok: true,
      submission: {
        cancelled: false,
        answers: [
          { questionIndex: 0, selectedOptionIndexes: [], customAnswer: "2" },
        ],
      },
    });
    expect(parseAnswers("=", card({}))).toMatchObject({
      ok: false,
      reason: "empty",
      question: 0,
    });
  });

  it("never splits a one-question card", () => {
    expect(parseAnswers("用 a; 再用 b\n最后 c", card({}))).toEqual({
      ok: true,
      submission: {
        cancelled: false,
        answers: [
          {
            questionIndex: 0,
            selectedOptionIndexes: [],
            customAnswer: "用 a; 再用 b\n最后 c",
          },
        ],
      },
    });
  });

  it("refuses a count mismatch", () => {
    expect(parseAnswers("2", card({}, {}))).toEqual({
      ok: false,
      reason: "count",
      expected: 2,
    });
    expect(parseAnswers("1; 2; 3", card({}, {}))).toEqual({
      ok: false,
      reason: "count",
      expected: 2,
    });
    expect(parseAnswers("", card({}))).toMatchObject({
      ok: false,
      reason: "empty",
    });
  });

  it("refuses several numbers on a single-select question", () => {
    expect(parseAnswers("1,2; 1", card({}, {}))).toEqual({
      ok: false,
      reason: "multi",
      expected: 2,
      question: 0,
    });
  });

  it("refuses an option the question does not have", () => {
    expect(parseAnswers("3", card({ options: 2 }))).toEqual({
      ok: false,
      reason: "range",
      expected: 1,
      question: 0,
    });
  });

  it("treats numbers outside 1-4 as free text", () => {
    expect(parseAnswers("5", card({}))).toMatchObject({
      ok: true,
      submission: { answers: [{ customAnswer: "5" }] },
    });
  });
});

describe("resolveRef", () => {
  const rows = [
    { id: "1", label: "Fix login" },
    { id: "2", label: "Fix login page" },
    { id: "3", label: "调研 Pine" },
    { id: "4", label: "Release notes" },
  ];
  it("prefers an exact match", () => {
    expect(resolveRef(rows, "fix LOGIN")).toEqual({
      kind: "one",
      row: rows[0],
    });
  });
  it("takes a unique prefix, then a unique substring", () => {
    expect(resolveRef(rows, "rel")).toEqual({ kind: "one", row: rows[3] });
    expect(resolveRef(rows, "ｐｉｎｅ")).toEqual({ kind: "one", row: rows[2] });
  });
  it("lists several matches and reports none", () => {
    expect(resolveRef(rows, "fix")).toEqual({
      kind: "many",
      rows: [rows[0], rows[1]],
    });
    expect(resolveRef(rows, "notes")).toEqual({ kind: "one", row: rows[3] });
    expect(resolveRef(rows, "e")).toEqual({
      kind: "many",
      rows: [rows[1], rows[2], rows[3]],
    });
    expect(resolveRef(rows, "zzz")).toEqual({ kind: "none" });
    expect(resolveRef(rows, "  ")).toEqual({ kind: "none" });
  });
});
