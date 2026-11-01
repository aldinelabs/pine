import { mkdtemp, readFile, rm, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createVideoTools } from "../video-tools";
import type { MediaGenerationToolOptions } from "../tools";
import type { ToolGate } from "../../gate";

const catalog = {
  data: [
    {
      id: "test/video",
      name: "Test Video",
      supported_durations: [4, 8],
      supported_resolutions: ["720p"],
      supported_aspect_ratios: ["16:9"],
    },
  ],
};
let directory: string;
let options: MediaGenerationToolOptions;
let fetchMock: ReturnType<typeof vi.fn<typeof fetch>>;
let review: ReturnType<typeof vi.fn>;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "pine-video-test-"));
  review = vi.fn().mockResolvedValue({ kind: "allow" });
  options = {
    cwd: directory,
    outputDirectory: directory,
    videoAgentDir: directory,
    videoJobsDirectory: path.join(directory, "jobs"),
    getApprovalMode: () => "auto-approve",
    getGate: () => ({ reviewPrivilegedCall: review }) as unknown as ToolGate,
    resolveApiKey: () => Promise.resolve("secret-test"),
    authorizeWrite: (target) => Promise.resolve(target),
    videoModelId: () => "test/video",
    resolveImageReference: vi.fn().mockResolvedValue({
      type: "image",
      mimeType: "image/png",
      data: "aW1hZ2U=",
    }),
  };
  fetchMock = vi.fn<typeof fetch>().mockImplementation((url, init) => {
    if (
      (typeof url === "string"
        ? url
        : url instanceof URL
          ? url.href
          : url.url
      ).endsWith("/models")
    )
      return Promise.resolve(Response.json(catalog));
    if (init?.method === "POST")
      return Promise.resolve(Response.json({ id: "job-1", status: "pending" }));
    if (
      (typeof url === "string"
        ? url
        : url instanceof URL
          ? url.href
          : url.url
      ).includes("/content")
    )
      return Promise.resolve(
        new Response("video bytes", {
          headers: { "Content-Type": "video/mp4" },
        }),
      );
    return Promise.resolve(
      Response.json({
        id: "job-1",
        status: "completed",
        usage: { cost: 0.5 },
      }),
    );
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(directory, { recursive: true, force: true });
});

function execute(name: string, params: unknown, signal?: AbortSignal) {
  return createVideoTools(options)
    .find((tool) => tool.name === name)!
    .execute("call", params, signal, vi.fn(), {} as never);
}
const posts = () =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

