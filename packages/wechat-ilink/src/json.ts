// Ported from @tencent-weixin/openclaw-weixin 2.4.10 (MIT),
// Copyright (C) 2026 Tencent. See LICENSE-openclaw-weixin.

import { IlinkResponseError } from "./errors";

const LOSSLESS_ID_FIELDS = new Set(["message_id", "msg_id", "svr_id"]);

const WHITESPACE = /\s/;
const DIGIT = /\d/;

/**
 * Parses an iLink response. Message ids are 64-bit integers on the wire and
 * lose their last digits as JavaScript numbers, so the integer value of
 * `message_id`, `msg_id` and `svr_id` is turned into a string before
 * `JSON.parse` sees it. Only property values are touched, never the inside
 * of a string.
 *
 * Text that is not JSON throws an `IlinkResponseError`. The parser's own
 * message is dropped because it quotes the text, which can hold a token.
 */
export function parseIlinkJson(text: string): unknown {
  let output = "";
  let index = 0;
  while (index < text.length) {
    if (text[index] !== '"') {
      output += text[index++];
      continue;
    }

    const stringStart = index;
    index++;
    let escaped = false;
    while (index < text.length) {
      const char = text[index++];
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        break;
      }
    }
    const stringToken = text.slice(stringStart, index);
    output += stringToken;

    // A string followed by a colon is a property name.
    let cursor = index;
    while (WHITESPACE.test(text[cursor] ?? "")) cursor++;
    if (text[cursor] !== ":") continue;

    let key: unknown;
    try {
      key = JSON.parse(stringToken);
    } catch {
      continue;
    }
    if (typeof key !== "string" || !LOSSLESS_ID_FIELDS.has(key)) continue;

    output += text.slice(index, cursor + 1);
    cursor++;
    while (WHITESPACE.test(text[cursor] ?? "")) {
      output += text[cursor++];
    }
    const numberStart = cursor;
    if (text[cursor] === "-") cursor++;
    const digitsStart = cursor;
    while (DIGIT.test(text[cursor] ?? "")) cursor++;
    // Quote integers only. A fraction or an exponent is left to JSON.parse.
    const isInteger = cursor > digitsStart && !/[.eE]/.test(text[cursor] ?? "");
    if (isInteger) {
      output += `"${text.slice(numberStart, cursor)}"`;
      index = cursor;
    } else {
      index = numberStart;
    }
  }
  try {
    return JSON.parse(output) as unknown;
  } catch {
    throw new IlinkResponseError("The answer is not valid JSON.");
  }
}
