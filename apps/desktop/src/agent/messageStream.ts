import {
  parseStreamingJson,
  type AssistantMessageEvent,
} from "@earendil-works/pi-ai";
import type {
  PineAssistantMessageUpdate,
  PineJsonValue,
} from "../shared/agent";
import { toPineJsonValue } from "./protocol";

type StreamingAssistantEvent = Exclude<
  AssistantMessageEvent,
  { type: "start" | "done" | "error" }
>;

function contentBlock(
  event: StreamingAssistantEvent,
): Record<string, unknown> | undefined {
  const block = event.partial.content[event.contentIndex];
  return typeof block === "object" && block !== null
    ? (block as unknown as Record<string, unknown>)
    : undefined;
}

function optionalJson(value: unknown): PineJsonValue | undefined {
  return value === undefined ? undefined : toPineJsonValue(value);
}

interface TextBlockCursor {
  kind: "text" | "thinking";
  coveredChars: number;
  deltaChars: number;
}

interface ToolCallCursor {
  disabled: boolean;
  initialInput?: PineJsonValue;
  json: string;
}

export const MAX_STREAMED_TOOL_PREVIEW_CHARS = 64 * 1024;

function isJsonPrefix(
  snapshot: PineJsonValue | undefined,
  current: PineJsonValue | undefined,
): boolean {
  if (snapshot === undefined) return current === undefined;
  if (typeof snapshot === "string") {
    return typeof current === "string" && current.startsWith(snapshot);
  }
  if (Array.isArray(snapshot)) {
    return (
      Array.isArray(current) &&
      snapshot.length <= current.length &&
      snapshot.every((value, index) => isJsonPrefix(value, current[index]))
    );
  }
  if (typeof snapshot !== "object" || snapshot === null) {
    return Object.is(snapshot, current);
  }
  if (
    typeof current !== "object" ||
    current === null ||
    Array.isArray(current)
  ) {
    return false;
  }
  return Object.entries(snapshot).every(
    ([key, value]) =>
      Object.hasOwn(current, key) && isJsonPrefix(value, current[key]),
  );
}

/**
 * Converts one SDK assistant stream into bounded wire updates. The SDK's
 * `partial` object is a shared live accumulator, so a queued `*_start` can
 * already expose characters that are repeated by its subsequent deltas. Keep
 * a per-block cursor and omit that covered prefix exactly once.
 */
export class AssistantMessageUpdateCompactor {
  private readonly blocks = new Map<number, TextBlockCursor>();
  private readonly toolCalls = new Map<number, ToolCallCursor>();

  compact(
    event: AssistantMessageEvent,
  ): PineAssistantMessageUpdate | undefined {
    if (
      event.type === "start" ||
      event.type === "done" ||
      event.type === "error"
    ) {
      return undefined;
    }

    const block = contentBlock(event);
    switch (event.type) {
      case "text_start": {
        const text = typeof block?.text === "string" ? block.text : "";
        this.startBlock(event.contentIndex, "text", text.length);
        return {
          type: "text-start",
          contentIndex: event.contentIndex,
          text,
        };
      }
      case "text_delta": {
        const delta = this.uncoveredDelta(
          event.contentIndex,
          "text",
          event.delta,
        );
        return delta
          ? { type: "text-delta", contentIndex: event.contentIndex, delta }
          : undefined;
      }
      case "text_end":
        this.blocks.delete(event.contentIndex);
        return {
          type: "text-end",
          contentIndex: event.contentIndex,
          text: event.content,
        };
      case "thinking_start": {
        const thinking =
          typeof block?.thinking === "string" ? block.thinking : "";
        this.startBlock(event.contentIndex, "thinking", thinking.length);
        return {
          type: "thinking-start",
          contentIndex: event.contentIndex,
          thinking,
        };
      }
      case "thinking_delta": {
        const delta = this.uncoveredDelta(
          event.contentIndex,
          "thinking",
          event.delta,
        );
        return delta
          ? { type: "thinking-delta", contentIndex: event.contentIndex, delta }
          : undefined;
      }
      case "thinking_end":
        this.blocks.delete(event.contentIndex);
        return {
          type: "thinking-end",
          contentIndex: event.contentIndex,
          thinking: event.content,
        };
      case "toolcall_start":
        if (
          block?.type !== "toolCall" ||
          typeof block.id !== "string" ||
          typeof block.name !== "string"
        ) {
          return undefined;
        }
        {
          const input = optionalJson(block.arguments);
          this.toolCalls.set(event.contentIndex, {
            disabled: false,
            ...(input === undefined ? {} : { initialInput: input }),
            json: "",
          });
          return {
            type: "tool-call-start",
            contentIndex: event.contentIndex,
            id: block.id,
            name: block.name,
            ...(input === undefined ? {} : { input }),
          };
        }
      case "toolcall_delta":
        return {
          type: "tool-call-delta",
          contentIndex: event.contentIndex,
          delta: event.delta,
        };
      case "toolcall_end":
        return {
          type: "tool-call-end",
          contentIndex: event.contentIndex,
          id: event.toolCall.id,
          name: event.toolCall.name,
          ...(event.toolCall.arguments === undefined
            ? {}
            : { input: optionalJson(event.toolCall.arguments) }),
        };
    }
  }

