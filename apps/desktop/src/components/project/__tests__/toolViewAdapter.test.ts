import { describe, expect, it } from "vitest";
import type { PineProject } from "@/shared/projects";
import {
  editDiffCode,
  editHunks,
  toolFileRequest,
  toolOutputParts,
  toolViewAdapter,
  webResults,
} from "../toolViewAdapter";

const project = {
  id: "project-1",
  defaultFolderId: "folder-1",
  folders: [
    { id: "folder-1", path: "/work/pine", isAvailable: true },
    { id: "folder-2", path: "/work/pine/packages/shared", isAvailable: true },
  ],
} as PineProject;

describe("tool view adapter", () => {
  it("assigns semantic views across first-party tool families", () => {
    const families = {
      bash: "shell",
      privileged_powershell: "shell",
      read: "file",
      ui_present_file: "file",
      ask_user_question: "questionnaire",
      invoke_skill: "skill",
      list_skill_resources: "skill",
      generate_image: "media",
      screenshot: "computer",
      browser_snapshot: "computer",
      web_search: "search",
      web_fetch: "fetch",
    };
    for (const [name, detail] of Object.entries(families)) {
      expect(
        toolViewAdapter({ id: name, name, status: "running" }).detail,
      ).toBe(detail);
    }
    expect(
      toolViewAdapter({ id: "mcp", name: "mcp__read", status: "complete" })
        .detail,
    ).toBe("generic");
  });

  it("opens only successful first-party reads and writes", () => {
    expect(
      toolViewAdapter({
        id: "1",
        name: "read",
        status: "complete",
        input: { path: "src/main.ts" },
      }).filePath,
    ).toBe("src/main.ts");
    expect(
      toolViewAdapter({
        id: "2",
        name: "write",
        status: "error",
        input: { path: "src/main.ts" },
      }).filePath,
    ).toBeUndefined();
    expect(
      toolViewAdapter({
        id: "3",
        name: "mcp__read",
        status: "complete",
        input: { path: "src/main.ts" },
      }).filePath,
    ).toBeUndefined();
    expect(
      toolViewAdapter({
        id: "4",
        name: "ui_present_file",
        status: "complete",
        input: { path: "src/main.ts" },
        output: { details: { path: "/work/pine/src/main.ts" } },
      }).filePath,
    ).toBe("/work/pine/src/main.ts");
  });

  it("resolves project paths without allowing a path outside its folders", () => {
    expect(toolFileRequest("src/main.ts", project)).toEqual({
      projectId: "project-1",
      folderId: "folder-1",
      relativePath: "src/main.ts",
    });
    expect(
      toolFileRequest("/work/pine/packages/shared/index.ts", project),
    ).toEqual({
      projectId: "project-1",
      folderId: "folder-2",
      relativePath: "index.ts",
    });
    expect(toolFileRequest("../secret.ts", project)).toBeUndefined();
    expect(toolFileRequest("/work/pine/../secret.ts", project)).toBeUndefined();
    expect(
      toolFileRequest("c:\\WORK\\Pine\\src\\main.ts", {
        ...project,
        folders: [
          {
            id: "folder-1",
            name: "Pine",
            access: "read-write",
            path: "C:\\Work\\Pine",
            isAvailable: true,
          },
        ],
      }),
    ).toEqual({
      projectId: "project-1",
      folderId: "folder-1",
      relativePath: "src/main.ts",
    });
  });

  it("extracts edit hunks and completed TinyFish results", () => {
    expect(
      editHunks({ edits: [{ oldText: "before", newText: "after" }] }),
    ).toEqual([{ before: "before", after: "after" }]);
    expect(editDiffCode({ before: "one\ntwo", after: "one\nthree" })).toBe(
      " one\n-two\n+three",
    );
    expect(
      webResults({
        content: [
          {
            type: "text",
            text: '<tinyfish_web_data>\n{"results":[{"title":"Example","url":"https://example.com","snippet":"Summary"}]}\n</tinyfish_web_data>',
          },
        ],
      }),
    ).toEqual([
      {
        title: "Example",
        url: "https://example.com",
        snippet: "Summary",
        content: undefined,
        metadata: {},
      },
    ]);
    expect(
      webResults({ content: [{ text: '<tinyfish_web_data>{"results":[' }] }),
    ).toBeUndefined();
  });

  it("keeps text and images as display parts without flattening image bytes", () => {
    expect(
      toolOutputParts({
        content: [
          { type: "text", text: "Done" },
          { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
        ],
      }),
    ).toEqual([
      { type: "text", text: "Done" },
      { type: "image", imageUrl: "data:image/png;base64,aGVsbG8=" },
    ]);
  });
});
