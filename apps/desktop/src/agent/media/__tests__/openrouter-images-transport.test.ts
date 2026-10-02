import type { ImageApi, ImageModel } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  imagesEndpointBody,
  isImagesEndpointRedirect,
} from "../openrouter-images-endpoint";
import { generateImagesWithOpenRouter, imageTransportFor } from "../tools";

const mocks = vi.hoisted(() => ({ generateImages: vi.fn() }));

vi.mock("../models", () => ({
  DEFAULT_IMAGE_MODEL_ID: "google/gemini-3-pro-image",
  imageModel: () => undefined,
  imageModelDescriptors: () => [],
  imageModelIds: () => [],
  pineImagesModels: () => ({ generateImages: mocks.generateImages }),
}));

afterEach(() => {
  mocks.generateImages.mockReset();
  vi.unstubAllGlobals();
});

function imageModel(
  overrides: Partial<ImageModel<ImageApi>> = {},
): ImageModel<ImageApi> {
  return {
    type: "image",
    api: "openrouter-images",
    baseUrl: "https://openrouter.ai/api/v1",
    cost: { cacheRead: 2, cacheWrite: 0, input: 8, output: 8 },
    id: "openai/gpt-image-2.5-flare",
    input: ["text", "image"],
    name: "OpenAI: GPT Image 2.5 Flare",
    output: ["image"],
    provider: "openrouter",
    ...overrides,
  };
}