  /**
   * Parse tool arguments once per transport batch, capped so large write/patch
   * payloads cannot restore the former quadratic streaming cost. The result is
   * what goes on the wire: argument deltas carry only the parsed `input`
   * (consumers never read the raw JSON), and a delta with no preview to show
   * is dropped.
   */
  addToolInputPreviews(
    updates: readonly PineAssistantMessageUpdate[],
  ): PineAssistantMessageUpdate[] {
    const result: PineAssistantMessageUpdate[] = [];
    for (const update of updates) {
      if (update.type === "tool-call-end") {
        this.toolCalls.delete(update.contentIndex);
        result.push(update);
        continue;
      }
      if (update.type !== "tool-call-delta") {
        result.push(update);
        continue;
      }
      const input = this.toolInputPreview(update.contentIndex, update.delta);
      if (input !== undefined) {
        result.push({
          type: "tool-call-delta",
          contentIndex: update.contentIndex,
          input,
        });
      }
    }
    return result;
  }

  private toolInputPreview(
    contentIndex: number,
    delta: string | undefined,
  ): PineJsonValue | undefined {
    const cursor = this.toolCalls.get(contentIndex) ?? {
      disabled: false,
      json: "",
    };
    this.toolCalls.set(contentIndex, cursor);
    if (cursor.disabled) return undefined;

    cursor.json += delta ?? "";
    if (cursor.json.length > MAX_STREAMED_TOOL_PREVIEW_CHARS) {
      cursor.disabled = true;
      cursor.json = "";
      return undefined;
    }

    const input = toPineJsonValue(parseStreamingJson(cursor.json));
    if (
      cursor.initialInput !== undefined &&
      !isJsonPrefix(cursor.initialInput, input)
    ) {
      return undefined;
    }
    cursor.initialInput = undefined;
    return input;
  }

  private startBlock(
    contentIndex: number,
    kind: TextBlockCursor["kind"],
    coveredChars: number,
  ): void {
    this.blocks.set(contentIndex, { kind, coveredChars, deltaChars: 0 });
  }

  private uncoveredDelta(
    contentIndex: number,
    kind: TextBlockCursor["kind"],
    delta: string,
  ): string {
    const cursor = this.blocks.get(contentIndex);
    if (!cursor || cursor.kind !== kind) return delta;
    const deltaStart = cursor.deltaChars;
    cursor.deltaChars += delta.length;
    const covered = Math.max(0, cursor.coveredChars - deltaStart);
    return covered >= delta.length ? "" : delta.slice(covered);
  }
}

/** Merge only adjacent textual deltas. Structural boundaries remain ordered. */
export function coalesceAssistantMessageUpdates(
  updates: readonly PineAssistantMessageUpdate[],
): PineAssistantMessageUpdate[] {
  const result: PineAssistantMessageUpdate[] = [];
  for (const update of updates) {
    const previous = result.at(-1);
    if (
      update.type === "text-delta" &&
      previous?.type === "text-delta" &&
      previous.contentIndex === update.contentIndex
    ) {
      previous.delta += update.delta;
    } else if (
      update.type === "thinking-delta" &&
      previous?.type === "thinking-delta" &&
      previous.contentIndex === update.contentIndex
    ) {
      previous.delta += update.delta;
    } else if (
      update.type === "tool-call-delta" &&
      previous?.type === "tool-call-delta" &&
      previous.contentIndex === update.contentIndex
    ) {
      previous.delta = (previous.delta ?? "") + (update.delta ?? "");
    } else {
      result.push({ ...update });
    }
  }
  return result;
}
