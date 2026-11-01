import { createWriteStream } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { VIDEO_ENDPOINT, record } from "./video-models";

export interface VideoJobStatus {
  id: string;
  status:
    | "pending"
    | "in_progress"
    | "completed"
    | "failed"
    | "cancelled"
    | "expired";
  error?: string;
  cost?: number;
}

export function parseVideoJob(value: unknown): VideoJobStatus {
  if (
    !record(value) ||
    typeof value.id !== "string" ||
    !/^[\w-]{1,256}$/u.test(value.id) ||
    ![
      "pending",
      "in_progress",
      "completed",
      "failed",
      "cancelled",
      "expired",
    ].includes(String(value.status))
  )
    throw new Error("Invalid video job response.");
  return {
    id: value.id,
    status: value.status as VideoJobStatus["status"],
    ...(typeof value.error === "string"
      ? { error: value.error }
      : record(value.error) && typeof value.error.message === "string"
        ? { error: value.error.message }
        : {}),
    ...(record(value.usage) && typeof value.usage.cost === "number"
      ? { cost: value.usage.cost }
      : {}),
  };
}

export interface VideoClientOptions {
  apiKey: string;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
}

async function request(
  endpoint: string,
  options: VideoClientOptions,
  body?: Record<string, unknown>,
): Promise<Response> {
  const timeout = AbortSignal.timeout(body ? 120_000 : 300_000);
  const response = await (options.fetch ?? fetch)(endpoint, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${options.apiKey}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: options.signal
      ? AbortSignal.any([options.signal, timeout])
      : timeout,
    // Only the fixed OpenRouter endpoint receives the key; never follow redirects.
    redirect: "error",
  });
  if (!response.ok) {
    let message = `OpenRouter video request failed (HTTP ${response.status}).`;
    try {
      const error: unknown = await response.json();
      if (record(error) && typeof error.error === "string")
        message += ` ${error.error}`;
      else if (
        record(error) &&
        record(error.error) &&
        typeof error.error.message === "string"
      )
        message += ` ${error.error.message}`;
    } catch {
      /* Keep the HTTP status. */
    }
    throw new Error(message);
  }
  return response;
}

export async function submitVideo(
  body: Record<string, unknown>,
  options: VideoClientOptions,
): Promise<VideoJobStatus> {
  // Never retry POST automatically: a lost response may still have created a billable job.
  return parseVideoJob(
    await (await request(VIDEO_ENDPOINT, options, body)).json(),
  );
}

function jobUrl(id: string): string {
  if (!/^[\w-]{1,256}$/u.test(id)) throw new Error("Invalid video job ID.");
  return `${VIDEO_ENDPOINT}/${encodeURIComponent(id)}`;
}

export async function pollVideo(
  id: string,
  options: VideoClientOptions,
): Promise<VideoJobStatus> {
  const job = parseVideoJob(await (await request(jobUrl(id), options)).json());
  if (job.id !== id) throw new Error("Video job ID mismatch.");
  return job;
}

/** Stream into a sibling temporary file, then replace only after a complete download. */
export async function downloadVideo(
  id: string,
  target: string,
  options: VideoClientOptions,
): Promise<{ path: string; bytes: number; mimeType: string }> {
  const response = await request(`${jobUrl(id)}/content?index=0`, options);
  const mimeType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim();
  if (mimeType !== "video/mp4" || !response.body) {
    await response.body?.cancel();
    throw new Error("OpenRouter did not return an MP4 video.");
  }
  const limit = 1024 * 1024 * 1024;
  if (Number(response.headers.get("content-length")) > limit) {
    await response.body.cancel();
    throw new Error("Generated video exceeds the 1 GiB download limit.");
  }
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.part`;
  let bytes = 0;
  try {
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        bytes += chunk.length;
        callback(
          bytes > limit
            ? new Error("Generated video exceeds the 1 GiB download limit.")
            : null,
          chunk,
        );
      },
    });
    await pipeline(
      Readable.fromWeb(
        response.body as unknown as import("node:stream/web").ReadableStream<Uint8Array>,
      ),
      counter,
      createWriteStream(temporary, { flags: "wx", mode: 0o600 }),
      { signal: options.signal },
    );
    if (!bytes) throw new Error("Generated video is empty.");
    await rename(temporary, target);
    return { path: target, bytes, mimeType };
  } finally {
    await rm(temporary, { force: true });
  }
}
