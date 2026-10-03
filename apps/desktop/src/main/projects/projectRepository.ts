import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import {
  PROJECT_CACHE_DIRECTORY,
  PROJECT_ATTACHMENTS_DIRECTORY,
  PROJECT_METADATA_FILE,
  PROJECT_SESSIONS_DIRECTORY,
  PROJECT_SKILLS_DIRECTORY,
  PROJECT_SKILLS_SETTINGS_FILE,
  PROJECT_TEMPORARY_DIRECTORY,
  PROJECT_COLOR_THEMES,
  PROJECT_ICONS,
  TEMPORARY_WORKSPACE_DIRECTORY,
  TEMPORARY_WORKSPACE_FOLDER_ID,
  TEMPORARY_WORKSPACE_PROJECT_ID,
  isTemporaryWorkspace,
  type PineProject,
  type PineSessionGroup,
  type ProjectFolderInput,
  type ProjectMutationInput,
} from "../../shared/projects";

const PROJECT_SCHEMA_VERSION = 1 as const;

const ProjectFolderSchema = z.object({
  access: z.enum(["read-only", "read-write"]),
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  path: z.string().min(1).max(4_096),
});

const ProjectSessionGroupSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().min(1).max(100),
  sessionIds: z.array(z.uuid()),
});

const StoredProjectSchema = z.object({
  createdAt: z.iso.datetime(),
  defaultFolderId: z.uuid(),
  folders: z.array(ProjectFolderSchema).min(1),
  id: z.uuid(),
  lastOpenedAt: z.iso.datetime().optional(),
  name: z.string().trim().min(1).max(100),
  projectColorTheme: z
    .union([z.enum(PROJECT_COLOR_THEMES), z.literal("neutral")])
    .transform((theme) => (theme === "neutral" ? "olive" : theme))
    .default("olive"),
  projectIcon: z.enum(PROJECT_ICONS).catch("inbox"),
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION),
  sessionGroups: z.array(ProjectSessionGroupSchema).default([]),
  updatedAt: z.iso.datetime(),
});

type StoredProject = z.infer<typeof StoredProjectSchema>;

export interface ProjectDataPaths {
  attachmentsRoot: string;
  cacheRoot: string;
  projectRoot: string;
  sessionsRoot: string;
  skillsRoot?: string;
  skillsSettingsPath?: string;
  temporaryRoot?: string;
}

/** Stored name; the renderer shows a localized label instead. */
const TEMPORARY_WORKSPACE_NAME = "Temporary Workspace";

function assertEditable(id: string): void {
  if (isTemporaryWorkspace(id)) {
    throw new Error("The temporary workspace cannot be changed or deleted.");
  }
}

