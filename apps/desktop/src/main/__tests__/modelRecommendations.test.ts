import { describe, expect, it, vi } from "vitest";
import {
  ModelRecommendationService,
  parseModelRecommendations,
} from "../modelRecommendations";

const V2_URL = "https://example.test/v2.json";
const LEGACY_URL = "https://example.test/legacy.json";

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status });
}

/** Routes requests by URL so each test states what both files return. */
function routes(handlers: Record<string, () => Promise<Response>>) {
  return vi.fn<typeof globalThis.fetch>((input) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.href
          : input.url;
    const handler = handlers[url];
    return handler ? handler() : Promise.resolve(json(null, 404));
  });
}

function service(
  fetch: typeof globalThis.fetch,
  options: { now?: () => number; ttlMs?: number; retryDelayMs?: number } = {},
) {
  return new ModelRecommendationService({
    fetch,
    legacyUrl: LEGACY_URL,
    url: V2_URL,
    ...options,
  });
}

describe("parseModelRecommendations", () => {
  it("groups IDs by kind and drops malformed entries", () => {
    expect(
      parseModelRecommendations({
        version: 2,
        chat: ["glm-5.3-flash", " glm-5.3-flash ", "", 42, null],
        image: ["openai/gpt-image-1"],
        video: "not-a-list",
        audio: ["ignored"],
      }),
    ).toEqual({
      chat: ["glm-5.3-flash"],
      image: ["openai/gpt-image-1"],
      video: [],
    });
  });

  it("treats missing kinds as empty lists", () => {
    expect(parseModelRecommendations({ version: 2 })).toEqual({
      chat: [],
      image: [],
      video: [],
    });
  });

  it("rejects documents that are not version 2 objects", () => {
    expect(() => parseModelRecommendations(["glm"])).toThrow();
    expect(() => parseModelRecommendations({ chat: ["glm"] })).toThrow();
    expect(() =>
      parseModelRecommendations({ version: 3, chat: ["glm"] }),
    ).toThrow();
  });
});

describe("ModelRecommendationService", () => {
  it("loads and caches the v2 document without touching the legacy file", async () => {
    let now = 1_000;
    const fetch = routes({
      [V2_URL]: () =>
        Promise.resolve(
          json({
            version: 2,
            chat: ["glm-5.3-flash", "deepseek-v4"],
            image: ["openai/gpt-image-1"],
            video: ["vendor/video-a"],
          }),
        ),
    });
    const recommendations = service(fetch, { now: () => now, ttlMs: 1_000 });

    await expect(recommendations.get()).resolves.toEqual({
      chat: ["glm-5.3-flash", "deepseek-v4"],
      image: ["openai/gpt-image-1"],
      video: ["vendor/video-a"],
    });
    now += 999;
    await recommendations.get();

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(V2_URL, expect.anything());
  });

  it("falls back to the legacy chat list while the v2 file is missing", async () => {
    const fetch = routes({
      [LEGACY_URL]: () =>
        Promise.resolve(json(["glm-5.3-flash", "glm-5.3-flash", "hy4-flash"])),
    });

    await expect(service(fetch).get()).resolves.toEqual({
      chat: ["glm-5.3-flash", "hy4-flash"],
      image: [],
      video: [],
    });
  });

  it("falls back to the legacy list when the v2 document is malformed", async () => {
    const fetch = routes({
      [V2_URL]: () => Promise.resolve(json(["not", "v2"])),
      [LEGACY_URL]: () => Promise.resolve(json(["glm-5.3-flash"])),
    });

    await expect(service(fetch).get()).resolves.toEqual({
      chat: ["glm-5.3-flash"],
      image: [],
      video: [],
    });
  });

  it("keeps image and video lists when only the legacy file answers later", async () => {
    let now = 1_000;
    let v2Online = true;
    const fetch = routes({
      [V2_URL]: () =>
        v2Online
          ? Promise.resolve(
              json({ version: 2, chat: ["a"], image: ["img"], video: ["vid"] }),
            )
          : Promise.reject(new Error("offline")),
      [LEGACY_URL]: () => Promise.resolve(json(["b"])),
    });
    const recommendations = service(fetch, { now: () => now, ttlMs: 1_000 });

    await recommendations.get();
    v2Online = false;
    now += 1_000;

    await expect(recommendations.get()).resolves.toEqual({
      chat: ["b"],
      image: ["img"],
      video: ["vid"],
    });
  });

  it("keeps the last successful lists when both files fail", async () => {
    let now = 1_000;
    let online = true;
    const fetch = routes({
      [V2_URL]: () =>
        online
          ? Promise.resolve(json({ version: 2, chat: ["glm-5.3-flash"] }))
          : Promise.reject(new Error("offline")),
      [LEGACY_URL]: () => Promise.reject(new Error("offline")),
    });
    const recommendations = service(fetch, { now: () => now, ttlMs: 1_000 });

    await recommendations.get();
    online = false;
    now += 1_000;

    await expect(recommendations.get()).resolves.toEqual({
      chat: ["glm-5.3-flash"],
      image: [],
      video: [],
    });
  });

  it("resolves to empty lists when nothing can be loaded", async () => {
    const fetch = routes({
      [V2_URL]: () => Promise.resolve(json({ id: "glm" })),
      [LEGACY_URL]: () => Promise.resolve(json({ id: "glm" })),
    });

    await expect(service(fetch).get()).resolves.toEqual({
      chat: [],
      image: [],
      video: [],
    });
  });
});
