import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  filterPineManagedSkills,
  piProjectSkillPaths,
  pineScopeForPiSkill,
  summarizePiSkill,
} from "../../../agent/skills/piDiscovery";
import {
  collectSkillResources,
  PineSkillRepository,
} from "../../../agent/skills/repository";
import {
  CREATE_SKILL_CHANNEL,
  EDIT_SKILL_CHANNEL,
  LIST_SKILLS_CHANNEL,
  READ_SKILL_CHANNEL,
  REMOVE_SKILL_CHANNEL,
  SET_GLOBAL_SKILL_ENABLED_CHANNEL,
  type ListSkillsResult,
  type PineSkillScope,
  type ReadSkillResult,
  type RemoveSkillResult,
  type SetGlobalSkillEnabledResult,
} from "../../../shared/skills";
import type { PineCore } from "../pineCore";
import {
  SetGlobalSkillEnabledRequestSchema,
  SkillIdentityRequestSchema,
  SkillScopeRequestSchema,
  WriteSkillRequestSchema,
} from "../requestSchemas";

type DefaultResourceLoader =
  import("@earendil-works/pi-coding-agent").DefaultResourceLoader;
type PiSkill = import("@earendil-works/pi-coding-agent").Skill;

/** Pine-managed Skills and the Pi Skills discovered beside them. */
export function registerSkillRequests(core: PineCore): void {
  async function skillRepositoryFor(
    scope: PineSkillScope,
    projectId?: string,
  ): Promise<PineSkillRepository> {
    const repository = core.repository;
    if (scope === "project" && !projectId) {
      throw new Error("Project scope requires a project ID.");
    }

    let projectSkillsRoot = path.join(
      core.agentDirectory,
      ".no-project-skills",
    );
    let disabledGlobalSkillsPath: string | undefined;
    if (projectId) {
      await repository.get(projectId);
      const dataPaths = repository.dataPaths(projectId);
      disabledGlobalSkillsPath =
        dataPaths.skillsSettingsPath ??
        path.join(dataPaths.projectRoot, "skills.json");
      if (scope === "project") {
        projectSkillsRoot =
          dataPaths.skillsRoot ?? path.join(dataPaths.projectRoot, "skills");
      }
    }

    return new PineSkillRepository({
      ...(disabledGlobalSkillsPath ? { disabledGlobalSkillsPath } : {}),
      global: path.join(core.agentDirectory, "skills"),
      project: projectSkillsRoot,
    });
  }

  async function piSkillResourceLoader(
    projectId: string | undefined,
    repository: PineSkillRepository,
  ): Promise<DefaultResourceLoader> {
    const { DefaultResourceLoader, SettingsManager, loadSkills } =
      await import("@earendil-works/pi-coding-agent");
    const agentDir = core.agentDirectory;
    const cwd = projectId ? await core.defaultFolderPath(projectId) : agentDir;
    const settingsManager = SettingsManager.create(cwd, agentDir, {
      projectTrusted: false,
    });
    const loader = new DefaultResourceLoader({
      cwd,
      agentDir,
      settingsManager,
      noExtensions: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      additionalSkillPaths: projectId ? piProjectSkillPaths(cwd) : [],
      skillsOverride: filterPineManagedSkills(
        repository,
        cwd,
        agentDir,
        loadSkills,
      ),
    });
    await loader.reload();
    return loader;
  }

  async function readPiSkill(
    projectId: string | undefined,
    repository: PineSkillRepository,
    scope: PineSkillScope,
    name: string,
  ): Promise<ReadSkillResult> {
    const loader = await piSkillResourceLoader(projectId, repository);
    const skill = loader
      .getSkills()
      .skills.find(
        (candidate) =>
          candidate.name === name && pineScopeForPiSkill(candidate) === scope,
      );
    if (!skill) throw new Error(`Pi skill "${name}" was not found.`);

    return piSkillReadResult(skill);
  }

  async function piSkillReadResult(skill: PiSkill): Promise<ReadSkillResult> {
    return {
      content: await readFile(skill.filePath, "utf8"),
      resources: await collectSkillResources(skill.baseDir),
      skill: summarizePiSkill(skill),
      skillDirectory: skill.baseDir,
    };
  }

  async function editPiSkill(
    projectId: string | undefined,
    repository: PineSkillRepository,
    scope: PineSkillScope,
    name: string,
    content: string,
  ): Promise<ReadSkillResult> {
    const loader = await piSkillResourceLoader(projectId, repository);
    const skill = loader
      .getSkills()
      .skills.find(
        (candidate) =>
          candidate.name === name && pineScopeForPiSkill(candidate) === scope,
      );
    if (!skill) throw new Error(`Pi skill "${name}" was not found.`);
    if (summarizePiSkill(skill).readOnly) {
      throw new Error("This Pi Skill is package-managed and cannot be edited.");
    }

    const normalizedContent = `${content.trim()}\n`;
    if (
      normalizedContent.trim().length === 0 ||
      Buffer.byteLength(normalizedContent, "utf8") > 1_000_000
    ) {
      throw new Error("SKILL.md must contain 1-1,000,000 bytes of content.");
    }

    const validationDirectory = path.join(
      skill.baseDir,
      `.pine-skill-validation-${randomUUID()}`,
    );
    const stagedFile = `${skill.filePath}.${randomUUID()}.tmp`;
    await mkdir(validationDirectory, { recursive: false });
    try {
      await writeFile(
        path.join(validationDirectory, "SKILL.md"),
        normalizedContent,
        {
          encoding: "utf8",
          flag: "wx",
        },
      );
      const { loadSkillsFromDir } =
        await import("@earendil-works/pi-coding-agent");
      const validation = loadSkillsFromDir({
        dir: validationDirectory,
        source: "temporary",
      });
      if (
        validation.skills.length !== 1 ||
        validation.skills[0]?.name !== name
      ) {
        throw new Error(
          validation.diagnostics[0]?.message ??
            "The edited Skill is not valid Pi Skill content.",
        );
      }
      await writeFile(stagedFile, normalizedContent, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(stagedFile, skill.filePath);
    } finally {
      await rm(stagedFile, { force: true });
      await rm(validationDirectory, { recursive: true, force: true });
    }

    return readPiSkill(projectId, repository, scope, name);
  }

  async function removePiSkill(
    projectId: string | undefined,
    repository: PineSkillRepository,
    scope: PineSkillScope,
    name: string,
  ): Promise<boolean> {
    const loader = await piSkillResourceLoader(projectId, repository);
    const skill = loader
      .getSkills()
      .skills.find(
        (candidate) =>
          candidate.name === name && pineScopeForPiSkill(candidate) === scope,
      );
    if (!skill) throw new Error(`Pi skill "${name}" was not found.`);
    if (summarizePiSkill(skill).readOnly) {
      throw new Error(
        "This Pi Skill is package-managed and cannot be deleted.",
      );
    }

    const trashDirectory = path.join(
      skill.baseDir,
      ".trash",
      `${name}-${Date.now()}-${randomUUID()}`,
    );
    await mkdir(trashDirectory, { recursive: true });
    await rename(
      skill.filePath,
      path.join(trashDirectory, path.basename(skill.filePath)),
    );
    return true;
  }

  core.handle(
    LIST_SKILLS_CHANNEL,
    async (_context, request: unknown): Promise<ListSkillsResult> => {
      const parsed = SkillScopeRequestSchema.parse(request);
      const repository = await skillRepositoryFor(
        parsed.scope,
        parsed.projectId,
      );
      const managed = repository.list(parsed.scope);
      const piSkills = await piSkillResourceLoader(
        parsed.projectId,
        repository,
      );
      const discovered = piSkills.getSkills();
      return {
        diagnostics: [
          ...managed.diagnostics,
          ...discovered.diagnostics.map((entry) => ({
            message: entry.message,
            type:
              entry.type === "collision"
                ? ("collision" as const)
                : entry.type === "error"
                  ? ("error" as const)
                  : ("warning" as const),
          })),
        ],
        skills: [
          ...managed.skills,
          ...discovered.skills
            .filter((skill) => pineScopeForPiSkill(skill) === parsed.scope)
            .map(summarizePiSkill),
        ],
      };
    },
  );

  core.handle(
    READ_SKILL_CHANNEL,
    async (_context, request: unknown): Promise<ReadSkillResult> => {
      const parsed = SkillIdentityRequestSchema.parse(request);
      const repository = await skillRepositoryFor(
        parsed.scope,
        parsed.projectId,
      );
      if (parsed.managedBy === "pi") {
        return readPiSkill(
          parsed.projectId,
          repository,
          parsed.scope,
          parsed.name,
        );
      }
      return repository.read(parsed.scope, parsed.name);
    },
  );

  core.handle(
    CREATE_SKILL_CHANNEL,
    async (_context, request: unknown): Promise<ReadSkillResult> => {
      const parsed = WriteSkillRequestSchema.parse(request);
      if (parsed.managedBy === "pi") {
        throw new Error("New Skills must use Pine-managed storage.");
      }
      return (await skillRepositoryFor(parsed.scope, parsed.projectId)).create(
        parsed.scope,
        parsed.name,
        parsed.content,
      );
    },
  );

  core.handle(
    EDIT_SKILL_CHANNEL,
    async (_context, request: unknown): Promise<ReadSkillResult> => {
      const parsed = WriteSkillRequestSchema.parse(request);
      const repository = await skillRepositoryFor(
        parsed.scope,
        parsed.projectId,
      );
      if (parsed.managedBy === "pi") {
        return editPiSkill(
          parsed.projectId,
          repository,
          parsed.scope,
          parsed.name,
          parsed.content,
        );
      }
      return repository.edit(parsed.scope, parsed.name, parsed.content);
    },
  );

  core.handle(
    REMOVE_SKILL_CHANNEL,
    async (_context, request: unknown): Promise<RemoveSkillResult> => {
      const parsed = SkillIdentityRequestSchema.parse(request);
      const repository = await skillRepositoryFor(
        parsed.scope,
        parsed.projectId,
      );
      return {
        removed:
          parsed.managedBy === "pi"
            ? await removePiSkill(
                parsed.projectId,
                repository,
                parsed.scope,
                parsed.name,
              )
            : await repository.remove(parsed.scope, parsed.name),
      };
    },
  );

  core.handle(
    SET_GLOBAL_SKILL_ENABLED_CHANNEL,
    async (
      _context,
      request: unknown,
    ): Promise<SetGlobalSkillEnabledResult> => {
      const parsed = SetGlobalSkillEnabledRequestSchema.parse(request);
      const repository = await skillRepositoryFor("project", parsed.projectId);
      await repository.setGlobalSkillEnabled(parsed.name, parsed.enabled);
      return { updated: true };
    },
  );
}