function isFileSystemError(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

function parseProject(contents: string): StoredProject {
  try {
    return StoredProjectSchema.parse(JSON.parse(contents));
  } catch (error) {
    throw new Error("The Pine project metadata is invalid or unsupported.", {
      cause: error,
    });
  }
}

function pathContains(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${path.sep}`) &&
      relativePath !== ".." &&
      !path.isAbsolute(relativePath))
  );
}

function validateFolderRelationships(folders: ProjectFolderInput[]): void {
  const ids = new Set<string>();

  for (const folder of folders) {
    if (ids.has(folder.id)) {
      throw new Error("Project folder IDs must be unique.");
    }
    ids.add(folder.id);
  }

  for (let leftIndex = 0; leftIndex < folders.length; leftIndex += 1) {
    for (
      let rightIndex = leftIndex + 1;
      rightIndex < folders.length;
      rightIndex += 1
    ) {
      const leftPath = path.resolve(folders[leftIndex].path);
      const rightPath = path.resolve(folders[rightIndex].path);
      if (
        pathContains(leftPath, rightPath) ||
        pathContains(rightPath, leftPath)
      ) {
        throw new Error(
          "Project folders cannot be duplicated or nested inside each other.",
        );
      }
    }
  }
}

async function canonicalizeDirectory(directoryPath: string): Promise<string> {
  const canonicalPath = await realpath(directoryPath);
  const info = await stat(canonicalPath);
  if (!info.isDirectory())
    throw new Error("Project folders must be directories.");
  return canonicalPath;
}

async function isAvailableDirectory(directoryPath: string): Promise<boolean> {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch {
    return false;
  }
}

export class ProjectRepository {
  constructor(private readonly projectsRoot: string) {}

  async list(): Promise<PineProject[]> {
    await this.ensureTemporaryWorkspace();
    let entries;
    try {
      entries = await readdir(this.projectsRoot, { withFileTypes: true });
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) return [];
      throw error;
    }

    const projects = await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map(async (entry) => {
          try {
            return await this.readPublic(entry.name);
          } catch {
            return null;
          }
        }),
    );

    return projects
      .filter((project): project is PineProject => project !== null)
      .sort((left, right) => {
        // The temporary workspace always leads the list.
        if (isTemporaryWorkspace(left.id)) return -1;
        if (isTemporaryWorkspace(right.id)) return 1;
        const leftTime = Date.parse(left.lastOpenedAt ?? left.updatedAt);
        const rightTime = Date.parse(right.lastOpenedAt ?? right.updatedAt);
        return rightTime - leftTime;
      });
  }

  async create(input: ProjectMutationInput): Promise<PineProject> {
    const folders = await this.normalizeFolders(input.folders);
    const now = new Date().toISOString();
    const project: StoredProject = this.validateProject({
      createdAt: now,
      defaultFolderId: input.defaultFolderId,
      folders,
      id: randomUUID(),
      name: input.name,
      projectColorTheme: input.projectColorTheme ?? "olive",
      projectIcon: input.projectIcon ?? "inbox",
      schemaVersion: PROJECT_SCHEMA_VERSION,
      sessionGroups: [],
      updatedAt: now,
    });

    const projectRoot = this.projectRoot(project.id);
    await mkdir(this.projectsRoot, { recursive: true });
    await mkdir(projectRoot, { recursive: false });
    try {
      await this.write(project);
    } catch (error) {
      await rm(projectRoot, { recursive: true, force: true });
      throw error;
    }
    return this.toPublic(project);
  }

  async get(id: string): Promise<PineProject> {
    return this.toPublic(await this.read(id));
  }

  async open(id: string): Promise<PineProject> {
    const project = await this.read(id);
    project.lastOpenedAt = new Date().toISOString();
    await this.write(project);
    return this.toPublic(project);
  }

  async update(id: string, input: ProjectMutationInput): Promise<PineProject> {
    assertEditable(id);
    const current = await this.read(id);
    const folders = await this.normalizeFolders(input.folders, current.folders);
    const project = this.validateProject({
      ...current,
      defaultFolderId: input.defaultFolderId,
      folders,
      name: input.name,
      projectColorTheme: input.projectColorTheme ?? current.projectColorTheme,
      projectIcon: input.projectIcon ?? current.projectIcon,
      sessionGroups: current.sessionGroups,
      updatedAt: new Date().toISOString(),
    });
    await this.write(project);
    return this.toPublic(project);
  }

  async updateSessionGroups(
    id: string,
    sessionGroups: PineSessionGroup[],
  ): Promise<PineProject> {
    const current = await this.read(id);
    const project = this.validateProject({
      ...current,
      sessionGroups,
      updatedAt: new Date().toISOString(),
    });
    await this.write(project);
    return this.toPublic(project);
  }

  async delete(id: string): Promise<boolean> {
    assertEditable(id);
    const project = await this.read(id);
    await rm(this.projectRoot(project.id), { recursive: true, force: false });
    return true;
  }

  dataPaths(id: string): ProjectDataPaths {
    const projectRoot = this.projectRoot(id);
    return {
      attachmentsRoot: path.join(projectRoot, PROJECT_ATTACHMENTS_DIRECTORY),
      cacheRoot: path.join(projectRoot, PROJECT_CACHE_DIRECTORY),
      projectRoot,
      sessionsRoot: path.join(projectRoot, PROJECT_SESSIONS_DIRECTORY),
      skillsRoot: path.join(projectRoot, PROJECT_SKILLS_DIRECTORY),
      skillsSettingsPath: path.join(projectRoot, PROJECT_SKILLS_SETTINGS_FILE),
      temporaryRoot: path.join(projectRoot, PROJECT_TEMPORARY_DIRECTORY),
    };
  }

  private async normalizeFolders(
    folders: ProjectFolderInput[],
    previousFolders: ProjectFolderInput[] = [],
  ): Promise<ProjectFolderInput[]> {
    const previousById = new Map(
      previousFolders.map((folder) => [folder.id, folder]),
    );
    const normalized = await Promise.all(
      folders.map(async (folder) => {
        const parsed = ProjectFolderSchema.parse(folder);
        const previous = previousById.get(parsed.id);
        const folderPath =
          previous?.path === parsed.path
            ? path.resolve(parsed.path)
            : await canonicalizeDirectory(parsed.path);
        return { ...parsed, path: folderPath };
      }),
    );
    validateFolderRelationships(normalized);
    return normalized;
  }

  private validateProject(project: StoredProject): StoredProject {
    const parsed = StoredProjectSchema.parse(project);
    if (
      !parsed.folders.some((folder) => folder.id === parsed.defaultFolderId)
    ) {
      throw new Error("The default folder must belong to the project.");
    }
    validateFolderRelationships(parsed.folders);
    return parsed;
  }

  private projectRoot(id: string): string {
    const projectId = z.uuid().parse(id);
    return path.join(this.projectsRoot, projectId);
  }

  private metadataPath(id: string): string {
    return path.join(this.projectRoot(id), PROJECT_METADATA_FILE);
  }

  /**
   * Create the temporary workspace on first use and pin its fixed fields, so
   * a hand-edited or relocated data directory cannot change what it is.
   */
  async ensureTemporaryWorkspace(): Promise<void> {
    const id = TEMPORARY_WORKSPACE_PROJECT_ID;
    const projectRoot = this.projectRoot(id);
    const workspacePath = path.join(projectRoot, TEMPORARY_WORKSPACE_DIRECTORY);
    await mkdir(workspacePath, { recursive: true });

    let current: StoredProject | null = null;
    try {
      current = parseProject(await readFile(this.metadataPath(id), "utf8"));
    } catch {
      // Missing or damaged metadata is rebuilt from the fixed fields.
    }
    const now = new Date().toISOString();
    const pinned: StoredProject = {
      createdAt: current?.createdAt ?? now,
      defaultFolderId: TEMPORARY_WORKSPACE_FOLDER_ID,
      folders: [
        {
          access: "read-write",
          id: TEMPORARY_WORKSPACE_FOLDER_ID,
          name: TEMPORARY_WORKSPACE_NAME,
          path: workspacePath,
        },
      ],
      id,
      ...(current?.lastOpenedAt ? { lastOpenedAt: current.lastOpenedAt } : {}),
      name: TEMPORARY_WORKSPACE_NAME,
      projectColorTheme: "olive",
      projectIcon: "inbox",
      schemaVersion: PROJECT_SCHEMA_VERSION,
      sessionGroups: current?.sessionGroups ?? [],
      updatedAt: current?.updatedAt ?? now,
    };
    if (JSON.stringify(current) !== JSON.stringify(pinned)) {
      await this.write(pinned);
    }
  }

  private async read(id: string): Promise<StoredProject> {
    if (isTemporaryWorkspace(id)) await this.ensureTemporaryWorkspace();
    try {
      return parseProject(await readFile(this.metadataPath(id), "utf8"));
    } catch (error) {
      if (isFileSystemError(error, "ENOENT")) {
        throw new Error("Pine project not found.", { cause: error });
      }
      throw error;
    }
  }

  private async readPublic(id: string): Promise<PineProject> {
    return this.toPublic(await this.read(id));
  }

  private async toPublic(project: StoredProject): Promise<PineProject> {
    return {
      ...project,
      folders: await Promise.all(
        project.folders.map(async (folder) => ({
          ...folder,
          isAvailable: await isAvailableDirectory(folder.path),
        })),
      ),
    };
  }

  private async write(project: StoredProject): Promise<void> {
    const projectRoot = this.projectRoot(project.id);
    await mkdir(projectRoot, { recursive: true });
    const metadataPath = this.metadataPath(project.id);
    const temporaryPath = path.join(
      projectRoot,
      `.${PROJECT_METADATA_FILE}.${randomUUID()}.tmp`,
    );

    try {
      await writeFile(
        temporaryPath,
        `${JSON.stringify(project, null, 2)}\n`,
        "utf8",
      );
      await rename(temporaryPath, metadataPath);
    } catch (error) {
      await rm(temporaryPath, { force: true }).catch(() => undefined);
      throw error;
    }
  }
}
