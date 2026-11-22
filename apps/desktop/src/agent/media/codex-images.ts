import {
  createProvider,
  type AssistantImages,
  type ImageApi,
  type ImageModel,
  type ImagesContext,
  type ImagesOptions,
  type Provider,
  type Usage,
} from "@earendil-works/pi-ai";

/**
 * Image generation through a ChatGPT subscription.
 *
 * Codex's Responses route (`chatgpt.com/backend-api/codex/responses`) exposes
 * OpenAI's hosted `image_generation` tool to signed-in ChatGPT plans. The route
 * is not a published API: Pine sends the request with the `openai-codex`
 * sign-in that Pi stores and refreshes, and reads the image out of the SSE
 * stream. The request never names an image model; the backend picks its
 * current one and reports it back, so Pine always runs (and shows) whatever
 * the subscription serves today instead of a hard-coded ID.
 *
 * The provider plugs into Pi's image surface (`createProvider({ images })`),
 * so the tool calls it like any other image model.
 */

/** Pi provider that stores and refreshes the ChatGPT (Codex) sign-in. */
export const CHATGPT_AUTH_PROVIDER_ID = "openai-codex";
/** Pine's image-only provider registered in the image model collection. */
export const CHATGPT_IMAGE_PROVIDER_ID = "openai-codex-images";
export const CHATGPT_IMAGE_PROVIDER_NAME = "ChatGPT";
export const CHATGPT_IMAGE_API = "openai-codex-images";
/** Stable selection ID; the image model behind it is whatever ChatGPT serves. */
export const CHATGPT_IMAGE_MODEL_ID = "chatgpt-image";
export const CHATGPT_IMAGE_MODEL_NAME = "GPT Image";

export const CHATGPT_BASE_URL = "https://chatgpt.com/backend-api";
export const CHATGPT_IMAGE_TIMEOUT_MS = 5 * 60_000;
/** Codex hides models newer than the client asks for; ask as a recent client. */
const CODEX_CLIENT_VERSION = "0.200.0";
const ROUTING_MODEL_CACHE_MS = 60 * 60_000;
const MAX_RETRIES = 2;
const MAX_RETRY_DELAY_MS = 20_000;
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

/**
 * Tool fields the agent may set through `parameters`. `model` is left out on
 * purpose: the subscription decides which image model runs.
 */
export const CHATGPT_IMAGE_TOOL_FIELDS = new Set([
  "background",
  "input_fidelity",
  "moderation",
  "output_compression",
  "output_format",
  "quality",
  "size",
]);

const QUOTA_CODES = new Set([
  "billing_hard_limit_reached",
  "billing_not_active",
  "insufficient_quota",
  "organization_usage_limit_exceeded",
  "quota_exceeded",
  "usage_limit_exceeded",
  "usage_limit_reached",
  "usage_not_included",
  "workspace_member_usage_limit_reached",
]);

const ROUTING_INSTRUCTIONS =
  "You generate images. Call the image_generation tool exactly once with the user's request as its prompt, keeping the user's wording and language. Do not answer with text instead of an image unless image generation is refused.";

export function chatGptImageModel(): ImageModel<ImageApi> {
  return {
    api: CHATGPT_IMAGE_API,
    baseUrl: CHATGPT_BASE_URL,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: CHATGPT_IMAGE_MODEL_ID,
    input: ["text", "image"],
    name: CHATGPT_IMAGE_MODEL_NAME,
    output: ["image"],
    provider: CHATGPT_IMAGE_PROVIDER_ID,
    type: "image",
  };
}

/** Request options Pine adds on top of Pi's image options. */
export interface ChatGptImagesOptions extends ImagesOptions {
  /** Extra `image_generation` tool fields (size, quality, background, …). */
  parameters?: Record<string, unknown>;
  /** Overall deadline; defaults to five minutes. */
  timeoutMs?: number;
  /** Retry back-off, injectable for tests. */
  sleep?: (ms: number, signal: AbortSignal) => Promise<void>;
}

