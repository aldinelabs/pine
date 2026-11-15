import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import {
  isMemoryName,
  MEMORY_CONTENT_MAX_LENGTH,
  MEMORY_DESCRIPTION_MAX_LENGTH,
  type PineMemoryNote,
  type PineMemoryScope,
  type PineMemorySummary,
} from "../../shared/memory";

const NOTE_EXTENSION = ".md";

export interface PineMemoryRoots {
  global: string;
  /** Absent where there is no project, such as a settings window. */
  project?: string;
}

export interface SaveMemoryInput {
  content: string;
  description: string;
  name: string;
  scope: PineMemoryScope;
  sessionId?: string;
  verified: boolean;
}

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function singleLine(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

function renderNote(note: PineMemoryNote): string {
  const frontmatter = stringifyYaml(
    {
      name: note.name,
      description: note.description,
      verified: note.verified,
      updatedAt: note.updatedAt,
      ...(note.sessionId ? { sessionId: note.sessionId } : {}),
    },
    { lineWidth: 0 },
  );
  return `---\n${frontmatter}---\n\n${note.content.trim()}\n`;
}

function parseNote(
  scope: PineMemoryScope,
  name: string,
  source: string,
): PineMemoryNote | undefined {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/u.exec(source);
  if (!match) return undefined;
  let frontmatter: unknown;
  try {
    frontmatter = parseYaml(match[1] ?? "");
  } catch {
    return undefined;
  }
  if (
    typeof frontmatter !== "object" ||
    frontmatter === null ||
    Array.isArray(frontmatter)
  )
    return undefined;
  const fields = frontmatter as Record<string, unknown>;
  if (typeof fields.description !== "string") return undefined;
  const description = singleLine(fields.description);
  if (!description) return undefined;
  return {
    name,
    scope,
    description,
    verified: fields.verified === true,
    updatedAt: typeof fields.updatedAt === "string" ? fields.updatedAt : "",
    ...(typeof fields.sessionId === "string" && fields.sessionId
      ? { sessionId: fields.sessionId }
      : {}),
    content: (match[2] ?? "").trim(),
  };
}

/** The note without its text. */
export function memorySummary(note: PineMemoryNote): PineMemorySummary {
  return {
    name: note.name,
    scope: note.scope,
    description: note.description,
    verified: note.verified,
    updatedAt: note.updatedAt,
    ...(note.sessionId ? { sessionId: note.sessionId } : {}),
  };
}

/**
 * File-backed memory notes. Each note is its own file and is replaced by an
 * atomic rename, so sessions writing at the same time never overwrite each
 * other's notes; the list every session sees is derived from the files and
 * cannot drift from them.
 */
export class PineMemoryRepository {
  constructor(private readonly roots: PineMemoryRoots) {}

  private root(scope: PineMemoryScope): string {
    const root = scope === "global" ? this.roots.global : this.roots.project;
    if (!root) throw new Error("Project memory needs a project.");
    return root;
  }

  private notePath(scope: PineMemoryScope, name: string): string {
    if (!isMemoryName(name))
      throw new Error(
        "A memory name is lowercase letters and digits joined by single hyphens, at most 64 characters.",
      );
    return path.join(this.root(scope), `${name}${NOTE_EXTENSION}`);
  }

  private async listScope(scope: PineMemoryScope): Promise<PineMemoryNote[]> {
    const root = scope === "global" ? this.roots.global : this.roots.project;
    if (!root) return [];
    let files: string[];
    try {
      files = await readdir(root);
    } catch (error) {
      if (isMissing(error)) return [];
      throw error;
    }
    const notes = await Promise.all(
      files
        .filter((file) => file.endsWith(NOTE_EXTENSION))
        .map((file) => file.slice(0, -NOTE_EXTENSION.length))
        .filter(isMemoryName)
        .sort()
        .map((name) => this.read(scope, name).catch(() => undefined)),
    );
    return notes.filter((note): note is PineMemoryNote => note !== undefined);
  }

  /** Every readable note, project scope first, each scope sorted by name. */
  async list(): Promise<PineMemorySummary[]> {
    const [project, global] = await Promise.all([
      this.listScope("project"),
      this.listScope("global"),
    ]);
    return [...project, ...global].map(memorySummary);
  }

  async read(
    scope: PineMemoryScope,
    name: string,
  ): Promise<PineMemoryNote | undefined> {
    let source: string;
    try {
      source = await readFile(this.notePath(scope, name), "utf8");
    } catch (error) {
      if (isMissing(error)) return undefined;
      throw error;
    }
    return parseNote(scope, name, source);
  }

  /** Create the note, or replace the one of the same name and scope. */
  async save(input: SaveMemoryInput): Promise<PineMemoryNote> {
    const description = singleLine(input.description);
    const content = input.content.trim();
    if (!description) throw new Error("A memory needs a description.");
    if (description.length > MEMORY_DESCRIPTION_MAX_LENGTH)
      throw new Error(
        `A memory description is at most ${MEMORY_DESCRIPTION_MAX_LENGTH} characters.`,
      );
    if (!content) throw new Error("A memory needs content.");
    if (content.length > MEMORY_CONTENT_MAX_LENGTH)
      throw new Error(
        `A memory is at most ${MEMORY_CONTENT_MAX_LENGTH} characters.`,
      );
    const destination = this.notePath(input.scope, input.name);
    const note: PineMemoryNote = {
      name: input.name,
      scope: input.scope,
      description,
      verified: input.verified,
      updatedAt: new Date().toISOString(),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
      content,
    };
    await mkdir(path.dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, renderNote(note), "utf8");
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
    return note;
  }

  /** Whether a note was there to remove. */
  async remove(scope: PineMemoryScope, name: string): Promise<boolean> {
    try {
      await rm(this.notePath(scope, name));
      return true;
    } catch (error) {
      if (isMissing(error)) return false;
      throw error;
    }
  }
}
