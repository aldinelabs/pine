import type { PineContentBlock } from "@/shared/sessions";
import type { PineTranscriptMessage } from "@/stores/session";

/**
 * When the model skips thinking and starts a turn directly with a tool call,
 * the turn reads as a continuation of the previous assistant turn, so the
 * transcript tightens the inter-turn gap down to the in-turn tool spacing
 * rhythm instead of the full message gap.
 */
export function collapsesTranscriptGap(
  messages: readonly Pick<PineTranscriptMessage, "role" | "blocks">[],
  index: number,
): boolean {
  const message = messages[index];
  if (message?.role !== "assistant") return false;
  const firstBlock: PineContentBlock | undefined = message.blocks[0];
  if (firstBlock?.type !== "toolCall") return false;
  return messages[index - 1]?.role === "assistant";
}

export interface TranscriptRenderState {
  expandedToolRuns: ReadonlySet<string>;
  reviewingToolCallIds: ReadonlySet<string>;
  awaitingApprovalToolCallIds: ReadonlySet<string>;
  isRunning: boolean;
  hasRewriteHandler: boolean;
}

/**
 * The slice of transcript-wide render state one message actually reads,
 * flattened to a string for `v-memo`. Expansion, review, and approval sets are
 * replaced wholesale whenever any tool call changes; memoizing on the sets
 * themselves re-rendered every message of a long transcript on each auto
 * expand/collapse. A message whose own tool calls keep the same membership
 * renders identically from the previous sets, so it can skip the update.
 */
export function transcriptMessageRenderSignature(
  message: Pick<PineTranscriptMessage, "id" | "role" | "blocks">,
  state: TranscriptRenderState,
): string {
  // Only the user-message editor reads the running state and rewrite hook.
  if (message.role === "user")
    return `${state.isRunning ? "running" : "idle"}:${state.hasRewriteHandler ? "rewrite" : ""}`;
  let signature = "";
  let previousWasToolCall = false;
  for (const block of message.blocks) {
    if (block.type !== "toolCall") {
      previousWasToolCall = false;
      continue;
    }
    const id = block.toolCall.id;
    // Runs are keyed by their first call (see useToolActivityExpansion).
    if (
      !previousWasToolCall &&
      state.expandedToolRuns.has(`${message.id}:${id}`)
    )
      signature += `e:${id}\n`;
    if (state.reviewingToolCallIds.has(id)) signature += `r:${id}\n`;
    if (state.awaitingApprovalToolCallIds.has(id)) signature += `a:${id}\n`;
    previousWasToolCall = true;
  }
  return signature;
}
