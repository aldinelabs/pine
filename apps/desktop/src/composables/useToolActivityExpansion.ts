import { computed, type ComputedRef, type Ref } from "vue";
import type { PineContentBlock } from "@/shared/sessions";
import type { PineTranscriptMessage } from "@/stores/session";

/**
 * Ordered keys of every tool-activity unit in the transcript. Consecutive
 * tool calls form one unit; a single ("落单") call counts as its own unit,
 * exactly like a folded group.
 */
export function toolRunKeys(
  messages: readonly PineTranscriptMessage[],
): string[] {
  const keys: string[] = [];
  for (const message of messages) {
    const blocks: readonly PineContentBlock[] = message.blocks;
    let index = 0;
    while (index < blocks.length) {
      const block = blocks[index];
      if (block?.type !== "toolCall") {
        index++;
        continue;
      }
      const key = `${message.id}:${block.toolCall.id}`;
      keys.push(key);
      while (index < blocks.length && blocks[index]?.type === "toolCall") {
        index++;
      }
    }
  }
  return keys;
}

/**
 * The run keys of one message, newest first. Messages are immutable records
 * replaced on every change, so the keys are cached by record: a streaming
 * flush only reads the message it replaced.
 */
const messageRunKeys = new WeakMap<PineTranscriptMessage, readonly string[]>();

function runKeysOf(message: PineTranscriptMessage): readonly string[] {
  const cached = messageRunKeys.get(message);
  if (cached) return cached;
  const keys = toolRunKeys([message]).reverse();
  messageRunKeys.set(message, keys);
  return keys;
}

function latestToolRunKeys(
  messages: readonly PineTranscriptMessage[],
  limit: number,
): string[] {
  const keys: string[] = [];
  for (
    let messageIndex = messages.length - 1;
    messageIndex >= 0 && keys.length < limit;
    messageIndex--
  ) {
    for (const key of runKeysOf(messages[messageIndex])) {
      if (keys.length >= limit) break;
      keys.push(key);
    }
  }
  return keys.reverse();
}

/**
 * Transcript-level expansion policy for tool runs: while a response is
 * active, its last two tool units stay expanded (a standalone call counts
 * as a unit and is visible either way — it only reserves a window slot).
 * Older units collapse as newer ones arrive, and when the response finally
 * ends without another tool call the set empties so everything folds up.
 * Static history (no active response) stays fully collapsed unless the
 * reader toggles a run open manually.
 */
export function useToolActivityExpansion(options: {
  /** The messages the transcript renders; only those can show a run. */
  messages: Ref<readonly PineTranscriptMessage[]>;
  isRunning: Ref<boolean>;
}): ComputedRef<Set<string>> {
  // Static history never expands, so it is not scanned (or tracked) at all.
  const keys = computed(() =>
    options.isRunning.value ? latestToolRunKeys(options.messages.value, 2) : [],
  );
  return computed((previous) => {
    const nextKeys = keys.value;
    if (
      previous &&
      previous.size === nextKeys.length &&
      nextKeys.every((key) => previous.has(key))
    ) {
      return previous;
    }
    return new Set(nextKeys);
  });
}
