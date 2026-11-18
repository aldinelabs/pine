import { flushPromises } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { mountBlock } from "./fixtures/mountBlock";

describe("layout and text components", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps horizontal layouts inside the message column", async () => {
    const wrapper = await mountBlock(
      `root = Stack([wrapped, scrolled, stackRow, seg, tabs])
$s = "One"
wrapped = Row([Button("Approve"), Button("Reject"), Badge("Pending")])
scrolled = Row([Button("A"), Button("B")], null, null, null, false)
stackRow = Stack([Button("C"), Button("D")], "row")
seg = SegmentedControl($s, ["One", "Two", "Three"])
tabs = Tabs([Tab("First", [Text("x")]), Tab("Second", [Text("y")])])`,
    );
    const rows = wrapper.findAll('[data-iui="row"]');
    expect(rows[0]?.classes()).toContain("flex-wrap");
    expect(rows[1]?.classes()).toContain("overflow-x-auto");
    expect(rows[1]?.classes()).not.toContain("flex-wrap");
    const stacks = wrapper.findAll('[data-iui="stack"]');
    expect(stacks[1]?.classes()).toContain("flex-wrap");
    expect(stacks[0]?.classes()).not.toContain("flex-wrap");
    const segmented = wrapper.find('[data-iui="segmented-control"]');
    expect(segmented.classes()).toEqual(
      expect.arrayContaining(["max-w-full", "overflow-x-auto"]),
    );
    const tabList = wrapper.find('[data-iui="tabs"] [role="tablist"]');
    expect(tabList.classes()).toEqual(
      expect.arrayContaining(["max-w-full", "overflow-x-auto"]),
    );
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
