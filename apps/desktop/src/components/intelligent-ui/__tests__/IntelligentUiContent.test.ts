import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { mountBlock } from "./fixtures/mountBlock";

describe("layout and text components", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("asks before a Link opens and only links web URLs", async () => {
    const wrapper = await mountBlock(
      `root = Stack([Link("Docs", "https://example.com/docs"), Link("Bad", "javascript:alert(1)")])`,
    );
    await flushPromises();

    const links = wrapper.findAll('[data-iui="link"]');
    expect(links[0]?.attributes("href")).toBe("https://example.com/docs");
    expect(links[1]?.element.tagName).toBe("SPAN");

    await links[0]?.trigger("click");
    await flushPromises();
    expect(document.body.textContent).toContain("https://example.com/docs");
    expect(document.body.textContent).toContain("Open external link?");
  });

  it("renders KaTeX without trusting commands", async () => {
    const wrapper = await mountBlock(
      `root = Math("\\\\href{javascript:alert(1)}{x} + y^2")`,
    );
    await flushPromises();

    const math = wrapper.find('[data-iui="math"]');
    expect(math.find(".katex").exists()).toBe(true);
    expect(math.find("a").exists()).toBe(false);
  });
});
