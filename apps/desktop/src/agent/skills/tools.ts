import {
  defineTool,
  type AgentToolResult,
  type InlineExtension,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { PineApprovalMode } from "../../shared/agent";
import { ACTIVATE_SKILL_AUTHORING_TOOL_NAME } from "../../shared/sessionMutators";
import type { PineSkillScope } from "../../shared/skills";
import type { ToolGate } from "../gate";
import AUTHORING_SKILL from "./skill-authoring/SKILL.md?raw";
import { PineSkillRepository } from "./repository";

export const INVOKE_SKILL_TOOL_NAME = "invoke_skill";
export const LIST_SKILL_RESOURCES_TOOL_NAME = "list_skill_resources";
export const READ_SKILL_RESOURCE_TOOL_NAME = "read_skill_resource";
export { ACTIVATE_SKILL_AUTHORING_TOOL_NAME };
export const CREATE_SKILL_TOOL_NAME = "create_skill";
export const EDIT_SKILL_TOOL_NAME = "edit_skill";
export const REMOVE_SKILL_TOOL_NAME = "remove_skill";
export const SKILL_AUTHORING_DYNAMIC_TOOL_NAMES = [
  CREATE_SKILL_TOOL_NAME,
  EDIT_SKILL_TOOL_NAME,
  REMOVE_SKILL_TOOL_NAME,
] as const;

export interface SkillToolsOptions {
  activated(): void;
  getApprovalMode(): PineApprovalMode;
  getGate(): ToolGate | null;
  repository: PineSkillRepository;
}

const emptyParams = Type.Object({}, { additionalProperties: false });
const scopeSchema = Type.Union([
  Type.Literal("project"),
  Type.Literal("global"),
]);
const skillNameSchema = Type.String({
  description: "Exact lowercase skill name from the available skill list.",
  minLength: 1,
  maxLength: 64,
  pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
});
const skillContentSchema = Type.String({
  description:
    "Complete SKILL.md content, including YAML frontmatter with matching name and a specific description.",
  minLength: 1,
  maxLength: 1_000_000,
});

/** The instructions activation returns, also given by a session mutator. */
export function skillAuthoringInstructions(): string {
  return `<skill_authoring>\n${AUTHORING_SKILL.trim()}\n</skill_authoring>\n\nPine skill authoring is active for this session.`;
}

function textResult(
  text: string,
  details: Record<string, unknown>,
): AgentToolResult<Record<string, unknown>> {
  return { content: [{ type: "text", text }], details };
}

async function reviewMutation(
  options: SkillToolsOptions,
  toolCallId: string,
  toolName: string,
  scope: PineSkillScope,
  name: string,
  signal?: AbortSignal,
): Promise<void> {
  if (options.getApprovalMode() === "YOLO") return;
  const gate = options.getGate();
  if (!gate) throw new Error("Skill changes require an approval gate.");
  const decision = await gate.reviewPrivilegedCall({
    toolCallId,
    toolName,
    subject: `${scope} skill ${name}`,
    description: `${toolName.replaceAll("_", " ")} for ${scope} scope`,
    evidence:
      "This changes reusable instructions that Pine may load in future sessions. Global scope affects every project; project scope affects the current project.",
    signal,
  });
  if (decision.kind === "deny") {
    throw new Error(decision.reason ?? "The skill change was denied.");
  }
}

function createDefinitions(
  options: SkillToolsOptions,
  activate: () => void,
): ToolDefinition[] {
  const invokeParams = Type.Object(
    {
      name: skillNameSchema,
      userRequest: Type.Optional(
        Type.String({
          description:
            "Optional task-specific context to append after the skill instructions.",
          maxLength: 100_000,
        }),
      ),
    },
    { additionalProperties: false },
  );
  const listResourcesParams = Type.Object(
    { name: skillNameSchema },
    { additionalProperties: false },
  );
  const readResourceParams = Type.Object(
    {
      name: skillNameSchema,
      path: Type.String({
        description: "Relative path inside the activated skill directory.",
        minLength: 1,
        maxLength: 4_096,
      }),
      encoding: Type.Optional(
        Type.Union([Type.Literal("utf8"), Type.Literal("base64")]),
      ),
    },
    { additionalProperties: false },
  );
  const writeParams = Type.Object(
    {
      scope: scopeSchema,
      name: skillNameSchema,
      content: skillContentSchema,
    },
    { additionalProperties: false },
  );
  const removeParams = Type.Object(
    { scope: scopeSchema, name: skillNameSchema },
    { additionalProperties: false },
  );

  return [
    defineTool({
      name: INVOKE_SKILL_TOOL_NAME,
      label: "Invoke Skill",
      description:
        "Load one available Pine skill by exact name and return its full instructions. Use this before acting whenever the task matches a skill in the available skill list.",
      promptSnippet:
        "Load matching skill instructions on demand; only skill names and descriptions stay in the system prompt",
      parameters: invokeParams,
      prepareArguments: (args) => args as Static<typeof invokeParams>,
      execute: async (_toolCallId, params) =>
        textResult(
          await options.repository.invoke(params.name, params.userRequest),
          { name: params.name },
        ),
    }),
    defineTool({
      name: ACTIVATE_SKILL_AUTHORING_TOOL_NAME,
      label: "Activate Skill Authoring",
      description:
        "Dynamically enable Pine's skill creation, editing, and removal tools and load their authoring instructions. Use when the user asks to create, revise, or remove a reusable skill.",
      promptSnippet:
        "Activate skill authoring tools only when reusable Pine skills need to be created, edited, or removed",
      parameters: emptyParams,
      prepareArguments: () => ({}),
      executionMode: "sequential",
      execute: () => {
        activate();
        return Promise.resolve(
          textResult(skillAuthoringInstructions(), {
            activatedToolNames: [...SKILL_AUTHORING_DYNAMIC_TOOL_NAMES],
          }),
        );
      },
    }),
    defineTool({
      name: LIST_SKILL_RESOURCES_TOOL_NAME,
      label: "List Skill Resources",
      description:
        "List the files and directories bundled with an available skill. Use after invoke_skill when the skill references supporting files.",
      promptSnippet:
        "Inspect a skill's bundled scripts, references, and assets without loading them all into context",
      parameters: listResourcesParams,
      prepareArguments: (args) => args as Static<typeof listResourcesParams>,
      execute: async (_toolCallId, params) => {
        const result = await options.repository.listResources(params.name);
        const lines = result.resources.map(
          (resource) =>
            `- ${resource.path} (${resource.kind}${resource.size === undefined ? "" : `, ${resource.size} bytes`})`,
        );
        return textResult(
          `<skill_resources name="${params.name}">\n${lines.join("\n")}\n</skill_resources>`,
          result as unknown as Record<string, unknown>,
        );
      },
    }),
    defineTool({
      name: READ_SKILL_RESOURCE_TOOL_NAME,
      label: "Read Skill Resource",
      description:
        "Read one UTF-8 text or base64-encoded file bundled with an available skill by relative path.",
      promptSnippet:
        "Load one referenced skill resource on demand instead of putting every bundled file into context",
      parameters: readResourceParams,
      prepareArguments: (args) => args as Static<typeof readResourceParams>,
      execute: async (_toolCallId, params) => {
        const result = await options.repository.readResource(
          params.name,
          params.path,
          params.encoding,
        );
        return textResult(
          `<skill_resource name="${params.name}" path="${params.path}" encoding="${result.encoding}">\n${result.content}\n</skill_resource>`,
          result as unknown as Record<string, unknown>,
        );
      },
    }),
    defineTool({
      name: CREATE_SKILL_TOOL_NAME,
      label: "Create Skill",
      description:
        "Create a new valid Pine skill in project or global scope. Project scope is preferred unless the user explicitly wants the skill everywhere.",
      parameters: writeParams,
      prepareArguments: (args) => args as Static<typeof writeParams>,
      executionMode: "sequential",
      execute: async (toolCallId, params, signal) => {
        await reviewMutation(
          options,
          toolCallId,
          CREATE_SKILL_TOOL_NAME,
          params.scope,
          params.name,
          signal,
        );
        const result = await options.repository.create(
          params.scope,
          params.name,
          params.content,
        );
        return textResult(
          `Created ${params.scope} skill \"${result.skill.name}\". It is available immediately. Skill directory: ${result.skillDirectory ?? "unavailable"}. Use write, edit, or bash with this directory to add bundled resources under scripts/, references/, or assets/.`,
          {
            scope: params.scope,
            skill: result.skill,
            skillDirectory: result.skillDirectory,
          },
        );
      },
    }),
    defineTool({
      name: EDIT_SKILL_TOOL_NAME,
      label: "Edit Skill",
      description:
        "Replace the SKILL.md instructions for an existing Pine skill while preserving its other package files.",
      parameters: writeParams,
      prepareArguments: (args) => args as Static<typeof writeParams>,
      executionMode: "sequential",
      execute: async (toolCallId, params, signal) => {
        await reviewMutation(
          options,
          toolCallId,
          EDIT_SKILL_TOOL_NAME,
          params.scope,
          params.name,
          signal,
        );
        const result = await options.repository.edit(
          params.scope,
          params.name,
          params.content,
        );
        return textResult(
          `Updated ${params.scope} skill \"${result.skill.name}\". The new instructions are available immediately. Skill directory: ${result.skillDirectory ?? "unavailable"}. Existing bundled resources were preserved.`,
          {
            scope: params.scope,
            skill: result.skill,
            skillDirectory: result.skillDirectory,
          },
        );
      },
    }),
    defineTool({
      name: REMOVE_SKILL_TOOL_NAME,
      label: "Remove Skill",
      description:
        "Remove an existing Pine skill from discovery by moving its package into Pine's recoverable internal trash.",
      parameters: removeParams,
      prepareArguments: (args) => args as Static<typeof removeParams>,
      executionMode: "sequential",
      execute: async (toolCallId, params, signal) => {
        await reviewMutation(
          options,
          toolCallId,
          REMOVE_SKILL_TOOL_NAME,
          params.scope,
          params.name,
          signal,
        );
        await options.repository.remove(params.scope, params.name);
        return textResult(
          `Removed ${params.scope} skill \"${params.name}\" from discovery. Its files remain in Pine's internal skill trash.`,
          { removed: true, scope: params.scope, name: params.name },
        );
      },
    }),
  ];
}

export function createSkillToolsExtension(options: SkillToolsOptions): {
  extension: InlineExtension;
} {
  return {
    extension: {
      name: "pine-skills",
      factory: (pi) => {
        const activate = () => {
          const active = pi.getActiveTools();
          const added = SKILL_AUTHORING_DYNAMIC_TOOL_NAMES.filter(
            (name) => !active.includes(name),
          );
          if (added.length > 0) pi.setActiveTools([...active, ...added]);
          options.activated();
        };
        for (const tool of createDefinitions(options, activate)) {
          pi.registerTool(tool);
        }
      },
    },
  };
}
