import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PineModelService } from "../model-service";
import {
  readPineAgentSettings,
  writeImageModelSelection,
} from "../../pineSettings";

vi.mock("../decisions-models", () => ({
  decisionsModelDescriptors: vi.fn(() => Promise.resolve([])),
}));
let agentDir: string;
let service: PineModelService;
let configured: boolean;
beforeEach(async () => {
  agentDir = await mkdtemp(path.join(os.tmpdir(), "pine-video-settings-"));
  configured = true;
  vi.stubGlobal(
    "fetch",
    vi.fn(() =>
      Promise.resolve(
        Response.json({
          data: [
            {
              id: "test/video",
              name: "Test Video",
              supported_frame_images: ["first_frame", "last_frame"],
            },
          ],
        }),
      ),
    ),
  );
  service = new PineModelService({
    emit: vi.fn(),
    getLiveSession: () => undefined,
    getLiveSessions: () => [],
    applyContextCompactionStrategy: vi.fn(),
  });
  vi.spyOn(service, "getModelRuntime").mockResolvedValue({
    getModels: () => [],
    getProviders: () => [],
    hasConfiguredAuth: () => configured,
  } as unknown as ModelRuntime);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(agentDir, { recursive: true, force: true });
});
it("persists video selection separately and exposes frame capabilities", async () => {
  await writeImageModelSelection(agentDir, {
    providerId: "openrouter",
    modelId: "image-model",
  });
  await service.selectVideoModel(agentDir, {
    providerId: "openrouter",
    modelId: "test/video",
  });
  expect(await readPineAgentSettings(agentDir)).toMatchObject({
    imageModel: { modelId: "image-model" },
    videoModel: { modelId: "test/video" },
  });
  const catalog = await service.getModelCatalog(agentDir);
  expect(catalog.videoSelection).toEqual({
    providerId: "openrouter",
    modelId: "test/video",
  });
  expect(catalog.videoModels?.[0]?.supportedFrameImages).toEqual([
    "first_frame",
    "last_frame",
  ]);
});
it("rejects unconfigured providers and nonexistent models", async () => {
  configured = false;
  await expect(
    service.selectVideoModel(agentDir, {
      providerId: "openrouter",
      modelId: "test/video",
    }),
  ).rejects.toThrow("Configure OpenRouter");
  configured = true;
  await expect(
    service.selectVideoModel(agentDir, {
      providerId: "openrouter",
      modelId: "missing",
    }),
  ).rejects.toThrow("not found");
  await expect(
    service.selectVideoModel(agentDir, {
      providerId: "other",
      modelId: "test/video",
    }),
  ).rejects.toThrow("Configure OpenRouter");
});
