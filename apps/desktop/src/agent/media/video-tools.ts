import { randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  defineTool,
  withFileMutationQueue,
} from "@earendil-works/pi-coding-agent";
import { Type, type Static } from "typebox";
import {
  generateVideoParams,
  validateVideoParameters,
  videoRequestBody,
} from "./video-parameters";
import { UI_PRESENT_FILE_TOOL_NAME } from "../../shared/agent";
import {
  downloadVideo,
  pollVideo,
  submitVideo,
  type VideoJobStatus,
} from "./openrouter-videos";
import { videoModelDescriptors, record } from "./video-models";
import type { MediaGenerationToolOptions } from "./tools";

export const GENERATE_VIDEO_TOOL_NAME = "generate_video";
export const GET_VIDEO_GENERATION_TOOL_NAME = "get_video_generation";
export const LIST_VIDEO_MODELS_TOOL_NAME = "list_video_models";

const getParams = Type.Object(
  {
    job_id: Type.Optional(
      Type.String({
        pattern: "^[\\w-]{1,256}$",
        description:
          "Resume an existing job, without submitting or charging for a new generation. Omit to list this project's saved video jobs.",
      }),
    ),
  },
  { additionalProperties: false },
);

interface SavedJob {
  id: string;
  model: string;
  target: string;
  status: VideoJobStatus["status"] | "submitting" | "submission_unknown";
  createdAt: string;
  error?: string;
  cost?: number;
  file?: { path: string; bytes: number; mimeType: string };
}

function result(text: string, details: Record<string, unknown>) {
  return { content: [{ type: "text" as const, text }], details };
}

