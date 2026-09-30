import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PineModelService } from "../model-service";

let agentDir: string;
const fetchMock = vi.fn<typeof fetch>();
const response = (id: string) =>
  Response.json({
    data: [
      {
        id,
        name: id,
        architecture: { output_modalities: ["decisions"] },
      },
    ],
  });

beforeEach(async () => {
  agentDir = await mkdtemp(
    path.join(os.tmpdir(), "pine-model-service-decisions-"),
  );
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(agentDir, { recursive: true, force: true });
});

it("returns discovered Decisions models and includes them in explicit catalog refresh", async () => {
  const service = new PineModelService({
    emit: vi.fn(),
    getLiveSession: () => undefined,
    getLiveSessions: () => [],
    applyContextCompactionStrategy: vi.fn(),
  });
  const refresh = vi
    .fn()
    .mockResolvedValue({ aborted: false, errors: new Map() });
  vi.spyOn(service, "getModelRuntime").mockResolvedValue({
    getModels: () => [],
    getProviders: () => [],
    refresh,
    hasConfiguredAuth: () => false,
  } as unknown as ModelRuntime);
  fetchMock.mockResolvedValueOnce(response("upstage/solar-decide"));
  const first = await service.getModelCatalog(agentDir);
  expect(first.decisionsModels?.map((model) => model.id)).toEqual([
    "upstage/solar-decide",
  ]);
  fetchMock.mockResolvedValueOnce(response("future/new-model"));
  const refreshed = await service.refreshModelCatalog(agentDir);
  expect(refreshed.decisionsModels?.map((model) => model.id)).toEqual([
    "future/new-model",
  ]);
  expect(refresh).toHaveBeenCalledExactlyOnceWith({
    allowNetwork: true,
    force: true,
    signal: expect.any(AbortSignal),
  });
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
