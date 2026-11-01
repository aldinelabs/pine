import path from "node:path";
import { fileURLToPath } from "node:url";
import { Type, type Static } from "typebox";
import type { PineVideoModelDescriptor } from "../../shared/models";
import { previewMimeType } from "../../shared/previewFormats";
import type { MediaGenerationToolOptions } from "./tools";

const reference = Type.String({
  minLength: 1,
  maxLength: 150_000_000,
  description: "Local path, HTTP(S) URL, or base64 data URL.",
});
const url = Type.Object({ url: reference }, { additionalProperties: false });
const image = Type.Object(
  { type: Type.Literal("image_url"), image_url: url },
  { additionalProperties: false },
);
const audio = Type.Object(
  { type: Type.Literal("audio_url"), audio_url: url },
  { additionalProperties: false },
);
const video = Type.Object(
  { type: Type.Literal("video_url"), video_url: url },
  { additionalProperties: false },
);
export const generateVideoParams = Type.Object(
  {
    prompt: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 8_000,
        description:
          "Self-contained scene, motion, camera, lighting and sound. Omit only for models supporting input-only generation or upscaling.",
      }),
    ),
    duration: Type.Optional(Type.Integer({ minimum: 1 })),
    resolution: Type.Optional(Type.String({ maxLength: 32 })),
    aspect_ratio: Type.Optional(Type.String({ maxLength: 32 })),
    size: Type.Optional(
      Type.String({
        pattern: "^[1-9][0-9]*x[1-9][0-9]*$",
        description:
          "Exact pixel dimensions; use instead of resolution/aspect_ratio.",
      }),
    ),
    generate_audio: Type.Optional(Type.Boolean()),
    seed: Type.Optional(Type.Integer()),
    first_frame: Type.Optional(reference),
    last_frame: Type.Optional(reference),
    frame_images: Type.Optional(
      Type.Array(
        Type.Object(
          {
            type: Type.Literal("image_url"),
            image_url: url,
            frame_type: Type.Union([
              Type.Literal("first_frame"),
              Type.Literal("last_frame"),
            ]),
          },
          { additionalProperties: false },
        ),
        {
          maxItems: 2,
          description:
            "OpenRouter frame format. Do not combine with first_frame/last_frame aliases or input_references.",
        },
      ),
    ),
    input_references: Type.Optional(
      Type.Array(Type.Union([reference, image, audio, video]), {
        maxItems: 32,
        description:
          "Reference assets in order. A plain string is an image. Audio/video references require provider support; unsupported providers may ignore them. Use frame_images for exact first/last frames instead.",
      }),
    ),
    previous_job_id: Type.Optional(
      Type.String({
        pattern: "^[\\w-]{1,256}$",
        description:
          "Continue/edit a completed Pine video job. Reuses its model and endpoint; creates a new billable job.",
      }),
    ),
    upscale_factor: Type.Optional(Type.Number({ exclusiveMinimum: 0 })),
    creativity: Type.Optional(Type.Integer()),
    provider: Type.Optional(
      Type.Object(
        {
          options: Type.Optional(
            Type.Record(
              Type.String(),
              Type.Record(Type.String(), Type.Unknown()),
            ),
          ),
        },
        {
          additionalProperties: false,
          description:
            "OpenRouter provider.options keyed by provider slug. Only matched provider options apply. Consult list_video_models for allowed keys; use provider-specific nesting (e.g. google-vertex.parameters.negativePrompt). Local file references belong in frame_images/input_references.",
        },
      ),
    ),
    output_path: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 4096,
        description:
          "MP4 destination in a shared folder; omit for Pine's temporary media directory.",
      }),
    ),
  },
  { additionalProperties: false },
);
export type GenerateVideoParams = Static<typeof generateVideoParams>;