function response(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

function stubFetch(handler: () => ReturnType<typeof response>) {
  const mock = vi.fn((_url: string, init: { signal?: AbortSignal }) => {
    if (init.signal?.aborted) {
      return Promise.reject(new Error("This operation was aborted"));
    }
    return Promise.resolve(handler());
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

function request(model: ImageModel<ImageApi>) {
  return {
    apiKey: "sk-or-test",
    model,
    prompt: "A red circle on a plain white background",
  };
}

describe("imageTransportFor", () => {
  it("sends text-emitting image models through Pi's chat transport", () => {
    expect(imageTransportFor(imageModel({ output: ["image", "text"] }))).toBe(
      "chat",
    );
  });

  it("sends pure image models to the dedicated image endpoint", () => {
    expect(imageTransportFor(imageModel())).toBe("images");
  });
});

describe("generateImagesWithOpenRouter", () => {
  it("posts pure image models to the dedicated endpoint", async () => {
    const fetchMock = stubFetch(() =>
      response({
        data: [
          {
            b64_json: Buffer.from("image-bytes").toString("base64"),
            media_type: "image/png",
          },
        ],
        usage: { completion_tokens: 4175, cost: 0.04, total_tokens: 4175 },
      }),
    );

    const result = await generateImagesWithOpenRouter(
      request(imageModel({ id: "openai/gpt-image-2.5-flare" })),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string; headers: Record<string, string>; method: string },
    ];
    expect(url).toBe("https://openrouter.ai/api/v1/images");
    expect(init.method).toBe("POST");
    expect(init.headers.authorization).toBe("Bearer sk-or-test");
    expect(JSON.parse(init.body)).toEqual({
      model: "openai/gpt-image-2.5-flare",
      prompt: "A red circle on a plain white background",
    });
    expect(mocks.generateImages).not.toHaveBeenCalled();
    expect(result.stopReason).toBe("stop");
    expect(result.output).toEqual([
      {
        type: "image",
        mimeType: "image/png",
        data: Buffer.from("image-bytes").toString("base64"),
      },
    ]);
    expect(result.usage?.cost.total).toBe(0.04);
  });

  it("passes model options through but keeps the prompt frame", async () => {
    const fetchMock = stubFetch(() => response({ data: [] }));

    await generateImagesWithOpenRouter({
      ...request(imageModel()),
      parameters: {
        messages: [{ role: "user", content: "hijack" }],
        model: "someone/else",
        prompt: "hijack",
        size: "2K",
      },
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(JSON.parse(init.body)).toEqual({
      model: "openai/gpt-image-2.5-flare",
      prompt: "A red circle on a plain white background",
      size: "2K",
    });
  });

  it("maps multiple image inputs to the dedicated API reference format", async () => {
    const fetchMock = stubFetch(() => response({ data: [] }));

    await generateImagesWithOpenRouter({
      ...request(imageModel()),
      input: [
        { type: "text", text: "Make a variation" },
        { type: "image", data: "AAA", mimeType: "image/png" },
        { type: "image", data: "BBB", mimeType: "image/jpeg" },
      ],
    });

    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { body: string },
    ];
    expect(JSON.parse(init.body)).toEqual({
      input_references: [
        {
          image_url: { url: "data:image/png;base64,AAA" },
          type: "image_url",
        },
        {
          image_url: { url: "data:image/jpeg;base64,BBB" },
          type: "image_url",
        },
      ],
      model: "openai/gpt-image-2.5-flare",
      prompt: "A red circle on a plain white background",
    });
  });

  it("keeps text-emitting models on Pi's chat transport", async () => {
    mocks.generateImages.mockResolvedValue({
      api: "openrouter-images",
      model: "google/gemini-3-pro-image",
      output: [{ type: "image", data: "AAA", mimeType: "image/png" }],
      provider: "openrouter",
      stopReason: "stop",
      timestamp: Date.now(),
    });
    const fetchMock = stubFetch(() => response({ data: [] }));

    const result = await generateImagesWithOpenRouter(
      request(
        imageModel({
          id: "google/gemini-3-pro-image",
          output: ["image", "text"],
        }),
      ),
    );

    expect(mocks.generateImages).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.output).toHaveLength(1);
  });

  it("passes text and multiple images through Pi's chat context", async () => {
    mocks.generateImages.mockResolvedValue({
      api: "openrouter-images",
      model: "google/gemini-3-pro-image",
      output: [{ type: "image", data: "AAA", mimeType: "image/png" }],
      provider: "openrouter",
      stopReason: "stop",
      timestamp: Date.now(),
    });

    await generateImagesWithOpenRouter({
      ...request(
        imageModel({
          id: "google/gemini-3-pro-image",
          output: ["image", "text"],
        }),
      ),
      input: [
        { type: "text", text: "Make a variation" },
        { type: "image", data: "AAA", mimeType: "image/png" },
        { type: "image", data: "BBB", mimeType: "image/jpeg" },
      ],
    });

    expect(mocks.generateImages.mock.calls[0]?.[1]).toEqual({
      input: [
        { type: "text", text: "Make a variation" },
        { type: "image", data: "AAA", mimeType: "image/png" },
        { type: "image", data: "BBB", mimeType: "image/jpeg" },
      ],
    });
  });

  it("retries on the image endpoint when chat rejects the model", async () => {
    mocks.generateImages.mockResolvedValue({
      api: "openrouter-images",
      errorMessage:
        "404: openai/gpt-image-2.5-flare is an image generation model and cannot be used with the chat/completions endpoint. Use the /api/v1/images endpoint instead.",
      model: "openai/gpt-image-2.5-flare",
      output: [],
      provider: "openrouter",
      stopReason: "error",
      timestamp: Date.now(),
    });
    const fetchMock = stubFetch(() =>
      response({ data: [{ b64_json: "AAA", media_type: "image/png" }] }),
    );

    const result = await generateImagesWithOpenRouter(
      request(imageModel({ output: ["image", "text"] })),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.stopReason).toBe("stop");
    expect(result.output).toEqual([
      { type: "image", mimeType: "image/png", data: "AAA" },
    ]);
  });

  it("keeps unrelated chat failures instead of retrying elsewhere", async () => {
    mocks.generateImages.mockResolvedValue({
      api: "openrouter-images",
      errorMessage: "Upstream model is unavailable",
      model: "google/gemini-3-pro-image",
      output: [],
      provider: "openrouter",
      stopReason: "error",
      timestamp: Date.now(),
    });
    const fetchMock = stubFetch(() => response({ data: [] }));

    const result = await generateImagesWithOpenRouter(
      request(imageModel({ output: ["image", "text"] })),
    );

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.errorMessage).toBe("Upstream model is unavailable");
  });

  it("surfaces the provider error message from the image endpoint", async () => {
    stubFetch(() =>
      response({ error: { code: 402, message: "Insufficient credits" } }, 402),
    );

    const result = await generateImagesWithOpenRouter(request(imageModel()));

    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toBe("Insufficient credits");
  });

  it("reports an abort instead of an error when the signal is cancelled", async () => {
    stubFetch(() => response({ data: [] }));
    const controller = new AbortController();
    controller.abort();

    const result = await generateImagesWithOpenRouter({
      ...request(imageModel()),
      signal: controller.signal,
    });

    expect(result.stopReason).toBe("aborted");
  });
});

describe("imagesEndpointBody", () => {
  it("omits protected fields even without extra parameters", () => {
    expect(imagesEndpointBody(request(imageModel()))).toEqual({
      model: "openai/gpt-image-2.5-flare",
      prompt: "A red circle on a plain white background",
    });
  });

  it("does not allow parameters to replace generated references", () => {
    expect(
      imagesEndpointBody({
        ...request(imageModel()),
        input: [{ type: "image", data: "AAA", mimeType: "image/png" }],
        parameters: {
          input_references: [
            { type: "image_url", image_url: { url: "hijack" } },
          ],
        },
      }),
    ).toEqual({
      input_references: [
        {
          image_url: { url: "data:image/png;base64,AAA" },
          type: "image_url",
        },
      ],
      model: "openai/gpt-image-2.5-flare",
      prompt: "A red circle on a plain white background",
    });
  });
});

describe("isImagesEndpointRedirect", () => {
  it("only recognizes OpenRouter's endpoint mismatch", () => {
    expect(
      isImagesEndpointRedirect(
        "404: model cannot be used with the chat/completions endpoint. Use the /api/v1/images endpoint instead.",
      ),
    ).toBe(true);
    expect(isImagesEndpointRedirect("429: rate limited")).toBe(false);
    expect(isImagesEndpointRedirect(undefined)).toBe(false);
  });
});
