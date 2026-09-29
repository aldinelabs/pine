import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

export const RECOMMENDED_COMPACTION_CONTEXT_RATIO = 0.8;
export const RECOMMENDED_COMPACTION_HARD_LIMIT = 400_000;

/**
 * Returns the cache hit rate for the latest assistant request in the session.
 * The active assistant message is accepted separately because Pi emits
 * message_end before persisting that message to SessionManager.
 */
export function getLatestCacheHitRate(
  entries: readonly SessionEntry[],
  currentAssistantMessage?: AssistantMessage,
): number | null {
  let latestCacheHitRate: number | undefined;

  for (const entry of entries) {
    if (entry.type !== "message" || entry.message.role !== "assistant") {
      continue;
    }
    latestCacheHitRate = cacheHitRateForMessage(entry.message);
  }

  if (currentAssistantMessage) {
    latestCacheHitRate = cacheHitRateForMessage(currentAssistantMessage);
  }

  return latestCacheHitRate ?? null;
}

function cacheHitRateForMessage(message: AssistantMessage): number | undefined {
  const promptTokens =
    message.usage.input + message.usage.cacheRead + message.usage.cacheWrite;
  return promptTokens > 0
    ? (message.usage.cacheRead / promptTokens) * 100
    : undefined;
}

export function recommendedCompactionReserveTokens(
  contextWindow: number,
): number {
  const triggerTokens = Math.min(
    Math.floor(contextWindow * RECOMMENDED_COMPACTION_CONTEXT_RATIO),
    RECOMMENDED_COMPACTION_HARD_LIMIT,
  );
  return Math.max(0, contextWindow - triggerTokens);
}
