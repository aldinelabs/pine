import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GET_MEMORY_ENABLED_CHANNEL,
  LIST_MEMORIES_CHANNEL,
  READ_MEMORY_CHANNEL,
  REMOVE_MEMORY_CHANNEL,
  SAVE_MEMORY_CHANNEL,
  SET_MEMORY_ENABLED_CHANNEL,
} from "../../../../shared/memory";
import type { PineCore } from "../../pineCore";
import { registerMemoryRequests } from "../memory";

const roots: string[] = [];
const projectId = "22222222-2222-4222-8222-222222222222";

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "pine-memory-host-"));
  roots.push(root);
  const handlers = new Map<
    string,
    (context: unknown, request?: unknown) => Promise<unknown>
  >();
  const get = vi.fn().mockResolvedValue({ id: projectId });
  const core = {
    agentDirectory: path.join(root, "agent"),
    handle: (channel: string, handler: never) => handlers.set(channel, handler),
    repository: {
      get,
      dataPaths: () => ({
        projectRoot: path.join(root, "project"),
        memoryRoot: path.join(root, "project", "memory"),
      }),
    },
  } as unknown as PineCore;
  registerMemoryRequests(core);
  const invoke = (channel: string, request?: unknown) => {
    const handler = handlers.get(channel);
    if (!handler) throw new Error(`No handler for ${channel}`);
    return handler({}, request);
  };
  return { get, invoke };
}

const note = {
  projectId,
  scope: "project",
  name: "release-day",
  description: "Releases go out on Thursdays",
  content: "Stated by the user.",
  verified: true,
};

describe("memory requests", () => {
  it("saves, lists, reads, and removes a project note", async () => {
    const { invoke } = await fixture();
    await expect(invoke(SAVE_MEMORY_CHANNEL, note)).resolves.toMatchObject({
      scope: "project",
      name: "release-day",
      verified: true,
    });
    await expect(
      invoke(LIST_MEMORIES_CHANNEL, { projectId }),
    ).resolves.toMatchObject({ memories: [{ name: "release-day" }] });
    await expect(
      invoke(READ_MEMORY_CHANNEL, {
        projectId,
        scope: "project",
        name: "release-day",
      }),
    ).resolves.toMatchObject({ content: "Stated by the user." });
    await expect(
      invoke(REMOVE_MEMORY_CHANNEL, {
        projectId,
        scope: "project",
        name: "release-day",
      }),
    ).resolves.toEqual({ removed: true });
    await expect(invoke(LIST_MEMORIES_CHANNEL, { projectId })).resolves.toEqual(
      { memories: [] },
    );
  });

  it("lists only global notes without a project", async () => {
    const { get, invoke } = await fixture();
    await invoke(SAVE_MEMORY_CHANNEL, note);
    await invoke(SAVE_MEMORY_CHANNEL, {
      ...note,
      projectId: undefined,
      scope: "global",
      name: "tone",
    });
    get.mockClear();
    await expect(invoke(LIST_MEMORIES_CHANNEL, {})).resolves.toMatchObject({
      memories: [{ scope: "global", name: "tone" }],
    });
    expect(get).not.toHaveBeenCalled();
  });

  it("rejects a project note without a project and unsafe names", async () => {
    const { invoke } = await fixture();
    await expect(
      invoke(SAVE_MEMORY_CHANNEL, { ...note, projectId: undefined }),
    ).rejects.toThrow();
    await expect(
      invoke(SAVE_MEMORY_CHANNEL, { ...note, name: "../escape" }),
    ).rejects.toThrow();
    await expect(
      invoke(READ_MEMORY_CHANNEL, {
        projectId,
        scope: "project",
        name: "absent",
      }),
    ).rejects.toThrow("Memory not found.");
  });

  it("is on until turned off", async () => {
    const { invoke } = await fixture();
    await expect(invoke(GET_MEMORY_ENABLED_CHANNEL)).resolves.toBe(true);
    await expect(
      invoke(SET_MEMORY_ENABLED_CHANNEL, { enabled: false }),
    ).resolves.toEqual({ enabled: false });
    await expect(invoke(GET_MEMORY_ENABLED_CHANNEL)).resolves.toBe(false);
  });
});
