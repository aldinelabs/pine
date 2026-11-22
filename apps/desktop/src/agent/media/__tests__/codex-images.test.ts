import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CHATGPT_IMAGE_MODEL_ID,
  CHATGPT_IMAGE_PROVIDER_ID,
  chatGptAccountId,
  chatGptImageModel,
  chatGptImageRequestBody,
  generateImagesWithChatGpt,
  resetChatGptRoutingModelCache,
} from "../codex-images";
import { imageModel, imageModelDescriptors, pineImagesModels } from "../models";

const ACCOUNT_ID = "acct-123";

function token(accountId = ACCOUNT_ID): string {
  const payload = Buffer.from(
    JSON.stringify({
      "https://api.openai.com/auth": { chatgpt_account_id: accountId },
    }),
  ).toString("base64url");
  return `header.${payload}.signature`;
}

function sse(events: unknown[]): string {
  return events
    .map((event) => `event: x\ndata: ${JSON.stringify(event)}\n\n`)
    .join("");
}

/** Streams the body in small chunks so frames split across reads. */
function streamResponse(body: string, chunkSize = 7): Response {
  const bytes = new TextEncoder().encode(body);
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
  });
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), { headers, status });
}

const MODELS = {
  models: [
    { priority: 3, slug: "older-model", visibility: "list" },
    { priority: 0, slug: "hidden-model", visibility: "hide" },
    { priority: 1, slug: "newest-model", visibility: "list" },
  ],
};

const IMAGE_ITEM = {
  id: "ig_1",
  output_format: "png",
  result: "aW1hZ2U=",
  revised_prompt: "a pine tree",
  status: "completed",
  type: "image_generation_call",
};

const COMPLETED = {
  response: {
    id: "resp_1",
    output: [IMAGE_ITEM],
    tools: [{ model: "gpt-image-9-codex", type: "image_generation" }],
    usage: { input_tokens: 20, output_tokens: 5, total_tokens: 25 },
  },
  type: "response.completed",
};

function successStream(): string {
  return sse([
    { response: { id: "resp_1" }, type: "response.created" },
    { type: "response.image_generation_call.generating" },
    { item: IMAGE_ITEM, type: "response.output_item.done" },
    COMPLETED,
  ]);
}

type FetchHandler = (url: string, init: RequestInit) => Promise<Response>;

function urlOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value instanceof URL) return value.href;
  return value instanceof Request ? value.url : "";
}

function fetchMock(responses: FetchHandler) {
  return vi.fn((url: string | URL | Request, init?: RequestInit) =>
    responses(urlOf(url), init ?? {}),
  );
}

function routedFetch(
  responses: () => Response | Promise<Response>,
): ReturnType<typeof fetchMock> {
  return fetchMock(async (url, init) => {
    if (url.includes("/codex/models")) return jsonResponse(MODELS);
    if (init.signal?.aborted) throw new Error("aborted");
    return responses();
  });
}

const prompt = { input: [{ text: "a pine tree", type: "text" as const }] };

