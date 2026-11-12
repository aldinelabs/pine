import type { AssistantMessageEvent } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";
import {
  AssistantMessageUpdateCompactor,
  coalesceAssistantMessageUpdates,
  MAX_STREAMED_TOOL_PREVIEW_CHARS,
} from "../messageStream";

describe("assistant message stream transport", () => {
  it("strips the cumulative message snapshot from text deltas", () => {
    const event = {
      type: "text_delta",
      contentIndex: 0,
      delta: "world",
      partial: {
        role: "assistant",
        content: [{ type: "text", text: "hello world" }],
      },
    } as AssistantMessageEvent;

    expect(new AssistantMessageUpdateCompactor().compact(event)).toEqual({
      type: "text-delta",
      contentIndex: 0,
      delta: "world",
    });
  });

  it("keeps only the active tool argument snapshot", () => {
    const event = {
      type: "toolcall_start",
      contentIndex: 1,
      partial: {
        role: "assistant",
        content: [
          { type: "text", text: "a very long prefix" },
          {
            type: "toolCall",
            id: "call-1",
            name: "read",
            arguments: { path: "/project/file.ts" },
          },
        ],
      },
    } as AssistantMessageEvent;

    expect(new AssistantMessageUpdateCompactor().compact(event)).toEqual({
      type: "tool-call-start",
      contentIndex: 1,
      id: "call-1",
      name: "read",
      input: { path: "/project/file.ts" },
    });
  });

  it("forwards tool arguments as append-only deltas", () => {
    const event = {
      type: "toolcall_delta",
      contentIndex: 1,
      delta: '"command":"bun run check"',
      partial: {
        role: "assistant",
        content: [
          { type: "text", text: "a very long prefix" },
          {
            type: "toolCall",
            id: "call-1",
            name: "bash",
            arguments: { command: "bun run check" },
          },
        ],
      },
    } as AssistantMessageEvent;

    expect(new AssistantMessageUpdateCompactor().compact(event)).toEqual({
      type: "tool-call-delta",
      contentIndex: 1,
      delta: '"command":"bun run check"',
    });
  });

  it("adds a parsed live preview to bounded tool argument batches", () => {
    const compactor = new AssistantMessageUpdateCompactor();
    const partial = {
      role: "assistant",
      content: [
        { type: "toolCall", id: "call-1", name: "bash", arguments: {} },
      ],
    };
    const start = compactor.compact({
      type: "toolcall_start",
      contentIndex: 0,
      partial,
    } as AssistantMessageEvent);
    const delta = compactor.compact({
      type: "toolcall_delta",
      contentIndex: 0,
      delta: '{"command":"bun run',
      partial,
    } as AssistantMessageEvent);

    expect(
      compactor.addToolInputPreviews(
        [start, delta].filter((update) => update !== undefined),
      ),
    ).toEqual([
      {
        type: "tool-call-start",
        contentIndex: 0,
        id: "call-1",
        name: "bash",
        input: {},
      },
      {
        type: "tool-call-delta",
        contentIndex: 0,
        input: { command: "bun run" },
      },
    ]);
  });

  it("stops live tool parsing when the bounded preview limit is exceeded", () => {
    const compactor = new AssistantMessageUpdateCompactor();
    const update = {
      type: "tool-call-delta" as const,
      contentIndex: 0,
      delta: "x".repeat(MAX_STREAMED_TOOL_PREVIEW_CHARS + 1),
    };
    const end = {
      type: "tool-call-end" as const,
      contentIndex: 0,
      id: "call-1",
      name: "write",
    };

    // A delta with nothing to preview is not sent; the end still is.
    expect(compactor.addToolInputPreviews([update, end])).toEqual([end]);
  });

  it("drops argument deltas whose preview contradicts the start input", () => {
    const compactor = new AssistantMessageUpdateCompactor();
    const partial = {
      role: "assistant",
      content: [
        {
          type: "toolCall",
          id: "call-1",
          name: "bash",
          arguments: { command: "ls" },
        },
      ],
    };
    const start = compactor.compact({
      type: "toolcall_start",
      contentIndex: 0,
      partial,
    } as unknown as AssistantMessageEvent);
    const delta = compactor.compact({
      type: "toolcall_delta",
      contentIndex: 0,
      delta: '{"other":1',
      partial,
    } as unknown as AssistantMessageEvent);

    const updates = compactor.addToolInputPreviews(
      [start, delta].filter((update) => update !== undefined),
    );
    expect(updates.map((update) => update.type)).toEqual(["tool-call-start"]);
  });

  it("does not replay text already visible through a shared start partial", () => {
    const compactor = new AssistantMessageUpdateCompactor();
    const partial = {
      role: "assistant",
      content: [{ type: "text", text: "Hello" }],
    };

    expect(
      compactor.compact({
        type: "text_start",
        contentIndex: 0,
        partial,
      } as AssistantMessageEvent),
    ).toEqual({ type: "text-start", contentIndex: 0, text: "Hello" });
    expect(
      compactor.compact({
        type: "text_delta",
        contentIndex: 0,
        delta: "Hel",
        partial,
      } as AssistantMessageEvent),
    ).toBeUndefined();
    expect(
      compactor.compact({
        type: "text_delta",
        contentIndex: 0,
        delta: "lo!",
        partial,
      } as AssistantMessageEvent),
    ).toEqual({ type: "text-delta", contentIndex: 0, delta: "!" });
  });

  it("does not replay thinking already visible through a shared start partial", () => {
    const compactor = new AssistantMessageUpdateCompactor();
    const partial = {
      role: "assistant",
      content: [{ type: "thinking", thinking: "Plan" }],
    };

    expect(
      compactor.compact({
        type: "thinking_start",
        contentIndex: 0,
        partial,
      } as AssistantMessageEvent),
    ).toEqual({
      type: "thinking-start",
      contentIndex: 0,
      thinking: "Plan",
    });
    expect(
      compactor.compact({
        type: "thinking_delta",
        contentIndex: 0,
        delta: "Plan",
        partial,
      } as AssistantMessageEvent),
    ).toBeUndefined();
    expect(
      compactor.compact({
        type: "thinking_delta",
        contentIndex: 0,
        delta: " ahead",
        partial,
      } as AssistantMessageEvent),
    ).toEqual({
      type: "thinking-delta",
      contentIndex: 0,
      delta: " ahead",
    });
  });

  it("coalesces adjacent deltas without crossing structural boundaries", () => {
    expect(
      coalesceAssistantMessageUpdates([
        { type: "text-delta", contentIndex: 0, delta: "a" },
        { type: "text-delta", contentIndex: 0, delta: "b" },
        { type: "text-end", contentIndex: 0, text: "ab" },
        { type: "thinking-delta", contentIndex: 1, delta: "c" },
        { type: "thinking-delta", contentIndex: 1, delta: "d" },
        { type: "tool-call-delta", contentIndex: 2, delta: '{"path"' },
        { type: "tool-call-delta", contentIndex: 2, delta: ':"x"}' },
      ]),
    ).toEqual([
      { type: "text-delta", contentIndex: 0, delta: "ab" },
      { type: "text-end", contentIndex: 0, text: "ab" },
      { type: "thinking-delta", contentIndex: 1, delta: "cd" },
      { type: "tool-call-delta", contentIndex: 2, delta: '{"path":"x"}' },
    ]);
  });
});