export function createVideoTools(options: MediaGenerationToolOptions) {
  const directory =
    options.videoJobsDirectory ?? path.join(options.outputDirectory, "jobs");
  const filePath = (id: string) => {
    if (!/^[\w-]{1,256}$/u.test(id)) throw new Error("Invalid video job ID.");
    return path.join(directory, `${id}.json`);
  };
  const save = async (job: SavedJob) => {
    await mkdir(directory, { recursive: true });
    const target = filePath(job.id);
    await withFileMutationQueue(target, async () => {
      const temporary = `${target}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, JSON.stringify(job), { mode: 0o600 });
        await rename(temporary, target);
      } finally {
        await rm(temporary, { force: true });
      }
    });
  };
  const read = async (id: string): Promise<SavedJob> => {
    const value: unknown = JSON.parse(await readFile(filePath(id), "utf8"));
    if (
      !record(value) ||
      value.id !== id ||
      typeof value.target !== "string" ||
      typeof value.model !== "string" ||
      typeof value.status !== "string"
    )
      throw new Error("Invalid saved video job.");
    return value as unknown as SavedJob;
  };
  const apiKey = async () => {
    const key = (await options.resolveApiKey())?.trim();
    if (!key)
      throw new Error(
        "Configure OpenRouter in Pine's model settings before generating videos.",
      );
    return key;
  };
  const finish = async (saved: SavedJob, key: string, signal?: AbortSignal) => {
    if (saved.file) {
      const target = await options.authorizeWrite(saved.target);
      try {
        const info = await stat(target);
        if (info.isFile() && info.size === saved.file.bytes)
          return result(
            `Video saved to ${target}. Call ${UI_PRESENT_FILE_TOOL_NAME} to show it.`,
            { ...saved, files: [saved.file] },
          );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    const job = await pollVideo(saved.id, { apiKey: key, signal });
    Object.assign(saved, job);
    await save(saved);
    if (job.status === "completed") {
      const target = await options.authorizeWrite(saved.target);
      saved.file = await withFileMutationQueue(target, () =>
        downloadVideo(job.id, target, { apiKey: key, signal }),
      );
      await save(saved);
      return result(
        `Video saved to ${saved.file.path}. Call ${UI_PRESENT_FILE_TOOL_NAME} to show it.`,
        { ...saved, files: [saved.file] },
      );
    }
    if (
      job.status === "failed" ||
      job.status === "cancelled" ||
      job.status === "expired"
    ) {
      throw new Error(
        `Video ${job.id}: ${job.status}${job.error ? ` — ${job.error}` : ""}.`,
      );
    }
    return result(
      `Video ${job.id}: ${job.status}${job.error ? ` — ${job.error}` : ""}. ${job.status === "pending" || job.status === "in_progress" ? `Use ${GET_VIDEO_GENERATION_TOOL_NAME} with this job_id to continue; do not submit again.` : ""}`,
      { ...saved },
    );
  };
  return [
    defineTool({
      name: GENERATE_VIDEO_TOOL_NAME,
      label: "Generate Video",
      description:
        "Generate, edit, extend, or upscale one MP4 video using OpenRouter. Inspect list_video_models first. Uses the selected model, except previous_job_id keeps the original model. Supports first/last frames, image/audio/video references and provider-specific options. May cost money. Submits once, waits up to ten minutes, and saves the output. Interrupting stops local waiting, not cloud generation. Resume with get_video_generation; never resubmit an interrupted job.",
      parameters: generateVideoParams,
      prepareArguments: (args) => args as Static<typeof generateVideoParams>,
      executionMode: "sequential",
      execute: async (toolCallId, params, signal, onUpdate) => {
        const key = await apiKey();
        const previous = params.previous_job_id
          ? await read(params.previous_job_id)
          : undefined;
        if (
          previous &&
          (await pollVideo(previous.id, { apiKey: key, signal })).status !==
            "completed"
        )
          throw new Error("Only completed video jobs can be continued.");
        const modelId = previous?.model ?? (await options.videoModelId?.());
        if (!modelId)
          throw new Error(
            "Choose a video generation model in Pine settings first.",
          );
        const models = await videoModelDescriptors(
          options.videoAgentDir ?? directory,
          { force: true },
        );
        const model = models.find((item) => item.id === modelId);
        if (!model)
          throw new Error(
            "Selected video model is unavailable. Choose another in Pine settings.",
          );
        validateVideoParameters(params, model);
        const requested =
          params.output_path?.trim() ||
          path.join(options.outputDirectory, `video-${randomUUID()}.mp4`);
        const target = await options.authorizeWrite(
          path.resolve(
            options.cwd,
            path.extname(requested) ? requested : `${requested}.mp4`,
          ),
        );
        if (path.extname(target).toLowerCase() !== ".mp4")
          throw new Error("Video output_path must use the .mp4 extension.");
        if (options.getApprovalMode() !== "YOLO") {
          const gate = options.getGate();
          if (!gate)
            throw new Error("Video generation requires an approval gate.");
          const decision = await gate.reviewPrivilegedCall({
            toolCallId,
            toolName: GENERATE_VIDEO_TOOL_NAME,
            subject: `${model.name}: ${params.prompt ?? "Input media generation"}`,
            description: `Generate a video with ${model.name}`,
            evidence: `Sends the prompt and supplied media to OpenRouter and may cost money. Parameters: ${JSON.stringify({ duration: params.duration, resolution: params.resolution, aspect_ratio: params.aspect_ratio, size: params.size, generate_audio: params.generate_audio, seed: params.seed, previous_job_id: params.previous_job_id, upscale_factor: params.upscale_factor, creativity: params.creativity, provider: params.provider, frameCount: params.frame_images?.length ?? Number(!!params.first_frame) + Number(!!params.last_frame), referenceCount: params.input_references?.length ?? 0 })}. Stopping local waiting does not cancel cloud billing.`,
            signal,
          });
          if (decision.kind === "deny")
            throw new Error(decision.reason ?? "Video generation denied.");
        }
        const body = await videoRequestBody(params, modelId, options, signal);
        signal?.throwIfAborted();
        const intent: SavedJob = {
          id: `request-${randomUUID()}`,
          model: modelId,
          target,
          status: "submitting",
          createdAt: new Date().toISOString(),
        };
        // Persist before the billable call. If its response is lost, do not pretend it is safe to retry.
        await save(intent);
        let job: VideoJobStatus;
        try {
          job = await submitVideo(body, { apiKey: key, signal });
        } catch (error) {
          intent.status = "submission_unknown";
          await save(intent);
          throw new Error(
            `Video submission was not confirmed. It may already be billed; check OpenRouter activity before submitting again. Local request: ${intent.id}. ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        const saved: SavedJob = { ...intent, ...job };
        try {
          await save(saved);
          await rm(filePath(intent.id), { force: true });
        } catch (error) {
          throw new Error(
            `Video was submitted as ${job.id}, but Pine could not persist its state. Do not resubmit; keep this job ID for recovery. ${error instanceof Error ? error.message : String(error)}`,
          );
        }
        onUpdate?.(
          result(
            `Video submitted: ${job.id}. Waiting for generation; stopping does not cancel the cloud job.`,
            { ...saved },
          ),
        );
        try {
          const deadline = Date.now() + 10 * 60_000;
          while (true) {
            const response = await finish(saved, key, signal);
            onUpdate?.(response);
            if (saved.status !== "pending" && saved.status !== "in_progress")
              return response;
            if (Date.now() >= deadline) return response;
            await delay(30_000, undefined, { signal });
          }
        } catch (error) {
          throw new Error(
            `Video job ${job.id} remains saved. Use ${GET_VIDEO_GENERATION_TOOL_NAME} with job_id "${job.id}" to resume without a new charge. ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      },
    }),
    defineTool({
      name: LIST_VIDEO_MODELS_TOOL_NAME,
      label: "Inspect Video Models",
      description:
        "Inspect OpenRouter video model capabilities and the model selected in Pine settings before generating. Lists supported frame types, durations, dimensions, audio/seed flags, upscaling controls, allowed provider passthrough keys and pricing. Missing capabilities are unknown, not guaranteed. Provider slug/nesting and reference/continuation support must follow provider documentation; the catalog does not describe all combinations.",
      parameters: Type.Object({}, { additionalProperties: false }),
      prepareArguments: () => ({}),
      executionMode: "sequential",
      execute: async () => {
        const models = await videoModelDescriptors(
          options.videoAgentDir ?? directory,
          { force: true },
        );
        const selectedModelId = await options.videoModelId?.();
        return result(JSON.stringify({ selectedModelId, models }), {
          selectedModelId,
          models,
        });
      },
    }),
    defineTool({
      name: GET_VIDEO_GENERATION_TOOL_NAME,
      label: "Check Video Generation",
      description:
        "List saved video jobs for this project, or check and download one existing job by job_id. Does not submit a generation. Use after interruption, timeout, or restart. Pending jobs should be checked about every 30 seconds. Never automatically resubmit submission_unknown requests.",
      parameters: getParams,
      prepareArguments: (args) => args as Static<typeof getParams>,
      executionMode: "sequential",
      execute: async (_toolCallId, params, signal) => {
        if (!params.job_id) {
          let names: string[];
          try {
            names = await readdir(directory);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
            names = [];
          }
          const jobs = await Promise.all(
            names
              .filter((name) => name.endsWith(".json"))
              .map((name) => read(name.slice(0, -5))),
          );
          return result(JSON.stringify(jobs), { jobs });
        }
        const saved = await read(params.job_id);
        if (saved.id.startsWith("request-"))
          return result(JSON.stringify(saved), { ...saved });
        return finish(saved, await apiKey(), signal);
      },
    }),
  ];
}
