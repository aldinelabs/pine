import { describe, expect, it, vi } from "vitest";
import type { PineProject } from "../../shared/projects";
import type { SessionSearchResult } from "../../shared/sessions";
import {
  attachmentForProjectSession,
  listAllRecentSessions,
} from "../recentSessions";
import type { ProjectSessionService } from "../sessions";

function project(id: string): PineProject {
  return {
    createdAt: "",
    defaultFolderId: "folder",
    folders: [],
    id,
    name: id,
    schemaVersion: 1,
    updatedAt: "",
  };
}

function session(id: string, updatedAt: string): SessionSearchResult {
  return { createdAt: updatedAt, id, messageCount: 1, updatedAt };
}

const dispose = vi.fn();

function service(
  search: () => Promise<SessionSearchResult[]>,
): ProjectSessionService {
  return { search: vi.fn(search), dispose } as unknown as ProjectSessionService;
}

describe("listAllRecentSessions", () => {
  it("limits each project independently so quieter projects keep their history", async () => {
    const services = new Map([
      [
        "a",
        service(() =>
          Promise.resolve([
            session("a2", "2026-10-03T00:00:00Z"),
            session("a1", "2026-10-01T00:00:00Z"),
            session("a0", "2026-09-30T00:00:00Z"),
          ]),
        ),
      ],
      [
        "b",
        service(() => Promise.resolve([session("b1", "2026-10-02T00:00:00Z")])),
      ],
      ["broken", service(() => Promise.reject(new Error("unreadable")))],
    ]);
    const result = await listAllRecentSessions(
      [project("a"), project("b"), project("broken")],
      {
        dataPaths: () => {
          throw new Error("every project is open here");
        },
        openSessionService: (id) => services.get(id),
      },
      2,
    );

    expect(result.map(({ id, projectId }) => [id, projectId])).toEqual([
      ["a2", "a"],
      ["b1", "b"],
      ["a1", "a"],
    ]);
    // An index a window holds open stays open.
    expect(dispose).not.toHaveBeenCalled();
  });
});

describe("attachmentForProjectSession", () => {
  it("reads from a session index another window already holds open", async () => {
    const attachmentForSession = vi.fn(() =>
      Promise.resolve({ name: "a.jsonl", path: "/a.jsonl" }),
    );
    const open = {
      attachmentForSession,
      dispose,
    } as unknown as ProjectSessionService;

    await expect(
      attachmentForProjectSession("a", "s1", {
        dataPaths: () => {
          throw new Error("an open index needs no data paths");
        },
        openSessionService: () => open,
      }),
    ).resolves.toMatchObject({ path: "/a.jsonl" });
    expect(attachmentForSession).toHaveBeenCalledWith("s1");
    expect(dispose).not.toHaveBeenCalled();
  });
});
