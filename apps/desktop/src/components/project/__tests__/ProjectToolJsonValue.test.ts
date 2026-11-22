import { mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import ProjectToolJsonValue from "../ProjectToolJsonValue.vue";

function mountValue(value: unknown) {
  return mount(ProjectToolJsonValue, {
    props: { value, emptyLabel: "No value" },
    global: { plugins: [createPinia(), createAppI18n("en-US")] },
  });
}

describe("ProjectToolJsonValue", () => {
  it("renders nested values as indented JSON without escaping non-ASCII", () => {
    const wrapper = mountValue({
      files: [{ path: "/工作区/销售图表.png", title: "销售图表" }],
    });

    expect(wrapper.find('[data-slot="code-block"]').exists()).toBe(true);
    expect(wrapper.text()).toContain(
      [
        "{",
        '  "files": [',
        "    {",
        '      "path": "/工作区/销售图表.png",',
        '      "title": "销售图表"',
        "    }",
        "  ]",
        "}",
      ].join("\n"),
    );
    expect(wrapper.text()).not.toContain("\\u");
    expect(wrapper.text()).not.toContain("files[0]");
  });

  it("parses serialized JSON, including nested JSON strings", () => {
    const wrapper = mountValue(
      JSON.stringify({ message: "a\nb", nested: '{"ok":true}' }),
    );

    expect(wrapper.text()).toContain('"message": "a\\nb"');
    expect(wrapper.text()).toContain('"nested": {\n    "ok": true\n  }');
  });

  it("shows plain strings as text and circular references safely", () => {
    expect(mountValue("First line\nSecond line").get("pre").text()).toBe(
      "First line\nSecond line",
    );

    const loop: Record<string, unknown> = { name: "loop" };
    loop.self = loop;
    expect(mountValue(loop).text()).toContain('"self": "[Circular]"');
  });

  it("shows the empty label when there is no value", () => {
    expect(mountValue(undefined).text()).toBe("No value");
  });
});
