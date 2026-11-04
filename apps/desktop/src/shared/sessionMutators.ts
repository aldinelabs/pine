import type { PineToolCall } from "./sessions";

/**
 * Session mutators change a session's state from outside its conversation:
 * the renderer attaches them to a draft (or an existing session) and the agent
 * worker applies them right before the next prompt. They are declarative and
 * serializable so they cross the renderer → main → worker boundary unchanged.
 */

/** What Pine can help author together with the user. */
export type PineAuthoringTarget = "skill" | "automation" | "mcp";

export const PINE_AUTHORING_TARGETS: readonly PineAuthoringTarget[] = [
  "skill",
  "automation",
  "mcp",
];

export type PineSessionMutator = {
  kind: "activate-authoring";
  target: PineAuthoringTarget;
};

export const ACTIVATE_SKILL_AUTHORING_TOOL_NAME =
  "activate_skill_authoring" as const;
export const ACTIVATE_AUTOMATION_AUTHORING_TOOL_NAME =
  "activate_automation_authoring" as const;
export const ACTIVATE_MCP_AUTHORING_TOOL_NAME =
  "activate_mcp_authoring" as const;

/** The tool the model would call to activate the same authoring tools. */
export const AUTHORING_ACTIVATION_TOOL_NAME: Record<
  PineAuthoringTarget,
  string
> = {
  skill: ACTIVATE_SKILL_AUTHORING_TOOL_NAME,
  automation: ACTIVATE_AUTOMATION_AUTHORING_TOOL_NAME,
  mcp: ACTIVATE_MCP_AUTHORING_TOOL_NAME,
};

/**
 * Custom message a mutator leaves in the conversation. Its content (the
 * authoring instructions) is model context; the transcript shows it as the
 * activation tool's marker.
 */
export const PINE_SESSION_MUTATION_MESSAGE = "pine.session-mutation" as const;

export interface PineSessionMutationDetails {
  mutator: PineSessionMutator;
}

export function isPineSessionMutator(
  value: unknown,
): value is PineSessionMutator {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    record.kind === "activate-authoring" &&
    PINE_AUTHORING_TARGETS.includes(record.target as PineAuthoringTarget)
  );
}

/** The same mutator twice changes nothing; keep the first of each. */
export function uniqueSessionMutators(
  mutators: readonly PineSessionMutator[],
): PineSessionMutator[] {
  const seen = new Set<string>();
  return mutators.filter((mutator) => {
    const key = `${mutator.kind}:${mutator.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The transcript marker for a mutation message: the activation tool call it
 * stands in for. `undefined` for any other message.
 */
export function sessionMutationToolCall(
  message: unknown,
  id: string,
): PineToolCall | undefined {
  if (typeof message !== "object" || message === null) return undefined;
  const record = message as Record<string, unknown>;
  if (record.customType !== PINE_SESSION_MUTATION_MESSAGE) return undefined;
  const details = record.details as { mutator?: unknown } | undefined;
  const mutator = details?.mutator;
  if (!isPineSessionMutator(mutator)) return undefined;
  const content =
    typeof record.content === "string"
      ? record.content
      : Array.isArray(record.content)
        ? record.content
            .map((part: unknown) =>
              typeof part === "object" &&
              part !== null &&
              typeof (part as { text?: unknown }).text === "string"
                ? (part as { text: string }).text
                : "",
            )
            .join("\n")
        : "";
  return {
    id: `mutation-${id}-${mutator.target}`,
    name: AUTHORING_ACTIVATION_TOOL_NAME[mutator.target],
    status: "complete",
    input: {},
    output: {
      content: [{ type: "text", text: content }],
      details: { preactivated: true, mutator },
    },
  };
}
