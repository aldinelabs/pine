import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createAppI18n } from "@/app/i18n";
import MarkdownRender, {
  getMarkdown,
  parseMarkdownToStructure,
} from "markstream-vue";
import { useAppearanceStore } from "@/stores/appearance";
import MarkdownContent from "../MarkdownContent.vue";
import MarkdownTable from "../MarkdownTable.vue";
import markdownComponentSource from "../MarkdownContent.vue?raw";
import { configurePineMarkdown } from "../configureMarkdown";

const passthroughStub = { template: "<div><slot /></div>" };
const alertDialogStub = {
  name: "AlertDialogStub",
  props: ["open"],
  emits: ["update:open"],
  template: '<div data-alert-dialog :data-open="open"><slot /></div>',
};
const alertDialogActionStub = {
  name: "AlertDialogActionStub",
  emits: ["click"],
  template:
    '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
};
const alertDialogCancelStub = {
  name: "AlertDialogCancelStub",
  emits: ["click"],
  template:
    '<button v-bind="$attrs" @click="$emit(\'click\', $event)"><slot /></button>',
};

function mountMarkdown(
  props: { source: string; final?: boolean; documentUrl?: string } | string,
) {
  return mount(MarkdownContent, {
    props:
      typeof props === "string"
        ? { source: props, final: true }
        : { final: true, ...props },
    global: {
      plugins: [createAppI18n("zh-CN")],
      stubs: {
        AlertDialog: alertDialogStub,
        AlertDialogAction: alertDialogActionStub,
        AlertDialogCancel: alertDialogCancelStub,
        AlertDialogContent: passthroughStub,
        AlertDialogDescription: passthroughStub,
        AlertDialogFooter: passthroughStub,
        AlertDialogHeader: passthroughStub,
        AlertDialogTitle: passthroughStub,
      },
    },
  });
}

