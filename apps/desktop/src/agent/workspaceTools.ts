import {
  defineTool,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type {
  AskUserQuestionParams,
  AskUserQuestionSubmission,
} from "@pine/rpiv-ask-user-question";
import {
  UI_LIST_PROJECT_TOOL_NAME,
  UI_TELEPORT_TOOL_NAME,
} from "../shared/agent";
import type {
  AgentHostProject,
  AgentHostRequest,
  AgentHostResponse,
} from "./protocol";

export interface PineWorkspaceToolContext {
  /** Ask main, which owns the project library and session storage. */
  requestHost(request: AgentHostRequest): Promise<AgentHostResponse>;
  /** Always shown to the user, whatever the approval mode. */
  requestQuestionnaire(
    toolCallId: string,
    params: AskUserQuestionParams,
    signal?: AbortSignal,
  ): Promise<AskUserQuestionSubmission>;
  getLocale(): "en-US" | "zh-CN";
  /** Where the session runs now; the prompt tells the agent so. */
  currentProject: { name?: string; temporaryWorkspace: boolean };
}

type CurrentProject = PineWorkspaceToolContext["currentProject"];

function currentPlace(current: CurrentProject): string {
  return current.temporaryWorkspace || !current.name
    ? "No Project, Pine's temporary workspace that belongs to no project"
    : `the Pine project "${current.name}"`;
}

function describeProject(project: AgentHostProject): string {
  const folders = project.folders
    .map(
      (folder) =>
        `  - ${folder.name}: ${folder.path} (${folder.access}${
          folder.path === project.defaultFolderPath ? ", working directory" : ""
        })`,
    )
    .join("\n");
  return `- ${project.name} (id: ${project.id})${
    project.current ? " (current: this session runs here)" : ""
  }\n${folders}`;
}

async function listProjects(
  context: PineWorkspaceToolContext,
): Promise<AgentHostProject[]> {
  const response = await context.requestHost({ kind: "list-projects" });
  if (response.kind !== "list-projects")
    throw new Error("Pine returned an unexpected project list.");
  return response.projects;
}

function confirmationQuestion(
  project: AgentHostProject,
  current: CurrentProject,
  locale: "en-US" | "zh-CN",
): AskUserQuestionParams {
  const zh = locale === "zh-CN";
  const inProject = !current.temporaryWorkspace && current.name;
  return {
    questions: [
      {
        header: zh ? "移动会话" : "Move session",
        question: zh
          ? `要把这个会话移动到项目“${project.name}”吗？之后的回复会在 ${project.defaultFolderPath} 中进行，并使用该项目的文件夹权限。`
          : `Move this session to the project "${project.name}"? Later replies will work in ${project.defaultFolderPath} with that project's folder access.`,
        options: [
          {
            label: zh ? "移动" : "Move",
            description: zh
              ? "本次回复结束后，会话转到该项目中继续。"
              : "The session continues in that project once this reply ends.",
          },
          {
            label: zh
              ? inProject
                ? `留在“${current.name}”`
                : "保持无项目"
              : "Keep it here",
            description: zh
              ? inProject
                ? "会话继续在当前项目中进行。"
                : "会话继续不属于任何项目。"
              : inProject
                ? `The session stays in "${current.name}".`
                : "The session stays outside any project.",
          },
        ],
      },
    ],
  };
}

/**
 * Listing the user's projects and moving the session into another one, for
 * every session. Moving always asks the user first, even in modes that
 * otherwise run without approval.
 */
export function createWorkspaceToolDefinitions(
  context: PineWorkspaceToolContext,
): ToolDefinition[] {
  const { currentProject } = context;
  const here = currentPlace(currentProject);
  const listTool = defineTool({
    name: UI_LIST_PROJECT_TOOL_NAME,
    label: "List Projects",
    description: `List the user's Pine projects with their names, ids, and folder paths; the project this session runs in is marked as current. This session runs in ${here}.`,
    promptSnippet: `This session runs in ${here}. Use ${UI_LIST_PROJECT_TOOL_NAME} to see the user's Pine projects and their folders, for example to check whether a request belongs to another project`,
    parameters: Type.Object({}),
    execute: async () => {
      const projects = await listProjects(context);
      return {
        content: [
          {
            type: "text" as const,
            text: projects.length
              ? projects.map(describeProject).join("\n")
              : "The user has no Pine projects yet.",
          },
        ],
        details: { projects },
      };
    },
  });

  const teleportParams = Type.Object({
    projectId: Type.String({
      description: `Id of the destination project, from ${UI_LIST_PROJECT_TOOL_NAME}.`,
    }),
  });
  const teleportTool = defineTool({
    name: UI_TELEPORT_TOOL_NAME,
    label: "Move Session to Project",
    description: `Move this session from ${here} into another of the user's Pine projects. Pine asks the user to confirm first. When confirmed, the move happens after the current reply ends; later turns run in that project's working directory with its folder access.`,
    promptSnippet: `Use ${UI_TELEPORT_TOOL_NAME} to offer moving this session into the project the user's request belongs to`,
    promptGuidelines: [
      `Before starting work on a request, check whether it fits ${here}. If it clearly belongs to another project, because it names that project or refers to code, files, or folders that live in another project's folders rather than this session's, call ${UI_LIST_PROJECT_TOOL_NAME} and then ${UI_TELEPORT_TOOL_NAME} with that project's id to offer the move right away. Do not ask about it in plain text first and do not work around the wrong folders: the tool itself asks the user to confirm.`,
      ...(currentProject.temporaryWorkspace
        ? [
            `In No Project, also offer the move as soon as the work turns out to belong to one of the user's existing projects.`,
          ]
        : []),
      `Do not offer a move when the fit is only uncertain, for general questions that need no project files, or after the user has declined moving this session.`,
      `Pass an id from ${UI_LIST_PROJECT_TOOL_NAME}; the current project cannot be chosen.`,
      `If the user declines, keep working where the session is.`,
      `After a confirmed move, finish the reply briefly: the new folders are only available from the next turn.`,
    ],
    parameters: teleportParams,
    prepareArguments: (args) => args as Static<typeof teleportParams>,
    execute: async (toolCallId, params, signal) => {
      const projects = await listProjects(context);
      const project = projects.find(
        (candidate) => candidate.id === params.projectId.trim(),
      );
      if (!project) {
        throw new Error(
          `No project has id ${params.projectId}. Call ${UI_LIST_PROJECT_TOOL_NAME} for the current list.`,
        );
      }
      if (project.current) {
        throw new Error(
          `This session already runs in ${project.name}; there is nothing to move.`,
        );
      }

      const submission = await context.requestQuestionnaire(
        toolCallId,
        confirmationQuestion(project, currentProject, context.getLocale()),
        signal,
      );
      const choice = submission.answers[0];
      const confirmed =
        !submission.cancelled &&
        choice?.selectedOptionIndexes.length === 1 &&
        choice.selectedOptionIndexes[0] === 0;
      if (!confirmed) {
        const note = choice?.customAnswer?.trim();
        return {
          content: [
            {
              type: "text" as const,
              text: `The user did not move the session to ${project.name}; it stays in ${here}. Do not offer this move again in this session.${note ? ` The user said: ${note}` : ""}`,
            },
          ],
          details: {
            moved: false,
            projectId: project.id,
            projectName: project.name,
          },
        };
      }

      if (signal?.aborted) throw new Error("aborted");
      const response = await context.requestHost({
        kind: "teleport",
        projectId: project.id,
      });
      if (response.kind !== "teleport")
        throw new Error("Pine could not schedule the move.");
      return {
        content: [
          {
            type: "text" as const,
            text: `The user confirmed. This session moves to ${response.projectName} when this reply ends; from the next turn the working directory is ${response.cwd}. Finish this reply without starting new work in ${here}.`,
          },
        ],
        details: {
          moved: true,
          projectId: project.id,
          projectName: project.name,
        },
      };
    },
  });

  return [listTool, teleportTool] as ToolDefinition[];
}
