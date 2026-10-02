import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  AssistantImages,
  ImageApi,
  ImagesContext,
  ImagesInputContent,
  ImageContent,
  ImageModel,
} from "@earendil-works/pi-ai";
import {
  defineTool,
  withFileMutationQueue,
  type AgentToolResult,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import type { PineApprovalMode } from "../../shared/agent";
import { UI_PRESENT_FILE_TOOL_NAME } from "../../shared/agent";
import type { ToolGate } from "../gate";
import { DEFAULT_IMAGE_MODEL_ID, imageModel, pineImagesModels } from "./models";
import {
  PROTECTED_BODY_FIELDS,
  generateImagesViaEndpoint,
  isImagesEndpointRedirect,
} from "./openrouter-images-endpoint";
import {
  imageReferenceUrl,
  resolveImageReference as resolveImageReferenceInput,
  type ImageReferenceInput,
} from "./image-input";

export const ACTIVATE_MEDIA_GENERATION_TOOL_NAME =
  "activate_media_generation" as const;
export const GENERATE_IMAGE_TOOL_NAME = "generate_image" as const;

/**
 * Media tools hidden until `activate_media_generation` runs. Image generation
 * is the only entry today; further media tools join this list instead of
 * widening the always-visible tool set.
 */
export const MEDIA_GENERATION_DYNAMIC_TOOL_NAMES = [
  GENERATE_IMAGE_TOOL_NAME,
] as const;

const MAX_PROMPT_LENGTH = 8_000;

const IMAGE_FILE_EXTENSIONS: Record<string, string> = {
  "image/avif": "avif",
  "image/bmp": "bmp",
  "image/gif": "gif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

const ACTIVATION_GUIDANCE = `Media generation is active for this session.

Call ${GENERATE_IMAGE_TOOL_NAME} with a self-contained prompt: name the subject, its actions and setting, then the composition, medium or style, lighting, colour palette, and any text that must appear in the image. Write the prompt in the language the user is using unless the prompt itself benefits from another language. Prefer one clear image per call; ask for variants with separate calls instead of stacking contradictory instructions in one prompt. When the user attached reference images, pass their local paths from the <pine_attachments> block in input_references.

The image model itself is a user preference: every call runs on the model the user picked in Pine's settings, and the tool has no model argument. Use parameters only for model-specific options the user asked for (for example size, quality, aspect ratio, or style).

Generated files are written to disk but never opened for the user, and the default output lands in this project's temporary directory, outside the folders the user shares with Pine. When the user should actually look at the image, put it somewhere they can reach first — pass an output_path inside a folder shared with Pine, or copy the generated file there with the shell — and then call ${UI_PRESENT_FILE_TOOL_NAME} on that path. Mention the path you kept.`;

function textResult(
  text: string,
  details: Record<string, unknown>,
): AgentToolResult<Record<string, unknown>> {
  return { content: [{ type: "text", text }], details };
}

function extensionFor(mimeType: string): string {
  return IMAGE_FILE_EXTENSIONS[mimeType.trim().toLowerCase()] ?? "png";
}

function parameterRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function imageFileName(sequence: number): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(/\..+$/u, "");
  const suffix = randomUUID().slice(0, 8);
  return `image-${stamp}-${suffix}${sequence > 1 ? `-${sequence}` : ""}`;
}

function withExtension(filePath: string, extension: string): string {
  return path.extname(filePath) ? filePath : `${filePath}.${extension}`;
}

function withSequence(filePath: string, sequence: number): string {
  if (sequence <= 1) return filePath;
  const extension = path.extname(filePath);
  return `${filePath.slice(0, filePath.length - extension.length)}-${sequence}${extension}`;
}

export interface GenerateImageRequest {
  apiKey: string;
  input?: readonly ImagesInputContent[];
  model: ImageModel<ImageApi>;
  prompt: string;
  parameters?: Record<string, unknown>;
  signal?: AbortSignal;
}

export interface MediaGenerationToolOptions {
  /** Records activation and exposes the hidden media tools for this session. */
  activateMediaGeneration?: () => void;
  /** Project root used to resolve relative output paths. */
  cwd: string;
  getApprovalMode(): PineApprovalMode;
  getGate(): ToolGate | null;
  /** Resolves the OpenRouter credential; undefined when it is not configured. */
  resolveApiKey(): Promise<string | undefined>;
  /**
   * The image model the user picked in settings. It is the only way to choose
   * an image model; the tool itself cannot ask for one.
   */
  imageModelId?: () => Promise<string | undefined> | string | undefined;
  /** Directory that receives generated files when output_path is omitted. */
  outputDirectory: string;
  /** Authorizes (and canonicalizes) a project write target. */
  authorizeWrite(targetPath: string): Promise<string>;
  /** Resolves a local path, HTTP(S) URL, or data URL into image content. */
  resolveImageReference?: (
    reference: string,
    signal?: AbortSignal,
  ) => Promise<ImageContent>;
  /** Injectable image generation, used by tests. */
  generateImages?: (request: GenerateImageRequest) => Promise<AssistantImages>;
}

/**
 * OpenRouter serves image models on two transports: chat models that emit an
 * image alongside their text answer use `chat/completions`, while pure image
 * models are only reachable on the dedicated `/api/v1/images` endpoint. Pi
 * 0.85.1 implements the first one, so Pine routes by the catalog's declared
 * output modalities instead of waiting for a Pi release.
 */
export function imageTransportFor(
  model: ImageModel<ImageApi>,
): "chat" | "images" {
  return model.output.includes("text") ? "chat" : "images";
}

export async function generateImagesWithOpenRouter(
  request: GenerateImageRequest,
): Promise<AssistantImages> {
  const input = request.input ?? [{ type: "text", text: request.prompt }];
  if (imageTransportFor(request.model) === "images") {
    return generateImagesViaEndpoint({ ...request, input });
  }

  const context: ImagesContext = {
    input: [...input],
  };
  const result = await pineImagesModels().generateImages(
    request.model,
    context,
    {
      apiKey: request.apiKey,
      onPayload: (payload: unknown) =>
        mergeImageParameters(payload, request.parameters),
      ...(request.signal ? { signal: request.signal } : {}),
    },
  );
  // Models can be reclassified upstream without a Pi release; when OpenRouter
  // answers that the model lives on the image API, retry there once.
  if (isImagesEndpointRedirect(result.errorMessage)) {
    return generateImagesViaEndpoint({ ...request, input });
  }
  return result;
}

/**
 * Merges model-specific options into the OpenRouter request body. The prompt
 * frame itself (messages, model, stream) stays under Pine's control.
 */
export function mergeImageParameters(
  payload: unknown,
  parameters: Record<string, unknown> | undefined,
): unknown {
  if (!parameters) return payload;
  if (
    typeof payload !== "object" ||
    payload === null ||
    Array.isArray(payload)
  ) {
    return payload;
  }
  const body = { ...(payload as Record<string, unknown>) };
  for (const [key, value] of Object.entries(parameters)) {
    if (PROTECTED_BODY_FIELDS.has(key)) continue;
    body[key] = value;
  }
  return body;
}

const emptyParams = Type.Object({}, { additionalProperties: false });

const generateImageParams = Type.Object(
  {
    input_references: Type.Optional(
      Type.Array(
        Type.Union([
          Type.String({
            description:
              "A local image path from the current <pine_attachments> block, an HTTP(S) image URL, or a base64 data URL.",
            maxLength: 4_096,
          }),
          Type.Object(
            {
              image_url: Type.Object(
                {
                  url: Type.String({ minLength: 1, maxLength: 16_777_216 }),
                },
                { additionalProperties: false },
              ),
              type: Type.Literal("image_url"),
            },
            { additionalProperties: false },
          ),
        ]),
        {
          description:
            "Reference images for image-to-image generation. Multiple references are sent in order; the selected model must accept image input.",
        },
      ),
    ),
    prompt: Type.String({
      description:
        "A complete, self-contained description of the image to create: subject, setting, composition, style or medium, lighting, palette, and any text that must appear.",
      minLength: 1,
      maxLength: MAX_PROMPT_LENGTH,
    }),
    parameters: Type.Optional(
      Type.Record(Type.String(), Type.Unknown(), {
        description:
          "Extra OpenRouter request-body fields for model-specific options, such as size, quality, aspect_ratio, n, background, or output_format. Passed through unchanged; models that do not support a field may ignore or reject it. model, prompt, messages, modalities, input_references, and stream cannot be overridden here.",
      }),
    ),
    output_path: Type.Optional(
      Type.String({
        description:
          "File path for the generated image. A relative path resolves against the project root and must stay inside a folder shared with Pine; use this when the user should keep or open the image. Omit to save into this project's Pine temporary directory, which the user cannot browse from Pine. When several images are returned, later files get a numeric suffix.",
        maxLength: 4_096,
      }),
    ),
  },
  { additionalProperties: false },
);

function createActivateTool(options: MediaGenerationToolOptions) {
  return defineTool({
    name: ACTIVATE_MEDIA_GENERATION_TOOL_NAME,
    label: "Activate Media Generation",
    description:
      "Dynamically enable Pine's media generation tools for the current session. Call this before generating images; the tools stay out of context until activation. Ask for image generation directly when the user asks for a picture, illustration, logo, mockup, or diagram rendered as an image.",
    promptSnippet:
      "Activate image generation on demand before drawing or generating any picture",
    promptGuidelines: [
      `Call ${ACTIVATE_MEDIA_GENERATION_TOOL_NAME} once when the user asks for a picture, illustration, logo, mockup, or any other image, then call ${GENERATE_IMAGE_TOOL_NAME}.`,
      `Skip activation for text-only work such as diagrams, charts, or icons that should be expressed as code.`,
    ],
    parameters: emptyParams,
    prepareArguments: () => ({}),
    executionMode: "sequential",
    execute: () => {
      options.activateMediaGeneration?.();
      return Promise.resolve(
        textResult(ACTIVATION_GUIDANCE, {
          activatedToolNames: [...MEDIA_GENERATION_DYNAMIC_TOOL_NAMES],
        }),
      );
    },
  });
}

function createGenerateImageTool(options: MediaGenerationToolOptions) {
  return defineTool({
    name: GENERATE_IMAGE_TOOL_NAME,
    label: "Generate Image",
    description:
      "Generate an image from a text prompt and optional reference images with OpenRouter's aggregated image models, then save the result as a file. The file is not opened for the user: keep it in a folder shared with Pine and call " +
      UI_PRESENT_FILE_TOOL_NAME +
      " if the user should see it. Requires activate_media_generation first. This call reaches the network and may cost money, so it is reviewed like other privileged actions.",
    promptSnippet:
      "Generate images from a prompt with OpenRouter image models and save them as project files",
    promptGuidelines: [
      `Write ${GENERATE_IMAGE_TOOL_NAME} prompts that a reader could execute without seeing the conversation: describe the subject, setting, composition, style, lighting, and palette, and spell out text that must appear in the image.`,
      `For image-to-image work, pass every intended reference in input_references. Use the exact local path from the current <pine_attachments> block, or an HTTP(S)/base64 data URL; do not describe an attached image and omit it from the request.`,
      `Prefer one image per call and iterate on the prompt instead of asking for many unrelated images at once.`,
      `Without output_path the image lands in this project's temporary directory, which never shows up in Pine's file tree and is not opened for the user.`,
      `When the user should look at the image, write or copy it into a folder shared with Pine and call ${UI_PRESENT_FILE_TOOL_NAME} on that path; opening the temporary copy needs an approval and is a poor default.`,
      `Generated images do not enter the conversation as attachments: describe what you created and name the path you kept.`,
    ],
    parameters: generateImageParams,
    prepareArguments: (args) => args as Static<typeof generateImageParams>,
    executionMode: "sequential",
    execute: async (toolCallId, params, signal) => {
      const apiKey = (await options.resolveApiKey())?.trim();
      if (!apiKey) {
        throw new Error(
          "Image generation is unavailable because OpenRouter is not configured. Ask the user to add an OpenRouter API key or sign in with OpenRouter in Pine's model settings, then try again.",
        );
      }

      const selectedModelId =
        (await options.imageModelId?.())?.trim() || DEFAULT_IMAGE_MODEL_ID;
      const model = imageModel(selectedModelId);
      if (!model) {
        throw new Error(
          `The image model "${selectedModelId}" from Pine's settings is not in OpenRouter's image catalog. Ask the user to pick another image model in Pine's settings, then try again.`,
        );
      }

      const references = (params.input_references ??
        []) as ImageReferenceInput[];
      if (references.length > 0 && !model.input.includes("image")) {
        throw new Error(
          `${model.name} does not accept image input. Pick an image model that lists image input, or remove input_references.`,
        );
      }

      if (options.getApprovalMode() !== "YOLO") {
        const gate = options.getGate();
        if (!gate) {
          throw new Error(
            "Image generation requires an approval gate in this mode.",
          );
        }
        const decision = await gate.reviewPrivilegedCall({
          toolCallId,
          toolName: GENERATE_IMAGE_TOOL_NAME,
          subject: `${model.name}: ${params.prompt}`,
          description: `Generate an image with ${model.name}`,
          evidence:
            "This sends the prompt to OpenRouter's image API, outside Pine's project sandbox, and the request may cost money.",
          signal,
        });
        if (decision.kind === "deny") {
          throw new Error(decision.reason ?? "Image generation was denied.");
        }
      }
      if (signal?.aborted) throw new Error("aborted");

      const generate = options.generateImages ?? generateImagesWithOpenRouter;
      const resolveReference =
        options.resolveImageReference ??
        ((reference: string, referenceSignal?: AbortSignal) =>
          resolveImageReferenceInput(reference, {
            cwd: options.cwd,
            ...(referenceSignal ? { signal: referenceSignal } : {}),
          }));
      const result = await generate({
        apiKey,
        model,
        prompt: params.prompt,
        ...(references.length > 0
          ? {
              input: [
                { text: params.prompt, type: "text" as const },
                ...(await Promise.all(
                  references.map(async (reference) => {
                    const value = imageReferenceUrl(reference);
                    return resolveReference(value, signal);
                  }),
                )),
              ],
            }
          : {}),
        ...(params.parameters
          ? { parameters: parameterRecord(params.parameters) }
          : {}),
        ...(signal ? { signal } : {}),
      });
      if (result.stopReason === "aborted") throw new Error("aborted");
      if (result.stopReason === "error") {
        throw new Error(
          result.errorMessage ?? "Image generation failed without a message.",
        );
      }

      const images = result.output.filter(
        (part): part is { type: "image"; data: string; mimeType: string } =>
          part.type === "image",
      );
      const modelText = result.output
        .filter((part) => part.type === "text")
        .map((part) => part.text)
        .join("\n")
        .trim();
      if (images.length === 0) {
        throw new Error(
          `${model.name} returned no image${modelText ? `: ${modelText}` : "."}`,
        );
      }

      const baseDirectory = options.outputDirectory;
      const requestedOutput = params.output_path?.trim();
      const files: { path: string; mimeType: string; bytes: number }[] = [];
      for (const [index, image] of images.entries()) {
        const extension = extensionFor(image.mimeType);
        const requestedTarget = requestedOutput
          ? withSequence(
              withExtension(
                path.isAbsolute(requestedOutput)
                  ? requestedOutput
                  : path.resolve(options.cwd, requestedOutput),
                extension,
              ),
              index + 1,
            )
          : path.join(
              baseDirectory,
              `${imageFileName(index + 1)}.${extension}`,
            );
        const target = await options.authorizeWrite(requestedTarget);
        const bytes = Buffer.from(image.data, "base64");
        await mkdir(path.dirname(target), { recursive: true });
        await withFileMutationQueue(target, () =>
          writeFile(target, bytes, { mode: 0o600 }),
        );
        files.push({
          bytes: bytes.byteLength,
          mimeType: image.mimeType,
          path: target,
        });
      }

      const list = files
        .map(
          (file) =>
            `- ${file.path} (${file.mimeType}, ${Math.round(file.bytes / 1024)} KB)`,
        )
        .join("\n");
      const summary = [
        `Generated ${files.length} image${files.length === 1 ? "" : "s"} with ${model.name}:`,
        list,
        ...(modelText ? [`\n${model.name} also returned:\n${modelText}`] : []),
        `\nPine does not open generated images. To show one to the user, write or copy it into a folder shared with Pine and call ${UI_PRESENT_FILE_TOOL_NAME} on that path.`,
      ]
        .filter(Boolean)
        .join("\n");
      return textResult(summary, {
        files,
        model: model.id,
        ...(params.parameters ? { parameters: params.parameters } : {}),
        prompt: params.prompt,
        ...(result.responseId ? { responseId: result.responseId } : {}),
      });
    },
  });
}

/**
 * Builds the media generation tools. The activator is always visible; the
 * generation tools are registered up front and become active only after
 * activation, so their schemas and prompt guidance stay out of context until
 * the session actually needs them.
 */
export function createMediaGenerationToolDefinitions(
  options: MediaGenerationToolOptions,
): ToolDefinition[] {
  if (!options.activateMediaGeneration) return [];
  return [createActivateTool(options), createGenerateImageTool(options)];
}
