// Dot-command parser. Pure: no I/O.
import type {
  AskUserQuestionParams,
  AskUserQuestionSubmission,
} from "@pine/rpiv-ask-user-question";
import {
  lookupCommand,
  specOf,
  suggestCommand,
  zhAliasPrefix,
} from "./commandSpec";
import type { CommandName, Parsed, ParsedCommand } from "./types";

const PREFIXES = new Set([".", "。", "．", "｡"]);

function isWs(char: string | undefined): boolean {
  return (
    char === " " ||
    char === "\t" ||
    char === "　" ||
    char === "\n" ||
    char === "\r"
  );
}

/**
 * Zero-width characters are removed, except a zero-width
 * joiner inside an emoji sequence, so emoji in a prompt stay intact.
 */
const ZERO_WIDTH =
  /[​‌﻿]|(?<!\p{Extended_Pictographic}[\u{1f3fb}-\u{1f3ff}️]?)‍|‍(?!\p{Extended_Pictographic})/gu;

export function stripZeroWidth(text: string): string {
  return text.replace(ZERO_WIDTH, "");
}

function normalizeToken(token: string): string {
  return token
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[，、]/gu, ",");
}

function normalizeArg(arg: string): string {
  return arg.normalize("NFKC").toLowerCase();
}

const NUMBER_TOKEN = /^\d+(?:,\d+)*$/;
const GLUED_TOKEN = /^(.+?)(\d+(?:,\d+)*)$/u;
const ASCII_NAME = /^[a-z][a-z0-9]{0,15}$/;
const CJK_NAME = /^[一-鿿]{1,4}$/u;

/**
 * Classifies one user-typed TEXT item. The rules apply in order; the first
 * match wins.
 *
 * - `unknown.suggestion` has no leading dot (`status`, `停止`, `n 2`).
 * - A bare number followed by more text (`.3 个文件`) is `unknown` with no
 *   suggestion: it is neither sent to the agent nor read as a number.
 */
export function parseCommand(input: string): Parsed {
  const text = stripZeroWidth(input).trim();
  const head = text[0];
  // Rule 1.
  if (head === undefined || !PREFIXES.has(head))
    return { kind: "message", text };
  // Rule 2.
  if (text.length === 1) return command("status");
  let prefixes = 0;
  while (prefixes < text.length && PREFIXES.has(text[prefixes] ?? ""))
    prefixes += 1;
  // Rule 3.
  if (prefixes >= 3) return { kind: "message", text };
  // Rule 4.
  if (prefixes === 2 && text.length > 2)
    return { kind: "message", text: text.slice(1) };
  // Rule 5.
  if (isWs(text[1])) return { kind: "message", text };

  const body = text.slice(1);
  let split = 0;
  while (split < body.length && !isWs(body[split])) split += 1;
  const rawToken = body.slice(0, split);
  const rest = body.slice(split);
  const token = normalizeToken(rawToken);

  // Rule 6.
  if (token === "?") return withParams("help", rest);
  // Rule 7.
  if (NUMBER_TOKEN.test(token)) {
    if (rest.trim().length > 0) return { kind: "unknown", token };
    return {
      kind: "number",
      numbers: token.split(",").map((part) => Number(part)),
    };
  }
  // Rule 8.
  const known = lookupCommand(token);
  if (known) return withParams(known, rest);
  // Rule 9.
  const glued = GLUED_TOKEN.exec(token);
  if (glued) {
    const [, namePart = "", digits = ""] = glued;
    const name = lookupCommand(namePart);
    if (name) {
      if (specOf(name).glued) return withGlued(name, digits, rest);
      return { kind: "unknown", token, suggestion: `${namePart} ${digits}` };
    }
  }
  // Rule 10. The tail is taken from the raw token: NFKC never touches a tail.
  const zh = zhAliasPrefix(rawToken);
  if (zh) {
    const spec = specOf(zh.name);
    if (spec.tail && spec.cls !== "D") {
      const tail = (zh.rest + rest).trim();
      return command(zh.name, { tail: tail.length > 0 ? tail : undefined });
    }
    return { kind: "unknown", token, suggestion: zh.alias };
  }
  // Rule 11.
  if (ASCII_NAME.test(token) || CJK_NAME.test(token)) {
    const suggestion = suggestCommand(token);
    return suggestion
      ? { kind: "unknown", token, suggestion }
      : { kind: "unknown", token };
  }
  // Rule 12.
  return { kind: "message", text };
}

