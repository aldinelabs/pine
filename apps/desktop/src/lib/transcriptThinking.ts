import type { PineAssistantMessageUpdate } from "@/shared/agent";
import type { PineContentBlock } from "@/shared/sessions";

/** Renderer-only timing for one SDK thinking block, keyed by contentIndex. */
export interface ThinkingBlockState {
  status: "streaming" | "complete";
  startedAt: number;
  durationMs?: number;
}

export function updateThinkingBlocks(
  blocks: readonly PineContentBlock[],
  previous: Readonly<Record<number, ThinkingBlockState>> = {},
  updates: readonly PineAssistantMessageUpdate[],
  now: number,
  ended: boolean,
): Record<number, ThinkingBlockState> {
  const next = { ...previous };
  for (const update of updates) {
    if (
      update.type !== "thinking-start" &&
      update.type !== "thinking-delta" &&
      update.type !== "thinking-end"
    ) {
      continue;
    }
    const startedAt = next[update.contentIndex]?.startedAt ?? now;
    next[update.contentIndex] =
      update.type === "thinking-end"
        ? {
            status: "complete",
            startedAt,
            durationMs: Math.max(0, now - startedAt),
          }
        : { status: "streaming", startedAt };
  }

  return Object.fromEntries(
    blocks.flatMap((block, index) => {
      if (block.type !== "thinking") return [];
      const state = next[index] ?? { status: "streaming", startedAt: now };
      return [
        [
          index,
          ended && state.status === "streaming"
            ? {
                ...state,
                status: "complete",
                durationMs: Math.max(0, now - state.startedAt),
              }
            : state,
        ],
      ];
    }),
  );
}

interface ThinkingSummary {
  thinkingStatus?: "streaming" | "complete";
  thinkingStartedAt?: number;
  thinkingDurationMs?: number;
}

/** Summarize a message or one contiguous thinking run, not unrelated runs. */
export function summarizeThinking(
  states: readonly ThinkingBlockState[],
): ThinkingSummary {
  if (states.length === 0) return {};
  const active = states.filter((state) => state.status === "streaming");
  const durationMs = states.reduce(
    (total, state) => total + (state.durationMs ?? 0),
    0,
  );
  return {
    thinkingStatus:
      active.length > 0 ? ("streaming" as const) : ("complete" as const),
    // Carry completed work forward without counting gaps between blocks.
    thinkingStartedAt:
      active.length > 0
        ? Math.min(...active.map((state) => state.startedAt)) - durationMs
        : Math.min(...states.map((state) => state.startedAt)),
    ...(active.length === 0 ? { thinkingDurationMs: durationMs } : {}),
  };
}
