import { describe, expect, it, vi } from "vitest";
import { validateVideoParameters, videoRequestBody } from "../video-parameters";
import { parseVideoModels } from "../video-models";
import type { MediaGenerationToolOptions } from "../tools";

const model = parseVideoModels({
  data: [
    {
      id: "test",
      name: "Test",
      supported_durations: [4, 8],
      supported_resolutions: ["720p"],
      supported_aspect_ratios: ["16:9"],
      supported_sizes: ["1280x720"],
      supported_frame_images: ["first_frame", "last_frame"],
      generate_audio: true,
      seed: true,
      allowed_passthrough_parameters: ["negativePrompt"],
      upscale_factor: { min: 1.5, max: 3 },
      creativity: [0, 1],
    },
  ],
})[0];
const options = {
  cwd: "/project",
  resolveImageReference: vi.fn((value: string) =>
    Promise.resolve({
      type: "image" as const,
      mimeType: "image/png",
      data: Buffer.from(value).toString("base64"),
    }),
  ),
  readVideoReferenceFile: vi.fn(() => Promise.resolve(Buffer.from("media"))),
} as unknown as MediaGenerationToolOptions;

describe("video capabilities", () => {
  it("maps both frames in order and preserves zero/false and provider options", async () => {
    const params = {
      prompt: "Move",
      first_frame: "start.png",
      last_frame: "end.png",
      seed: 0,
      generate_audio: false,
      size: "1280x720",
      provider: {
        options: {
          "google-vertex": { parameters: { negativePrompt: "blur" } },
        },
      },
    };
    validateVideoParameters(params, model);
    const body = await videoRequestBody(params, "test", options);
    expect(body).toMatchObject({
      seed: 0,
      generate_audio: false,
      size: "1280x720",
      provider: params.provider,
      frame_images: [
        { frame_type: "first_frame" },
        { frame_type: "last_frame" },
      ],
    });
    expect(body).not.toHaveProperty("first_frame");
    expect(body).not.toHaveProperty("output_path");
  });
  it("accepts OpenRouter frame_images without requiring text", async () => {
    const params = {
      frame_images: [
        {
          type: "image_url" as const,
          frame_type: "last_frame" as const,
          image_url: { url: "end.png" },
        },
      ],
    };
    validateVideoParameters(params, model);
    const body = await videoRequestBody(params, "test", options);
    expect(body).toMatchObject({
      frame_images: [{ type: "image_url", frame_type: "last_frame" }],
    });
    expect(body).not.toHaveProperty("prompt");
  });
  it("preserves mixed reference order and reads local files through the policy callback", async () => {
    const body = await videoRequestBody(
      {
        prompt: "Match these",
        input_references: [
          "style.png",
          { type: "audio_url", audio_url: { url: "sound.mp3" } },
          { type: "video_url", video_url: { url: "clip.mp4" } },
          {
            type: "video_url",
            video_url: { url: "https://example.com/reference.mp4" },
          },
        ],
      },
      "test",
      options,
    );
    expect(body).toMatchObject({
      input_references: [
        { type: "image_url" },
        {
          type: "audio_url",
          audio_url: { url: "data:audio/mpeg;base64,bWVkaWE=" },
        },
        {
          type: "video_url",
          video_url: { url: "data:video/mp4;base64,bWVkaWE=" },
        },
        {
          type: "video_url",
          video_url: { url: "https://example.com/reference.mp4" },
        },
      ],
    });
    expect(options.readVideoReferenceFile).toHaveBeenCalledWith(
      "/project/clip.mp4",
    );
  });
  it("forwards continuation and upscaling controls", async () => {
    const params = {
      previous_job_id: "job-1",
      upscale_factor: 2,
      creativity: 0,
    };
    validateVideoParameters(params, model);
    expect(await videoRequestBody(params, "test", options)).toMatchObject(
      params,
    );
  });
  it("rejects unsupported tail frames before submission", () => {
    expect(() =>
      validateVideoParameters(
        { prompt: "Move", last_frame: "end.png" },
        { ...model, supportedFrameImages: ["first_frame"] },
      ),
    ).toThrow("last_frame");
  });
  it.each([
    { first_frame: "start.png", input_references: ["style.png"] },
    { first_frame: "start.png", frame_images: [] },
    { prompt: "Move", size: "1280x720", resolution: "720p" },
    { prompt: "Move", upscale_factor: 10 },
    { prompt: "Move", creativity: 4 },
    {},
  ])("rejects conflicting or unsupported controls: %j", (params) => {
    expect(() => validateVideoParameters(params, model)).toThrow();
  });
  it("does not bypass local reference access checks", async () => {
    await expect(
      videoRequestBody(
        {
          input_references: [
            { type: "video_url", video_url: { url: "/private/clip.mp4" } },
          ],
        },
        "test",
        {
          ...options,
          readVideoReferenceFile: () => Promise.reject(new Error("Denied")),
        },
      ),
    ).rejects.toThrow("Denied");
  });
});
