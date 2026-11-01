import { describe, expect, it, vi } from "vitest";
import { parseVideoJob, pollVideo, submitVideo } from "../openrouter-videos";
import { parseVideoModels } from "../video-models";

describe("OpenRouter video transport", () => {
  it("uses fixed endpoints and rejects redirects instead of forwarding credentials", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() =>
      Promise.resolve(
        Response.json({
          id: "job-1",
          status: "pending",
          polling_url: "https://evil.example/steal",
        }),
      ),
    );
    await submitVideo(
      { model: "test", prompt: "test" },
      { apiKey: "key", fetch },
    );
    await pollVideo("job-1", { apiKey: "key", fetch });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://openrouter.ai/api/v1/videos",
      "https://openrouter.ai/api/v1/videos/job-1",
    ]);
    for (const [, init] of fetch.mock.calls)
      expect(init).toMatchObject({
        redirect: "error",
        headers: { Authorization: "Bearer key" },
      });
  });
  it("rejects mismatched job IDs", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ id: "other", status: "completed" }));
    await expect(pollVideo("job-1", { apiKey: "key", fetch })).rejects.toThrow(
      "mismatch",
    );
  });
  it("rejects unknown statuses", () => {
    expect(() => parseVideoJob({ id: "job-1", status: "mystery" })).toThrow();
  });
  it("reports API errors", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        Response.json(
          { error: { message: "Insufficient credits" } },
          { status: 402 },
        ),
      );
    await expect(submitVideo({}, { apiKey: "key", fetch })).rejects.toThrow(
      "Insufficient credits",
    );
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("parses capabilities and rejects invalid catalogs", () => {
    expect(
      parseVideoModels({
        data: [
          {
            id: "a",
            name: "A",
            supported_durations: [4, -1, "8"],
            supported_resolutions: ["720p", null],
          },
        ],
      }),
    ).toEqual([
      {
        id: "a",
        name: "A",
        providerId: "openrouter",
        providerName: "OpenRouter",
        supportedDurations: [4],
        supportedResolutions: ["720p"],
        supportedAspectRatios: [],
        allowedPassthroughParameters: [],
      },
    ]);
    expect(() => parseVideoModels({ data: [] })).toThrow("Empty");
  });
});
