import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  PI_MODELS_MAX_BYTES,
  parsePiModels,
  readPiProviders,
  resolvePiAgentDir,
  stripJsonc,
} from "../pi-providers";

const provider = (overrides: Record<string, unknown> = {}) => ({
  name: "Example",
  baseUrl: "https://api.example.test",
  api: "anthropic-messages",
  apiKey: "sk-test",
  models: [{ id: "model-a", contextWindow: 200_000, maxTokens: 8_192 }],
  ...overrides,
});

const models = (providers: Record<string, unknown>) =>
  JSON.stringify({ providers });

describe("resolvePiAgentDir", () => {
  const home = "/home/test";

  it("prefers Pine's setting, then PI_CODING_AGENT_DIR, then ~/.pi/agent", () => {
    expect(
      resolvePiAgentDir("/custom/pi", { PI_CODING_AGENT_DIR: "/env" }, home),
    ).toEqual({ agentDir: "/custom/pi", source: "setting" });
    expect(
      resolvePiAgentDir(undefined, { PI_CODING_AGENT_DIR: "~/pi-env" }, home),
    ).toEqual({ agentDir: path.join(home, "pi-env"), source: "environment" });
    expect(resolvePiAgentDir(undefined, {}, home)).toEqual({
      agentDir: path.join(home, ".pi", "agent"),
      source: "default",
    });
  });

  it("ignores relative folders", () => {
    expect(
      resolvePiAgentDir("relative", { PI_CODING_AGENT_DIR: "also" }, home)
        .source,
    ).toBe("default");
  });
});

describe("stripJsonc", () => {
  it("removes comments and trailing commas but keeps strings intact", () => {
    const text = `{
      // line comment
      "url": "https://x.test/a//b", /* block */
      "list": [1, 2,],
    }`;
    expect(JSON.parse(stripJsonc(text))).toEqual({
      url: "https://x.test/a//b",
      list: [1, 2],
    });
  });
});

describe("parsePiModels", () => {
  it("namespaces provider ids and fills model defaults", () => {
    const { providers, skipped } = parsePiModels(
      models({
        "cc-switch-a": provider({
          models: [{ id: "m1" }],
        }),
      }),
    );
    expect(skipped).toEqual([]);
    const config = providers.get("pi-cc-switch-a");
    expect(config).toMatchObject({
      name: "Example",
      baseUrl: "https://api.example.test",
      api: "anthropic-messages",
      apiKey: "sk-test",
    });
    expect(config?.models?.[0]).toMatchObject({
      id: "m1",
      name: "m1",
      api: "anthropic-messages",
      input: ["text"],
      reasoning: false,
      contextWindow: 128_000,
      maxTokens: 16_384,
    });
  });

  it("pushes provider compat down onto each model, model values winning", () => {
    const { providers } = parsePiModels(
      models({
        a: provider({
          compat: { supportsStore: false, maxTokensField: "max_tokens" },
          models: [
            { id: "m1" },
            { id: "m2", compat: { maxTokensField: "max_completion_tokens" } },
          ],
        }),
      }),
    );
    const [first, second] = providers.get("pi-a")?.models ?? [];
    expect(first).toMatchObject({
      compat: { supportsStore: false, maxTokensField: "max_tokens" },
    });
    expect(second).toMatchObject({
      compat: { supportsStore: false, maxTokensField: "max_completion_tokens" },
    });
  });

  it("skips !command keys and headers but keeps $ENV keys", () => {
    const { providers, skipped } = parsePiModels(
      models({
        command: provider({ apiKey: "!security find-generic-password" }),
        header: provider({ headers: { "x-token": "!cat ~/.token" } }),
        modelHeader: provider({
          models: [{ id: "m", headers: { "x-token": "!cat token" } }],
        }),
        env: provider({ apiKey: "$EXAMPLE_API_KEY" }),
      }),
    );
    expect(skipped).toEqual([
      { key: "command", reason: "command-value" },
      { key: "header", reason: "command-value" },
      { key: "modelHeader", reason: "command-value" },
    ]);
    expect(providers.get("pi-env")?.apiKey).toBe("$EXAMPLE_API_KEY");
  });

  it("explains providers it cannot register", () => {
    const { providers, skipped } = parsePiModels(
      models({
        override: { baseUrl: "https://proxy.test" },
        noUrl: provider({ baseUrl: "" }),
        noApi: provider({ api: "made-up" }),
        broken: provider({ models: [{ name: "no id" }] }),
        notObject: "oops",
      }),
    );
    expect(providers.size).toBe(0);
    expect(skipped).toEqual([
      { key: "override", reason: "no-models" },
      { key: "noUrl", reason: "missing-base-url" },
      { key: "noApi", reason: "missing-api" },
      { key: "broken", reason: "invalid" },
      { key: "notObject", reason: "invalid" },
    ]);
  });

  it("reports malformed files without throwing", () => {
    expect(parsePiModels("{").error).toBe("invalid-json");
    expect(parsePiModels("[]").error).toBe("invalid-json");
  });
});

describe("readPiProviders", () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "pine-pi-providers-"));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("treats a missing file as not found", async () => {
    const snapshot = await readPiProviders(path.join(directory, "missing"));
    expect(snapshot).toMatchObject({ found: false, skipped: [] });
    expect(snapshot.error).toBeUndefined();
  });

  it("reads JSONC files", async () => {
    await writeFile(
      path.join(directory, "models.json"),
      `// written by CC Switch\n${models({ a: provider() })}`,
    );
    const snapshot = await readPiProviders(directory);
    expect(snapshot.found).toBe(true);
    expect([...snapshot.providers.keys()]).toEqual(["pi-a"]);
  });

  it("refuses files over 1 MiB", async () => {
    await writeFile(
      path.join(directory, "models.json"),
      " ".repeat(PI_MODELS_MAX_BYTES + 1),
    );
    const snapshot = await readPiProviders(directory);
    expect(snapshot).toMatchObject({ found: true, error: "too-large" });
    expect(snapshot.providers.size).toBe(0);
  });
});
