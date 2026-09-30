import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decisionsModelDescriptors,
  parseDecisionsModels,
} from "../decisions-models";

const fetchMock = vi.fn<typeof fetch>();
let agentDir: string;
const apiModel = (id: string, output = "decisions") => ({
  id,
  name: id,
  context_length: 0,
  supported_parameters: [],
  architecture: { output_modalities: [output] },
});
const ids = [
  "typesafe/jev-1.13",
  "~typesafe/jev-latest",
  "upstage/solar-decide",
  "respan/span-01",
  "respan/span-01-lite",
  "respan/span-01-lite:free",
  "jaredpalmer/kev-4b",
];
const response = (modelIds = ids) =>
  Response.json({ data: modelIds.map((id) => apiModel(id)) });

beforeEach(async () => {
  agentDir = await mkdtemp(path.join(os.tmpdir(), "pine-decisions-catalog-"));
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(agentDir, { recursive: true, force: true });
});

describe("Decisions model discovery", () => {
  it("uses the Decisions modality filter, including other authors, aliases and zero-context models", async () => {
    fetchMock.mockResolvedValue(response());
    const models = await decisionsModelDescriptors(agentDir);
    expect(models.map((model) => model.id).sort()).toEqual([...ids].sort());
    expect(models.every((model) => model.providerId === "openrouter")).toBe(
      true,
    );
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(
      "https://openrouter.ai/api/v1/models?output_modalities=decisions",
      { signal: expect.any(AbortSignal) },
    );
    const saved = JSON.parse(
      await readFile(path.join(agentDir, "decisions-models.json"), "utf8"),
    );
    expect(saved.models).toEqual(models);
    expect(saved.fetchedAt).toBeGreaterThan(0);
  });

  it("discovers future models without a hardcoded allowlist and excludes chat models", () => {
    const models = parseDecisionsModels({
      data: [
        apiModel("future/new-model"),
        apiModel("future/new-model"),
        apiModel("typesafe/jev-router", "text"),
        apiModel("openai/chat", "text"),
        null,
        { id: "invalid" },
        { ...apiModel("invalid/name"), name: " " },
      ],
    });
    expect(models.map((model) => model.id)).toEqual(["future/new-model"]);
  });

  it("deduplicates concurrent loads and does not fetch again while fresh", async () => {
    fetchMock.mockResolvedValue(response());
    const [first, second] = await Promise.all([
      decisionsModelDescriptors(agentDir),
      decisionsModelDescriptors(agentDir),
    ]);
    first[0].name = "changed";
    expect(second[0].name).not.toBe("changed");
    await decisionsModelDescriptors(agentDir);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses a persisted fresh catalog after a process restart", async () => {
    await writeFile(
      path.join(agentDir, "decisions-models.json"),
      JSON.stringify({
        fetchedAt: Date.now(),
        models: [{ id: "future/new-model", name: "New Decisions model" }],
      }),
    );
    expect((await decisionsModelDescriptors(agentDir))[0].id).toBe(
      "future/new-model",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refreshes a stale disk cache, then keeps newly discovered models if offline", async () => {
    await writeFile(
      path.join(agentDir, "decisions-models.json"),
      JSON.stringify({
        fetchedAt: Date.now() - 2 * 60 * 60 * 1_000,
        models: [{ id: "future/cached-model", name: "Cached" }],
      }),
    );
    fetchMock.mockRejectedValue(new Error("offline"));
    expect((await decisionsModelDescriptors(agentDir))[0].id).toBe(
      "future/cached-model",
    );
    await decisionsModelDescriptors(agentDir);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fetchMock.mockResolvedValue(response(["future/new-model"]));
    expect(
      (await decisionsModelDescriptors(agentDir, { force: true }))[0].id,
    ).toBe("future/new-model");
  });

  it("force refresh bypasses a fresh cache and reports errors without losing the last catalog", async () => {
    fetchMock.mockResolvedValueOnce(response());
    await decisionsModelDescriptors(agentDir);
    fetchMock.mockResolvedValue(
      Response.json({ error: "unavailable" }, { status: 503 }),
    );
    await expect(
      decisionsModelDescriptors(agentDir, { force: true }),
    ).rejects.toThrow("HTTP 503");
    expect(
      (await decisionsModelDescriptors(agentDir))
        .map((model) => model.id)
        .sort(),
    ).toEqual([...ids].sort());
  });

  it.each(["network", "timeout", "http", "json", "empty"])(
    "uses the full offline snapshot when discovery fails: %s",
    async (failure) => {
      if (failure === "http")
        fetchMock.mockResolvedValue(new Response(null, { status: 500 }));
      else if (failure === "json")
        fetchMock.mockResolvedValue(new Response("invalid JSON"));
      else if (failure === "empty")
        fetchMock.mockResolvedValue(Response.json({ data: [] }));
      else fetchMock.mockRejectedValue(new Error(failure));
      expect(
        (await decisionsModelDescriptors(agentDir))
          .map((model) => model.id)
          .sort(),
      ).toEqual([...ids].sort());
    },
  );
});
