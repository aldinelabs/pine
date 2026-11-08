import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SAVE_PASTED_ATTACHMENT_CHANNEL } from "../../../../shared/attachments";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "../../../../shared/projects";
import { PineRequestRouter } from "../../../requestRouter";
import type { PineCore } from "../../pineCore";
import { registerFileRequests } from "../files";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function setup(panel = true) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "pine-pasted-"));
  directories.push(directory);
  const router = new PineRequestRouter();
  const core = {
    handle: router.register.bind(router),
    host: {
      isQuickComposerClient: (clientId: number) => panel && clientId === 42,
    },
    runtimes: { attachmentsRootFor: vi.fn(() => undefined) },
    repository: {
      get: vi.fn().mockResolvedValue({}),
      dataPaths: vi.fn(() => ({ attachmentsRoot: directory })),
    },
    rememberAttachments: vi.fn(),
  };
  registerFileRequests(core as unknown as PineCore);
  return { core, router, directory };
}

const request = {
  projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
  mimeType: "text/plain",
  text: "Pasted context",
};

describe("pasted attachments", () => {
  it.each([
    request,
    {
      projectId: TEMPORARY_WORKSPACE_PROJECT_ID,
      mimeType: "image/png",
      bytes: new Uint8Array([1, 2, 3]),
    },
    { ...request, projectId: "7f48c81c-f1dc-4be6-a8ee-55729ef647ba" },
  ])(
    "saves panel attachments before a project runtime opens",
    async (input) => {
      const { core, router, directory } = await setup();
      const result = (await router.invoke(
        SAVE_PASTED_ATTACHMENT_CHANNEL,
        { clientId: 42, source: "desktop" },
        input,
      )) as { attachment: { path: string } };
      expect(path.dirname(result.attachment.path)).toBe(directory);
      const expected =
        "text" in input ? Buffer.from(input.text) : Buffer.from(input.bytes);
      expect(await readFile(result.attachment.path)).toEqual(expected);
      expect(core.repository.get).toHaveBeenCalledWith(input.projectId);
      expect(core.rememberAttachments).toHaveBeenCalledWith(42, [
        result.attachment.path,
      ]);
    },
  );

  it.each(["desktop", "web"] as const)(
    "keeps unopened projects unavailable to ordinary %s clients",
    async (source) => {
      const { router, core } = await setup(source === "web");
      await expect(
        router.invoke(
          SAVE_PASTED_ATTACHMENT_CHANNEL,
          { clientId: 42, source },
          request,
        ),
      ).rejects.toThrow("not open");
      expect(core.repository.get).not.toHaveBeenCalled();
    },
  );

  it("rejects a project deleted since it was selected", async () => {
    const { core, router } = await setup();
    core.repository.get.mockRejectedValue(new Error("Unknown project"));
    await expect(
      router.invoke(
        SAVE_PASTED_ATTACHMENT_CHANNEL,
        { clientId: 42, source: "desktop" },
        request,
      ),
    ).rejects.toThrow("Unknown project");
    expect(core.rememberAttachments).not.toHaveBeenCalled();
  });
});
