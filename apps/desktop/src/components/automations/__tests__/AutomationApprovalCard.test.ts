import { mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { AutomationApprovalRequest } from "@/shared/automation";
import AutomationApprovalCard from "../AutomationApprovalCard.vue";

const approval = {
  requestId: "r1",
  projectId: "p1",
  projectName: "Website",
  kind: "create",
  facts: { name: "Daily summary", triggers: [] },
  warnings: [],
  createdAt: "2026-11-12T08:00:00.000Z",
} as unknown as AutomationApprovalRequest;

function mountCard(request: AutomationApprovalRequest, locale = "en-US") {
  const pinia = createPinia();
  setActivePinia(pinia);
  return mount(AutomationApprovalCard, {
    props: { approval: request },
    global: {
      plugins: [pinia, createAppI18n(locale as "en-US" | "zh-CN")],
      stubs: { AutomationFactsList: true },
    },
  });
}

describe("AutomationApprovalCard", () => {
  it("says when the request came from WeChat", () => {
    const wrapper = mountCard({ ...approval, via: "wechat" });
    expect(wrapper.get('[data-slot="automation-approval-via"]').text()).toBe(
      "Requested from WeChat",
    );
    wrapper.unmount();

    const zh = mountCard({ ...approval, via: "wechat" }, "zh-CN");
    expect(zh.get('[data-slot="automation-approval-via"]').text()).toBe(
      "来自微信的请求",
    );
    zh.unmount();
  });

  it("shows no WeChat line for other requests", () => {
    const wrapper = mountCard(approval);
    expect(wrapper.find('[data-slot="automation-approval-via"]').exists()).toBe(
      false,
    );
    expect(wrapper.text()).not.toContain("WeChat");
    wrapper.unmount();
  });
});
