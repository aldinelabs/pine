import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { nextTick } from "vue";
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
  it.each([{ isComposing: true }, { keyCode: 229 }])(
    "ignores decision shortcuts while confirming IME candidates (%j)",
    (options) => {
      const wrapper = mount(ProjectApprovalCard, {
        props: { approval, isActive: true },
        global: { plugins: [createAppI18n("zh-CN")] },
      });
      for (const key of ["Enter", "Escape", "/"]) {
        window.dispatchEvent(new KeyboardEvent("keydown", { key, ...options }));
      }
      expect(wrapper.emitted("respond")).toBeUndefined();
      expect(wrapper.find("textarea").exists()).toBe(false);
      wrapper.unmount();
    },
  );

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

  it("shows Pine's own escalation note after the evidence, localized", () => {
    const wrapper = mount(ProjectApprovalCard, {
      props: {
        approval: {
          ...approval,
          reasonCode: "autoReviewUnavailable",
          reasonDetail: "The reviewer did not submit a ruling.",
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    expect(wrapper.get("details pre").text()).toBe(
      "Sandbox error\n\n自动审查不可用：审查模型没有提交裁决。",
    );
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

  describe("reviewer explanation", () => {
    const explanation = {
      summary: "Builds the project into dist.",
      risks: ["Overwrites dist.", "Runs project scripts."],
    };
    const i18n = () => ({ plugins: [createAppI18n("en-US")] });
    const toggle = (wrapper: ReturnType<typeof mount>) =>
      wrapper
        .findAll("button")
        .find((button) => button.text().includes("original parameters"));

    it("leads with the explanation and keeps the parameters one click away", async () => {
      const wrapper = mount(ProjectApprovalCard, {
        props: { approval: { ...approval, explanation } },
        global: i18n(),
      });
      const text = wrapper.text();
      expect(text).toContain("Builds the project into dist.");
      expect(text).toContain("Risks");
      expect(text).toContain("Overwrites dist.");
      expect(text).toContain("Runs project scripts.");
      expect(text).toContain("Written by the approval model.");
      expect(text).not.toContain("bun run build");
      expect(toggle(wrapper)?.text()).toBe("Show original parameters");
      await toggle(wrapper)!.trigger("click");
      expect(wrapper.text()).toContain("bun run build");
      expect(wrapper.text()).toContain("Run the build");
      expect(toggle(wrapper)?.text()).toBe("Hide original parameters");
      wrapper.unmount();
    });

    it("shows a loading line with the parameters, then fills in the explanation", async () => {
      const wrapper = mount(ProjectApprovalCard, {
        props: { approval: { ...approval, explanationPending: true } },
        global: i18n(),
      });
      const loading = '[data-slot="approval-explanation-loading"]';
      expect(wrapper.get(loading).text()).toContain(
        "The approval model is describing this operation…",
      );
      expect(wrapper.text()).toContain("bun run build");
      await wrapper.setProps({
        approval: { ...approval, explanationPending: false, explanation },
      });
      expect(wrapper.find(loading).exists()).toBe(false);
      expect(wrapper.text()).toContain("Builds the project into dist.");
      expect(wrapper.text()).toContain("bun run build");
      wrapper.unmount();
    });

    it("reopens the parameters when a hidden-while-pending explanation never arrives", async () => {
      const wrapper = mount(ProjectApprovalCard, {
        props: { approval: { ...approval, explanationPending: true } },
        global: i18n(),
      });
      await toggle(wrapper)!.trigger("click");
      expect(wrapper.text()).not.toContain("bun run build");
      await wrapper.setProps({
        approval: { ...approval, explanationPending: false },
      });
      // The collapsible's presence settles on the next frame.
      await new Promise(requestAnimationFrame);
      await nextTick();
      expect(toggle(wrapper)).toBeUndefined();
      expect(wrapper.text()).toContain("bun run build");
      expect(wrapper.text()).toContain("Run the build");
      wrapper.unmount();
    });

    it("renders model text literally", () => {
      const wrapper = mount(ProjectApprovalCard, {
        props: {
          approval: {
            ...approval,
            explanation: { summary: "<b>x</b>", risks: ["<img src=y>"] },
          },
        },
        global: i18n(),
      });
      expect(wrapper.find("b").exists()).toBe(false);
      expect(wrapper.find("img").exists()).toBe(false);
      expect(wrapper.text()).toContain("<b>x</b>");
      wrapper.unmount();
    });

    it("keeps today's card without a toggle when there is no explanation", () => {
      const wrapper = mount(ProjectApprovalCard, {
        props: { approval },
        global: i18n(),
      });
      expect(toggle(wrapper)).toBeUndefined();
      expect(wrapper.text()).toContain("bun run build");
      expect(wrapper.text()).toContain("Run the build");
      wrapper.unmount();
    });
  });
});