export function chatGptImagesProvider(): Provider {
  return createProvider({
    auth: {
      // Pine resolves the `openai-codex` sign-in itself and passes the token
      // per request; this provider never stores credentials of its own.
      apiKey: {
        name: "ChatGPT sign-in (OpenAI Codex)",
        resolve: ({ credential }) =>
          Promise.resolve(
            credential?.key ? { auth: { apiKey: credential.key } } : undefined,
          ),
      },
    },
    baseUrl: CHATGPT_BASE_URL,
    id: CHATGPT_IMAGE_PROVIDER_ID,
    images: {
      [CHATGPT_IMAGE_API]: {
        generateImages: (model, context, options) =>
          generateImagesWithChatGpt(model, context, options),
      },
    },
    models: [chatGptImageModel()],
    name: CHATGPT_IMAGE_PROVIDER_NAME,
  });
}

/** Reads the ChatGPT account ID out of the Codex access token. */
export function chatGptAccountId(token: string): string {
  const payload = token.split(".")[1];
  if (!payload) throw new ChatGptImageError(signInMessage());
  try {
    const claims = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as Record<string, { chatgpt_account_id?: unknown } | undefined>;
    const accountId = claims[JWT_CLAIM_PATH]?.chatgpt_account_id;
    if (typeof accountId === "string" && accountId) return accountId;
  } catch {
    // Falls through to the sign-in message below.
  }
  throw new ChatGptImageError(signInMessage());
}

export class ChatGptImageError extends Error {
  override name = "ChatGptImageError";
}

function signInMessage(): string {
  return "The ChatGPT sign-in could not be used. Ask the user to sign in to OpenAI Codex again under Pine Settings › Models › Manage providers and models, then retry.";
}

function codexHeaders(
  token: string,
  accountId: string,
): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "chatgpt-account-id": accountId,
    // Codex expects an originator on every request; it is not attribution.
    originator: "pi",
  };
}

let cachedRoutingModel: { expires: number; id: string } | undefined;

/** Clears the cached routing model; used by tests. */
export function resetChatGptRoutingModelCache(): void {
  cachedRoutingModel = undefined;
}

/**
 * Picks the text model that dispatches the image tool. Codex rejects unknown
 * models and its lineup changes often, so Pine asks Codex for the models the
 * account can use and takes the one it ranks first.
 */
export async function chatGptRoutingModel(
  token: string,
  accountId: string,
  fetchImpl: typeof globalThis.fetch,
  signal: AbortSignal,
): Promise<string> {
  if (cachedRoutingModel && cachedRoutingModel.expires > Date.now()) {
    return cachedRoutingModel.id;
  }
  const response = await fetchImpl(
    `${CHATGPT_BASE_URL}/codex/models?client_version=${CODEX_CLIENT_VERSION}`,
    { headers: codexHeaders(token, accountId), method: "GET", signal },
  );
  if (!response.ok) {
    throw await httpError(response);
  }
  const body = record(parseJson(await response.text()));
  const models = Array.isArray(body.models) ? body.models.map(record) : [];
  const listed = models
    .filter(
      (model) =>
        typeof model.slug === "string" &&
        model.slug.length > 0 &&
        model.visibility !== "hide",
    )
    .sort(
      (left, right) =>
        numberOr(left.priority, Number.MAX_SAFE_INTEGER) -
        numberOr(right.priority, Number.MAX_SAFE_INTEGER),
    );
  const id = listed[0]?.slug;
  if (typeof id !== "string") {
    throw new ChatGptImageError(
      "ChatGPT did not list any model this account can use for image generation. Image generation needs a paid ChatGPT plan.",
    );
  }
  cachedRoutingModel = { expires: Date.now() + ROUTING_MODEL_CACHE_MS, id };
  return id;
}

