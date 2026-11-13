import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import { createAppI18n } from "@/app/i18n";
import MarkdownContent from "../MarkdownContent.vue";
import { markdownImageName } from "../markdownImageContext";

function mountMarkdown(source: string, zoomableImages = true) {
  return mount(MarkdownContent, {
    attachTo: document.body,
    props: { source, final: true, zoomableImages },
    global: { plugins: [createAppI18n("en-US")] },
  });
}

async function openedDialog(): Promise<HTMLElement> {
  // The viewer loads with the first click.
  return vi.waitFor(() => {
    const content = dialog();
    expect(content?.getAttribute("data-state")).toBe("open");
    return content!;
  });
}

function dialog(): HTMLElement | null {
  return document.body.querySelector<HTMLElement>(
    '[data-slot="markdown-image-viewer"]',
  );
}

async function loadImages(
  wrapper: ReturnType<typeof mountMarkdown>,
): Promise<void> {
  for (const image of wrapper.findAll("img")) await image.trigger("load");
  await flushPromises();
}

describe("Markdown image viewer", () => {
  beforeEach(() => setActivePinia(createPinia()));
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("opens the clicked image enlarged and closes on Escape", async () => {
    const wrapper = mountMarkdown(
      "![First chart](/docs/first.png)\n\n![](/docs/second%20plot.png)",
    );
    await flushPromises();
    await loadImages(wrapper);

    const second = wrapper.findAll("img")[1];
    expect(second.attributes("role")).toBe("button");
    expect(second.attributes("tabindex")).toBe("0");
    expect(second.classes()).toContain("cursor-zoom-in");
    await second.trigger("click");
    const content = await openedDialog();
    expect(content?.querySelector("h2")?.textContent?.trim()).toBe(
      "second plot.png",
    );
    expect(content?.querySelector("img")?.getAttribute("src")).toBe(
      second.attributes("src"),
    );
    expect(content?.textContent).toContain("2 / 2");

    content.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }),
    );
    await flushPromises();
    expect(dialog()?.querySelector("h2")?.textContent?.trim()).toBe(
      "First chart",
    );

    content.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(dialog()?.getAttribute("data-state")).not.toBe("open");
    wrapper.unmount();
  });

  it("opens a focused image with Enter", async () => {
    const wrapper = mountMarkdown("![Diagram](/docs/diagram.png)");
    await flushPromises();
    await loadImages(wrapper);
    await wrapper.get("img").trigger("keydown", { key: "Enter" });
    await openedDialog();
    wrapper.unmount();
  });

  it("does not zoom a broken or unloaded image", async () => {
    const wrapper = mountMarkdown(
      "![Broken](/docs/missing.png)\n\n![Pending](/docs/pending.png)",
    );
    await flushPromises();
    const [broken, pending] = wrapper.findAll("img");
    await pending.trigger("click");
    await broken.trigger("error");
    await flushPromises();
    expect(wrapper.findAll("img")).toHaveLength(1);
    expect(wrapper.text()).toContain("Image failed to load");
    expect(wrapper.get("img").attributes("role")).toBeUndefined();
    expect(dialog()).toBeNull();
    wrapper.unmount();
  });

  it("leaves images inline where the renderer does not opt in", async () => {
    const wrapper = mountMarkdown("![Chat](/docs/chat.png)", false);
    await flushPromises();
    await loadImages(wrapper);
    const image = wrapper.get("img");
    expect(image.attributes("role")).toBeUndefined();
    await image.trigger("click");
    await flushPromises();
    expect(dialog()).toBeNull();
    wrapper.unmount();
  });

  it("names an image by its alt text, else its file name", () => {
    expect(markdownImageName(" Plot ", "a/b.png")).toBe("Plot");
    expect(markdownImageName("", "./figures/my%20chart.png?x=1")).toBe(
      "my chart.png",
    );
    expect(markdownImageName("", "data:image/png;base64,AAAA")).toBe("");
  });
});