function command(
  name: CommandName,
  options: { project?: string; args?: string[]; tail?: string } = {},
): ParsedCommand {
  const parsed: ParsedCommand = {
    kind: "command",
    name,
    args: options.args ?? [],
  };
  if (options.project !== undefined) parsed.project = options.project;
  if (options.tail !== undefined) parsed.tail = options.tail;
  return parsed;
}

function invalid(name: CommandName): Parsed {
  return { kind: "invalid", name, reason: "args" };
}

interface Token {
  value: string;
  end: number;
}

/** One parameter starting at `start`: `"…"`, `“…”`, or a run of non-whitespace. */
function readToken(source: string, start: number): Token {
  const open = source[start];
  const close = open === '"' ? '"' : open === "“" ? "”" : undefined;
  let value = "";
  let index = start;
  if (close) {
    const end = source.indexOf(close, start + 1);
    if (end >= 0) {
      value = source.slice(start + 1, end);
      index = end + 1;
    }
  }
  while (index < source.length && !isWs(source[index])) {
    value += source[index] ?? "";
    index += 1;
  }
  return { value, end: index };
}

function readTokens(source: string): string[] {
  const tokens: string[] = [];
  let index = 0;
  while (index < source.length) {
    if (isWs(source[index])) {
      index += 1;
      continue;
    }
    const token = readToken(source, index);
    tokens.push(token.value);
    index = token.end;
  }
  return tokens;
}

function isDigitToken(source: string): boolean {
  return /^\d+$/.test(source.normalize("NFKC"));
}

function withParams(name: CommandName, rest: string): Parsed {
  const spec = specOf(name);
  let remainder = rest.trim();
  let project: string | undefined;
  if (
    spec.project &&
    (remainder.startsWith("@") || remainder.startsWith("＠"))
  ) {
    const token = readToken(remainder, 1);
    if (token.value.length === 0) return invalid(name);
    const numeric = token.value.normalize("NFKC");
    project = /^\d+$/.test(numeric) ? numeric : token.value;
    remainder = remainder.slice(token.end).trim();
  }
  if (spec.tail) {
    // `[ref]` commands: one number is a handle, anything else is a name.
    if (spec.positional.length > 0 && isDigitToken(remainder)) {
      return command(name, { project, args: [remainder.normalize("NFKC")] });
    }
    return command(name, {
      project,
      tail: remainder.length > 0 ? remainder : undefined,
    });
  }
  const args = readTokens(remainder).map(normalizeArg);
  if (args.length > spec.positional.length) return invalid(name);
  return command(name, { project, args });
}

function withGlued(name: CommandName, digits: string, rest: string): Parsed {
  const spec = specOf(name);
  const remainder = rest.trim();
  if (spec.tail && spec.positional.length === 0) {
    // `.d12 text`, `.a13 2; 1`: the ask number leads the tail.
    return command(name, {
      tail: remainder.length > 0 ? `${digits} ${remainder}` : digits,
    });
  }
  if (spec.tail) {
    return remainder.length > 0
      ? invalid(name)
      : command(name, { args: [digits] });
  }
  const args = [digits, ...readTokens(remainder).map(normalizeArg)];
  if (args.length > spec.positional.length) return invalid(name);
  return command(name, { args });
}

/**
 * The first token of a tail is an ask number only when it is two
 * digits (after NFKC) and in `known` (open or tombstoned asks).
 */
export function splitAskPrefix(
  tail: string | undefined,
  known: ReadonlySet<number>,
): { ask?: number; text: string } {
  const source = (tail ?? "").trim();
  let split = 0;
  while (split < source.length && !isWs(source[split])) split += 1;
  const first = source.slice(0, split).normalize("NFKC");
  if (/^\d{2}$/.test(first) && known.has(Number(first))) {
    return { ask: Number(first), text: source.slice(split).trim() };
  }
  return { text: source };
}