export function chatGptImageRequestBody(
  routingModel: string,
  context: ImagesContext,
  parameters: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const tool: Record<string, unknown> = { type: "image_generation" };
  for (const [key, value] of Object.entries(parameters ?? {})) {
    if (CHATGPT_IMAGE_TOOL_FIELDS.has(key)) tool[key] = value;
  }
  const content = context.input.map((part) =>
    part.type === "text"
      ? { text: part.text, type: "input_text" }
      : {
          image_url: `data:${part.mimeType};base64,${part.data}`,
          type: "input_image",
        },
  );
  return {
    input: [{ content, role: "user" }],
    instructions: ROUTING_INSTRUCTIONS,
    model: routingModel,
    parallel_tool_calls: false,
    store: false,
    stream: true,
    tool_choice: "auto",
    tools: [tool],
  };
}

export async function generateImagesWithChatGpt(
  model: ImageModel<ImageApi>,
  context: ImagesContext,
  options: ChatGptImagesOptions = {},
): Promise<AssistantImages> {
  const output: AssistantImages = {
    api: model.api,
    model: model.id,
    output: [],
    provider: model.provider,
    stopReason: "stop",
    timestamp: Date.now(),
  };
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs ?? CHATGPT_IMAGE_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error("timeout"));
  }, timeoutMs);
  const abort = () => controller.abort(options.signal?.reason);
  if (options.signal?.aborted) abort();
  else options.signal?.addEventListener("abort", abort, { once: true });

  try {
    const token = options.apiKey?.trim();
    if (!token) throw new ChatGptImageError(signInMessage());
    const accountId = chatGptAccountId(token);
    const fetchImpl = options.fetch ?? globalThis.fetch;
    const routingModel = await chatGptRoutingModel(
      token,
      accountId,
      fetchImpl,
      controller.signal,
    );
    let body: unknown = chatGptImageRequestBody(
      routingModel,
      context,
      options.parameters,
    );
    if (options.onPayload) {
      body = (await options.onPayload(body, model)) ?? body;
    }
    const response = await postWithRetries(
      fetchImpl,
      {
        body: JSON.stringify(body),
        headers: {
          ...codexHeaders(token, accountId),
          ...stringHeaders(options.headers),
          accept: "text/event-stream",
          "content-type": "application/json",
          "OpenAI-Beta": "responses=experimental",
        },
        method: "POST",
        signal: controller.signal,
      },
      controller.signal,
      options.sleep ?? abortableSleep,
    );
    const parsed = await parseChatGptImageStream(response, controller.signal);
    if (parsed.imageModel) output.model = parsed.imageModel;
    if (parsed.responseId) output.responseId = parsed.responseId;
    if (parsed.usage) output.usage = parsed.usage;
    for (const image of parsed.images) output.output.push(image);
    if (parsed.images.length === 0 && parsed.text) {
      output.output.push({ text: parsed.text, type: "text" });
    }
    return output;
  } catch (error) {
    if (timedOut) {
      output.stopReason = "error";
      output.errorMessage = `ChatGPT did not finish the image within ${Math.round(timeoutMs / 60_000)} minutes. It may be busy; try again in a little while.`;
    } else if (options.signal?.aborted) {
      output.stopReason = "aborted";
      output.errorMessage = "Image generation was stopped.";
    } else {
      output.stopReason = "error";
      output.errorMessage =
        error instanceof ChatGptImageError
          ? error.message
          : `ChatGPT image generation failed: ${error instanceof Error ? error.message : String(error)}`;
    }
    return output;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener("abort", abort);
  }
}

async function postWithRetries(
  fetchImpl: typeof globalThis.fetch,
  init: RequestInit,
  signal: AbortSignal,
  sleep: (ms: number, signal: AbortSignal) => Promise<void>,
): Promise<Response> {
  for (let attempt = 0; ; attempt += 1) {
    const response = await fetchImpl(
      `${CHATGPT_BASE_URL}/codex/responses`,
      init,
    );
    if (response.ok) return response;
    const error = await httpError(response);
    if (attempt >= MAX_RETRIES || !error.retryable) throw error;
    await sleep(retryDelayMs(response.headers, attempt), signal);
  }
}

