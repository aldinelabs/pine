import { describe, expect, it, vi } from "vitest";
import type { PineProject } from "../../shared/projects";
import type { SessionSearchResult } from "../../shared/sessions";
import {
  attachmentTitleOfProjectSession,
  listAllRecentSessions,
  searchAllSessions,
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

describe("searchAllSessions", () => {
  it("runs the query in every project and caps the merged matches", async () => {
    const searchA = vi.fn(() =>
      Promise.resolve([
        session("a1", "2026-10-01T00:00:00Z"),
        session("a0", "2026-09-30T00:00:00Z"),
      ]),
    );
    const searchB = vi.fn(() =>
      Promise.resolve([session("b1", "2026-10-02T00:00:00Z")]),
    );
    const a = service(searchA);
    const b = service(searchB);
    const services = new Map([
      ["a", a],
      ["b", b],
    ]);
    const result = await searchAllSessions(
      [project("a"), project("b")],
      "pdf",
      {
        dataPaths: () => {
          throw new Error("every project is open here");
        },
        openSessionService: (id) => services.get(id),
      },
      2,
    );

    expect(searchA).toHaveBeenCalledWith("pdf");
    expect(searchB).toHaveBeenCalledWith("pdf");
    expect(result.map(({ id, projectId }) => [id, projectId])).toEqual([
      ["b1", "b"],
      ["a1", "a"],
    ]);
  });
});

describe("attachmentTitleOfProjectSession", () => {
  it("reads from a session index another window already holds open", async () => {
    const attachmentTitle = vi.fn(() =>
      Promise.resolve({ title: "A", updatedAt: "2026-01-01T00:00:00Z" }),
    );
    const open = {
      attachmentTitle,
      dispose,
    } as unknown as ProjectSessionService;

    await expect(
      attachmentTitleOfProjectSession("a", "s1", {
        dataPaths: () => {
          throw new Error("an open index needs no data paths");
        },
        openSessionService: () => open,
      }),
    ).resolves.toMatchObject({ title: "A" });
    expect(attachmentTitle).toHaveBeenCalledWith("s1");
    expect(dispose).not.toHaveBeenCalled();
  });
});
