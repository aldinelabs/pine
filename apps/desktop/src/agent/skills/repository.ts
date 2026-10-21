import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  type Dirent,
} from "node:fs";
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
import { randomUUID } from "node:crypto";
import { parse as parseYaml } from "yaml";
import type {
  ListSkillsResult,
  ListSkillResourcesResult,
  PineSkillDiagnostic,
  PineSkillResource,
  PineSkillScope,
  PineSkillSummary,
  ReadSkillResourceResult,
  ReadSkillResult,
} from "../../shared/skills";

const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_SKILL_NAME_LENGTH = 64;
const MAX_SKILL_CONTENT_BYTES = 1_000_000;
const MAX_SKILL_DESCRIPTION_LENGTH = 1_024;
const MAX_SKILL_COMPATIBILITY_LENGTH = 500;
const MAX_SKILL_RESOURCE_BYTES = 10_000_000;
const MAX_SKILL_RESOURCE_PATH_LENGTH = 4_096;

interface Skill {
  allowedTools?: string;
  baseDir: string;
  compatibility?: string;
  description: string;
  disableModelInvocation: boolean;
  filePath: string;
  license?: string;
  metadata: Record<string, string>;
  name: string;
}

interface ResourceDiagnostic {
  message: string;
  name?: string;
  type: "collision" | "error" | "warning";
}

interface SkillLoadResult {
  diagnostics: ResourceDiagnostic[];
  skills: Skill[];
}

interface ParsedSkillDocument {
  body: string;
  frontmatter: Record<string, unknown>;
}

function normalizeSkillText(content: string): string {
  return content
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");
}

