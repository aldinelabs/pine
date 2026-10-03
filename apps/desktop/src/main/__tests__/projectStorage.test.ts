import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  clearProjectStorage,
  measureProjectStorage,
} from "../projects/projectStorage";
import type { ProjectDataPaths } from "../projects/projectRepository";

const roots: string[] = [];

async function fixture(): Promise<ProjectDataPaths> {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "pine-storage-"));
  roots.push(projectRoot);
  const dataPaths: ProjectDataPaths = {
    attachmentsRoot: path.join(projectRoot, "attachments"),
    cacheRoot: path.join(projectRoot, "cache"),
    projectRoot,
    sessionsRoot: path.join(projectRoot, "sessions"),
    temporaryRoot: path.join(projectRoot, "tmp"),
  };
  const workingDirectory = path.join(dataPaths.temporaryRoot!, "abc123");
  await mkdir(path.join(workingDirectory, "web"), { recursive: true });
  await mkdir(dataPaths.attachmentsRoot);
  await mkdir(path.join(dataPaths.sessionsRoot, "--project--"), {
    recursive: true,
  });
  await mkdir(dataPaths.cacheRoot);
  await Promise.all([
    writeFile(path.join(workingDirectory, "scratch.txt"), "12345"),
    writeFile(path.join(workingDirectory, "web", "page.html"), "123"),
    writeFile(path.join(dataPaths.attachmentsRoot, "image.png"), "1234"),
    writeFile(
      path.join(dataPaths.sessionsRoot, "--project--", "s.jsonl"),
      "12",
    ),
    writeFile(path.join(dataPaths.cacheRoot, "index.db"), "1"),
  ]);
  return dataPaths;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("project storage", () => {
  it("measures each kind of Pine data for a project", async () => {
    const dataPaths = await fixture();

    await expect(measureProjectStorage("p1", dataPaths)).resolves.toEqual({
      projectId: "p1",
      attachments: 4,
      cache: 1,
      sessions: 2,
      temporary: 8,
      total: 15,
    });
  });

  it("empties temporary folders without removing a session's own folder", async () => {
    const dataPaths = await fixture();

    await clearProjectStorage(dataPaths, "temporary");

    await expect(
      readdir(path.join(dataPaths.temporaryRoot!, "abc123")),
    ).resolves.toEqual([]);
    const usage = await measureProjectStorage("p1", dataPaths);
    expect(usage).toMatchObject({ temporary: 0, attachments: 4, sessions: 2 });
  });

  it("clears attachments and leaves history alone", async () => {
    const dataPaths = await fixture();

    await clearProjectStorage(dataPaths, "attachments");

    await expect(measureProjectStorage("p1", dataPaths)).resolves.toMatchObject(
      { attachments: 0, sessions: 2, temporary: 8 },
    );
  });
});
