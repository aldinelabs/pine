import { describe, expect, it } from "vitest";
import { effectiveImageModelSelection } from "../model-service";

const chatGpt = { modelId: "chatgpt-image", providerId: "openai-codex-images" };
const openRouterDefault = {
  modelId: "google/gemini-3-pro-image",
  providerId: "openrouter",
};

describe("effectiveImageModelSelection", () => {
  it("never switches to ChatGPT on the user's behalf", () => {
    expect(
      effectiveImageModelSelection(undefined, {
        chatGpt: true,
        openRouter: true,
      }),
    ).toEqual(openRouterDefault);
    expect(
      effectiveImageModelSelection(undefined, {
        chatGpt: true,
        openRouter: false,
      }),
    ).toBeUndefined();
  });

  it("keeps the ChatGPT choice while signed in", () => {
    expect(
      effectiveImageModelSelection(chatGpt, {
        chatGpt: true,
        openRouter: false,
      }),
    ).toEqual(chatGpt);
  });

  it("falls back to OpenRouter after signing out of ChatGPT", () => {
    expect(
      effectiveImageModelSelection(chatGpt, {
        chatGpt: false,
        openRouter: true,
      }),
    ).toEqual(openRouterDefault);
  });

  it("drops an unknown provider", () => {
    expect(
      effectiveImageModelSelection(
        { modelId: "chatgpt-image", providerId: "elsewhere" },
        { chatGpt: true, openRouter: false },
      ),
    ).toBeUndefined();
  });
});
