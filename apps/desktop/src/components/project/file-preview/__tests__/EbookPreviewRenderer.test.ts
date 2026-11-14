import { createTestingPinia } from "@pinia/testing";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import EbookPreviewRenderer from "../EbookPreviewRenderer.vue";
import type { PreviewRendererHandle } from "../previewRenderer";

vi.mock("@/lib/ebook", () => {
  const unused = () => Promise.reject(new Error("Not this format."));
  return {
    readFb2: unused,
    readUmd: unused,
    readChm: unused,
    readEpub: () =>
      Promise.resolve({
        title: "Book",
        chapters: [
          {
            title: "Opening",
            depth: 0,
            load: () => Promise.resolve("<p>One</p>"),
          },
          {
            title: "Middle",
            depth: 0,
            load: () => Promise.resolve("<p>Two</p>"),
          },
        ],
      }),
  };
});

async function render(compact = false) {
  const wrapper = mount(EbookPreviewRenderer, {
    props: {
      preview: {
        kind: "text",
        text: "",
        encoding: "utf-8",
        size: 0,
        modifiedAt: "2026-01-01T00:00:00.000Z",
      },
      fileName: "book.epub",
      filePath: "book.epub",
      active: true,
      mode: "rendered",
      zoom: 100,
      inverted: false,
      selectionLabel: "",
      compact,
    },
    global: {
      plugins: [
        createAppI18n("en-US"),
        createTestingPinia({ createSpy: vi.fn }),
      ],
    },
  });
  // The reader loads on demand; wait until the first chapter shows.
  await vi.waitFor(() => {
    if (wrapper.find('[role="status"]').exists()) throw new Error("loading");
  });
  await flushPromises();
  const handle = wrapper.vm as unknown as Required<PreviewRendererHandle>;
  return { wrapper, handle };
}

/** The test environment gives srcdoc frames no document of their own. */
async function loadFrame(
  wrapper: Awaited<ReturnType<typeof render>>["wrapper"],
) {
  const frame = wrapper.get("iframe");
  const page = document.implementation.createHTMLDocument("chapter");
  Object.defineProperty(frame.element, "contentDocument", { value: page });
  await frame.trigger("load");
  return page;
}

describe("EbookPreviewRenderer", () => {
  it("offers the shown chapter for comments once its frame loads", async () => {
    const { wrapper, handle } = await render();
    expect(wrapper.emitted("capabilitiesChange")).toContainEqual([
      { annotate: true },
    ]);
    expect(handle.annotationSurfaces()).toEqual([]);

    const page = await loadFrame(wrapper);
    expect(wrapper.emitted("annotationsChange")).toHaveLength(1);
    expect(handle.annotationSurfaces()).toEqual([
      {
        root: page.body,
        segment: "chapter:1",
        place: { kind: "chapter", title: "Opening" },
      },
    ]);
  });

  it("turns to a comment's chapter", async () => {
    const { wrapper, handle } = await render();
    await loadFrame(wrapper);
    await handle.revealAnnotation({ segment: "chapter:2" });
    await flushPromises();
    expect(wrapper.get("iframe").attributes("srcdoc")).toContain("Two");
    // The new chapter's frame has not loaded: nothing to comment on yet.
    expect(handle.annotationSurfaces()).toEqual([]);

    const page = await loadFrame(wrapper);
    expect(wrapper.emitted("annotationsChange")).toHaveLength(2);
    expect(handle.annotationSurfaces()).toEqual([
      {
        root: page.body,
        segment: "chapter:2",
        place: { kind: "chapter", title: "Middle" },
      },
    ]);
  });

  it("ignores segments that are not its chapters", async () => {
    const { wrapper, handle } = await render();
    await handle.revealAnnotation({ segment: "chapter:9" });
    await handle.revealAnnotation({ segment: "page:1" });
    await flushPromises();
    expect(wrapper.get("iframe").attributes("srcdoc")).toContain("One");
  });

  it("offers no comments in a compact card", async () => {
    const { wrapper } = await render(true);
    expect(wrapper.emitted("capabilitiesChange")).not.toContainEqual([
      { annotate: true },
    ]);
  });
});