class ChatGptHttpError extends ChatGptImageError {
  constructor(
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
  }
}

function retryDelayMs(headers: Headers, attempt: number): number {
  const seconds = Number(headers.get("retry-after"));
  const requested =
    Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
  return Math.min(MAX_RETRY_DELAY_MS, Math.max(requested, 1000 * 2 ** attempt));
}

function abortableSleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("aborted"));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/** Turns an HTTP failure into a message the user can act on. */
async function httpError(response: Response): Promise<ChatGptHttpError> {
  const raw = await response.text().catch(() => "");
  const body = record(parseJson(raw));
  const error = record(body.error ?? body.detail ?? body);
  const status = response.status;
  if (status === 401) {
    return new ChatGptHttpError(signInMessage(), false);
  }
  if (isQuota(error)) {
    return new ChatGptHttpError(quotaMessage(error, response.headers), false);
  }
  if (status === 429) {
    return new ChatGptHttpError(
      "ChatGPT is receiving a lot of image requests right now. Wait a minute and try again.",
      true,
    );
  }
  if (status === 403) {
    return new ChatGptHttpError(
      "ChatGPT turned down image generation for this account. It needs a paid ChatGPT plan (Plus, Pro, Business or similar).",
      false,
    );
  }
  if (isModeration(error)) {
    return new ChatGptHttpError(moderationMessage(), false);
  }
  if (status === 404) {
    return new ChatGptHttpError(
      "ChatGPT's image route was not found. It is not an official API and may have changed; for now pick another image model in Pine's settings.",
      false,
    );
  }
  const detail = errorText(error);
  return new ChatGptHttpError(
    `ChatGPT returned HTTP ${status}${detail ? `: ${detail}` : "."}`,
    status >= 500,
  );
}

function isQuota(error: Record<string, unknown>): boolean {
  return [error.code, error.type].some(
    (value) => typeof value === "string" && QUOTA_CODES.has(value),
  );
}

function isModeration(error: Record<string, unknown>): boolean {
  return (
    error.code === "moderation_blocked" ||
    error.type === "image_generation_user_error"
  );
}

function moderationMessage(): string {
  return "ChatGPT declined to draw this image under its content policy. Try rewording the prompt or using different reference images.";
}

function quotaMessage(
  error: Record<string, unknown>,
  headers?: Headers,
): string {
  const resetsAt = numberOr(error.resets_at, Number.NaN);
  const resetAfter = Number(
    headers?.get("x-codex-primary-reset-after-seconds"),
  );
  const minutes = Number.isFinite(resetsAt)
    ? Math.max(1, Math.round((resetsAt * 1000 - Date.now()) / 60_000))
    : Number.isFinite(resetAfter) && resetAfter > 0
      ? Math.max(1, Math.round(resetAfter / 60))
      : undefined;
  const when =
    minutes === undefined
      ? " It refills on the plan's schedule."
      : minutes < 120
        ? ` It refills in about ${minutes} min.`
        : ` It refills in about ${Math.round(minutes / 60)} h.`;
  return `This ChatGPT plan has used up its Codex usage for now, which image generation shares.${when}`;
}

function errorText(error: Record<string, unknown>): string | undefined {
  const message = error.message;
  return typeof message === "string" && message.trim()
    ? message.trim().slice(0, 500)
    : undefined;
}

interface ParsedImageStream {
  images: { data: string; mimeType: string; type: "image" }[];
  imageModel?: string;
  responseId?: string;
  text: string;
  usage?: Usage;
}

const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

