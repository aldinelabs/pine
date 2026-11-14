import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writePiProvidersSetting } from "../../pineSettings";
import { PiProviderSync } from "../pi-provider-sync";

let root: string;
let pineDir: string;
let piDir: string;

const providerNode = (modelId: string, apiKey = "sk-test") => ({
  name: "Example",
  baseUrl: "https://api.example.test/v1",
  api: "openai-completions",
  apiKey,
  models: [{ id: modelId }],
});

async function writePiModels(providers: Record<string, unknown>) {
  await mkdir(piDir, { recursive: true });
  await writeFile(
    path.join(piDir, "models.json"),
    JSON.stringify({ providers }, null, 2),
  );
}

function fakeRuntime(existing: string[] = []) {
  const registered = new Map<string, unknown>();
  return {
    registered,
    registerProvider: vi.fn((id: string, config: unknown) => {
      registered.set(id, config);
    }),
    unregisterProvider: vi.fn((id: string) => {
      registered.delete(id);
    }),
    getProvider: vi.fn((id: string) =>
      existing.includes(id) ? ({ id } as never) : undefined,
    ),
  };
}

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pine-pi-sync-"));
  pineDir = path.join(root, "pine-agent");
  piDir = path.join(root, "pi-agent");
  await mkdir(pineDir, { recursive: true });
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

const options = () => ({
  env: { PI_CODING_AGENT_DIR: piDir },
  home: root,
  debounceMs: 20,
  retryMs: 30,
});

describe("PiProviderSync", () => {
  it("stays off and registers nothing until the setting is on", async () => {
    await writePiModels({ a: providerNode("m") });
    const runtime = fakeRuntime();
    const sync = new PiProviderSync(runtime, pineDir, options());
    const status = await sync.sync();
    expect(status).toMatchObject({
      enabled: false,
      found: true,
      count: 0,
      agentDirSource: "environment",
      path: path.join(piDir, "models.json"),
    });
    expect(runtime.registerProvider).not.toHaveBeenCalled();
    sync.dispose();
  });

  it("registers and removes providers as the setting changes", async () => {
    await writePiModels({ a: providerNode("m"), b: providerNode("n") });
    const runtime = fakeRuntime();
    const sync = new PiProviderSync(runtime, pineDir, options());
    await writePiProvidersSetting(pineDir, { enabled: true });
    expect((await sync.sync()).count).toBe(2);
    expect([...runtime.registered.keys()]).toEqual(["pi-a", "pi-b"]);
    expect(sync.has("pi-a")).toBe(true);

    await writePiProvidersSetting(pineDir, { enabled: false });
    expect((await sync.sync()).count).toBe(0);
    expect(runtime.registered.size).toBe(0);
    expect(sync.has("pi-a")).toBe(false);
    sync.dispose();
  });

  it("uses the folder saved in Pine's setting over the environment", async () => {
    const other = path.join(root, "other");
    await mkdir(other, { recursive: true });
    await writeFile(
      path.join(other, "models.json"),
      JSON.stringify({ providers: { o: providerNode("x") } }),
    );
    const runtime = fakeRuntime();
    const sync = new PiProviderSync(runtime, pineDir, options());
    await writePiProvidersSetting(pineDir, { enabled: true, agentDir: other });
    expect(await sync.sync()).toMatchObject({
      agentDir: other,
      agentDirSource: "setting",
      count: 1,
    });
    sync.dispose();
  });

  it("never replaces a provider Pine already has under the same id", async () => {
    await writePiModels({ taken: providerNode("m") });
    const runtime = fakeRuntime(["pi-taken"]);
    const sync = new PiProviderSync(runtime, pineDir, options());
    await writePiProvidersSetting(pineDir, { enabled: true });
    const status = await sync.sync();
    expect(status.count).toBe(0);
    expect(status.skipped).toEqual([{ key: "taken", reason: "conflict" }]);
    sync.dispose();
  });

  it("reloads when CC Switch rewrites models.json", async () => {
    await writePiModels({ a: providerNode("m") });
    const runtime = fakeRuntime();
    const sync = new PiProviderSync(runtime, pineDir, options());
    await writePiProvidersSetting(pineDir, { enabled: true });
    await sync.sync();

    await writePiModels({ c: providerNode("z") });
    await vi.waitFor(
      () => expect([...runtime.registered.keys()]).toEqual(["pi-c"]),
      { timeout: 2_000 },
    );
    sync.dispose();
  });

  it("picks up models.json when Pi's folder appears later", async () => {
    const runtime = fakeRuntime();
    const sync = new PiProviderSync(runtime, pineDir, options());
    await writePiProvidersSetting(pineDir, { enabled: true });
    expect(await sync.sync()).toMatchObject({ found: false, count: 0 });

    await writePiModels({ late: providerNode("m") });
    await vi.waitFor(() => expect(sync.status().count).toBe(1), {
      timeout: 2_000,
    });
    sync.dispose();
  });

  it("makes Pi's models usable on a real model runtime", async () => {
    await writePiModels({ live: providerNode("model-one") });
    const runtime = await ModelRuntime.create({
      authPath: path.join(pineDir, "auth.json"),
      modelsPath: path.join(pineDir, "models.json"),
      modelsStorePath: path.join(pineDir, "models-store.json"),
      refreshOnCreate: false,
    });
    const sync = new PiProviderSync(runtime, pineDir, options());
    await writePiProvidersSetting(pineDir, { enabled: true });
    await sync.sync();
    expect(runtime.getModel("pi-live", "model-one")).toMatchObject({
      provider: "pi-live",
      baseUrl: "https://api.example.test/v1",
    });
    expect(runtime.hasConfiguredAuth("pi-live")).toBe(true);
    expect(await runtime.getAuth("pi-live")).toMatchObject({
      auth: { apiKey: "sk-test" },
    });

    await writePiModels({ live: providerNode("model-two", "sk-next") });
    await vi.waitFor(
      () => expect(runtime.getModel("pi-live", "model-two")).toBeDefined(),
      { timeout: 2_000 },
    );
    expect(runtime.getModel("pi-live", "model-one")).toBeUndefined();
    expect(await runtime.getAuth("pi-live")).toMatchObject({
      auth: { apiKey: "sk-next" },
    });
    sync.dispose();
  });
});
