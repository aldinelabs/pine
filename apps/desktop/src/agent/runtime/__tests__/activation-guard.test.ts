import { describe, expect, it } from "vitest";
import {
  describeContextTokens,
  isActivationToolName,
  LONG_CONTEXT_ACTIVATION_TOKENS,
  modelKeepsCacheOnToolAdditions,
  shouldConfirmLongContextActivation,
  toolsAddedByActivation,
} from "../activation-guard";
import { COMPUTER_USE_DYNAMIC_TOOL_NAMES } from "../../computer-use/tools";

const uncachedModel = { api: "openai-completions", compat: {} };
const longContext = LONG_CONTEXT_ACTIVATION_TOKENS + 1;

describe("modelKeepsCacheOnToolAdditions", () => {
  it("accepts transports that add tools in place", () => {
    expect(
      modelKeepsCacheOnToolAdditions({
        api: "anthropic-messages",
        compat: {
          supportsMidConvoSystemMessages: true,
          supportsMidConvoToolChanges: true,
        },
      }),
    ).toBe(true);
    expect(
      modelKeepsCacheOnToolAdditions({
        api: "openai-completions",
        compat: {
          supportsMidConvoSystemMessages: true,
          supportsMidConvoToolAdditions: true,
        },
      }),
    ).toBe(true);
    expect(
      modelKeepsCacheOnToolAdditions({
        api: "openai-responses",
        compat: { supportsToolSearch: true },
      }),
    ).toBe(true);
    expect(
      modelKeepsCacheOnToolAdditions({
        api: "openai-codex-responses",
        compat: {
          supportsMidConvoSystemMessages: true,
          supportsAdditionalTools: true,
        },
      }),
    ).toBe(true);
  });

  it("rejects models that rewrite the tool list", () => {
    expect(modelKeepsCacheOnToolAdditions(uncachedModel)).toBe(false);
    expect(
      modelKeepsCacheOnToolAdditions({
        api: "anthropic-messages",
        compat: { supportsMidConvoSystemMessages: true },
      }),
    ).toBe(false);
    expect(
      modelKeepsCacheOnToolAdditions({ api: "google-generative-ai" }),
    ).toBe(false);
  });
});

describe("toolsAddedByActivation", () => {
  it("lists only the group's tools that are not active", () => {
    const [first, ...rest] = COMPUTER_USE_DYNAMIC_TOOL_NAMES;
    expect(toolsAddedByActivation("activate_computer_use", [first])).toEqual(
      rest,
    );
    expect(
      toolsAddedByActivation("activate_computer_use", [
        ...COMPUTER_USE_DYNAMIC_TOOL_NAMES,
      ]),
    ).toEqual([]);
  });

  it("ignores tools that are not activations", () => {
    expect(isActivationToolName("read")).toBe(false);
    expect(toolsAddedByActivation("read", [])).toEqual([]);
  });
});

describe("shouldConfirmLongContextActivation", () => {
  const base = {
    toolName: "activate_computer_use",
    activeToolNames: [] as string[],
    model: uncachedModel,
    contextTokens: longContext,
    attended: true,
  };

  it("asks when a long context would lose its cache", () => {
    expect(shouldConfirmLongContextActivation(base)).toBe(true);
  });

  it("does not ask below the threshold or when the size is unknown", () => {
    expect(
      shouldConfirmLongContextActivation({
        ...base,
        contextTokens: LONG_CONTEXT_ACTIVATION_TOKENS - 1,
      }),
    ).toBe(false);
    expect(
      shouldConfirmLongContextActivation({ ...base, contextTokens: null }),
    ).toBe(false);
  });

  it("does not ask when the model keeps its cache", () => {
    expect(
      shouldConfirmLongContextActivation({
        ...base,
        model: {
          api: "openai-responses",
          compat: { supportsToolSearch: true },
        },
      }),
    ).toBe(false);
  });

  it("does not ask when nobody can answer or nothing changes", () => {
    expect(
      shouldConfirmLongContextActivation({ ...base, attended: false }),
    ).toBe(false);
    expect(
      shouldConfirmLongContextActivation({
        ...base,
        activeToolNames: [...COMPUTER_USE_DYNAMIC_TOOL_NAMES],
      }),
    ).toBe(false);
    expect(
      shouldConfirmLongContextActivation({ ...base, toolName: "read" }),
    ).toBe(false);
  });
});

describe("describeContextTokens", () => {
  it("rounds to thousands", () => {
    expect(describeContextTokens(187_400)).toBe("187K tokens");
  });
});