/** Parses Codex's Responses SSE stream into images, text and usage. */
export async function parseChatGptImageStream(
  response: Response,
  signal: AbortSignal,
): Promise<ParsedImageStream> {
  if (!response.body) {
    throw new ChatGptImageError("ChatGPT sent an empty response.");
  }
  const parsed: ParsedImageStream = { images: [], text: "" };
  const seen = new Set<string>();
  let completed = false;

  const takeImage = (value: unknown) => {
    const item = record(value);
    if (item.type !== "image_generation_call") return;
    if (typeof item.model === "string") parsed.imageModel = item.model;
    const id = typeof item.id === "string" ? item.id : undefined;
    if (id && seen.has(id)) return;
    if (typeof item.result !== "string" || !item.result) return;
    if (id) seen.add(id);
    const format =
      typeof item.output_format === "string" ? item.output_format : "png";
    parsed.images.push({
      data: item.result,
      mimeType: MIME_BY_FORMAT[format] ?? "image/png",
      type: "image",
    });
  };

  const handle = (frame: string) => {
    const data = frame
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;
    const event = record(parseJson(data));
    switch (event.type) {
      case "error":
      case "response.failed": {
        const error = record(
          record(event.response).error ?? event.error ?? event,
        );
        if (isQuota(error)) throw new ChatGptImageError(quotaMessage(error));
        if (isModeration(error)) {
          throw new ChatGptImageError(moderationMessage());
        }
        const detail = errorText(error);
        throw new ChatGptImageError(
          `ChatGPT could not finish the image${detail ? `: ${detail}` : "."}`,
        );
      }
      case "response.incomplete":
        throw new ChatGptImageError(
          "ChatGPT stopped before the image was finished. Try again.",
        );
      case "response.created":
        if (typeof record(event.response).id === "string") {
          parsed.responseId = record(event.response).id as string;
        }
        break;
      case "response.output_text.delta":
        if (typeof event.delta === "string") parsed.text += event.delta;
        break;
      case "response.output_item.done":
        takeImage(event.item);
        break;
      case "response.completed": {
        const final = record(event.response);
        if (typeof final.id === "string") parsed.responseId = final.id;
        if (Array.isArray(final.output)) final.output.forEach(takeImage);
        const tools = Array.isArray(final.tools) ? final.tools.map(record) : [];
        const reported = tools.find(
          (tool) => tool.type === "image_generation",
        )?.model;
        if (typeof reported === "string" && !parsed.imageModel) {
          parsed.imageModel = reported;
        }
        const usage = parseUsage(final.usage);
        if (usage) parsed.usage = usage;
        completed = true;
        break;
      }
    }
  };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (!completed) {
      signal.throwIfAborted();
      const { done, value } = await raceAbort(reader.read(), signal);
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let match = /\r?\n\r?\n/u.exec(buffer);
      while (match && !completed) {
        handle(buffer.slice(0, match.index));
        buffer = buffer.slice(match.index + match[0].length);
        match = /\r?\n\r?\n/u.exec(buffer);
      }
    }
    if (!completed) {
      buffer += decoder.decode();
      if (buffer.trim()) handle(buffer);
    }
  } finally {
    void reader.cancel().catch(() => undefined);
  }
  if (!completed && parsed.images.length === 0) {
    throw new ChatGptImageError(
      "The connection to ChatGPT closed before the image arrived. Try again.",
    );
  }
  parsed.text = parsed.text.trim();
  return parsed;
}

function raceAbort<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("aborted"));
    if (signal.aborted) {
      onAbort();
      return;
    }
    signal.addEventListener("abort", onAbort, { once: true });
    work.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", onAbort);
    });
  });
}

function parseUsage(value: unknown): Usage | undefined {
  const raw = record(value);
  const input = numberOr(raw.input_tokens, 0);
  const output = numberOr(raw.output_tokens, 0);
  if (input === 0 && output === 0) return undefined;
  return {
    cacheRead: numberOr(record(raw.input_tokens_details).cached_tokens, 0),
    cacheWrite: 0,
    // Billed against the subscription, not per token.
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
    input,
    output,
    totalTokens: numberOr(raw.total_tokens, input + output),
  };
}

function stringHeaders(
  headers: ImagesOptions["headers"],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers ?? {})) {
    if (typeof value === "string") result[key] = value;
  }
  return result;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw) as unknown;
  } catch {
    return undefined;
  }
}
