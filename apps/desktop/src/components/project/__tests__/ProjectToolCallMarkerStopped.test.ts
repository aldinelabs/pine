import { mount } from "@vue/test-utils";
import { AlertCircleIcon, CircleStopIcon } from "@lucide/vue";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { REQUEST_COMPUTER_USE_PERMISSIONS_TOOL_NAME } from "@/agent/computer-use/tools";
import type { PineToolCall } from "@/shared/sessions";
import ProjectToolCallMarker from "../ProjectToolCallMarker.vue";

function marker(call: Partial<PineToolCall> = {}) {
  return mount(ProjectToolCallMarker, {
    props: {
      toolCall: {
        id: "call",
        name: REQUEST_COMPUTER_USE_PERMISSIONS_TOOL_NAME,
        input: {},
        status: "error",
        ...call,
      },
    },
    global: {
      plugins: [createAppI18n("en-US")],
      stubs: {
        ProjectToolCallDialog: {
          template: '<div><slot :open="() => undefined" /></div>',
        },
      },
    },
  });
}

describe("stopped tool markers", () => {
  it("shows a call the stop cut off as stopped, not failed or running", () => {
    const wrapper = marker({ stopped: true });

    expect(wrapper.text()).toContain("Requesting system permissions");
    expect(wrapper.find("[data-tool-stopped]").text()).toBe("· Stopped");
    expect(wrapper.findComponent(CircleStopIcon).exists()).toBe(true);
    expect(wrapper.findComponent(AlertCircleIcon).exists()).toBe(false);
    expect(wrapper.html()).not.toContain("text-destructive");
    expect(wrapper.find("[data-slot=marker-content]").classes()).not.toContain(
      "shimmer",
    );
    expect(wrapper.find("[aria-live]").exists()).toBe(false);
    wrapper.unmount();
  });

  it("keeps a real failure in the failure style", () => {
    const wrapper = marker();

    expect(wrapper.text()).toContain("Couldn’t request system permissions");
    expect(wrapper.find("[data-tool-stopped]").exists()).toBe(false);
    expect(wrapper.findComponent(AlertCircleIcon).exists()).toBe(true);
    wrapper.unmount();
  });
});
