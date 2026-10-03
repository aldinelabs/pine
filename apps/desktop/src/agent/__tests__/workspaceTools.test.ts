import { describe, expect, it, vi } from "vitest";
import type {
  ExtensionToolContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import type { AskUserQuestionSubmission } from "@pine/rpiv-ask-user-question";
import type { AgentHostProject, AgentHostRequest } from "../protocol";
import {
  createWorkspaceToolDefinitions,
  type PineWorkspaceToolContext,
} from "../workspaceTools";

const project: AgentHostProject = {
  id: "9ab0b15f-331f-4aa6-8056-cd2be3bf7414",
  name: "Pine",
  defaultFolderPath: "/Users/me/pine",
  folders: [{ access: "read-write", name: "pine", path: "/Users/me/pine" }],
};

function setup(submission: AskUserQuestionSubmission) {
  const requestHost = vi.fn((request: AgentHostRequest) =>
    Promise.resolve(
      request.kind === "list-projects"
        ? { kind: "list-projects" as const, projects: [project] }
        : {
            kind: "teleport" as const,
            projectName: project.name,
            cwd: project.defaultFolderPath,
          },
    ),
  );
  const requestQuestionnaire = vi.fn().mockResolvedValue(submission);
  const context: PineWorkspaceToolContext = {
    requestHost,
    requestQuestionnaire,
    getLocale: () => "zh-CN",
  };
  const [list, teleport] = createWorkspaceToolDefinitions(context);
  return { list, teleport, requestHost, requestQuestionnaire };
}

async function run(tool: ToolDefinition, params: never) {
  const result = await tool.execute(
    "call-1",
    params,
    undefined,
    undefined,
    {} as ExtensionToolContext,
  );
  return (result.content[0] as { text: string }).text;
}

describe("temporary workspace tools", () => {
  it("lists projects with their ids and working directories", async () => {
    const { list } = setup({ answers: [], cancelled: true });

    const text = await run(list, {} as never);

    expect(text).toContain("Pine (id: 9ab0b15f-331f-4aa6-8056-cd2be3bf7414)");
    expect(text).toContain("/Users/me/pine (read-write, working directory)");
  });

  it("asks the user before moving and moves only when confirmed", async () => {
    const { teleport, requestHost, requestQuestionnaire } = setup({
      answers: [{ questionIndex: 0, selectedOptionIndexes: [0] }],
      cancelled: false,
    });

    const text = await run(teleport, { projectId: project.id } as never);

    expect(requestQuestionnaire).toHaveBeenCalledWith(
      "call-1",
      expect.objectContaining({
        questions: [expect.objectContaining({ header: "移动会话" })],
      }),
      undefined,
    );
    expect(requestHost).toHaveBeenLastCalledWith({
      kind: "teleport",
      projectId: project.id,
    });
    expect(text).toContain("moves to Pine when this reply ends");
  });

  it.each([
    {
      answers: [{ questionIndex: 0, selectedOptionIndexes: [1] }],
      cancelled: false,
    },
    { answers: [], cancelled: true },
  ])("keeps the session when the user declines", async (submission) => {
    const { teleport, requestHost } = setup(submission);

    const text = await run(teleport, { projectId: project.id } as never);

    expect(requestHost).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "teleport" }),
    );
    expect(text).toContain("stays in the temporary workspace");
  });

  it("rejects an unknown project without asking the user", async () => {
    const { teleport, requestQuestionnaire } = setup({
      answers: [],
      cancelled: true,
    });

    await expect(
      run(teleport, { projectId: "missing" } as never),
    ).rejects.toThrow("No project has id missing");
    expect(requestQuestionnaire).not.toHaveBeenCalled();
  });
});
