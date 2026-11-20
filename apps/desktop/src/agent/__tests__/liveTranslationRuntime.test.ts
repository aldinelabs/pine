import { describe, expect, it, vi } from "vitest";
import { PineAgentRuntime } from "../runtime";

/** The runtime with a stand-in model and a scripted stream. */
function harness(model: unknown, reply: string) {
  const runtime = new PineAgentRuntime({ emit: () => undefined });
  const internals = runtime as unknown as {
    getModelRuntime: () => Promise<unknown>;
    modelService: { liveTranslationModel: () => Promise<unknown> };
  };
  internals.modelService.liveTranslationModel = vi
    .fn()
    .mockResolvedValue(model);
  const stream = vi.fn(function* () {
    yield {
      type: "done",
      message: { content: [{ type: "text", text: reply }] },
    };
  });
  internals.getModelRuntime = vi.fn().mockResolvedValue({ stream });
  return { runtime, stream };
}

const model = {
  id: "fast",
  name: "Fast",
  provider: "custom-provider",
  api: "anthropic-messages",
  maxTokens: 4_096,
};

describe("PineAgentRuntime.translateLiveContext", () => {
  it("translates with the live translation model, reasoning off", async () => {
    const { runtime, stream } = harness(
      model,
      '<t n="1">Bonjour à tous.</t><t n="2">On commence.</t>',
    );
    await expect(
      runtime.translateLiveContext("/agent", {
        language: "fr-FR",
        sourceLanguage: "en-US",
        context: [],
        segments: ["Hello everyone.", "Let's start."],
      }),
    ).resolves.toEqual({ translations: ["Bonjour à tous.", "On commence."] });
    const [usedModel, context, options] = stream.mock.calls[0] as unknown as [
      unknown,
      { systemPrompt: string },
      { thinkingEnabled: boolean; maxTokens: number },
    ];
    expect(usedModel).toBe(model);
    expect(context.systemPrompt).toContain("into French");
    expect(options).toMatchObject({ thinkingEnabled: false, maxTokens: 4_096 });
  });

  it("says there is no model instead of throwing", async () => {
    const { runtime, stream } = harness(undefined, "");
    await expect(
      runtime.translateLiveContext("/agent", {
        language: "fr-FR",
        context: [],
        segments: ["Hello"],
      }),
    ).resolves.toEqual({ error: "no_model" });
    expect(stream).not.toHaveBeenCalled();
  });
});