/** Validate advertised capabilities, leaving unspecified provider capabilities to OpenRouter. */
export function validateVideoParameters(
  params: GenerateVideoParams,
  model: PineVideoModelDescriptor,
): void {
  const frames = params.frame_images ?? [
    ...(params.first_frame ? [{ frame_type: "first_frame" }] : []),
    ...(params.last_frame ? [{ frame_type: "last_frame" }] : []),
  ];
  if (params.frame_images && (params.first_frame || params.last_frame))
    throw new Error("Use frame_images or first_frame/last_frame, not both.");
  if (new Set(frames.map((frame) => frame.frame_type)).size !== frames.length)
    throw new Error("Each frame type can only be specified once.");
  if (frames.length && params.input_references?.length)
    throw new Error(
      "Frame images and input_references select different generation modes; choose one.",
    );
  if (
    !params.prompt?.trim() &&
    !frames.length &&
    !params.input_references?.length &&
    !params.previous_job_id
  )
    throw new Error("Provide a prompt or input media.");
  if (params.size && (params.resolution || params.aspect_ratio))
    throw new Error("Use size or resolution/aspect_ratio, not both.");
  for (const [field, allowed, value] of [
    ["duration", model.supportedDurations, params.duration],
    ["resolution", model.supportedResolutions, params.resolution],
    ["aspect_ratio", model.supportedAspectRatios, params.aspect_ratio],
    ["size", model.supportedSizes ?? [], params.size],
  ] as const) {
    if (
      value !== undefined &&
      allowed.length &&
      !(allowed as readonly (string | number)[]).includes(value)
    )
      throw new Error(
        `Unsupported ${field}. Supported values: ${allowed.join(", ")}.`,
      );
  }
  for (const frame of frames)
    if (
      model.supportedFrameImages &&
      !model.supportedFrameImages.includes(frame.frame_type)
    )
      throw new Error(`${model.name} does not support ${frame.frame_type}.`);
  if (params.generate_audio === true && model.generatesAudio === false)
    throw new Error(`${model.name} does not support generated audio.`);
  if (params.seed !== undefined && model.supportsSeed === false)
    throw new Error(`${model.name} does not support seed.`);
  if (
    params.upscale_factor !== undefined &&
    (!model.upscaleFactor ||
      params.upscale_factor < model.upscaleFactor.min ||
      params.upscale_factor > model.upscaleFactor.max)
  )
    throw new Error(`Unsupported upscale_factor for ${model.name}.`);
  if (
    params.creativity !== undefined &&
    !model.creativity?.includes(params.creativity)
  )
    throw new Error(`Unsupported creativity for ${model.name}.`);
}

async function mediaUrl(
  value: string,
  kind: "image" | "audio" | "video",
  options: MediaGenerationToolOptions,
  signal?: AbortSignal,
): Promise<string> {
  if (kind === "image") {
    if (!options.resolveImageReference)
      throw new Error("Image references are unavailable.");
    const image = await options.resolveImageReference(value, signal);
    return `data:${image.mimeType};base64,${image.data}`;
  }
  if (/^https?:\/\//iu.test(value)) {
    const url = new URL(value);
    if (url.username || url.password)
      throw new Error("Reference URLs cannot contain credentials.");
    return url.href;
  }
  const limit = 100 * 1024 * 1024;
  if (value.startsWith("data:")) {
    const match = /^data:([^;,]+);base64,([A-Za-z0-9+/=\r\n]+)$/u.exec(value);
    if (!match || !match[1]?.startsWith(`${kind}/`))
      throw new Error(`Expected a base64 ${kind} data URL.`);
    if (Buffer.byteLength(match[2], "base64") > limit)
      throw new Error("Reference exceeds 100 MiB.");
    return value;
  }
  if (!options.readVideoReferenceFile)
    throw new Error("Local media references are unavailable.");
  const target = value.startsWith("file://")
    ? fileURLToPath(value)
    : path.resolve(options.cwd, value);
  const mime = previewMimeType(target);
  if (!mime.startsWith(`${kind}/`))
    throw new Error(`Expected a ${kind} file with a supported extension.`);
  signal?.throwIfAborted();
  const bytes = await options.readVideoReferenceFile(target);
  if (!bytes.length || bytes.length > limit)
    throw new Error("Media reference must contain 1 byte to 100 MiB.");
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

export async function videoRequestBody(
  params: GenerateVideoParams,
  modelId: string,
  options: MediaGenerationToolOptions,
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const body: Record<string, unknown> = { model: modelId };
  for (const field of [
    "prompt",
    "duration",
    "resolution",
    "aspect_ratio",
    "size",
    "generate_audio",
    "seed",
    "previous_job_id",
    "upscale_factor",
    "creativity",
    "provider",
  ] as const)
    if (params[field] !== undefined) body[field] = params[field];
  const frames = params.frame_images ?? [
    ...(params.first_frame
      ? [{ frame_type: "first_frame", image_url: { url: params.first_frame } }]
      : []),
    ...(params.last_frame
      ? [{ frame_type: "last_frame", image_url: { url: params.last_frame } }]
      : []),
  ];
  if (frames.length)
    body.frame_images = await Promise.all(
      frames.map(async (frame) => ({
        type: "image_url",
        frame_type: frame.frame_type,
        image_url: {
          url: await mediaUrl(frame.image_url.url, "image", options, signal),
        },
      })),
    );
  if (params.input_references?.length)
    body.input_references = await Promise.all(
      params.input_references.map(async (reference) => {
        if (typeof reference === "string")
          return {
            type: "image_url",
            image_url: {
              url: await mediaUrl(reference, "image", options, signal),
            },
          };
        switch (reference.type) {
          case "image_url":
            return {
              type: reference.type,
              image_url: {
                url: await mediaUrl(
                  reference.image_url.url,
                  "image",
                  options,
                  signal,
                ),
              },
            };
          case "audio_url":
            return {
              type: reference.type,
              audio_url: {
                url: await mediaUrl(
                  reference.audio_url.url,
                  "audio",
                  options,
                  signal,
                ),
              },
            };
          case "video_url":
            return {
              type: reference.type,
              video_url: {
                url: await mediaUrl(
                  reference.video_url.url,
                  "video",
                  options,
                  signal,
                ),
              },
            };
        }
      }),
    );
  return body;
}
