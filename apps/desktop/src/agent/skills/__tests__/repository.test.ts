// @vitest-environment node
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { PineSkillRepository } from "../repository";

const temporaryDirectories: string[] = [];

async function createRepository(): Promise<{
  global: string;
  project: string;
  repository: PineSkillRepository;
  settings: string;
}> {
  const root = await mkdtemp(path.join(os.tmpdir(), "pine-skills-"));
  temporaryDirectories.push(root);
  const global = path.join(root, "global");
  const project = path.join(root, "project");
  const settings = path.join(root, "skills.json");
  return {
    global,
    project,
    repository: new PineSkillRepository({
      disabledGlobalSkillsPath: settings,
      global,
      project,
    }),
    settings,
  };
}

function content(name: string, description: string): string {
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n# ${name}\n\n${description}\n`;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("PineSkillRepository", () => {
  it("creates, invokes, edits, and recoverably removes a skill", async () => {
    const { repository } = await createRepository();

    await repository.create(
      "project",
      "release-notes",
      content("release-notes", "Draft release notes."),
    );
    await expect(
      repository.invoke("release-notes", "Version 2"),
    ).resolves.toContain('<skill name="release-notes" scope="project">');
    await repository.edit(
      "project",
      "release-notes",
      content("release-notes", "Prepare concise release notes."),
    );
    expect(
      (await repository.read("project", "release-notes")).skill.description,
    ).toBe("Prepare concise release notes.");

    await repository.remove("project", "release-notes");
    expect(repository.list("project").skills).toEqual([]);
    await expect(repository.invoke("release-notes")).rejects.toThrow(
      'Skill "release-notes" was not found.',
    );
  });

  it("prefers project skills over global skills with the same name", async () => {
    const { repository } = await createRepository();
    await repository.create(
      "global",
      "review",
      content("review", "Global review workflow."),
    );
    await repository.create(
      "project",
      "review",
      content("review", "Project review workflow."),
    );

    const invoked = await repository.invoke("review");
    const combined = repository.listCombined();

    expect(invoked).toContain("Project review workflow");
    expect(invoked).not.toContain("Global review workflow");
    expect(combined.skills).toHaveLength(1);
    expect(combined.diagnostics[0]).toMatchObject({
      name: "review",
      type: "collision",
    });
  });

  it("rejects invalid names and mismatched frontmatter", async () => {
    const { repository } = await createRepository();

    await expect(
      repository.create("project", "../escape", content("escape", "No.")),
    ).rejects.toThrow("Skill names must contain");
    await expect(
      repository.create(
        "project",
        "expected-name",
        content("different-name", "No."),
      ),
    ).rejects.toThrow("valid skill");
  });

  it("hides explicit-only skills from the prompt list", async () => {
    const { repository } = await createRepository();
    await repository.create(
      "global",
      "manual-only",
      `---\nname: manual-only\ndescription: Explicit only.\ndisable-model-invocation: true\n---\n\n# Manual\n`,
    );

    expect(repository.promptList()).toBe("");
    await expect(repository.invoke("manual-only")).resolves.toContain(
      'name="manual-only"',
    );
  });

  it("can disable a global skill for one project", async () => {
    const { repository } = await createRepository();
    await repository.create(
      "global",
      "shared-review",
      content("shared-review", "Review shared changes."),
    );

    expect(repository.list("global").skills[0]?.enabled).toBe(true);
    await repository.setGlobalSkillEnabled("shared-review", false);
    expect(repository.list("global").skills[0]?.enabled).toBe(false);
    expect(repository.promptList()).not.toContain("shared-review");
    await expect(repository.invoke("shared-review")).rejects.toThrow(
      'Skill "shared-review" was not found.',
    );

    await repository.setGlobalSkillEnabled("shared-review", true);
    expect(repository.list("global").skills[0]?.enabled).toBe(true);
    await expect(repository.invoke("shared-review")).resolves.toContain(
      'name="shared-review"',
    );
  });

  it("supports standard metadata and bundled resources", async () => {
    const { project, repository } = await createRepository();
    const skillRoot = path.join(project, "document-review");
    await mkdir(path.join(skillRoot, "references"), { recursive: true });
    await writeFile(
      path.join(skillRoot, "SKILL.md"),
      `---
name: document-review
description: Review documents and apply the project review checklist.
license: Apache-2.0
compatibility: Requires markdown tooling.
allowed-tools: Read Bash(git:*)
metadata:
  author: pine
  version: "1"
---

# Document review
`,
    );
    await writeFile(
      path.join(skillRoot, "references", "checklist.md"),
      "# Checklist\n\n- Check headings\n",
    );

    const listed = repository.list("project");
    expect(listed.skills[0]).toMatchObject({
      allowedTools: "Read Bash(git:*)",
      compatibility: "Requires markdown tooling.",
      license: "Apache-2.0",
      metadata: { author: "pine", version: "1" },
      name: "document-review",
    });
    expect(repository.promptList()).toContain(
      "Review documents and apply the project review checklist.",
    );
    expect(repository.promptList()).toContain(
      `<location>${path.join(skillRoot, "SKILL.md")}</location>`,
    );

    const read = await repository.read("project", "document-review");
    expect(read.skillDirectory).toBe(skillRoot);
    expect(read.resources).toEqual([
      { kind: "directory", path: "references" },
      {
        kind: "file",
        path: "references/checklist.md",
        size: expect.any(Number),
      },
    ]);
    await expect(
      repository.readResource("document-review", "references/checklist.md"),
    ).resolves.toMatchObject({
      content: "# Checklist\n\n- Check headings\n",
      encoding: "utf8",
    });
    await expect(
      repository.readResource("document-review", "../SKILL.md"),
    ).rejects.toThrow("cannot escape");
  });

  it("requires a declared name that matches the skill directory", async () => {
    const { project, repository } = await createRepository();
    await mkdir(path.join(project, "directory-name"), { recursive: true });
    await writeFile(
      path.join(project, "directory-name", "SKILL.md"),
      "---\ndescription: Missing the required name.\n---\n",
    );
    await mkdir(path.join(project, "wrong-directory"), { recursive: true });
    await writeFile(
      path.join(project, "wrong-directory", "SKILL.md"),
      "---\nname: declared-name\ndescription: Directory does not match.\n---\n",
    );

    const result = repository.list("project");
    expect(result.skills).toEqual([]);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          message: "name is required",
          name: "directory-name",
        }),
        expect.objectContaining({
          message: "name must match the skill directory name (wrong-directory)",
          name: "declared-name",
        }),
      ]),
    );
  });
});
