import { computed, type ComputedRef } from "vue";
import { artifactsOfCalls, type CallArtifacts } from "@/shared/artifacts";
import { useSessionStore, type PineTranscriptMessage } from "@/stores/session";

/**
 * One message's artifacts. Transcript messages are immutable records, so a
 * streaming update only rescans the message it replaced.
 */
const artifactsByMessage = new WeakMap<PineTranscriptMessage, CallArtifacts>();

export function messageArtifacts(
  message: PineTranscriptMessage,
): CallArtifacts {
  const cached = artifactsByMessage.get(message);
  if (cached) return cached;
  const found = artifactsOfCalls(
    message.blocks.flatMap((block) =>
      block.type === "toolCall" ? [block.toolCall] : [],
    ),
  );
  artifactsByMessage.set(message, found);
  return found;
}

/**
 * How many completed submissions of each path the active session's loaded
 * transcript holds. A new count means the agent submitted the file again.
 */
export function useSubmissionCounts(): ComputedRef<
  ReadonlyMap<string, number>
> {
  const sessionStore = useSessionStore();
  return computed(() => {
    const counts = new Map<string, number>();
    for (const message of sessionStore.messages)
      for (const artifact of messageArtifacts(message).submitted)
        counts.set(artifact.path, (counts.get(artifact.path) ?? 0) + 1);
    return counts;
  });
}