beforeEach(() => {
  resetChatGptRoutingModelCache();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("chatGptAccountId", () => {
  it("reads the account from the access token", () => {
    expect(chatGptAccountId(token("acct-9"))).toBe("acct-9");
  });

  it("asks the user to sign in again when the token is unusable", () => {
    expect(() => chatGptAccountId("not-a-jwt")).toThrow(/sign in/u);
  });
});

describe("chatGptImageRequestBody", () => {
  it("never pins an image model and keeps only image tool fields", () => {
    const body = chatGptImageRequestBody(
      "newest-model",
      {
        input: [
          { text: "make it blue", type: "text" },
          { data: "AAA", mimeType: "image/png", type: "image" },
        ],
      },
      {
        model: "gpt-image-1",
        quality: "low",
        size: "1024x1024",
        stream: false,
      },
    );
    expect(body.model).toBe("newest-model");
    expect(body.stream).toBe(true);
    expect(body.store).toBe(false);
    expect(body.tools).toEqual([
      { quality: "low", size: "1024x1024", type: "image_generation" },
    ]);
    expect(body.input).toEqual([
      {
        content: [
          { text: "make it blue", type: "input_text" },
          { image_url: "data:image/png;base64,AAA", type: "input_image" },
        ],
        role: "user",
      },
    ]);
  });
});

describe("generateImagesWithChatGpt", () => {
  it("parses a chunked stream and reports the image model ChatGPT ran", async () => {
    const fetch = routedFetch(() => streamResponse(successStream()));
    const result = await generateImagesWithChatGpt(
      chatGptImageModel(),
      prompt,
      { apiKey: token(), fetch },
    );

    expect(result.stopReason).toBe("stop");
    expect(result.model).toBe("gpt-image-9-codex");
    expect(result.responseId).toBe("resp_1");
    // The same image appears in output_item.done and response.completed.
    expect(result.output).toEqual([
      { data: "aW1hZ2U=", mimeType: "image/png", type: "image" },
    ]);
    expect(result.usage?.totalTokens).toBe(25);
    expect(result.usage?.cost.total).toBe(0);

    const [modelsCall, imageCall] = fetch.mock.calls;
    expect(urlOf(modelsCall?.[0])).toContain("/codex/models");
    expect(urlOf(imageCall?.[0])).toBe(
      "https://chatgpt.com/backend-api/codex/responses",
    );
    const headers = imageCall?.[1]?.headers as Record<string, string>;
    expect(headers.authorization).toBe(`Bearer ${token()}`);
    expect(headers["chatgpt-account-id"]).toBe(ACCOUNT_ID);
    expect(headers["OpenAI-Beta"]).toBe("responses=experimental");
    const body = JSON.parse(imageCall?.[1]?.body as string) as {
      model: string;
    };
    // The routing model is the account's top-ranked visible Codex model.
    expect(body.model).toBe("newest-model");
  });

  it("reuses the routing model between calls", async () => {
    const fetch = routedFetch(() => streamResponse(successStream()));
    await generateImagesWithChatGpt(chatGptImageModel(), prompt, {
      apiKey: token(),
      fetch,
    });
    await generateImagesWithChatGpt(chatGptImageModel(), prompt, {
      apiKey: token(),
      fetch,
    });
    const modelCalls = fetch.mock.calls.filter(([url]) =>
      urlOf(url).includes("/codex/models"),
    );
    expect(modelCalls).toHaveLength(1);
  });

  it("maps the output format to a MIME type", async () => {
    const jpeg = { ...IMAGE_ITEM, output_format: "jpeg" };
    const fetch = routedFetch(() =>
      streamResponse(
        sse([
          { item: jpeg, type: "response.output_item.done" },
          {
            response: { ...COMPLETED.response, output: [jpeg] },
            type: "response.completed",
          },
        ]),
      ),
    );
    const result = await generateImagesWithChatGpt(
      chatGptImageModel(),
      prompt,
      {
        apiKey: token(),
        fetch,
      },
    );
    expect(result.output[0]).toMatchObject({ mimeType: "image/jpeg" });
  });

  it("returns the model's text when no image arrives", async () => {
    const fetch = routedFetch(() =>
      streamResponse(
        sse([
          { delta: "I can't draw ", type: "response.output_text.delta" },
          { delta: "that.", type: "response.output_text.delta" },
          {
            response: { id: "resp_2", output: [], tools: [] },
            type: "response.completed",
          },
        ]),
      ),
    );
    const result = await generateImagesWithChatGpt(
      chatGptImageModel(),
      prompt,
      {
        apiKey: token(),
        fetch,
      },
    );
    expect(result.stopReason).toBe("stop");
    expect(result.output).toEqual([
      { text: "I can't draw that.", type: "text" },
    ]);
  });

  it("explains a used-up plan with the refill time", async () => {
    vi.useFakeTimers({ now: 1_000_000, toFake: ["Date"] });
    const fetch = routedFetch(() =>
      jsonResponse(
        {
          error: {
            code: "usage_limit_reached",
            resets_at: 1_000 + 30 * 60,
          },
        },
        429,
      ),
    );
    const sleep = vi.fn(() => Promise.resolve());
    const result = await generateImagesWithChatGpt(
      chatGptImageModel(),
      prompt,
      {
        apiKey: token(),
        fetch,
        sleep,
      },
    );
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toMatch(/used up its Codex usage/u);
    expect(result.errorMessage).toMatch(/about 30 min/u);
    // A used-up plan is final; Pine does not retry it.
    expect(sleep).not.toHaveBeenCalled();
  });

  it("retries a busy rate limit, then explains it", async () => {
    const fetch = routedFetch(() =>
      jsonResponse({ error: { message: "slow down" } }, 429, {
        "retry-after": "1",
      }),
    );
    const sleep = vi.fn(() => Promise.resolve());
    const result = await generateImagesWithChatGpt(
      chatGptImageModel(),
      prompt,
      {
        apiKey: token(),
        fetch,
        sleep,
      },
    );
    expect(sleep).toHaveBeenCalledTimes(2);
    expect(result.errorMessage).toMatch(/Wait a minute/u);
  });

  it("recovers when a retry succeeds", async () => {
    let calls = 0;
    const fetch = routedFetch(() => {
      calls += 1;
      return calls === 1
        ? jsonResponse({}, 503)
        : streamResponse(successStream());
    });
    const result = await generateImagesWithChatGpt(
      chatGptImageModel(),
      prompt,
      {
        apiKey: token(),
        fetch,
        sleep: () => Promise.resolve(),
      },
    );
    expect(result.stopReason).toBe("stop");
    expect(result.output).toHaveLength(1);
  });

  it.each([
    [401, {}, /sign in to OpenAI Codex again/u],
    [403, {}, /paid ChatGPT plan/u],
    [400, { error: { code: "moderation_blocked" } }, /content policy/u],
    [404, {}, /not an official API/u],
    [
      400,
      { error: { message: "size is invalid" } },
      /HTTP 400: size is invalid/u,
    ],
  ])("explains HTTP %s", async (status, body, message) => {
    const fetch = routedFetch(() => jsonResponse(body, status));
    const result = await generateImagesWithChatGpt(
      chatGptImageModel(),
      prompt,
      {
        apiKey: token(),
        fetch,
        sleep: () => Promise.resolve(),
      },
    );
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toMatch(message);
  });

  it("explains a failure reported inside the stream", async () => {
    const fetch = routedFetch(() =>
      streamResponse(
        sse([
          {
            response: { error: { code: "moderation_blocked" } },
            type: "response.failed",
          },
        ]),
      ),
    );
    const result = await generateImagesWithChatGpt(
      chatGptImageModel(),
      prompt,
      {
        apiKey: token(),
        fetch,
      },
    );
    expect(result.errorMessage).toMatch(/content policy/u);
  });

  it("reports a stream that ends before the image", async () => {
    const fetch = routedFetch(() =>
      streamResponse(
        sse([{ type: "response.image_generation_call.generating" }]),
      ),
    );
    const result = await generateImagesWithChatGpt(
      chatGptImageModel(),
      prompt,
      {
        apiKey: token(),
        fetch,
      },
    );
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toMatch(/closed before the image arrived/u);
  });

  it("stops when the caller aborts mid-stream", async () => {
    const controller = new AbortController();
    const fetch = routedFetch(
      () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(stream) {
              stream.enqueue(
                new TextEncoder().encode(
                  sse([{ type: "response.image_generation_call.generating" }]),
                ),
              );
              // Never closes: only the abort can end the read.
              setTimeout(() => controller.abort(), 5);
            },
          }),
          { status: 200 },
        ),
    );
    const result = await generateImagesWithChatGpt(
      chatGptImageModel(),
      prompt,
      {
        apiKey: token(),
        fetch,
        signal: controller.signal,
      },
    );
    expect(result.stopReason).toBe("aborted");
  });

  it("does not call ChatGPT when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const fetch = fetchMock((_url, init) =>
      init.signal?.aborted
        ? Promise.reject(new Error("aborted"))
        : Promise.resolve(jsonResponse(MODELS)),
    );
    const result = await generateImagesWithChatGpt(
      chatGptImageModel(),
      prompt,
      {
        apiKey: token(),
        fetch,
        signal: controller.signal,
      },
    );
    expect(result.stopReason).toBe("aborted");
  });

  it("gives up with a readable message after the timeout", async () => {
    const fetch = routedFetch(
      () =>
        new Response(new ReadableStream<Uint8Array>({ start() {} }), {
          status: 200,
        }),
    );
    const result = await generateImagesWithChatGpt(
      chatGptImageModel(),
      prompt,
      {
        apiKey: token(),
        fetch,
        timeoutMs: 10,
      },
    );
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toMatch(/did not finish the image/u);
  });

  it("asks for a sign-in without a token", async () => {
    const fetch = routedFetch(() => streamResponse(successStream()));
    const result = await generateImagesWithChatGpt(
      chatGptImageModel(),
      prompt,
      {
        fetch,
      },
    );
    expect(result.errorMessage).toMatch(/sign in/u);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("Pine image catalog", () => {
  it("registers the ChatGPT source through Pi's image provider interface", async () => {
    const model = imageModel(CHATGPT_IMAGE_MODEL_ID, CHATGPT_IMAGE_PROVIDER_ID);
    expect(model).toBeDefined();
    const fetch = routedFetch(() => streamResponse(successStream()));
    const result = await pineImagesModels().generateImages(model!, prompt, {
      apiKey: token(),
      fetch,
    });
    expect(result.stopReason).toBe("stop");
    expect(result.model).toBe("gpt-image-9-codex");
  });

  it("lists the ChatGPT entry last and unavailable until signed in", () => {
    const signedOut = imageModelDescriptors().at(-1);
    expect(signedOut).toMatchObject({
      available: false,
      id: CHATGPT_IMAGE_MODEL_ID,
      providerId: CHATGPT_IMAGE_PROVIDER_ID,
      usesSubscription: true,
    });
    expect(
      imageModelDescriptors({ chatGptSignedIn: true }).at(-1)?.available,
    ).toBe(true);
    expect(imageModel("chatgpt-image", "unknown-provider")).toBeUndefined();
  });
});
