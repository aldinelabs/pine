import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PineModelService } from "../model-service";
import { writePiProvidersSetting } from "../../pineSettings";

vi.mock("../decisions-models", () => ({
  decisionsModelDescriptors: vi.fn(() => Promise.resolve([])),
}));
vi.mock("../../media/video-models", () => ({
  videoModelDescriptors: vi.fn(() => Promise.resolve([])),
}));

let root: string;
let pineDir: string;
let piDir: string;
let service: PineModelService;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "pine-pi-catalog-"));
  pineDir = path.join(root, "pine");
  piDir = path.join(root, "pi");
  await mkdir(pineDir, { recursive: true });
  await mkdir(piDir, { recursive: true });
  await writeFile(
    path.join(piDir, "models.json"),
    JSON.stringify({
      providers: {
        "cc-switch-demo": {
          name: "Demo",
          baseUrl: "https://api.demo.test",
          api: "anthropic-messages",
          apiKey: "sk-secret-value",
          models: [{ id: "demo-1", name: "Demo One" }],
        },
      },
    }),
  );
  await writePiProvidersSetting(pineDir, { enabled: true, agentDir: piDir });
  const create = ModelRuntime.create.bind(ModelRuntime);
  vi.spyOn(ModelRuntime, "create").mockImplementation((options) =>
    create({ ...options, allowModelNetwork: false, refreshOnCreate: false }),
  );
  service = new PineModelService({
    emit: vi.fn(),
    getLiveSession: () => undefined,
    getLiveSessions: () => [],
    applyContextCompactionStrategy: vi.fn(),
  });
});

afterEach(async () => {
  service.dispose();
  vi.restoreAllMocks();
  // Registering a provider starts a background refresh that Pi does not
  // expose; its locked models-store.json write can outlast the test.
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 50,
  });
});

it("lists Pi's providers as read-only and never sends their keys", async () => {
  const catalog = await service.getModelCatalog(pineDir);
  const provider = catalog.providers.find(
    (candidate) => candidate.id === "pi-cc-switch-demo",
  );
  expect(provider).toMatchObject({
    name: "Demo",
    source: "pi",
    readOnly: true,
    configured: true,
    authMethods: [],
    isCustom: false,
  });
  expect(
    catalog.models.find((model) => model.providerId === "pi-cc-switch-demo"),
  ).toMatchObject({ id: "demo-1", source: "pi" });
  expect(JSON.stringify(catalog)).not.toContain("sk-secret-value");
});

it("reports status and refuses to change Pi's providers from Pine", async () => {
  expect(await service.getPiProvidersStatus(pineDir)).toMatchObject({
    enabled: true,
    found: true,
    count: 1,
    agentDirSource: "setting",
  });
  await expect(
    service.addCustomModel(pineDir, {
      providerMode: "existing",
      providerId: "pi-cc-switch-demo",
      modelId: "extra",
      contextWindow: 1000,
      maxTokens: 100,
      thinkingLevels: ["off"],
      vision: false,
    }),
  ).rejects.toThrow("Pi or CC Switch");
  await expect(
    service.loginProvider(pineDir, "login", "pi-cc-switch-demo", "api_key"),
  ).rejects.toThrow("Pi or CC Switch");

  await writePiProvidersSetting(pineDir, { enabled: false, agentDir: piDir });
  expect((await service.syncPiProviders(pineDir)).count).toBe(0);
  const catalog = await service.getModelCatalog(pineDir);
  expect(
    catalog.providers.some((provider) => provider.id === "pi-cc-switch-demo"),
  ).toBe(false);
});
