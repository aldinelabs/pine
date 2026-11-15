import path from "node:path";
import { z } from "zod";
import {
  readPineAgentSettings,
  writeMemoryEnabled,
} from "../../../agent/pineSettings";
import {
  memorySummary,
  PineMemoryRepository,
} from "../../../agent/memory/repository";
import {
  DEFAULT_MEMORY_ENABLED,
  GET_MEMORY_ENABLED_CHANNEL,
  LIST_MEMORIES_CHANNEL,
  READ_MEMORY_CHANNEL,
  REMOVE_MEMORY_CHANNEL,
  SAVE_MEMORY_CHANNEL,
  SET_MEMORY_ENABLED_CHANNEL,
  type ListMemoriesResult,
  type MemoryEnabledResult,
  type PineMemoryNote,
  type PineMemorySummary,
  type RemoveMemoryResult,
} from "../../../shared/memory";
import { PROJECT_MEMORY_DIRECTORY } from "../../../shared/projects";
import type { PineCore } from "../pineCore";
import {
  MemoryIdentityRequestSchema,
  MemoryScopeRequestSchema,
  SaveMemoryRequestSchema,
} from "../requestSchemas";

/** The notes a project's sessions see; global ones alone without a project. */
async function memoryRepositoryFor(
  core: PineCore,
  projectId?: string,
): Promise<PineMemoryRepository> {
  const global = path.join(core.agentDirectory, "memory");
  if (!projectId) return new PineMemoryRepository({ global });
  await core.repository.get(projectId);
  const dataPaths = core.repository.dataPaths(projectId);
  return new PineMemoryRepository({
    global,
    project:
      dataPaths.memoryRoot ??
      path.join(dataPaths.projectRoot, PROJECT_MEMORY_DIRECTORY),
  });
}

export function registerMemoryRequests(core: PineCore): void {
  core.handle(
    LIST_MEMORIES_CHANNEL,
    async (_context, request: unknown): Promise<ListMemoriesResult> => {
      const parsed = MemoryScopeRequestSchema.parse(request ?? {});
      const repository = await memoryRepositoryFor(core, parsed.projectId);
      return { memories: await repository.list() };
    },
  );

  core.handle(
    READ_MEMORY_CHANNEL,
    async (_context, request: unknown): Promise<PineMemoryNote> => {
      const parsed = MemoryIdentityRequestSchema.parse(request);
      const repository = await memoryRepositoryFor(core, parsed.projectId);
      const note = await repository.read(parsed.scope, parsed.name);
      if (!note) throw new Error("Memory not found.");
      return note;
    },
  );

  core.handle(
    SAVE_MEMORY_CHANNEL,
    async (_context, request: unknown): Promise<PineMemorySummary> => {
      const parsed = SaveMemoryRequestSchema.parse(request);
      const repository = await memoryRepositoryFor(core, parsed.projectId);
      return memorySummary(
        await repository.save({
          scope: parsed.scope,
          name: parsed.name,
          description: parsed.description,
          content: parsed.content,
          verified: parsed.verified,
        }),
      );
    },
  );

  core.handle(
    REMOVE_MEMORY_CHANNEL,
    async (_context, request: unknown): Promise<RemoveMemoryResult> => {
      const parsed = MemoryIdentityRequestSchema.parse(request);
      const repository = await memoryRepositoryFor(core, parsed.projectId);
      return { removed: await repository.remove(parsed.scope, parsed.name) };
    },
  );

  core.handle(
    GET_MEMORY_ENABLED_CHANNEL,
    async (): Promise<boolean> =>
      (await readPineAgentSettings(core.agentDirectory)).memoryEnabled ??
      DEFAULT_MEMORY_ENABLED,
  );

  core.handle(
    SET_MEMORY_ENABLED_CHANNEL,
    async (_context, request: unknown): Promise<MemoryEnabledResult> => {
      const { enabled } = z.object({ enabled: z.boolean() }).parse(request);
      await writeMemoryEnabled(core.agentDirectory, enabled);
      return { enabled };
    },
  );
}