describe("MarkdownContent", () => {
  beforeEach(() => setActivePinia(createPinia()));

  it("renders footnote-style web sources as inline citations", async () => {
    const wrapper = mountMarkdown(
      [
        "结论成立[^1]，另见[^2]，脚注[^3]。",
        "",
        "[^1]: [Example 标题](https://www.example.com/a)",
        "[^2]: https://docs.example.org/x",
        "[^3]: 普通脚注文字",
      ].join("\n"),
    );
    await flushPromises();
    const chips = wrapper.findAll('[data-slot="inline-citation"]');
    expect(chips.map((chip) => chip.text())).toEqual([
      "example.com",
      "docs.example.org",
    ]);
    expect(chips[0].attributes("href")).toBe("https://www.example.com/a");
    expect(chips[0].get("img").attributes("src")).toBe(
      "https://icons.duckduckgo.com/ip3/www.example.com.ico",
    );
    await chips[0].get("img").trigger("error");
    expect(chips[0].find("img").exists()).toBe(false);
    expect(
      chips[0].find('[data-slot="citation-favicon-fallback"]').exists(),
    ).toBe(true);
    expect(wrapper.text()).toContain("普通脚注文字");
    expect(wrapper.text()).not.toContain("Example 标题");
    wrapper.unmount();
  });

  it("excludes citation-only definition slots from trailing Markdown spacing", async () => {
    const wrapper = mountMarkdown(
      "First paragraph.\n\nLast paragraph[^1][^2].\n\n[^1]: [One](https://example.com/one)\n[^2]: [Two](https://example.com/two)",
    );
    await flushPromises();
    try {
      const definitions = wrapper.findAll("[data-citation-definition]");
      expect(definitions).toHaveLength(2);
      for (const definition of definitions) {
        expect(definition.attributes("hidden")).toBeDefined();
        expect(
          definition.element
            .closest(".node-slot")
            ?.getAttribute("data-node-type"),
        ).toBe("footnote");
      }
      expect(wrapper.findAll("p").map((node) => node.text())).toEqual([
        "First paragraph.",
        "Last paragraph example.com example.com.",
      ]);
      expect(markdownComponentSource).toContain(
        '.node-slot[data-node-type="footnote"]:has([data-citation-definition])',
      );
      expect(markdownComponentSource).toContain(
        '1 of :not([data-node-type="footnote"]:has([data-citation-definition]))',
      );
    } finally {
      wrapper.unmount();
    }
  });

  it("keeps ordinary footnotes visible alongside hidden citation definitions", async () => {
    const wrapper = mountMarkdown(
      "Result[^1] and note[^2].\n\n[^1]: [Source](https://example.com)\n[^2]: Keep this ordinary footnote.",
    );
    await flushPromises();
    expect(wrapper.findAll("[data-citation-definition]")).toHaveLength(1);
    expect(wrapper.text()).toContain("Keep this ordinary footnote.");
    wrapper.unmount();
  });

  it("renders local chat image URLs without markstream stripping the Pine protocol", async () => {
    const wrapper = mountMarkdown(
      "![本地配图](/Users/kw/Week%204/案例.png)\n\n![文件 URL](file:///Users/kw/Week%204/figure.png)",
    );
    await flushPromises();
    expect(
      wrapper.findAll("img").map((image) => image.attributes("src")),
    ).toEqual([
      "pine-attachment://local/?p=%2FUsers%2Fkw%2FWeek%204%2F%E6%A1%88%E4%BE%8B.png",
      "pine-attachment://local/?p=%2FUsers%2Fkw%2FWeek%204%2Ffigure.png",
    ]);
    await wrapper.get("img").trigger("error");
    expect(wrapper.get('[role="status"]').text()).toBe("图片加载失败");
    await wrapper.setProps({ source: "![新配图](/Users/kw/new.png)" });
    await flushPromises();
    expect(wrapper.get("img").attributes("src")).toBe(
      "pine-attachment://local/?p=%2FUsers%2Fkw%2Fnew.png",
    );
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    wrapper.unmount();
  });

  it("resolves document images in paragraphs, lists and tables and updates the base", async () => {
    const source = [
      "![案例配图](figures-dd/dd-01-vera-winthagen-eindhoven.png)",
      "- ![列表配图](figures-dd/list.png)",
      "| 配图 |\n| --- |\n| ![表格配图](figures-dd/table.png) |",
    ].join("\n\n");
    const documentUrl =
      "pine-project-media://preview/?owner=7&projectId=p1&folderId=f1&relativePath=Readings%2F中文译本.md";
    const wrapper = mountMarkdown({ source, documentUrl });
    // File previews supply preparsed nodes, which must use the same image context.
    await wrapper.setProps({
      nodes: parseMarkdownToStructure(
        source,
        configurePineMarkdown(getMarkdown("pine-preview")),
        {
          final: true,
          includeSourceMap: true,
        },
      ),
    });
    await flushPromises();
    const images = wrapper.findAll("img");
    expect(images).toHaveLength(3);
    for (const image of images) {
      const url = new URL(image.attributes("src")!);
      expect(url.protocol).toBe("pine-project-media:");
      expect(url.searchParams.get("relativePath")).toBe("Readings/中文译本.md");
      expect(url.searchParams.get("markdownImage")).toMatch(/^figures-dd\//u);
    }
    await wrapper.setProps({
      documentUrl: documentUrl.replace("Readings", "Other"),
    });
    await flushPromises();
    for (const image of wrapper.findAll("img")) {
      expect(
        new URL(image.attributes("src")!).searchParams.get("relativePath"),
      ).toBe("Other/中文译本.md");
    }
    wrapper.unmount();
  });

  it("parses file images with titles while preserving code and rejecting unsafe image URLs", async () => {
    const source = [
      '![文件配图](<FILE:///Users/kw/a b.png> "标题")',
      "`![代码中的图片](file:///Users/kw/code.png)`",
      "![危险图片](javascript:alert%281%29)",
    ].join("\n\n");
    const wrapper = mountMarkdown(source);
    await wrapper.setProps({
      nodes: parseMarkdownToStructure(
        source,
        configurePineMarkdown(getMarkdown("pine-preview")),
        { final: true, includeSourceMap: true },
      ),
    });
    await flushPromises();
    expect(wrapper.findAll("img")).toHaveLength(1);
    expect(wrapper.get("img").attributes("src")).toBe(
      "pine-attachment://local/?p=%2FUsers%2Fkw%2Fa%20b.png",
    );
    expect(wrapper.get("img").attributes("title")).toBe("标题");
    expect(wrapper.get("code").text()).toBe(
      "![代码中的图片](file:///Users/kw/code.png)",
    );
    wrapper.unmount();
  });

  it("renders common Markdown structures", () => {
    const wrapper = mountMarkdown(
      "## Result\n\nA **strong** result with `code`.\n\n- first\n- second",
    );

    expect(wrapper.get("h2").text()).toBe("Result");
    expect(wrapper.get("strong").text()).toBe("strong");
    expect(wrapper.get("code").text()).toBe("code");
    expect(wrapper.findAll("li").map((item) => item.text())).toEqual([
      "first",
      "second",
    ]);
  });

  it("renders inline and display LaTeX with KaTeX", async () => {
    // markstream intentionally falls back to text for its async inline-math
    // component in NODE_ENV=test. Exercise the production loader for this
    // integration test so both renderer paths are covered.
    vi.stubEnv("NODE_ENV", "production");
    const wrapper = mountMarkdown({
      source:
        "$e^{i\\pi} + 1 = 0$\n\n$$\n\\int_0^1 x^2 \\, dx = \\frac{1}{3}\n$$",
      final: true,
    });

    try {
      await vi.waitFor(() => {
        expect(
          wrapper
            .get('[data-markstream-math="inline"] .katex-mathml annotation')
            .text(),
        ).toBe("e^{i\\pi} + 1 = 0");
        expect(
          wrapper
            .find('[data-markstream-math="block"] .katex-display')
            .exists(),
        ).toBe(true);
      });
    } finally {
      wrapper.unmount();
      vi.unstubAllEnvs();
    }
  });

  it("settles an incomplete streamed formula when the message finishes", async () => {
    const wrapper = mountMarkdown({
      source: "$$\n\\frac{1}{",
      final: false,
    });

    expect(wrapper.find('[data-markstream-math="block"] .katex').exists()).toBe(
      false,
    );

    await wrapper.setProps({
      source: "$$\n\\frac{1}{2}\n$$",
      final: true,
    });
    await vi.waitFor(() => {
      expect(
        wrapper.find('[data-markstream-math="block"] .katex-display').exists(),
      ).toBe(true);
    });
    wrapper.unmount();
  });

  it("renders safe raw HTML and removes unsafe tags", async () => {
    const wrapper = mountMarkdown(
      [
        '<details><summary>参考答案</summary><ol><li><code>pygame.Surface</code></li></ol><img src="https://example.com/x.png" onerror="alert(2)"></details>',
        '<script data-test="unsafe">alert(1)</script>',
      ].join("\n\n"),
    );
    await flushPromises();

    expect(wrapper.get("details summary").text()).toBe("参考答案");
    expect(wrapper.get("details ol li code").text()).toBe("pygame.Surface");
    expect(wrapper.get("details img").attributes("src")).toBe(
      "https://example.com/x.png",
    );
    expect(wrapper.get("details img").attributes("onerror")).toBeUndefined();
    expect(wrapper.find("script").exists()).toBe(false);
    expect(wrapper.text()).not.toContain("alert(1)");
  });

  it("prevents links from navigating the app window", () => {
    const wrapper = mountMarkdown("[Documentation](https://example.com)");

    expect(wrapper.get("a").attributes()).toEqual(
      expect.objectContaining({
        href: "https://example.com",
        rel: "noopener noreferrer",
        target: "_blank",
      }),
    );
  });

  it("asks for confirmation before opening an external link", async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { openExternalUrl },
    });
    const wrapper = mountMarkdown("[Documentation](https://example.com/docs)");

    await wrapper.get("a").trigger("click");

    expect(wrapper.get("[data-alert-dialog]").attributes("data-open")).toBe(
      "true",
    );
    expect(wrapper.text()).toContain("https://example.com/docs");
    expect(openExternalUrl).not.toHaveBeenCalled();

    await wrapper.get('[data-testid="confirm-external-link"]').trigger("click");

    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/docs");
    expect(wrapper.get("[data-alert-dialog]").attributes("data-open")).toBe(
      "false",
    );
    wrapper.unmount();
  });

  it("opens the confirmed URL through the real dialog and cancels without opening", async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { openExternalUrl },
    });
    const wrapper = mount(MarkdownContent, {
      attachTo: document.body,
      props: { source: "[Docs](https://example.com/docs)", final: true },
      global: { plugins: [createAppI18n("zh-CN")] },
    });
    try {
      await wrapper.get("a").trigger("click");
      await flushPromises();
      const cancel = document.querySelector<HTMLButtonElement>(
        '[data-slot="alert-dialog-cancel"]',
      );
      expect(cancel).not.toBeNull();
      cancel!.click();
      await flushPromises();
      expect(openExternalUrl).not.toHaveBeenCalled();

      await wrapper.get("a").trigger("click");
      await flushPromises();
      const confirm = document.querySelector<HTMLButtonElement>(
        '[data-testid="confirm-external-link"]',
      );
      expect(confirm).not.toBeNull();
      confirm!.click();
      await flushPromises();
      expect(openExternalUrl).toHaveBeenCalledExactlyOnceWith(
        "https://example.com/docs",
      );
      expect(document.querySelector('[role="alertdialog"]')).toBeNull();
    } finally {
      wrapper.unmount();
    }
  });

  it("does not open non-http links", async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { openExternalUrl },
    });
    const wrapper = mountMarkdown("[Unsupported](mailto:person@example.com)");

    await wrapper.get("a").trigger("click");

    expect(openExternalUrl).not.toHaveBeenCalled();
    expect(wrapper.get("[data-alert-dialog]").attributes("data-open")).toBe(
      "false",
    );
    wrapper.unmount();
  });

  it("uses https when the renderer auto-completes a schemeless URL", async () => {
    const openExternalUrl = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(window, "pine", {
      configurable: true,
      value: { openExternalUrl },
    });
    const wrapper = mountMarkdown("See example.com/docs");

    await wrapper.get("a").trigger("click");
    await wrapper.get('[data-testid="confirm-external-link"]').trigger("click");

    expect(openExternalUrl).toHaveBeenCalledWith("https://example.com/docs");
    wrapper.unmount();
  });

  it("renders streamed markdown and commits the tail on completion", async () => {
    const wrapper = mountMarkdown({
      source: "# Hello\n\nFirst paragraph",
      final: false,
    });

    // A closed heading renders immediately even while the stream is open.
    expect(wrapper.get("h1").text()).toBe("Hello");

    await wrapper.setProps({
      source: "# Hello\n\nFirst paragraph\n\nSecond paragraph",
      final: true,
    });
    // smooth-streaming is disabled, so each update renders synchronously;
    // flush the parent -> child prop propagation microtask before asserting.
    await nextTick();

    expect(wrapper.get("p").text()).toBe("First paragraph");
    expect(wrapper.text()).toContain("Second paragraph");
  });

  it("renders a fenced code block with a copy button", async () => {
    const wrapper = mountMarkdown("```ts\nconst x: number = 1;\n```");
    // The code text is rendered by shiki asynchronously; the container and its
    // copy button are present synchronously, so assert those.
    await flushPromises();
    await nextTick();
    expect(wrapper.find('[data-slot="code-block"]').exists()).toBe(true);
    expect(wrapper.find('button[aria-label="复制代码"]').exists()).toBe(true);
  });

  it("renders rich Markdown and column alignment in shadcn table cells", async () => {
    const wrapper = mountMarkdown({
      source:
        "| Name | Count | Details |\n| :--- | ---: | :---: |\n| **Pine** | 2 | [Docs](https://example.com) and `code` |\n| ![alt](https://example.com/x.png) | 3 | Plain text |",
      final: true,
    });
    await flushPromises();

    const table = wrapper.get('[data-slot="table"]');
    expect(table.findAll("th").map((cell) => cell.text())).toEqual([
      "Name",
      "Count",
      "Details",
    ]);
    expect(table.get("strong").text()).toBe("Pine");
    expect(table.get("code").text()).toBe("code");
    expect(table.get("a").attributes("target")).toBe("_blank");
    expect(table.get("img").attributes("alt")).toBe("alt");
    expect(table.get("img").attributes("onerror")).toBeUndefined();
    wrapper.unmount();
  });

  it("allows natural breaks in inline code within narrow table columns", () => {
    const wrapper = mountMarkdown({
      source:
        "| Translation | Coverage | Result |\n| --- | --- | --- |\n| `01 T Downey … ch17 … 中文译本.md` | §17.1–17.13 | Passed |",
      final: true,
    });

    expect(wrapper.get("tbody code.inline-code").text()).toBe(
      "01 T Downey … ch17 … 中文译本.md",
    );
    wrapper.unmount();
  });

  it("appends streamed table rows without replacing existing content", async () => {
    const source = "| Name | Count |\n| --- | --- |\n| Pine | 1 |\n";
    const wrapper = mountMarkdown({ source, final: false });
    const firstRow = wrapper.get("tbody tr").element;
    await wrapper.setProps({ source: `${source}| Oak | 2 |\n`, final: true });
    await nextTick();

    expect(wrapper.findAll("tbody tr")).toHaveLength(2);
    expect(wrapper.get("tbody tr").element).toBe(firstRow);
    expect(wrapper.findAll("tbody tr")[1].text()).toContain("Oak");
    wrapper.unmount();
  });

  it("updates a finished table whose cell changes while the block streams", async () => {
    const table = (cell: string) =>
      `| Name | Count |\n| --- | --- |\n| ${cell} | 1 |\n\nAfter the table`;
    const wrapper = mountMarkdown({ source: table("Pine"), final: false });
    await flushPromises();
    expect(wrapper.get("tbody").text()).toContain("Pine");

    await wrapper.setProps({ source: `${table("Pine")} more.` });
    await flushPromises();
    expect(wrapper.get("tbody").text()).toContain("Pine");

    await wrapper.setProps({ source: `${table("Oak")} more.` });
    await flushPromises();
    expect(wrapper.get("tbody").text()).toContain("Oak");
    expect(wrapper.get("tbody").text()).not.toContain("Pine");
    wrapper.unmount();
  });

  it("turns a table cell's footnote into a citation once its definition streams in", async () => {
    const table = "| Source |\n| --- |\n| Docs[^1] |\n\nAfter the table.";
    const wrapper = mountMarkdown({ source: table, final: false });
    await flushPromises();
    expect(wrapper.find('tbody [data-slot="inline-citation"]').exists()).toBe(
      false,
    );

    await wrapper.setProps({
      source: `${table}\n\n[^1]: [Docs](https://docs.example.com/page)`,
    });
    await flushPromises();
    expect(wrapper.get('tbody [data-slot="inline-citation"]').text()).toContain(
      "docs.example.com",
    );
    wrapper.unmount();
  });

  it("re-renders finished tables when the color scheme changes", async () => {
    const source = "| Name |\n| --- |\n| Pine |\n\nAfter the table.";
    const wrapper = mountMarkdown({ source, final: false });
    await flushPromises();
    const cellRenderers = () =>
      wrapper.getComponent(MarkdownTable).findAllComponents(MarkdownRender);
    expect(cellRenderers().length).toBeGreaterThan(0);
    expect(cellRenderers().every((cell) => cell.props("isDark") !== true)).toBe(
      true,
    );

    useAppearanceStore().colorScheme = "dark";
    await flushPromises();
    expect(cellRenderers().every((cell) => cell.props("isDark") === true)).toBe(
      true,
    );
    wrapper.unmount();
  });

  it("updates a citation chip whose source changes while streaming", async () => {
    const body = "Claim[^1].\n\n[^1]: [First](https://first.example.com/a)";
    const wrapper = mountMarkdown({ source: body, final: false });
    await flushPromises();
    expect(wrapper.get('[data-slot="inline-citation"]').text()).toContain(
      "first.example.com",
    );

    await wrapper.setProps({ source: body.replace("Claim", "A longer claim") });
    await flushPromises();
    expect(wrapper.get('[data-slot="inline-citation"]').text()).toContain(
      "first.example.com",
    );

    await wrapper.setProps({
      source: "Claim[^1].\n\n[^1]: [Second](https://second.example.com/b)",
    });
    await flushPromises();
    const chip = wrapper.get('[data-slot="inline-citation"]');
    expect(chip.text()).toContain("second.example.com");
    expect(chip.attributes("href")).toBe("https://second.example.com/b");
    wrapper.unmount();
  });

  it("updates an image whose source or text changes while streaming", async () => {
    const image = (alt: string, src: string) =>
      `![${alt}](${src})\n\nAfter the image`;
    const wrapper = mountMarkdown({
      source: image("Pine", "/images/first.png"),
      final: false,
    });
    await flushPromises();
    expect(wrapper.get("img").attributes("alt")).toBe("Pine");

    await wrapper.setProps({
      source: `${image("Pine", "/images/first.png")} more.`,
    });
    await flushPromises();
    expect(wrapper.get("img").attributes("src")).toContain("first.png");

    await wrapper.setProps({
      source: `${image("Oak", "/images/second.png")} more.`,
    });
    await flushPromises();
    expect(wrapper.get("img").attributes("alt")).toBe("Oak");
    expect(wrapper.get("img").attributes("src")).toContain("second.png");
    wrapper.unmount();
  });
});
