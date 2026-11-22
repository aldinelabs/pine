import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { PineToolCall } from "@/shared/sessions";
import ProjectToolSemanticValue from "../ProjectToolSemanticValue.vue";

function mountResult(output: unknown) {
  const toolCall: PineToolCall = {
    id: "call-1",
    name: "custom_tool",
    status: "complete",
    input: {},
    output,
  };
  return mount(ProjectToolSemanticValue, {
    props: { toolCall, section: "result", view: "generic" },
    global: { plugins: [createPinia(), createAppI18n("en-US")] },
  });
}

describe("ProjectToolSemanticValue results", () => {
  it("renders text results that encode JSON as JSON", () => {
    const wrapper = mountResult({
      content: [{ type: "text", text: '{"title":"销售图表","ok":true}' }],
    });

    const json = wrapper.get("[data-tool-json-value]");
    expect(json.text()).toContain('{\n  "title": "销售图表",\n  "ok": true\n}');
    expect(wrapper.text()).not.toContain("content[0]");
  });

  it("keeps plain text and Markdown results as text", () => {
    const markdown = "# Done\n\n- First item\n- [link](https://example.com)";
    const wrapper = mountResult({
      content: [{ type: "text", text: markdown }],
    });

    expect(wrapper.find("[data-tool-json-value]").exists()).toBe(false);
    expect(wrapper.get("pre").text()).toBe(markdown);
  });

  it("renders structured results without text content as JSON", () => {
    const wrapper = mountResult({ rows: [{ id: 1 }] });

    expect(wrapper.get("[data-tool-json-value]").text()).toContain(
      '"rows": [\n    {\n      "id": 1\n    }\n  ]',
    );
  });
});
