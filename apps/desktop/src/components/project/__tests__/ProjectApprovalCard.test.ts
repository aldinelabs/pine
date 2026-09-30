import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { PinePendingApproval } from "@/stores/session";
import ProjectApprovalCard from "../ProjectApprovalCard.vue";

const approval: PinePendingApproval = {
  requestId: "approval-1",
  toolCallId: "tool-1",
  toolName: "bash",
  trigger: "sandbox-denied",
  description: "Run the build",
  subject: "bun run build",
  evidence: "Sandbox error",
};

describe("ProjectApprovalCard", () => {
  it("identifies failed automatic reviews while preserving the action and manual controls", async () => {
    const wrapper = mount(ProjectApprovalCard, {
      props: {
        approval: {
          ...approval,
          autoApprovalFailure: { id: "failure-1", message: "Provider down" },
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(wrapper.get('[role="status"]').text()).toBe(
      "自动审批失败，请手动确认",
    );
    expect(wrapper.text()).toContain("Run the build");
    expect(wrapper.text()).toContain("bun run build");
    expect(wrapper.text()).toContain("该操作已被安全沙盒拦截");
    await wrapper
      .findAll("button")
      .find((button) => button.text().includes("批准"))!
      .trigger("click");
    expect(wrapper.emitted("respond")).toEqual([["approve", undefined]]);
    wrapper.unmount();
  });

  it("does not label ordinary manual confirmations as failures", () => {
    const wrapper = mount(ProjectApprovalCard, {
      props: { approval },
      global: { plugins: [createAppI18n("en-US")] },
    });
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.text()).toContain("Approval required");
    wrapper.unmount();
  });
});
