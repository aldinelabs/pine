import { mount } from "@vue/test-utils";
import {
  BookOpenIcon,
  EyeIcon,
  ShieldBanIcon,
  WandSparklesIcon,
} from "@lucide/vue";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { PineToolCall } from "@/shared/sessions";
import type { PineTranscriptMessage } from "@/stores/session";
import ProjectToolCallGroup from "../ProjectToolCallGroup.vue";
import ProjectToolCallMarker from "../ProjectToolCallMarker.vue";

const message: PineTranscriptMessage = {
  createdAt: "2026-08-26T00:00:00.000Z",
  id: "assistant-1",
  role: "assistant",
  status: "complete",
  blocks: [],
};

const toolCalls: PineToolCall[] = [
  {
    id: "tool-1",
    input: { command: "bun run check" },
    name: "bash",
    status: "complete",
  },
  {
    id: "tool-2",
    input: { path: "/project/src/main.ts" },
    name: "read",
    status: "complete",
  },
];

function mountGroup(
  overrides: Partial<{
    message: PineTranscriptMessage;
    toolCalls: PineToolCall[];
    expanded: boolean;
    openFile: (path: string, toolCallId: string) => boolean;
  }> = {},
) {
  return mount(ProjectToolCallGroup, {
    props: {
      message,
      toolCalls,
      ...overrides,
    },
    global: {
      plugins: [createAppI18n("zh-CN")],
    },
  });
}

describe("ProjectToolCallGroup", () => {
  it("marks denied calls in the folded header and does not leave them running", () => {
    const wrapper = mountGroup({
      toolCalls: [
        {
          ...toolCalls[0],
          status: "running",
          approval: { state: "denied", decidedBy: "user" },
        },
      ],
    });
    const icon = wrapper.get("[data-tool-icons]").findComponent(ShieldBanIcon);
    expect(icon.classes()).toContain("text-warning");
    expect(wrapper.find('[data-slot="spinner"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("collapses by default and expands on click", async () => {
    const wrapper = mountGroup();

    const trigger = wrapper.get('button[data-slot="marker"]');
    expect(trigger.attributes("aria-expanded")).toBe("false");
    expect(trigger.text()).toContain("读取了 1 个文件，运行了 1 条命令");

    const content = wrapper.get("[data-tool-calls-content]");
    expect(content.attributes("aria-hidden")).toBe("true");

    await trigger.trigger("click");
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(content.attributes("aria-hidden")).toBe("false");
    expect(wrapper.findAllComponents(ProjectToolCallMarker)).toHaveLength(2);
  });

  it("follows the transcript-level expansion policy while active", () => {
    const wrapper = mountGroup({ expanded: true });

    const trigger = wrapper.get('button[data-slot="marker"]');
    expect(trigger.attributes("aria-expanded")).toBe("true");
    expect(
      wrapper.get("[data-tool-calls-content]").attributes("aria-hidden"),
    ).toBe("false");
    expect(wrapper.findAllComponents(ProjectToolCallMarker)).toHaveLength(2);
  });

  it("folds when the run drops out of the window or the response ends", async () => {
    const wrapper = mountGroup({ expanded: true });
    expect(
      wrapper.get('button[data-slot="marker"]').attributes("aria-expanded"),
    ).toBe("true");

    await wrapper.setProps({ expanded: false });
    expect(
      wrapper.get('button[data-slot="marker"]').attributes("aria-expanded"),
    ).toBe("false");
  });

  it("shows the running summary and spinner while a tool is in flight", () => {
    const running: PineToolCall = {
      ...toolCalls[0],
      status: "running",
    };
    const wrapper = mountGroup({ toolCalls: [running] });
    expect(wrapper.get('button[data-slot="marker"]').text()).toContain(
      "正在运行 1 条命令",
    );
    expect(
      wrapper.get('[data-slot="marker"]').findComponent({ name: "Spinner" }),
    ).not.toBeUndefined();
  });

  it("summarizes web fetches", () => {
    const wrapper = mountGroup({
      toolCalls: [
        {
          id: "t-fetch",
          input: { urls: ["https://example.com/docs"] },
          name: "web_fetch",
          status: "complete",
        },
      ],
    });

    expect(wrapper.get('button[data-slot="marker"]').text()).toContain(
      "抓取了 1 个网页",
    );
    wrapper.unmount();
  });

  it("summarizes presented files with the dedicated icon and copy", () => {
    const wrapper = mountGroup({
      toolCalls: [
        {
          id: "t-present-1",
          input: { path: "/tmp/report.md" },
          name: "ui_present_file",
          status: "complete",
        },
        {
          id: "t-present-2",
          input: { path: "/tmp/summary.pdf" },
          name: "ui_present_file",
          status: "complete",
        },
      ],
    });

    const trigger = wrapper.get('button[data-slot="marker"]');
    expect(trigger.text()).toContain("打开了 2 个文件");
    expect(wrapper.findAllComponents(EyeIcon)).toHaveLength(2);
    wrapper.unmount();
  });

  it("opens a presented file from a nested marker without a dialog", async () => {
    const openFile = vi.fn(() => true);
    const wrapper = mountGroup({
      expanded: true,
      openFile,
      toolCalls: [
        {
          id: "present-in-group",
          input: { path: "report.md" },
          name: "ui_present_file",
          status: "complete",
          output: { details: { path: "/canonical/project/report.md" } },
        },
      ],
    });

    await wrapper
      .findComponent(ProjectToolCallMarker)
      .get("button")
      .trigger("click");
    expect(openFile).toHaveBeenCalledWith(
      "/canonical/project/report.md",
      "present-in-group",
    );
    expect(
      document.body.querySelector('[data-slot="dialog-content"]'),
    ).toBeNull();
    wrapper.unmount();
  });

  it("summarizes Skill operations and keeps their operation icons", () => {
    const wrapper = mountGroup({
      toolCalls: [
        {
          id: "t-skill-authoring",
          input: {},
          name: "activate_skill_authoring",
          status: "complete",
        },
        {
          id: "t-skill-invoke",
          input: { name: "release-notes" },
          name: "invoke_skill",
          status: "complete",
        },
      ],
    });

    const trigger = wrapper.get('button[data-slot="marker"]');
    expect(trigger.text()).toContain("处理了 2 项工作技能");
    expect(wrapper.findComponent(WandSparklesIcon).exists()).toBe(true);
    expect(wrapper.findComponent(BookOpenIcon).exists()).toBe(true);
    wrapper.unmount();
  });
});
