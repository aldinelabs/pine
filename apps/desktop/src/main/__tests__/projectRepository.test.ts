import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  TEMPORARY_WORKSPACE_FOLDER_ID,
  TEMPORARY_WORKSPACE_PROJECT_ID,
} from "../../shared/projects";
import { ProjectRepository } from "../projects/projectRepository";

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("ProjectRepository", () => {
  it("stores project metadata outside the selected folders", async () => {
    const userData = await createTemporaryDirectory("pine-user-data-");
    const folderPath = await createTemporaryDirectory("pine-project-folder-");
    const repository = new ProjectRepository(path.join(userData, "projects"));
    const folderId = "cde9a86c-7632-43ac-96d6-c41ddeddce0e";

    const project = await repository.create({
      defaultFolderId: folderId,
      folders: [
        {
          access: "read-write",
          id: folderId,
          name: "source",
          path: folderPath,
        },
      ],
      name: "Pine",
    });

    const metadata = JSON.parse(
      await readFile(
        path.join(userData, "projects", project.id, "project.json"),
        "utf8",
      ),
    ) as unknown;
    expect(metadata).toMatchObject({
      id: project.id,
      projectIcon: "inbox",
      schemaVersion: 1,
    });
    await expect(
      readFile(path.join(folderPath, ".pine", "project.json")),
    ).rejects.toMatchObject({ code: "ENOENT" });
    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({ id: TEMPORARY_WORKSPACE_PROJECT_ID }),
      expect.objectContaining({ id: project.id, name: "Pine" }),
    ]);
  });

  it("keeps a fixed temporary workspace inside Pine's data", async () => {
    const userData = await createTemporaryDirectory("pine-user-data-");
    const projectsRoot = path.join(userData, "projects");
    const repository = new ProjectRepository(projectsRoot);

    const [workspace] = await repository.list();
    const workspacePath = path.join(
      projectsRoot,
      TEMPORARY_WORKSPACE_PROJECT_ID,
      "workspace",
    );
    expect(workspace).toMatchObject({
      id: TEMPORARY_WORKSPACE_PROJECT_ID,
      defaultFolderId: TEMPORARY_WORKSPACE_FOLDER_ID,
      folders: [
        {
          access: "read-write",
          id: TEMPORARY_WORKSPACE_FOLDER_ID,
          isAvailable: true,
          path: workspacePath,
        },
      ],
    });
    await expect(
      repository.update(TEMPORARY_WORKSPACE_PROJECT_ID, {
        defaultFolderId: TEMPORARY_WORKSPACE_FOLDER_ID,
        folders: workspace.folders,
        name: "Renamed",
      }),
    ).rejects.toThrow("cannot be changed or deleted");
    await expect(
      repository.delete(TEMPORARY_WORKSPACE_PROJECT_ID),
    ).rejects.toThrow("cannot be changed or deleted");

    // Session groups organize its sessions and stay editable.
    const groups = [
      {
        id: "11111111-1111-4111-8111-111111111111",
        name: "Drafts",
        sessionIds: [],
      },
    ];
    await repository.updateSessionGroups(
      TEMPORARY_WORKSPACE_PROJECT_ID,
      groups,
    );
    await expect(
      repository.get(TEMPORARY_WORKSPACE_PROJECT_ID),
    ).resolves.toMatchObject({ sessionGroups: groups });
  });

  it("rejects duplicate and nested project folders", async () => {
    const userData = await createTemporaryDirectory("pine-user-data-");
    const folderPath = await createTemporaryDirectory("pine-project-folder-");
    await mkdir(path.join(folderPath, "nested"));
    const repository = new ProjectRepository(path.join(userData, "projects"));

    await expect(
      repository.create({
        defaultFolderId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        folders: [
          {
            access: "read-write",
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "root",
            path: folderPath,
          },
          {
            access: "read-only",
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            name: "nested",
            path: path.join(folderPath, "nested"),
          },
        ],
        name: "Invalid",
      }),
    ).rejects.toThrow();
  });

  it("marks missing folders unavailable and deletes only Pine data", async () => {
    const userData = await createTemporaryDirectory("pine-user-data-");
    const folderPath = await createTemporaryDirectory("pine-project-folder-");
    const repository = new ProjectRepository(path.join(userData, "projects"));
    const folderId = "cde9a86c-7632-43ac-96d6-c41ddeddce0e";
    const project = await repository.create({
      defaultFolderId: folderId,
      folders: [
        {
          access: "read-write",
          id: folderId,
          name: "source",
          path: folderPath,
        },
      ],
      name: "Pine",
    });

    await rm(folderPath, { recursive: true });
    expect((await repository.get(project.id)).folders[0].isAvailable).toBe(
      false,
    );
    await expect(repository.delete(project.id)).resolves.toBe(true);
    await expect(repository.get(project.id)).rejects.toThrow(
      "Pine project not found.",
    );
  });

  it("persists session groups and keeps them across project metadata updates", async () => {
    const userData = await createTemporaryDirectory("pine-user-data-");
    const folderPath = await createTemporaryDirectory("pine-project-folder-");
    const repository = new ProjectRepository(path.join(userData, "projects"));
    const folderId = "cde9a86c-7632-43ac-96d6-c41ddeddce0e";
    const project = await repository.create({
      defaultFolderId: folderId,
      folders: [
        {
          access: "read-write",
          id: folderId,
          name: "source",
          path: folderPath,
        },
      ],
      name: "Pine",
    });
    const sessionGroups = [
      {
        id: "4a1e4bf2-571b-4b48-9f7f-f7cf3dd6c01f",
        name: "Planning",
        sessionIds: ["019cfe51-7166-79b9-a5b9-c652fcca9eab"],
      },
    ];

    await repository.updateSessionGroups(project.id, sessionGroups);
    await repository.update(project.id, {
      defaultFolderId: folderId,
      folders: [
        {
          access: "read-write",
          id: folderId,
          name: "source",
          path: folderPath,
        },
      ],
      name: "Pine renamed",
    });

    await expect(repository.get(project.id)).resolves.toEqual(
      expect.objectContaining({
        name: "Pine renamed",
        sessionGroups,
      }),
    );
  });

  it("keeps a chosen project icon and repairs unknown ones", async () => {
    const userData = await createTemporaryDirectory("pine-user-data-");
    const folderPath = await createTemporaryDirectory("pine-project-folder-");
    const projectsRoot = path.join(userData, "projects");
    const repository = new ProjectRepository(projectsRoot);
    const folderId = "cde9a86c-7632-43ac-96d6-c41ddeddce0e";
    const input = {
      defaultFolderId: folderId,
      folders: [
        {
          access: "read-write" as const,
          id: folderId,
          name: "source",
          path: folderPath,
        },
      ],
      name: "Pine",
    };
    const project = await repository.create({ ...input, projectIcon: "code" });
    await repository.update(project.id, input);
    await expect(repository.get(project.id)).resolves.toMatchObject({
      projectIcon: "code",
    });

    const metadataPath = path.join(projectsRoot, project.id, "project.json");
    const metadata = JSON.parse(await readFile(metadataPath, "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      metadataPath,
      JSON.stringify({ ...metadata, projectIcon: "not-an-icon" }),
    );
    await expect(repository.get(project.id)).resolves.toMatchObject({
      projectIcon: "inbox",
    });
  });
});