describe("video tools", () => {
  it("submits approved text and first-frame generation, preserves false audio, and saves an MP4", async () => {
    const result = await execute("generate_video", {
      prompt: "A river",
      duration: 4,
      resolution: "720p",
      aspect_ratio: "16:9",
      generate_audio: false,
      first_frame: "frame.png",
      output_path: "clip.mp4",
    });
    expect(review).toHaveBeenCalledOnce();
    expect(posts()).toHaveLength(1);
    expect(JSON.parse(posts()[0]?.[1]?.body as string)).toMatchObject({
      model: "test/video",
      generate_audio: false,
      duration: 4,
      frame_images: [
        {
          frame_type: "first_frame",
          image_url: { url: "data:image/png;base64,aW1hZ2U=" },
        },
      ],
    });
    expect(await readFile(path.join(directory, "clip.mp4"), "utf8")).toBe(
      "video bytes",
    );
    expect(result.details).toMatchObject({
      id: "job-1",
      status: "completed",
      cost: 0.5,
      files: [{ mimeType: "video/mp4" }],
    });
    expect(
      await readFile(path.join(directory, "jobs/job-1.json"), "utf8"),
    ).not.toContain("secret-test");
  });

  it("rejects unsupported model parameters before charging", async () => {
    await expect(
      execute("generate_video", { prompt: "River", duration: 5 }),
    ).rejects.toThrow("Unsupported duration");
    expect(posts()).toHaveLength(0);
  });

  it("requires the user to select a model", async () => {
    options.videoModelId = () => undefined;
    await expect(
      execute("generate_video", { prompt: "River" }),
    ).rejects.toThrow("Choose a video");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("denial does not submit or read a reference", async () => {
    review.mockResolvedValue({ kind: "deny", reason: "No" });
    await expect(
      execute("generate_video", { prompt: "River", first_frame: "frame.png" }),
    ).rejects.toThrow("No");
    expect(posts()).toHaveLength(0);
    expect(options.resolveImageReference).not.toHaveBeenCalled();
  });

  it("validates the write destination before creating a billable job", async () => {
    options.authorizeWrite = () =>
      Promise.reject(new Error("Outside shared folders"));
    await expect(
      execute("generate_video", {
        prompt: "River",
        output_path: "/outside/video.mp4",
      }),
    ).rejects.toThrow("Outside shared folders");
    expect(posts()).toHaveLength(0);
  });

  it("records an uncertain submission and never retries POST", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(catalog))
      .mockRejectedValueOnce(new Error("Connection lost"));
    await expect(
      execute("generate_video", { prompt: "River" }),
    ).rejects.toThrow("may already be billed");
    expect(posts()).toHaveLength(1);
    const listed = await execute("get_video_generation", {});
    expect(listed.details).toMatchObject({
      jobs: [{ status: "submission_unknown" }],
    });
  });

  it("recovers a saved job after interrupted polling without resubmitting", async () => {
    fetchMock
      .mockResolvedValueOnce(Response.json(catalog))
      .mockResolvedValueOnce(Response.json({ id: "job-1", status: "pending" }))
      .mockRejectedValueOnce(new Error("Connection lost"));
    await expect(
      execute("generate_video", { prompt: "River", output_path: "clip.mp4" }),
    ).rejects.toThrow('job_id "job-1"');
    const resumed = await execute("get_video_generation", { job_id: "job-1" });
    expect(resumed.details).toMatchObject({ status: "completed" });
    expect(posts()).toHaveLength(1);
  });

  it.each(["failed", "cancelled", "expired"])(
    "returns terminal %s without attempting download",
    async (status) => {
      fetchMock
        .mockResolvedValueOnce(Response.json(catalog))
        .mockResolvedValueOnce(
          Response.json({ id: "job-1", status: "pending" }),
        )
        .mockResolvedValueOnce(
          Response.json({ id: "job-1", status, error: "Provider stopped" }),
        );
      await expect(
        execute("generate_video", { prompt: "River" }),
      ).rejects.toThrow(`Video job-1: ${status}`);
      expect(
        JSON.parse(
          await readFile(path.join(directory, "jobs/job-1.json"), "utf8"),
        ),
      ).toMatchObject({ status, error: "Provider stopped" });
      expect(
        fetchMock.mock.calls.some(([url]) =>
          (typeof url === "string"
            ? url
            : url instanceof URL
              ? url.href
              : url.url
          ).includes("/content"),
        ),
      ).toBe(false);
    },
  );

  it("preserves the old target and cleans up a partial download on failure", async () => {
    await writeFile(path.join(directory, "clip.mp4"), "old");
    fetchMock
      .mockResolvedValueOnce(Response.json(catalog))
      .mockResolvedValueOnce(Response.json({ id: "job-1", status: "pending" }))
      .mockResolvedValueOnce(
        Response.json({ id: "job-1", status: "completed" }),
      )
      .mockResolvedValueOnce(
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new Uint8Array([1, 2]));
              controller.error(new Error("Truncated"));
            },
          }),
          { headers: { "Content-Type": "video/mp4" } },
        ),
      );
    await expect(
      execute("generate_video", { prompt: "River", output_path: "clip.mp4" }),
    ).rejects.toThrow("Truncated");
    expect(await readFile(path.join(directory, "clip.mp4"), "utf8")).toBe(
      "old",
    );
    expect(
      (await readdir(directory)).some((name) => name.endsWith(".part")),
    ).toBe(false);
  });

  it("does not submit when already aborted", async () => {
    await expect(
      execute("generate_video", { prompt: "River" }, AbortSignal.abort()),
    ).rejects.toThrow();
    expect(posts()).toHaveLength(0);
  });

  it("rejects traversal and jobs not recorded in this project", async () => {
    await expect(
      execute("get_video_generation", { job_id: "../other" }),
    ).rejects.toThrow("Invalid video job ID");
    await expect(
      execute("get_video_generation", { job_id: "another-job" }),
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

it("lists current capabilities and the selected model without generating", async () => {
  const result = await execute("list_video_models", {});
  expect(result.details).toMatchObject({
    selectedModelId: "test/video",
    models: [{ supportedDurations: [4, 8] }],
  });
  expect(posts()).toHaveLength(0);
});

it("continues a completed job on its original model after settings change", async () => {
  await execute("generate_video", { prompt: "River" });
  options.videoModelId = () => "other/model";
  await execute("generate_video", {
    prompt: "Continue the river",
    previous_job_id: "job-1",
  });
  expect(posts()).toHaveLength(2);
  expect(JSON.parse(posts()[1]?.[1]?.body as string)).toMatchObject({
    model: "test/video",
    previous_job_id: "job-1",
  });
});

it("reuses an already-downloaded video even after cloud retention expires", async () => {
  await execute("generate_video", { prompt: "River" });
  fetchMock.mockRejectedValue(new Error("Expired"));
  const result = await execute("get_video_generation", { job_id: "job-1" });
  expect(result.details).toMatchObject({ status: "completed" });
});
