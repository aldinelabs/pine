import {
  defineTool,
  type AgentSession,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";
import {
  normalizeContext,
  type AssistantMessage,
  type UserMessage,
} from "@earendil-works/pi-ai";
import { Type } from "typebox";

/**
 * Compaction that continues the conversation instead of starting a new one.
 *
 * Prompt caches match a request's prefix byte for byte. A separate "summarize
 * this" request, with its own system prompt and no tools, shares nothing with
 * the conversation and is billed at the full uncached rate for the whole
 * context. Here the request is the conversation's next request, built by the
 * same pipeline as every other request (same system prompt, tools, model,
 * reasoning level and messages), with one user message appended that asks for
 * the summary. The provider's cache covers everything before that message.
 */

export const SUBMIT_SESSION_SUMMARY_TOOL_NAME =
  "submit_session_summary" as const;

/** pi's marker for a virtual model; its requests are routed per call. */
const VIRTUAL_MODEL_API = "pi-virtual";

/** Room the request needs beyond the context itself: the instruction and the summary. */
export const SESSION_SUMMARY_OUTPUT_BUFFER_TOKENS = 16_000;

/**
 * Stays in every session's tool list so the list never changes when a summary
 * is requested. Outside a compaction it rejects the call.
 */
export function createSubmitSessionSummaryToolDefinition() {
  return defineTool({
    name: SUBMIT_SESSION_SUMMARY_TOOL_NAME,
    label: "Submit Session Summary",
    description:
      "Reserved for Pine's conversation compaction. Call it only when Pine explicitly asks you to summarize the conversation; at any other time it is unavailable and does nothing.",
    parameters: Type.Object(
      {
        summary: Type.String({
          description:
            "The structured checkpoint summary Pine asked for, in the requested format.",
        }),
      },
      { additionalProperties: false },
    ),
    // eslint-disable-next-line @typescript-eslint/require-await
    execute: async () => {
      throw new Error(
        "No summary was requested. Pine will say so when it needs one. Continue with the user's task.",
      );
    },
  });
}

const SESSION_SUMMARY_INSTRUCTION = `Pine is compacting this conversation to free up context. Stop the current task. Do not answer the last message and do not call any tool except ${SUBMIT_SESSION_SUMMARY_TOOL_NAME}.

Call ${SUBMIT_SESSION_SUMMARY_TOOL_NAME} once. Its summary is a structured checkpoint that you or another assistant will use to continue the work without the earlier messages. Write it in the language the user has been using, in exactly this format:

## Goal
[What the user is trying to accomplish. Several items if the session covers different tasks.]

## Constraints & Preferences
- [Constraints, preferences or requirements the user stated]
- [Or "(none)"]

## Progress
### Done
- [x] [Completed tasks and changes]

### In Progress
- [ ] [Current work]

### Blocked
- [Issues preventing progress, if any]

## Key Decisions
- **[Decision]**: [Brief rationale]

## Next Steps
1. [Ordered list of what should happen next]

## Critical Context
- [Data, examples or references needed to continue]
- [Or "(none)"]

Keep each section concise. Preserve exact file paths, function names, identifiers and error messages. If the conversation already starts with an earlier summary, carry its still-relevant content forward. The most recent messages stay in the conversation after compaction, so keep their coverage brief.`;

function sessionSummaryRequest(): UserMessage {
  return {
    role: "user",
    content: [{ type: "text", text: SESSION_SUMMARY_INSTRUCTION }],
    timestamp: Date.now(),
  };
}

/** The summary the model submitted, or its plain text reply when it skipped the tool. */
export function extractSessionSummary(
  message: Pick<AssistantMessage, "content">,
): string | undefined {
  for (const block of message.content) {
    if (block.type !== "toolCall") continue;
    if (block.name !== SUBMIT_SESSION_SUMMARY_TOOL_NAME) continue;
    const summary = (block.arguments as { summary?: unknown }).summary;
    if (typeof summary === "string" && summary.trim()) return summary.trim();
  }
  const text = message.content
    .flatMap((block) => (block.type === "text" ? [block.text] : []))
    .join("\n")
    .trim();
  return text || undefined;
}

export interface SessionSummaryResult {
  summary: string;
  usage: AssistantMessage["usage"];
}

/**
 * Ask the session's own model for the summary as the conversation's next
 * request. Resolves to undefined when no usable summary came back, so the
 * caller can fall back to pi's own summarization.
 */
export async function requestSessionSummary(
  session: AgentSession,
  signal: AbortSignal,
): Promise<SessionSummaryResult | undefined> {
  const { agent } = session;
  const model = agent.state.model;
  if (model.api === VIRTUAL_MODEL_API) return undefined;

  // The same inputs and steps as the agent loop's next request.
  const messages = [
    ...session.sessionManager.buildSessionProjection().messages,
    sessionSummaryRequest(),
  ];
  const transformed = agent.transformContext
    ? await agent.transformContext(messages, signal)
    : messages;
  const llmMessages = await agent.convertToLlm(transformed);
  const thinkingLevel = agent.state.thinkingLevel;
  const apiKey = await agent.getApiKey?.(model.provider);

  const stream = await agent.streamFunction(
    model,
    normalizeContext({ messages: llmMessages }),
    {
      ...(apiKey ? { apiKey } : {}),
      signal,
      sessionId: agent.sessionId,
      transport: agent.transport,
      thinkingBudgets: agent.thinkingBudgets,
      maxRetryDelayMs: agent.maxRetryDelayMs,
      onPayload: agent.onPayload,
      ...(thinkingLevel === "off" ? {} : { reasoning: thinkingLevel }),
    },
  );
  const response = await stream.result();
  // A cut-off reply may carry a truncated summary.
  if (response.stopReason !== "stop" && response.stopReason !== "toolUse") {
    return undefined;
  }
  const summary = extractSessionSummary(response);
  return summary ? { summary, usage: response.usage } : undefined;
}

/**
 * Replaces pi's default summarization for the model route. Anything that
 * keeps the request from being the conversation's next one (a virtual model,
 * a context with no room for the reply, an overflow recovery, a failed
 * request) returns nothing, and pi summarizes the way it always has.
 */
export function createSessionSummaryCompactionExtension(options: {
  getSession: () => AgentSession;
  isEnabled: () => boolean;
}): { name: string; factory: ExtensionFactory } {
  return {
    name: "pine-session-summary",
    factory: (pi) => {
      pi.on("session_before_compact", async (event) => {
        if (!options.isEnabled() || event.reason === "overflow") {
          return undefined;
        }
        const session = options.getSession();
        const { model } = session;
        if (
          !model ||
          event.preparation.tokensBefore +
            SESSION_SUMMARY_OUTPUT_BUFFER_TOKENS >
            model.contextWindow
        ) {
          return undefined;
        }
        try {
          const result = await requestSessionSummary(session, event.signal);
          if (!result) return undefined;
          return {
            compaction: {
              summary: result.summary,
              firstKeptEntryId: event.preparation.firstKeptEntryId,
              tokensBefore: event.preparation.tokensBefore,
              usage: result.usage,
            },
          };
        } catch {
          // An abort ends the compaction in pi; any other failure falls back.
          return undefined;
        }
      });
    },
  };
}
