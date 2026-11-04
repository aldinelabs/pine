import {
  ACTIVATE_AUTOMATION_AUTHORING_TOOL_NAME,
  ACTIVATE_MCP_AUTHORING_TOOL_NAME,
  ACTIVATE_SKILL_AUTHORING_TOOL_NAME,
} from "../../shared/sessionMutators";
import { MCP_AUTHORING_DYNAMIC_TOOL_NAMES } from "../../shared/mcp";
import { AUTOMATION_AUTHORING_DYNAMIC_TOOL_NAMES } from "../automation/tools";
import {
  ACTIVATE_COMPUTER_USE_TOOL_NAME,
  COMPUTER_USE_DYNAMIC_TOOL_NAMES,
} from "../computer-use/tools";
import {
  ACTIVATE_MEDIA_GENERATION_TOOL_NAME,
  MEDIA_GENERATION_DYNAMIC_TOOL_NAMES,
} from "../media/tools";
import { SKILL_AUTHORING_DYNAMIC_TOOL_NAMES } from "../skills/tools";

/**
 * Past this many context tokens, a tool-set change that costs the provider's
 * prompt cache is worth a confirmation: the whole context is processed again
 * at full price.
 */
export const LONG_CONTEXT_ACTIVATION_TOKENS = 131_072;

/** The tools each `activate_*` call adds to the session. */
const ACTIVATION_TOOL_GROUPS: Readonly<Record<string, readonly string[]>> = {
  [ACTIVATE_COMPUTER_USE_TOOL_NAME]: COMPUTER_USE_DYNAMIC_TOOL_NAMES,
  [ACTIVATE_SKILL_AUTHORING_TOOL_NAME]: SKILL_AUTHORING_DYNAMIC_TOOL_NAMES,
  [ACTIVATE_AUTOMATION_AUTHORING_TOOL_NAME]:
    AUTOMATION_AUTHORING_DYNAMIC_TOOL_NAMES,
  [ACTIVATE_MCP_AUTHORING_TOOL_NAME]: MCP_AUTHORING_DYNAMIC_TOOL_NAMES,
  [ACTIVATE_MEDIA_GENERATION_TOOL_NAME]: MEDIA_GENERATION_DYNAMIC_TOOL_NAMES,
};

export function isActivationToolName(toolName: string): boolean {
  return Object.hasOwn(ACTIVATION_TOOL_GROUPS, toolName);
}

/** The group's tools that are not active yet; empty when the call changes nothing. */
export function toolsAddedByActivation(
  toolName: string,
  activeToolNames: readonly string[],
): string[] {
  if (!isActivationToolName(toolName)) return [];
  const active = new Set(activeToolNames);
  return ACTIVATION_TOOL_GROUPS[toolName].filter((name) => !active.has(name));
}

interface ModelToolChangeSupport {
  api: string;
  compat?: unknown;
}

function compatFlag(model: ModelToolChangeSupport, key: string): boolean {
  const compat = model.compat;
  if (typeof compat !== "object" || compat === null) return false;
  return (compat as Record<string, unknown>)[key] === true;
}

/**
 * Whether pi-ai sends added tools in place, behind the cached prefix, for this
 * model. Mirrors the transports' own checks: Anthropic needs inline tool
 * changes, Chat Completions needs mid-conversation additions, and the
 * Responses transports need additional tools or tool search. Every other
 * transport rewrites the request's tool list, which drops the cache.
 */
export function modelKeepsCacheOnToolAdditions(
  model: ModelToolChangeSupport,
): boolean {
  const midConversation = compatFlag(model, "supportsMidConvoSystemMessages");
  switch (model.api) {
    case "anthropic-messages":
      return (
        midConversation && compatFlag(model, "supportsMidConvoToolChanges")
      );
    case "openai-completions":
      return (
        midConversation && compatFlag(model, "supportsMidConvoToolAdditions")
      );
    case "openai-responses":
    case "azure-openai-responses":
    case "openai-codex-responses":
      return (
        compatFlag(model, "supportsToolSearch") ||
        (midConversation && compatFlag(model, "supportsAdditionalTools"))
      );
    default:
      return false;
  }
}

export interface LongContextActivationInput {
  toolName: string;
  activeToolNames: readonly string[];
  model: ModelToolChangeSupport | undefined;
  /** The context estimate; unknown right after a compaction. */
  contextTokens: number | null | undefined;
  /** Nobody is there to answer in Autonomous Work, YOLO or an automation run. */
  attended: boolean;
}

/**
 * Whether an activation should wait for the user's choice: it adds tools, the
 * model cannot take them without losing its prompt cache, and the context is
 * long enough for that to matter.
 */
export function shouldConfirmLongContextActivation(
  input: LongContextActivationInput,
): boolean {
  if (!input.attended || !input.model) return false;
  if (input.contextTokens == null) return false;
  if (input.contextTokens < LONG_CONTEXT_ACTIVATION_TOKENS) return false;
  if (modelKeepsCacheOnToolAdditions(input.model)) return false;
  return (
    toolsAddedByActivation(input.toolName, input.activeToolNames).length > 0
  );
}

/** Context size as shown on the approval card, e.g. `187K tokens`. */
export function describeContextTokens(tokens: number): string {
  return `${Math.round(tokens / 1000)}K tokens`;
}

/** Custom message type that resumes the run after compression. */
export const PINE_ACTIVATION_RESUME_MESSAGE = "pine.activation-resume";
