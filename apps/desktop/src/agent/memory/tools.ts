import {
  defineTool,
  type AgentToolResult,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { PineApprovalMode } from "../../shared/agent";
import {
  MEMORY_CONTENT_MAX_LENGTH,
  MEMORY_DESCRIPTION_MAX_LENGTH,
  MEMORY_NAME_MAX_LENGTH,
  MEMORY_NAME_PATTERN,
  MEMORY_READ_TOOL_NAME,
  MEMORY_REMOVE_TOOL_NAME,
  MEMORY_SAVE_TOOL_NAME,
  type PineMemoryScope,
  type PineMemorySummary,
} from "../../shared/memory";
import type { ToolGate } from "../gate";
import { memorySummary, type PineMemoryRepository } from "./repository";

export interface MemoryToolsOptions {
  /** Whether this turn has read web pages or MCP results. */
  afterExternalContent(): boolean;
  getApprovalMode(): PineApprovalMode;
  getGate(): ToolGate | null;
  isEnabled(): boolean;
  repository: PineMemoryRepository;
  sessionId(): string;
}

const scopeSchema = Type.Union(
  [Type.Literal("project"), Type.Literal("global")],
  {
    description:
      "project: applies to this project. global: applies to every project.",
  },
);
const nameSchema = Type.String({
  description:
    "Short kebab-case name that identifies the note within its scope.",
  minLength: 1,
  maxLength: MEMORY_NAME_MAX_LENGTH,
  pattern: MEMORY_NAME_PATTERN,
});

function textResult(
  text: string,
  details: Record<string, unknown>,
): AgentToolResult<Record<string, unknown>> {
  return { content: [{ type: "text", text }], details };
}

function assertEnabled(options: MemoryToolsOptions): void {
  if (!options.isEnabled())
    throw new Error("Long-term memory is turned off in Pine's settings.");
}

/**
 * Whether a write must be reviewed. Global notes reach every project, so they
 * always are. Project notes pass in the automatic modes unless the turn read
 * external content, which is where a planted "remember this" would come from.
 */
export function memoryWriteNeedsReview(
  approvalMode: PineApprovalMode,
  scope: PineMemoryScope,
  afterExternalContent: boolean,
): boolean {
  if (approvalMode === "YOLO") return false;
  if (approvalMode === "let-me-review") return true;
  return scope === "global" || afterExternalContent;
}

async function reviewWrite(
  options: MemoryToolsOptions,
  toolCallId: string,
  toolName: string,
  scope: PineMemoryScope,
  name: string,
  description: string,
  signal?: AbortSignal,
  content?: string,
): Promise<void> {
  const afterExternalContent = options.afterExternalContent();
  if (
    !memoryWriteNeedsReview(
      options.getApprovalMode(),
      scope,
      afterExternalContent,
    )
  )
    return;
  const gate = options.getGate();
  if (!gate) throw new Error("Memory changes require an approval gate.");
  const decision = await gate.reviewPrivilegedCall({
    toolCallId,
    toolName,
    subject: `${scope} memory ${name}`,
    description,
    evidence: `This changes a note that Pine shows to future sessions. Global scope affects every project; project scope affects the current project.${
      afterExternalContent
        ? " This turn read web or MCP content, which may have asked for the change; allow it only if the user's own request supports it."
        : ""
    }${
      content === undefined
        ? ""
        : `\n\nProposed note content (written by the agent):\n${content.slice(0, 2_000)}${content.length > 2_000 ? "\n…[truncated]" : ""}`
    }`,
    signal,
  });
  if (decision.kind === "deny")
    throw new Error(decision.reason ?? "The memory change was denied.");
}

function listing(memories: readonly PineMemorySummary[]): string {
  if (memories.length === 0) return "No notes have been saved.";
  return memories
    .map(
      (memory) =>
        `- [${memory.scope}] ${memory.name}${memory.verified ? "" : " (unverified)"}: ${memory.description}`,
    )
    .join("\n");
}

export function createMemoryToolDefinitions(
  options: MemoryToolsOptions,
): ToolDefinition[] {
  const readParams = Type.Object(
    {
      scope: Type.Optional(scopeSchema),
      name: Type.Optional(nameSchema),
    },
    { additionalProperties: false },
  );
  const saveParams = Type.Object(
    {
      scope: scopeSchema,
      name: nameSchema,
      description: Type.String({
        description:
          "One line saying what the note holds. Future sessions see only this line until they read the note, so make it specific enough to tell when the note is relevant.",
        minLength: 1,
        maxLength: MEMORY_DESCRIPTION_MAX_LENGTH,
      }),
      content: Type.String({
        description:
          "The note in Markdown: the fact, how you know it, and when it applies.",
        minLength: 1,
        maxLength: MEMORY_CONTENT_MAX_LENGTH,
      }),
      verified: Type.Boolean({
        description:
          "true if the user stated this or you checked it; false if it is an inference still to confirm.",
      }),
    },
    { additionalProperties: false },
  );
  const removeParams = Type.Object(
    { scope: scopeSchema, name: nameSchema },
    { additionalProperties: false },
  );

  return [
    defineTool({
      name: MEMORY_READ_TOOL_NAME,
      label: "Read Memory",
      description:
        "Read one long-term memory note by scope and name, or list every note when no name is given.",
      promptSnippet:
        "Read the full text of a long-term memory note listed in the memory notice",
      parameters: readParams,
      prepareArguments: (args) => args as Static<typeof readParams>,
      execute: async (_toolCallId, params) => {
        assertEnabled(options);
        if (!params.name) {
          const memories = await options.repository.list();
          return textResult(listing(memories), { memories });
        }
        const scopes: PineMemoryScope[] = params.scope
          ? [params.scope]
          : ["project", "global"];
        for (const scope of scopes) {
          const note = await options.repository
            .read(scope, params.name)
            .catch(() => undefined);
          if (!note) continue;
          return textResult(
            `<memory scope="${note.scope}" name="${note.name}" verified="${note.verified}" updated="${note.updatedAt}">\n${note.content}\n</memory>`,
            { memory: memorySummary(note) },
          );
        }
        throw new Error(
          `There is no memory note named "${params.name}"${params.scope ? ` in ${params.scope} scope` : ""}.`,
        );
      },
    }),
    defineTool({
      name: MEMORY_SAVE_TOOL_NAME,
      label: "Save Memory",
      description:
        "Save a long-term memory note that future sessions will see. Saving under an existing name and scope replaces that note, which is how a note is corrected.",
      promptSnippet:
        "Save what a future session would need and could not read from the project itself",
      parameters: saveParams,
      prepareArguments: (args) => args as Static<typeof saveParams>,
      executionMode: "sequential",
      execute: async (toolCallId, params, signal) => {
        assertEnabled(options);
        await reviewWrite(
          options,
          toolCallId,
          MEMORY_SAVE_TOOL_NAME,
          params.scope,
          params.name,
          `Remember: ${params.description}`,
          signal,
          params.content,
        );
        const note = await options.repository.save({
          ...params,
          sessionId: options.sessionId(),
        });
        return textResult(
          `Saved ${note.scope} memory "${note.name}". Later sessions will see it.`,
          { memory: memorySummary(note) },
        );
      },
    }),
    defineTool({
      name: MEMORY_REMOVE_TOOL_NAME,
      label: "Remove Memory",
      description:
        "Delete a long-term memory note that is wrong, outdated, or no longer wanted.",
      parameters: removeParams,
      prepareArguments: (args) => args as Static<typeof removeParams>,
      executionMode: "sequential",
      execute: async (toolCallId, params, signal) => {
        assertEnabled(options);
        await reviewWrite(
          options,
          toolCallId,
          MEMORY_REMOVE_TOOL_NAME,
          params.scope,
          params.name,
          `Forget the ${params.scope} memory "${params.name}"`,
          signal,
        );
        const removed = await options.repository.remove(
          params.scope,
          params.name,
        );
        if (!removed)
          throw new Error(
            `There is no memory note named "${params.name}" in ${params.scope} scope.`,
          );
        return textResult(`Removed ${params.scope} memory "${params.name}".`, {
          removed: true,
          scope: params.scope,
          name: params.name,
        });
      },
    }),
  ];
}
