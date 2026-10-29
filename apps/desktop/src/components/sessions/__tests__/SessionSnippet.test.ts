import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import SessionSnippet from "../SessionSnippet.vue";

describe("SessionSnippet", () => {
  it("highlights every case-insensitive match in plain text", () => {
    const wrapper = mount(SessionSnippet, {
      props: { query: "pdf", text: "PDF 导出与 pdf 裁剪" },
    });

    expect(wrapper.findAll("mark").map((mark) => mark.text())).toEqual([
      "PDF",
      "pdf",
    ]);
  });

  it("highlights marked ranges from the search index", () => {
    const wrapper = mount(SessionSnippet, {
      props: { query: "测试", text: "我\u0001测试\u0002一下" },
    });

    expect(wrapper.find("mark").text()).toBe("测试");
    expect(wrapper.text()).toBe("我测试一下");
  });

  it("trims leading context so the first match stays visible", () => {
    const wrapper = mount(SessionSnippet, {
      props: {
        leadingContext: 4,
        query: "测试",
        text: "…很长很长的一段前文内容\u0001测试\u0002结尾",
      },
    });

    expect(wrapper.text()).toBe("…前文内容测试结尾");
  });
});
