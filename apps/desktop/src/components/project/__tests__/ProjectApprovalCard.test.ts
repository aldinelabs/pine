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

  it("shows Pine's own escalation note after the evidence, localized", async () => {
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
    await wrapper
      .get('[data-slot="approval-details-trigger"]')
      .trigger("click");
    expect(
      wrapper.get('[data-slot="approval-reviewer-notes"] pre').text(),
    ).toBe("Sandbox error\n\n自动审查不可用：审查模型没有提交裁决。");
    wrapper.unmount();
  });

  it("describes an MCP server change in plain terms", async () => {
    const wrapper = mount(ProjectApprovalCard, {
      props: {
        approval: {
          requestId: "approval-mcp",
          toolCallId: "tool-mcp",
          toolName: "mcp_config_save",
          trigger: "privileged-execution",
          description: 'Save MCP server "github"',
          subject: "global MCP server github",
          evidence: "It launches `npx -y server` with your permissions.",
          mcpChange: {
            action: "add",
            scope: "global",
            name: "github",
            command: "npx -y server",
            credentials: ["GITHUB_TOKEN"],
            definition: '{\n  "command": "npx"\n}',
          },
        },
      },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    const text = wrapper.text();
    expect(text).toContain("Pine 想添加 MCP 服务器“github”。");
    expect(text).toContain("npx -y server");
    expect(text).toContain("使用你的权限，不受 Pine 沙箱限制。");
    expect(text).toContain("所有项目");
    expect(text).toContain("GITHUB_TOKEN");
    // The generic notice and the English tool summary give way to the account.
    expect(text).not.toContain("沙箱外使用原生权限");
    expect(text).not.toContain("Save MCP server");
    await wrapper
      .get('[data-slot="approval-details-trigger"]')
      .trigger("click");
    expect(
      wrapper.get('[data-slot="approval-mcp-definition"] pre').text(),
    ).toBe('{\n  "command": "npx"\n}');
    expect(wrapper.find('[data-slot="approval-reviewer-notes"]').exists()).toBe(
      false,
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
    const trigger = '[data-slot="approval-details-trigger"]';
    const details = '[data-slot="approval-details"]';
    const triggerText =
      "This operation was blocked by the sandbox. Approving re-runs it outside the sandbox.";

    it("leads with the explanation and keeps every technical detail behind one toggle", async () => {
      const wrapper = mount(ProjectApprovalCard, {
        props: { approval: { ...approval, explanation } },
        global: i18n(),
      });
      expect(wrapper.get('[data-slot="approval-summary"]').text()).toBe(
        "Builds the project into dist.",
      );
      const risks = wrapper.get('[data-slot="approval-risks"]');
      expect(risks.text()).toContain("Risks");
      expect(risks.findAll("li").map((item) => item.text())).toEqual([
        "Overwrites dist.",
        "Runs project scripts.",
      ]);
      const attribution = wrapper.get('[data-slot="approval-attribution"]');
      expect(attribution.text()).toContain("Explained by the approval model");
      expect(attribution.get(".sr-only").text()).toBe(
        "This is the approval model's reading of the request. What actually runs is the original parameters under Technical details.",
      );
      expect(wrapper.find('[data-slot="card-header"]').text()).not.toContain(
        triggerText,
      );
      expect(wrapper.findAll(trigger)).toHaveLength(1);
      expect(wrapper.find("details").exists()).toBe(false);
      expect(wrapper.text()).not.toContain("bun run build");
      expect(wrapper.text()).not.toContain(triggerText);

      await wrapper.get(trigger).trigger("click");
      const content = wrapper.get(details).text();
      expect(content).toContain("Why Pine asked");
      expect(content).toContain(triggerText);
      expect(content).toContain("Agent's description");
      expect(content).toContain("Run the build");
      expect(content).toContain("Original parameters");
      expect(content).toContain("bun run build");
      expect(content).toContain("Reviewer notes");
      expect(content).toContain("Sandbox error");
      wrapper.unmount();
    });

    it("opens the details while pending and keeps them open when the explanation arrives", async () => {
      const wrapper = mount(ProjectApprovalCard, {
        props: { approval: { ...approval, explanationPending: true } },
        global: i18n(),
      });
      const loading = '[data-slot="approval-explanation-loading"]';
      expect(wrapper.get(loading).text()).toContain(
        "The approval model is describing this operation…",
      );
      expect(wrapper.get(details).text()).toContain("bun run build");
      await wrapper.setProps({
        approval: { ...approval, explanationPending: false, explanation },
      });
      expect(wrapper.find(loading).exists()).toBe(false);
      expect(wrapper.text()).toContain("Builds the project into dist.");
      expect(wrapper.get(details).text()).toContain("bun run build");
      wrapper.unmount();
    });

    it("falls back to the plain layout when a pending explanation never arrives", async () => {
      const wrapper = mount(ProjectApprovalCard, {
        props: { approval: { ...approval, explanationPending: true } },
        global: i18n(),
      });
      await wrapper.get(trigger).trigger("click");
      await wrapper.setProps({
        approval: { ...approval, explanationPending: false },
      });
      // The collapsible's presence settles on the next frame.
      await new Promise(requestAnimationFrame);
      await nextTick();
      expect(wrapper.find('[data-slot="card-header"]').text()).toContain(
        triggerText,
      );
      expect(wrapper.text()).toContain("bun run build");
      expect(wrapper.text()).toContain("Run the build");
      expect(wrapper.find('[data-slot="approval-attribution"]').exists()).toBe(
        false,
      );
      // Only the reviewer notes remain behind the single toggle.
      expect(wrapper.findAll(trigger)).toHaveLength(1);
      await wrapper.get(trigger).trigger("click");
      const content = wrapper.get(details);
      expect(content.text()).toContain("Reviewer notes");
      expect(content.text()).not.toContain("Original parameters");
      expect(content.text()).not.toContain("Why Pine asked");
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

    it("keeps the plain card without a toggle when there is no explanation or evidence", () => {
      const wrapper = mount(ProjectApprovalCard, {
        props: { approval: { ...approval, evidence: undefined } },
        global: i18n(),
      });
      expect(wrapper.find(trigger).exists()).toBe(false);
      expect(wrapper.text()).toContain(triggerText);
      expect(wrapper.text()).toContain("bun run build");
      expect(wrapper.text()).toContain("Run the build");
      wrapper.unmount();
    });
  });
});
