import { mount } from "@vue/test-utils";
import { AlertCircleIcon, ClapperboardIcon, HistoryIcon } from "@lucide/vue";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { PineToolCall } from "@/shared/sessions";
import ProjectToolCallMarker from "../ProjectToolCallMarker.vue";
import { toolViewAdapter } from "../toolViewAdapter";

function marker(call: Partial<PineToolCall> = {}) {
  return mount(ProjectToolCallMarker, {
    props: {
      toolCall: {
        id: "call",
        name: "generate_video",
        input: { prompt: "河流的航拍画面" },
        status: "complete",
        ...call,
      },
    },
    global: {
      plugins: [createAppI18n("zh-CN")],
      stubs: {
        ProjectToolCallDialog: {
          template: '<div><slot :open="() => undefined" /></div>',
        },
      },
    },
  });
}

describe("video tool markers", () => {
  it("shows a saved filename instead of reporting only submission", () => {
    const wrapper = marker({
      output: {
        details: {
          status: "completed",
          files: [{ path: "/project/river.mp4" }],
        },
      },
    });
    expect(wrapper.text()).toContain("已保存视频");
    expect(wrapper.text()).toContain("river.mp4");
    expect(wrapper.text()).not.toContain("已提交");
    expect(wrapper.findComponent(ClapperboardIcon).exists()).toBe(true);
    wrapper.unmount();
  });
  it.each([
    ["pending", "视频排队中"],
    ["in_progress", "视频生成中"],
  ])("shows %s and the queried job ID", (status, label) => {
    const wrapper = marker({
      name: "get_video_generation",
      input: { job_id: "job-123" },
      output: { details: { status } },
    });
    expect(wrapper.text()).toContain(label);
    expect(wrapper.text()).toContain("job-123");
    expect(wrapper.findComponent(HistoryIcon).exists()).toBe(true);
    wrapper.unmount();
  });
  it("shows failure rather than completion", () => {
    const wrapper = marker({ status: "error", output: "Provider failed" });
    expect(wrapper.text()).toContain("生成视频失败");
    expect(wrapper.findComponent(AlertCircleIcon).exists()).toBe(true);
    wrapper.unmount();
  });
  it("labels capability discovery as a media tool", () => {
    const wrapper = marker({ name: "list_video_models", input: {} });
    expect(wrapper.text()).toContain("已查看视频模型");
    for (const name of [
      "generate_video",
      "get_video_generation",
      "list_video_models",
    ]) {
      expect(
        toolViewAdapter({ id: "call", name, input: {}, status: "complete" })
          .detail,
      ).toBe("media");
    }
    expect(wrapper.findComponent(ClapperboardIcon).exists()).toBe(true);
    wrapper.unmount();
  });
});