function parseSkillDocument(content: string): ParsedSkillDocument {
  const normalized = normalizeSkillText(content);
  if (!normalized.startsWith("---\n")) {
    throw new Error("SKILL.md frontmatter is required.");
  }

  const closingMarker = /\n---(?:\n|$)/g;
  closingMarker.lastIndex = 4;
  const match = closingMarker.exec(normalized);
  if (!match) throw new Error("SKILL.md frontmatter is incomplete.");

  let parsed: unknown;
  try {
    parsed = parseYaml(normalized.slice(4, match.index));
  } catch (error) {
    throw new Error(
      error instanceof Error ? error.message : "Invalid YAML frontmatter.",
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("SKILL.md frontmatter must be a YAML mapping.");
  }

  return {
    body: normalized.slice(match.index + match[0].length).trim(),
    frontmatter: parsed as Record<string, unknown>,
  };
}

function parseSkillFile(
  filePath: string,
  options: { validateDirectoryName?: boolean } = {},
): SkillLoadResult {
  const diagnostics: ResourceDiagnostic[] = [];
  let content: string;
  try {
    content = readFileSync(filePath, "utf8");
  } catch (error) {
    return {
      diagnostics: [
        {
          message:
            error instanceof Error ? error.message : "Unable to read Skill.",
          name: path.basename(path.dirname(filePath)),
          type: "warning",
        },
      ],
      skills: [],
    };
  }

  try {
    const { frontmatter } = parseSkillDocument(content);
    const baseDir = path.dirname(filePath);
    const directoryName = path.basename(baseDir);
    const name = frontmatter.name;
    const description = frontmatter.description;

    if (typeof name !== "string" || name.trim().length === 0) {
      diagnostics.push({
        message: "name is required",
        name: directoryName,
        type: "warning",
      });
    } else if (
      name.length > MAX_SKILL_NAME_LENGTH ||
      !SKILL_NAME_PATTERN.test(name)
    ) {
      diagnostics.push({
        message:
          "name must contain 1-64 lowercase letters, numbers, or single hyphens",
        name,
        type: "warning",
      });
    } else if (
      options.validateDirectoryName !== false &&
      name !== directoryName
    ) {
      diagnostics.push({
        message: `name must match the skill directory name (${directoryName})`,
        name,
        type: "warning",
      });
    }

    if (typeof description !== "string" || description.trim().length === 0) {
      diagnostics.push({
        message: "description is required",
        name: typeof name === "string" ? name : directoryName,
        type: "warning",
      });
    } else if (description.length > MAX_SKILL_DESCRIPTION_LENGTH) {
      diagnostics.push({
        message: `description must be no more than ${MAX_SKILL_DESCRIPTION_LENGTH} characters`,
        name: typeof name === "string" ? name : directoryName,
        type: "warning",
      });
    }

    const compatibility = frontmatter.compatibility;
    if (
      compatibility !== undefined &&
      (typeof compatibility !== "string" ||
        compatibility.trim().length === 0 ||
        compatibility.length > MAX_SKILL_COMPATIBILITY_LENGTH)
    ) {
      diagnostics.push({
        message: `compatibility must be a non-empty string of no more than ${MAX_SKILL_COMPATIBILITY_LENGTH} characters`,
        name: typeof name === "string" ? name : directoryName,
        type: "warning",
      });
    }

    const license = frontmatter.license;
    if (license !== undefined && typeof license !== "string") {
      diagnostics.push({
        message: "license must be a string when provided",
        name: typeof name === "string" ? name : directoryName,
        type: "warning",
      });
    }

    const metadata = frontmatter.metadata;
    const normalizedMetadata: Record<string, string> = {};
    if (
      metadata !== undefined &&
      (typeof metadata !== "object" ||
        metadata === null ||
        Array.isArray(metadata))
    ) {
      diagnostics.push({
        message: "metadata must be a mapping of string keys to string values",
        name: typeof name === "string" ? name : directoryName,
        type: "warning",
      });
    } else if (metadata !== undefined) {
      for (const [key, value] of Object.entries(
        metadata as Record<string, unknown>,
      )) {
        if (typeof value !== "string") {
          diagnostics.push({
            message: `metadata.${key} must be a string`,
            name: typeof name === "string" ? name : directoryName,
            type: "warning",
          });
        } else {
          normalizedMetadata[key] = value;
        }
      }
    }

    const allowedTools = frontmatter["allowed-tools"];
    if (allowedTools !== undefined && typeof allowedTools !== "string") {
      diagnostics.push({
        message: "allowed-tools must be a space-separated string",
        name: typeof name === "string" ? name : directoryName,
        type: "warning",
      });
    }

    if (diagnostics.length > 0) return { diagnostics, skills: [] };

    return {
      diagnostics,
      skills: [
        {
          allowedTools:
            typeof allowedTools === "string" ? allowedTools : undefined,
          baseDir,
          compatibility:
            typeof compatibility === "string" ? compatibility : undefined,
          description: description as string,
          disableModelInvocation:
            frontmatter["disable-model-invocation"] === true,
          filePath,
          license: typeof license === "string" ? license : undefined,
          metadata: normalizedMetadata,
          name: name as string,
        },
      ],
    };
  } catch (error) {
    return {
      diagnostics: [
        {
          message:
            error instanceof Error
              ? error.message
              : "Invalid YAML frontmatter.",
          name: path.basename(path.dirname(filePath)),
          type: "warning",
        },
      ],
      skills: [],
    };
  }
}

function loadSkillsFromDir(
  directory: string,
  options: { validateDirectoryName?: boolean } = {},
): SkillLoadResult {
  const skills: Skill[] = [];
  const diagnostics: ResourceDiagnostic[] = [];
  if (!existsSync(directory)) return { diagnostics, skills };

  let entries: Dirent<string>[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    return {
      diagnostics: [
        {
          message:
            error instanceof Error ? error.message : "Unable to list Skills.",
          type: "warning",
        },
      ],
      skills,
    };
  }

  const declaredSkill = entries.find((entry) => entry.name === "SKILL.md");
  if (declaredSkill) {
    const result = parseSkillFile(
      path.join(directory, declaredSkill.name),
      options,
    );
    return result;
  }

  for (const entry of entries.sort((left, right) =>
    left.name.localeCompare(right.name),
  )) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const entryPath = path.join(directory, entry.name);
    let isDirectory = entry.isDirectory();
    if (entry.isSymbolicLink()) {
      try {
        isDirectory = statSync(entryPath).isDirectory();
      } catch {
        continue;
      }
    }
    if (!isDirectory) continue;
    const result = loadSkillsFromDir(entryPath);
    skills.push(...result.skills);
    diagnostics.push(...result.diagnostics);
  }
  return { diagnostics, skills };
}

