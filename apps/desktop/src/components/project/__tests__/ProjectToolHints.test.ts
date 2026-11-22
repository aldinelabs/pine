import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { PineToolCall } from "@/shared/sessions";
import ProjectToolHints from "../ProjectToolHints.vue";

beforeEach(() => {
  window.localStorage.clear();
});

function call(name: string, status: PineToolCall["status"]): PineToolCall {
  return { id: name, name, status, input: {} };
}

async function shownHint(toolCalls: PineToolCall[]) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(ProjectToolHints, {
    props: { toolCalls },
    global: { plugins: [pinia, createAppI18n("en-US")] },
  });
  await flushPromises();
  return wrapper
    .findAll('[data-slot="first-use-hint"]')
    .map((hint) => hint.attributes("data-hint"));
}

describe("ProjectToolHints", () => {
  it("points at the guide for a memory note, a Skill or an MCP tool", async () => {
    expect(await shownHint([call("memory_save", "complete")])).toEqual([
      "memory-saved",
    ]);
    expect(await shownHint([call("invoke_skill", "complete")])).toEqual([
      "skill-used",
    ]);
    expect(await shownHint([call("mcp", "complete")])).toEqual(["mcp-used"]);
  });

  it("waits until the tool has finished, and ignores other tools", async () => {
    expect(await shownHint([call("memory_save", "running")])).toEqual([]);
    expect(await shownHint([call("memory_save", "error")])).toEqual([]);
    expect(await shownHint([call("bash", "complete")])).toEqual([]);
  });
});