export type AnswerParseError = "count" | "empty" | "range" | "multi";
export type AnswerParse =
  | { ok: true; submission: AskUserQuestionSubmission }
  | {
      ok: false;
      reason: AnswerParseError;
      /** Questions on the card. */
      expected: number;
      /** 0-based question the error is about; absent for `count`. */
      question?: number;
    };

const OPTION_ANSWER = /^[1-4](?:\s*[,\s]\s*[1-4])*$/;

/**
 * Answers are split on `;`, `；` or a line break, in question order;
 * a card with one question is never split. `1-4` select options (1-based on
 * WeChat, 0-based in the submission); `=` forces free text.
 */
export function parseAnswers(
  tail: string | undefined,
  questionnaire: AskUserQuestionParams,
): AnswerParse {
  const questions = questionnaire.questions;
  const expected = questions.length;
  const source = (tail ?? "").replace(/\r\n?/g, "\n").trim();
  const parts =
    expected === 1
      ? [source]
      : source
          .split(/[;；\n]/u)
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
  if (parts.length !== expected)
    return { ok: false, reason: "count", expected };

  const answers: AskUserQuestionSubmission["answers"] = [];
  for (const [index, part] of parts.entries()) {
    const question = questions[index];
    if (!question) return { ok: false, reason: "count", expected };
    const raw = part.trim();
    if (raw.startsWith("=")) {
      const text = raw.slice(1).trim();
      if (text.length === 0)
        return { ok: false, reason: "empty", expected, question: index };
      answers.push({
        questionIndex: index,
        selectedOptionIndexes: [],
        customAnswer: text,
      });
      continue;
    }
    if (raw.length === 0)
      return { ok: false, reason: "empty", expected, question: index };
    const options = raw.normalize("NFKC").replace(/、/gu, ",");
    if (OPTION_ANSWER.test(options)) {
      const picked = [
        ...new Set(options.split(/[,\s]+/).map((value) => Number(value) - 1)),
      ].sort((a, b) => a - b);
      if (picked.some((value) => value >= question.options.length)) {
        return { ok: false, reason: "range", expected, question: index };
      }
      if (picked.length > 1 && question.multiSelect !== true) {
        return { ok: false, reason: "multi", expected, question: index };
      }
      answers.push({ questionIndex: index, selectedOptionIndexes: picked });
      continue;
    }
    answers.push({
      questionIndex: index,
      selectedOptionIndexes: [],
      customAnswer: raw,
    });
  }
  return { ok: true, submission: { answers, cancelled: false } };
}

export type RefMatch<T> =
  { kind: "one"; row: T } | { kind: "many"; rows: T[] } | { kind: "none" };

function foldName(text: string): string {
  return text.normalize("NFKC").toLowerCase().trim();
}

/**
 * A name matched case-insensitively, exact first, then unique
 * prefix, then unique substring. Several matches at the first level that has
 * any → `many` (the caller lists them, nothing is done).
 */
export function resolveRef<T extends { label: string }>(
  rows: readonly T[],
  query: string,
): RefMatch<T> {
  const needle = foldName(query);
  if (needle.length === 0) return { kind: "none" };
  const labelled = rows.map((row) => ({ row, label: foldName(row.label) }));
  const levels = [
    labelled.filter((entry) => entry.label === needle),
    labelled.filter((entry) => entry.label.startsWith(needle)),
    labelled.filter((entry) => entry.label.includes(needle)),
  ];
  for (const level of levels) {
    const [only] = level;
    if (level.length === 1 && only) return { kind: "one", row: only.row };
    if (level.length > 1)
      return { kind: "many", rows: level.map((entry) => entry.row) };
  }
  return { kind: "none" };
}

export type AutoAction = "detail" | "on" | "off" | "run";

const AUTO_ACTIONS: Record<string, AutoAction> = {
  on: "on",
  enable: "on",
  开: "on",
  开启: "on",
  打开: "on",
  off: "off",
  disable: "off",
  关: "off",
  关闭: "off",
  run: "run",
  运行: "run",
  执行: "run",
};

/** The action word of `.auto N [on | off | run]`; none means the details. */
export function autoActionOf(word: string | undefined): AutoAction | undefined {
  if (word === undefined) return "detail";
  return AUTO_ACTIONS[word.normalize("NFKC").toLowerCase()];
}