function stripFrontmatter(content: string): string {
  try {
    return parseSkillDocument(content).body;
  } catch {
    return normalizeSkillText(content).trim();
  }
}

function validateSkillName(name: string): string {
  const normalized = name.trim();
  if (
    normalized.length === 0 ||
    normalized.length > MAX_SKILL_NAME_LENGTH ||
    !SKILL_NAME_PATTERN.test(normalized)
  ) {
    throw new Error(
      "Skill names must contain 1-64 lowercase letters, numbers, or single hyphens.",
    );
  }
  return normalized;
}

function validateSkillContent(content: string): string {
  const normalized = content.trim();
  if (!normalized) throw new Error("SKILL.md content is required.");
  if (Buffer.byteLength(normalized, "utf8") > MAX_SKILL_CONTENT_BYTES) {
    throw new Error("SKILL.md must be no larger than 1 MB.");
  }
  return `${normalized}\n`;
}

function summary(
  skill: Skill,
  scope: PineSkillScope,
  enabled?: boolean,
): PineSkillSummary {
  return {
    ...(skill.allowedTools === undefined
      ? {}
      : { allowedTools: skill.allowedTools }),
    ...(skill.compatibility === undefined
      ? {}
      : { compatibility: skill.compatibility }),
    description: skill.description,
    disableModelInvocation: skill.disableModelInvocation,
    ...(skill.license === undefined ? {} : { license: skill.license }),
    metadata: { ...skill.metadata },
    managedBy: "pine",
    name: skill.name,
    scope,
    ...(enabled === undefined ? {} : { enabled }),
  };
}

function diagnostic(value: ResourceDiagnostic): PineSkillDiagnostic {
  return {
    message: value.message,
    ...(value.name === undefined ? {} : { name: value.name }),
    type:
      value.type === "collision"
        ? "collision"
        : value.type === "error"
          ? "error"
          : "warning",
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function normalizeResourcePath(resourcePath: string): string {
  const portablePath = resourcePath.replaceAll("\\", "/");
  if (
    portablePath.length === 0 ||
    portablePath.length > MAX_SKILL_RESOURCE_PATH_LENGTH ||
    portablePath.includes("\0") ||
    path.posix.isAbsolute(portablePath) ||
    path.win32.isAbsolute(portablePath)
  ) {
    throw new Error("Skill resource paths must be relative paths.");
  }
  const normalized = path.posix.normalize(portablePath);
  if (
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith(`..${path.sep}`)
  ) {
    throw new Error("Skill resource paths cannot escape the skill directory.");
  }
  return normalized;
}

export async function collectSkillResources(
  baseDir: string,
  relativeDirectory = "",
): Promise<PineSkillResource[]> {
  const directory = path.join(baseDir, relativeDirectory);
  const entries = (await readdir(directory, { withFileTypes: true })).sort(
    (left, right) => left.name.localeCompare(right.name),
  );
  const resources: PineSkillResource[] = [];
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const relativePath = path
      .join(relativeDirectory, entry.name)
      .split(path.sep)
      .join("/");
    if (relativePath === "SKILL.md") continue;
    const absolutePath = path.join(baseDir, relativePath);
    if (entry.isDirectory()) {
      resources.push({ kind: "directory", path: relativePath });
      resources.push(...(await collectSkillResources(baseDir, relativePath)));
      continue;
    }
    if (!entry.isFile()) continue;
    const fileStats = await stat(absolutePath);
    resources.push({
      kind: "file",
      path: relativePath,
      size: fileStats.size,
    });
  }
  return resources;
}

export interface PineSkillRoots {
  disabledGlobalSkillsPath?: string;
  global: string;
  project: string;
}

export interface ResolvedPineSkill {
  scope: PineSkillScope;
  skill: Skill;
}

export class PineSkillRepository {
  constructor(private readonly roots: PineSkillRoots) {}

  /** Names stored in Pine-managed roots, including project-disabled globals. */
  managedSkillNames(): Set<string> {
    return new Set(
      [
        ...loadSkillsFromDir(this.roots.project).skills,
        ...loadSkillsFromDir(this.roots.global).skills,
      ].map((skill) => skill.name),
    );
  }

  /** Directories of valid packages that Skill Authoring may extend with resources. */
  authoringDirectories(): string[] {
    return [
      ...loadSkillsFromDir(this.roots.project).skills,
      ...loadSkillsFromDir(this.roots.global).skills,
    ].map((skill) => skill.baseDir);
  }

  list(scope: PineSkillScope): ListSkillsResult {
    const result = loadSkillsFromDir(this.root(scope));
    return {
      diagnostics: result.diagnostics.map(diagnostic),
      skills: result.skills.map((skill) =>
        summary(
          skill,
          scope,
          scope === "global"
            ? !this.disabledGlobalSkillNames().has(skill.name)
            : undefined,
        ),
      ),
    };
  }

  listCombined(): {
    diagnostics: PineSkillDiagnostic[];
    skills: ResolvedPineSkill[];
  } {
    const project = loadSkillsFromDir(this.roots.project);
    const global = loadSkillsFromDir(this.roots.global);
    const names = new Set<string>();
    const disabledGlobalSkills = this.disabledGlobalSkillNames();
    const skills: ResolvedPineSkill[] = [];
    const diagnostics = [
      ...project.diagnostics.map(diagnostic),
      ...global.diagnostics.map(diagnostic),
    ];
    for (const [scope, values] of [
      ["project", project.skills],
      ["global", global.skills],
    ] as const) {
      for (const skill of values) {
        if (scope === "global" && disabledGlobalSkills.has(skill.name)) {
          continue;
        }
        if (names.has(skill.name)) {
          diagnostics.push({
            message: `Global skill \"${skill.name}\" is shadowed by a project skill.`,
            name: skill.name,
            type: "collision",
          });
          continue;
        }
        names.add(skill.name);
        skills.push({ scope, skill });
      }
    }
    return { diagnostics, skills };
  }

  async read(scope: PineSkillScope, name: string): Promise<ReadSkillResult> {
    const skill = this.requireSkill(scope, name);
    const resources = await collectSkillResources(skill.baseDir);
    return {
      content: await readFile(skill.filePath, "utf8"),
      resources,
      skill: summary(skill, scope),
      skillDirectory: skill.baseDir,
    };
  }

  async listResources(name: string): Promise<ListSkillResourcesResult> {
    const resolved = this.requireCombinedSkill(name);
    const resources = await collectSkillResources(resolved.skill.baseDir);
    return {
      resources,
      skill: summary(resolved.skill, resolved.scope),
    };
  }

  async readResource(
    name: string,
    resourcePath: string,
    encoding: "base64" | "utf8" = "utf8",
  ): Promise<ReadSkillResourceResult> {
    const resolved = this.requireCombinedSkill(name);
    const normalizedPath = normalizeResourcePath(resourcePath);
    if (normalizedPath === "SKILL.md") {
      throw new Error("Use invoke_skill to load SKILL.md instructions.");
    }
    const resources = await collectSkillResources(resolved.skill.baseDir);
    const resource = resources.find(
      (value) => value.kind === "file" && value.path === normalizedPath,
    );
    if (!resource) {
      throw new Error(
        `Resource \"${resourcePath}\" was not found in skill \"${name}\".`,
      );
    }
    if ((resource.size ?? 0) > MAX_SKILL_RESOURCE_BYTES) {
      throw new Error(
        `Skill resource \"${resourcePath}\" exceeds the ${MAX_SKILL_RESOURCE_BYTES}-byte limit.`,
      );
    }

    const baseRealPath = await realpath(resolved.skill.baseDir);
    const resourceRealPath = await realpath(
      path.join(resolved.skill.baseDir, normalizedPath),
    );
    const relativeRealPath = path.relative(baseRealPath, resourceRealPath);
    if (
      relativeRealPath === "" ||
      relativeRealPath === ".." ||
      relativeRealPath.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeRealPath)
    ) {
      throw new Error(
        "Skill resource paths cannot escape the skill directory.",
      );
    }

    const bytes = await readFile(resourceRealPath);
    return {
      content:
        encoding === "base64"
          ? bytes.toString("base64")
          : new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      encoding,
      resource,
      skill: summary(resolved.skill, resolved.scope),
    };
  }

  async invoke(name: string, userRequest?: string): Promise<string> {
    const normalizedName = validateSkillName(name);
    const resolved = this.requireCombinedSkill(normalizedName);
    const content = await readFile(resolved.skill.filePath, "utf8");
    const body = stripFrontmatter(content).trim();
    const resourceHint =
      (await collectSkillResources(resolved.skill.baseDir)).length > 0
        ? "Use list_skill_resources and read_skill_resource to load bundled files when needed."
        : "";
    const allowedToolsHint = resolved.skill.allowedTools
      ? `The skill declares these pre-approved tools: ${resolved.skill.allowedTools}. Pine permissions and approval rules still apply.`
      : "";
    const block = `<skill name="${escapeXml(resolved.skill.name)}" scope="${resolved.scope}">\nReferences are relative to the skill root.\n${allowedToolsHint ? `${allowedToolsHint}\n` : ""}${resourceHint ? `${resourceHint}\n` : ""}\n${body}\n</skill>`;
    const request = userRequest?.trim();
    return request ? `${block}\n\nUser: ${request}` : block;
  }

  async create(
    scope: PineSkillScope,
    name: string,
    content: string,
  ): Promise<ReadSkillResult> {
    const normalizedName = validateSkillName(name);
    const normalizedContent = validateSkillContent(content);
    const root = this.root(scope);
    await mkdir(root, { recursive: true });
    const destination = path.join(root, normalizedName);
    const stage = path.join(root, `.pine-skill-stage-${randomUUID()}`);
    await mkdir(stage, { recursive: false });
    try {
      await writeFile(path.join(stage, "SKILL.md"), normalizedContent, {
        encoding: "utf8",
        flag: "wx",
      });
      this.validateStagedSkill(stage, normalizedName);
      await rename(stage, destination);
    } catch (error) {
      await rm(stage, { recursive: true, force: true });
      throw error;
    }
    return this.read(scope, normalizedName);
  }

  async edit(
    scope: PineSkillScope,
    name: string,
    content: string,
  ): Promise<ReadSkillResult> {
    const normalizedName = validateSkillName(name);
    const normalizedContent = validateSkillContent(content);
    this.requireSkill(scope, normalizedName);
    const root = this.root(scope);
    const destination = path.join(root, normalizedName);
    const validationStage = path.join(
      root,
      `.pine-skill-validation-${randomUUID()}`,
    );
    const nextFile = path.join(destination, `.SKILL.md-${randomUUID()}.tmp`);
    await mkdir(validationStage, { recursive: false });
    try {
      await writeFile(
        path.join(validationStage, "SKILL.md"),
        normalizedContent,
        {
          encoding: "utf8",
          flag: "wx",
        },
      );
      this.validateStagedSkill(validationStage, normalizedName);
      await writeFile(nextFile, normalizedContent, {
        encoding: "utf8",
        flag: "wx",
      });
      await rename(nextFile, path.join(destination, "SKILL.md"));
    } catch (error) {
      await rm(nextFile, { force: true });
      throw error;
    } finally {
      await rm(validationStage, { recursive: true, force: true });
    }
    return this.read(scope, normalizedName);
  }

  async remove(scope: PineSkillScope, name: string): Promise<boolean> {
    const normalizedName = validateSkillName(name);
    this.requireSkill(scope, normalizedName);
    const root = this.root(scope);
    const trash = path.join(root, ".trash");
    await mkdir(trash, { recursive: true });
    await rename(
      path.join(root, normalizedName),
      path.join(trash, `${normalizedName}-${Date.now()}-${randomUUID()}`),
    );
    return true;
  }

  async setGlobalSkillEnabled(name: string, enabled: boolean): Promise<void> {
    const normalizedName = validateSkillName(name);
    this.requireSkill("global", normalizedName);
    const settingsPath = this.roots.disabledGlobalSkillsPath;
    if (!settingsPath) {
      throw new Error("Project Skill settings are unavailable.");
    }
    const disabled = this.disabledGlobalSkillNames();
    if (enabled) disabled.delete(normalizedName);
    else disabled.add(normalizedName);
    await mkdir(path.dirname(settingsPath), { recursive: true });
    const temporary = `${settingsPath}.${randomUUID()}.tmp`;
    await writeFile(
      temporary,
      `${JSON.stringify({ disabledGlobalSkills: [...disabled].sort() }, null, 2)}\n`,
      "utf8",
    );
    await rename(temporary, settingsPath);
  }

  promptList(): string {
    const { skills } = this.listCombined();
    const visible = skills.filter(({ skill }) => !skill.disableModelInvocation);
    if (visible.length === 0) return "";
    const lines = [
      "<available_skills>",
      ...visible.flatMap(({ scope, skill }) => [
        "  <skill>",
        `    <name>${escapeXml(skill.name)}</name>`,
        `    <description>${escapeXml(skill.description)}</description>`,
        `    <scope>${scope}</scope>`,
        `    <location>${escapeXml(skill.filePath)}</location>`,
        "  </skill>",
      ]),
      "</available_skills>",
    ];
    return `The following skills provide specialized instructions. When a task matches, call invoke_skill with the exact skill name before proceeding; do not load instructions by reading skill files. Each location is the skill's actual SKILL.md path on disk, which may differ from other skill lists in this prompt; use it only when the user asks to open, inspect, or locate the file.\n\n${lines.join("\n")}`;
  }

  private root(scope: PineSkillScope): string {
    return scope === "global" ? this.roots.global : this.roots.project;
  }

  private disabledGlobalSkillNames(): Set<string> {
    const settingsPath = this.roots.disabledGlobalSkillsPath;
    if (!settingsPath) return new Set();
    try {
      const parsed = JSON.parse(readFileSync(settingsPath, "utf8")) as {
        disabledGlobalSkills?: unknown;
      };
      if (!Array.isArray(parsed.disabledGlobalSkills)) return new Set();
      return new Set(
        parsed.disabledGlobalSkills.filter(
          (value): value is string =>
            typeof value === "string" && SKILL_NAME_PATTERN.test(value),
        ),
      );
    } catch {
      return new Set();
    }
  }

  private validateStagedSkill(directory: string, expectedName: string): void {
    const result = loadSkillsFromDir(directory, {
      validateDirectoryName: false,
    });
    const loaded = result.skills.find((skill) => skill.name === expectedName);
    if (!loaded) {
      const details = result.diagnostics
        .map((value) => value.message)
        .join(" ");
      throw new Error(details || "SKILL.md did not define a valid skill.");
    }
    if (result.skills.length !== 1) {
      throw new Error("A skill directory must define exactly one SKILL.md.");
    }
  }

  private requireSkill(scope: PineSkillScope, name: string): Skill {
    const normalizedName = validateSkillName(name);
    const result = loadSkillsFromDir(this.root(scope));
    const skill = result.skills.find((value) => value.name === normalizedName);
    if (!skill) throw new Error(`Skill \"${normalizedName}\" was not found.`);
    if (path.basename(skill.baseDir) !== normalizedName) {
      throw new Error(
        "Skill directory and skill name must match before editing.",
      );
    }
    return skill;
  }

  private requireCombinedSkill(name: string): ResolvedPineSkill {
    const normalizedName = validateSkillName(name);
    const { skills } = this.listCombined();
    const resolved = skills.find(
      (value) => value.skill.name === normalizedName,
    );
    if (!resolved)
      throw new Error(`Skill \"${normalizedName}\" was not found.`);
    return resolved;
  }
}
