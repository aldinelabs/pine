import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useAppearanceStore } from "@/stores/appearance";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { codeToHtml } from "@/lib/codeHighlight";
import { Slider } from "@/components/ui/slider";
import type { ProjectFilePreview as Preview } from "@/shared/projectFiles";
import ProjectFilePreview from "../ProjectFilePreview.vue";
import FileViewerPreviewRenderer from "../file-preview/FileViewerPreviewRenderer.vue";
import { showProject } from "@/stores/__tests__/showProject";

vi.mock("@/lib/codeHighlight", () => ({
  codeToHtml: vi
    .fn()
    .mockResolvedValue('<pre class="shiki"><code>highlighted</code></pre>'),
}));
const fileViewer = vi.hoisted(() => {
  interface FakeViewer {
    container: HTMLElement;
    options: Record<string, unknown>;
    source?: Record<string, unknown>;
    scale: number;
    page: number;
    load: ReturnType<typeof vi.fn>;
    applyViewState: ReturnType<typeof vi.fn>;
    fitToView: ReturnType<typeof vi.fn>;
    search: ReturnType<typeof vi.fn>;
    updateOptions: ReturnType<typeof vi.fn>;
    [key: string]: unknown;
  }
  const state = {
    rendererId: "pdf",
    zoom: true,
    pageCount: 0,
    text: true,
    fail: false,
    instances: [] as FakeViewer[],
  };
  const contents: Record<string, string> = {
    pdf: '<div class="pdf-page"><span>PDF selected text</span></div>',
    "office-word-openxml":
      "<section><span>Document selected text</span></section>",
    image: '<img alt="" src="data:image/png;base64,aGVsbG8=">',
    video: "<video controls></video>",
    code: '<div class="html-viewer"><iframe class="html-preview-frame" sandbox=""></iframe></div>',
    "spreadsheet-openxml": "<div data-pine-spreadsheet></div>",
  };
  function searchState(query: string, total: number, currentIndex: number) {
    return Promise.resolve({
      query,
      total,
      currentIndex,
      current: null,
      matches: [],
    });
  }
  function createViewer(
    container: HTMLElement,
    {
      options,
      onEvent,
    }: { options: Record<string, unknown>; onEvent: (event: unknown) => void },
  ): FakeViewer {
    const zoomState = () => ({
      scale: viewer.scale,
      label: `${Math.round(viewer.scale * 100)}%`,
      canZoomIn: true,
      canZoomOut: true,
      canReset: true,
      minScale: 0.25,
      maxScale: 4,
    });
    const viewState = () => ({ page: viewer.page, pageCount: state.pageCount });
    const viewer: FakeViewer = {
      container,
      options,
      onEvent,
      scale: 0.9,
      page: 1,
      load: vi.fn((source: Record<string, unknown>) => {
        viewer.source = source;
        if (state.fail)
          return Promise.reject(new Error("Unreadable document."));
        container.innerHTML = contents[state.rendererId] ?? "<div></div>";
        // Images report their size once loaded, after the viewer settles.
        const image = container.querySelector("img");
        if (image) Object.defineProperty(image, "complete", { value: false });
        return Promise.resolve({});
      }),
      getRenderer: () => ({ id: state.rendererId, load: () => undefined }),
      getCapabilities: () => ({ zoom: state.zoom }),
      getZoomState: zoomState,
      getViewState: viewState,
      getDocumentTextChunks: () => (state.text ? [{ text: "text" }] : []),
      applyViewState: vi.fn((next: { scale?: number; page?: number }) => {
        if (next.scale) viewer.scale = next.scale;
        if (next.page) viewer.page = next.page;
        return Promise.resolve(viewState());
      }),
      fitToView: vi.fn(() => {
        viewer.scale = 0.75;
        onEvent({ type: "zoom-change", payload: zoomState() });
        return Promise.resolve({ applied: true });
      }),
      search: vi.fn((query: string) => searchState(query, 2, 0)),
      nextSearchResult: vi.fn(() => searchState("", 2, 1)),
      previousSearchResult: vi.fn(),
      clearSearch: vi.fn(() => searchState("", 0, -1)),
      updateOptions: vi.fn(),
      destroy: vi.fn(() => Promise.resolve()),
    };
    state.instances.push(viewer);
    return viewer;
  }
  return { state, createViewer };
});
vi.mock("@file-viewer/core", () => ({
  createViewer: fileViewer.createViewer,
  setDefaultFileViewerAssetBaseUrl: vi.fn(),
}));
vi.mock("@file-viewer/preset-all", () => ({
  allRenderers: { id: "file-viewer-preset-all" },
  setDefaultFullAssetBaseUrl: vi.fn(),
}));
const info = { size: 2048, modifiedAt: "2026-09-04T12:00:00Z" };
const fileRequest = {
  projectId: "p1",
  folderId: "f1",
  relativePath: "src/main.py",
};
const file = {
  id: "file-1",
  kind: "file" as const,
  label: "main.py",
  source: "project" as const,
  ...fileRequest,
};
const presentedFile = {
  id: "file-2",
  kind: "file" as const,
  label: "report.md",
  source: "presented" as const,
  path: "/tmp/report.md",
  projectId: "p1",
};
const wrappers: ReturnType<typeof mount>[] = [];
function render(
  read: (request: unknown) => Promise<Preview>,
  readPresented: (request: unknown) => Promise<Preview> = vi.fn(),
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  // The window's first draft belongs to the previewed file's project.
  useContentTabsStore().setDraftProject("session-1", "p1");
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: {} }],
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.resolve(new Response("document bytes"))),
  );
  Object.defineProperty(window, "pine", {
    configurable: true,
    value: {
      readProjectFilePreview: read,
      readPresentedFilePreview: readPresented,
      operateProjectFile: vi.fn().mockResolvedValue(undefined),
      setWatchedFilePreview: vi.fn().mockResolvedValue(undefined),
      onFilePreviewChanged: vi.fn().mockReturnValue(vi.fn()),
    },
  });
  const wrapper = mount(ProjectFilePreview, {
    props: { file },
    attachTo: document.body,
    global: { plugins: [pinia, router, createAppI18n("en-US")] },
  });
  wrappers.push(wrapper);
  return wrapper;
}
afterEach(() => {
  wrappers.splice(0).forEach((wrapper) => wrapper.unmount());
  Object.assign(fileViewer.state, {
    rendererId: "pdf",
    zoom: true,
    pageCount: 0,
    text: true,
    fail: false,
    instances: [],
  });
  window.getSelection()?.removeAllRanges();
  vi.mocked(codeToHtml).mockResolvedValue(
    '<pre class="shiki"><code>highlighted</code></pre>',
  );
});

async function mountedViewer(wrapper: ReturnType<typeof mount>) {
  await vi.waitFor(() => {
    expect(fileViewer.state.instances.length).toBeGreaterThan(0);
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
  await flushPromises();
  return fileViewer.state.instances.at(-1)!;
}

function documentPreview(url = "pine-project-media://preview/document") {
  return vi.fn().mockResolvedValue({ ...info, kind: "document", url });
}

function selectText(
  start: Node,
  startOffset: number,
  end: Node,
  endOffset: number,
) {
  const range = document.createRange();
  range.setStart(start, startOffset);
  range.setEnd(end, endOffset);
  window.getSelection()?.removeAllRanges();
  window.getSelection()?.addRange(range);
  document.dispatchEvent(new Event("selectionchange"));
}

describe("ProjectFilePreview", () => {
  it.each(["project", "presented"] as const)(
    "passes the %s document URL through the actual Markdown preview renderer",
    async (source) => {
      const url =
        "pine-project-media://preview/?owner=7&" +
        (source === "project"
          ? "projectId=p1&folderId=f1&relativePath=Readings%2Freport.md"
          : "presented=1&path=%2Ftmp%2Freport.md");
      const read = vi.fn().mockResolvedValue({
        ...info,
        kind: "text",
        text: "![案例配图](figures-dd/dd-01-vera-winthagen-eindhoven.png)",
        encoding: "UTF-8",
        url,
      });
      const wrapper = render(read, read);
      await wrapper.setProps({
        file:
          source === "project"
            ? { ...file, relativePath: "Readings/report.md" }
            : presentedFile,
      });
      await flushPromises();
      const imageUrl = new URL(wrapper.get("img").attributes("src")!);
      expect(imageUrl.searchParams.get("markdownImage")).toBe(
        "figures-dd/dd-01-vera-winthagen-eindhoven.png",
      );
      imageUrl.searchParams.delete("markdownImage");
      expect(imageUrl.href).toBe(new URL(url).href);
    },
  );

  function notifyPreviewChange(watchId?: string): void {
    const [request] = vi.mocked(window.pine.setWatchedFilePreview).mock
      .calls[0];
    const [listener] = vi.mocked(window.pine.onFilePreviewChanged).mock
      .calls[0];
    listener({ watchId: watchId ?? request.watchId });
  }

  it.each(["project", "presented"] as const)(
    "refreshes %s Markdown independently of file-tree events and keeps its scroll viewport",
    async (source) => {
      const read = vi.fn().mockResolvedValue({
        ...info,
        kind: "text",
        text: "# Before",
        encoding: "UTF-8",
      });
      const wrapper = render(read, read);
      const target =
        source === "project"
          ? { ...file, relativePath: "report.md" }
          : presentedFile;
      await wrapper.setProps({ file: target });
      await flushPromises();
      const viewport = wrapper.get('[data-slot="scroll-area-viewport"]')
        .element as HTMLElement;
      Object.defineProperties(viewport, {
        scrollHeight: { configurable: true, value: 2000 },
        clientHeight: { configurable: true, value: 400 },
      });
      viewport.scrollTop = 640;
      read.mockResolvedValue({
        ...info,
        kind: "text",
        text: "# After",
        encoding: "UTF-8",
      });
      notifyPreviewChange();
      await flushPromises();
      expect(wrapper.get("h1").text()).toBe("After");
      expect(wrapper.get('[data-slot="scroll-area-viewport"]').element).toBe(
        viewport,
      );
      expect(viewport.scrollTop).toBe(640);
      expect(wrapper.get('[role="switch"]').attributes("aria-checked")).toBe(
        "true",
      );
      expect(window.pine.setWatchedFilePreview).toHaveBeenLastCalledWith({
        watchId: expect.any(String),
        target:
          source === "project"
            ? { source, ...fileRequest, relativePath: "report.md" }
            : { source, path: "/tmp/report.md" },
      });
    },
  );

  it("keeps source mode and both scroll axes during asynchronous refresh, then clamps a shorter file", async () => {
    const read = vi.fn().mockResolvedValue({
      ...info,
      kind: "text",
      text: "# Before",
      encoding: "UTF-8",
    });
    const wrapper = render(read);
    await wrapper.setProps({ file: { ...file, relativePath: "report.md" } });
    await flushPromises();
    await wrapper.get('[role="switch"]').trigger("click");
    await flushPromises();
    const viewport = wrapper.get('[data-slot="scroll-area-viewport"]')
      .element as HTMLElement;
    const code = wrapper.get(".code-preview-scroll").element as HTMLElement;
    Object.defineProperties(viewport, {
      scrollHeight: { configurable: true, value: 2000 },
      clientHeight: { value: 400 },
    });
    Object.defineProperties(code, {
      scrollWidth: { value: 1000 },
      clientWidth: { value: 400 },
    });
    viewport.scrollTop = 640;
    code.scrollLeft = 180;
    let resolve!: (value: Preview) => void;
    read.mockImplementationOnce(
      () =>
        new Promise<Preview>((done) => {
          resolve = done;
        }),
    );
    notifyPreviewChange();
    await flushPromises();
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
    expect(wrapper.get('[data-slot="scroll-area-viewport"]').element).toBe(
      viewport,
    );
    resolve({ ...info, kind: "text", text: "# After", encoding: "UTF-8" });
    await flushPromises();
    expect(wrapper.get('[role="switch"]').attributes("aria-checked")).toBe(
      "false",
    );
    expect(wrapper.find("h1").exists()).toBe(false);
    expect(viewport.scrollTop).toBe(640);
    expect(code.scrollLeft).toBe(180);
    Object.defineProperty(viewport, "scrollHeight", { value: 500 });
    read.mockResolvedValueOnce({
      ...info,
      kind: "text",
      text: "short",
      encoding: "UTF-8",
    });
    notifyPreviewChange();
    await flushPromises();
    expect(viewport.scrollTop).toBe(100);
  });

  it("restores through delayed DOM updates and stops restoring when the user scrolls", async () => {
    const read = vi.fn().mockResolvedValue({
      ...info,
      kind: "text",
      text: "# Before",
      encoding: "UTF-8",
    });
    const wrapper = render(read);
    await wrapper.setProps({ file: { ...file, relativePath: "report.md" } });
    await flushPromises();
    const viewport = wrapper.get('[data-slot="scroll-area-viewport"]')
      .element as HTMLElement;
    Object.defineProperties(viewport, {
      scrollHeight: { value: 2000 },
      clientHeight: { value: 400 },
    });
    viewport.scrollTop = 640;
    read.mockResolvedValue({
      ...info,
      kind: "text",
      text: "# After",
      encoding: "UTF-8",
    });
    notifyPreviewChange();
    await flushPromises();
    viewport.scrollTop = 0;
    wrapper
      .get('[data-slot="markdown-content"]')
      .element.append(document.createElement("p"));
    await new Promise((done) => setTimeout(done, 20));
    expect(viewport.scrollTop).toBe(640);
    viewport.dispatchEvent(new WheelEvent("wheel"));
    viewport.scrollTop = 200;
    wrapper
      .get('[data-slot="markdown-content"]')
      .element.append(document.createElement("p"));
    await new Promise((done) => setTimeout(done, 20));
    expect(viewport.scrollTop).toBe(200);
  });

  it("defers background updates, ignores unrelated subscriptions and releases its watch on unmount", async () => {
    const read = vi.fn().mockResolvedValue({
      ...info,
      kind: "text",
      text: "hi",
      encoding: "UTF-8",
    });
    const wrapper = render(read);
    await flushPromises();
    const count = read.mock.calls.length;
    notifyPreviewChange("unrelated-tab");
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(count);
    await wrapper.setProps({ active: false });
    notifyPreviewChange();
    notifyPreviewChange();
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(count);
    await wrapper.setProps({ active: true });
    await flushPromises();
    expect(read).toHaveBeenCalledTimes(count + 1);
    const [request] = vi.mocked(window.pine.setWatchedFilePreview).mock
      .calls[0];
    const unsubscribe = vi.mocked(window.pine.onFilePreviewChanged).mock
      .results[0].value;
    wrapper.unmount();
    expect(window.pine.setWatchedFilePreview).toHaveBeenLastCalledWith({
      watchId: request.watchId,
      target: null,
    });
    expect(unsubscribe).toHaveBeenCalled();
  });

  it("ignores an obsolete refresh response when another change arrives", async () => {
    const read = vi.fn().mockResolvedValue({
      ...info,
      kind: "text",
      text: "# Initial",
      encoding: "UTF-8",
    });
    const wrapper = render(read);
    await wrapper.setProps({ file: { ...file, relativePath: "report.md" } });
    await flushPromises();
    let resolve!: (value: Preview) => void;
    read
      .mockImplementationOnce(
        () =>
          new Promise<Preview>((done) => {
            resolve = done;
          }),
      )
      .mockResolvedValueOnce({
        ...info,
        kind: "text",
        text: "# Newest",
        encoding: "UTF-8",
      });
    notifyPreviewChange();
    await flushPromises();
    notifyPreviewChange();
    await flushPromises();
    resolve({ ...info, kind: "text", text: "# Obsolete", encoding: "UTF-8" });
    await flushPromises();
    expect(wrapper.get("h1").text()).toBe("Newest");
  });

  it("renders HTML through file-viewer by default, scales its frame and switches to source", async () => {
    fileViewer.state.rendererId = "code";
    fileViewer.state.zoom = false;
    fileViewer.state.text = false;
    const source = "<!doctype html><html><body><h1>Hello</h1></body></html>";
    const wrapper = render(
      vi.fn().mockResolvedValue({
        ...info,
        kind: "text",
        text: source,
        encoding: "UTF-8",
      }),
    );
    await wrapper.setProps({
      file: { ...file, relativePath: "public/index.html" },
    });
    const viewer = await mountedViewer(wrapper);
    expect(viewer.source?.filename).toBe("index.html");
    expect(new TextDecoder().decode(viewer.source?.buffer as ArrayBuffer)).toBe(
      source,
    );
    expect(viewer.options).toMatchObject({
      toolbar: false,
      zoomGestures: true,
      text: { toolbar: false },
    });

    const mode = wrapper.get('[role="switch"]');
    expect(mode.attributes("aria-checked")).toBe("true");
    const slider = wrapper.findComponent(Slider);
    expect(slider.exists()).toBe(true);
    slider.vm.$emit("update:modelValue", [150]);
    slider.vm.$emit("valueCommit", [150]);
    await flushPromises();
    expect(
      wrapper.get('[data-slot="file-viewer"]').attributes("style"),
    ).toContain("--pine-frame-zoom: 1.5");
    expect(wrapper.get('[aria-label="File metadata"]').text()).toContain(
      "HTML",
    );

    await mode.trigger("click");
    await flushPromises();
    expect(wrapper.find('[data-slot="file-viewer"]').exists()).toBe(false);
    expect(wrapper.find("pre.shiki").exists()).toBe(true);
    expect(wrapper.findComponent(Slider).exists()).toBe(false);
    expect(viewer.destroy).toHaveBeenCalled();
  });

  it("leaves gesture zoom to the viewer and drives its zoom from the slider", async () => {
    fileViewer.state.rendererId = "image";
    fileViewer.state.text = false;
    const wrapper = render(documentPreview());
    const viewer = await mountedViewer(wrapper);
    const metadata = () => wrapper.get('[role="toolbar"]').text();
    expect(metadata()).toContain("90%");

    // Pinch and Ctrl/⌘ + wheel reach the viewer, which zooms by itself.
    const pinch = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      ctrlKey: true,
      deltaY: -40,
    });
    wrapper.element.dispatchEvent(pinch);
    expect(pinch.defaultPrevented).toBe(false);
    viewer.scale = 1.1;
    (viewer.onEvent as (event: unknown) => void)({
      type: "zoom-change",
      payload: (viewer.getZoomState as () => unknown)(),
    });
    await flushPromises();
    expect(metadata()).toContain("110%");
    expect(viewer.applyViewState).not.toHaveBeenCalled();

    // The slider zooms the document while it moves, not only on release.
    wrapper.findComponent(Slider).vm.$emit("update:modelValue", [130]);
    await vi.waitFor(() =>
      expect(viewer.applyViewState).toHaveBeenLastCalledWith(
        { scale: 1.3 },
        { notify: false },
      ),
    );
    expect(metadata()).toContain("130%");

    const fit = wrapper
      .findAll("button")
      .find((button) => button.text() === "Fit width")!;
    await fit.trigger("click");
    await flushPromises();
    expect(viewer.fitToView).toHaveBeenCalledWith("width");
    expect(metadata()).toContain("75%");
  });

  it("switches Markdown between source and rendered content and locates rendered selections", async () => {
    const wrapper = render(
      vi.fn().mockResolvedValue({
        ...info,
        kind: "text",
        text: "# Heading\n\nFirst **bold** line.\nSecond line.\n\n# Heading",
        encoding: "UTF-8",
      }),
    );
    await wrapper.setProps({ file: { ...file, relativePath: "notes.md" } });
    await flushPromises();
    const mode = wrapper.get('[role="switch"]');
    expect(mode.attributes("aria-checked")).toBe("true");
    expect(wrapper.find('[data-slot="markdown-content"]').exists()).toBe(true);
    expect(wrapper.findComponent(Slider).exists()).toBe(false);
    expect(wrapper.find("pre").exists()).toBe(false);
    const headings = wrapper.findAll("h1");
    expect(headings).toHaveLength(2);
    expect(wrapper.get("strong").text()).toBe("bold");
    const walker = document.createTreeWalker(
      headings[1].element,
      NodeFilter.SHOW_TEXT,
    );
    let text = walker.nextNode()!;
    while (text.textContent !== "Heading") text = walker.nextNode()!;
    selectText(text, 0, text, 7);
    await flushPromises();
    expect(wrapper.get('button[aria-haspopup="menu"]').text()).toBe(
      "Send selection to tab…",
    );

    showProject({
      id: "p1",
      name: "Project",
      schemaVersion: 1,
      createdAt: "",
      updatedAt: "",
      defaultFolderId: "f1",
      folders: [],
    });
    window.pine.inspectProjectAttachments = vi.fn().mockResolvedValue({
      attachments: [
        {
          name: "notes.md",
          path: "/notes.md",
          extension: "md",
          size: 10,
          modifiedAt: "",
        },
      ],
    });
    await wrapper.get('button[aria-haspopup="menu"]').trigger("click");
    await flushPromises();
    await new DOMWrapper(
      document.querySelector('[data-action="new-session"]'),
    ).trigger("click");
    await flushPromises();
    const store = useContentTabsStore();
    expect(
      store.attachmentsFor(store.fallbackActiveTabId!)[0].selection,
    ).toEqual({ startLine: 6, endLine: 6, text: "Heading" });
    await mode.trigger("click");
    await flushPromises();
    expect(wrapper.find("pre").exists()).toBe(true);
    expect(wrapper.get('button[aria-haspopup="menu"]').text()).toBe(
      "Send to tab…",
    );
    await wrapper.setProps({ file });
    await flushPromises();
    expect(wrapper.find('[role="switch"]').exists()).toBe(false);
  });

  it("snapshots source selections when the menu opens, including an exclusive next-line boundary", async () => {
    vi.mocked(codeToHtml).mockResolvedValue(
      "<pre><code><span>first</span>\n<span>second</span>\n<span>third</span></code></pre>",
    );
    const wrapper = render(
      vi.fn().mockResolvedValue({
        ...info,
        kind: "text",
        text: "first\nsecond\nthird",
        encoding: "UTF-8",
      }),
    );
    await flushPromises();
    const spans = wrapper.findAll("pre code span");
    selectText(
      spans[1].element.firstChild!,
      1,
      spans[2].element.firstChild!,
      0,
    );
    await flushPromises();
    const trigger = wrapper.get('button[aria-haspopup="menu"]');
    expect(trigger.text()).toBe("Send selection to tab…");
    showProject({
      id: "p1",
      name: "Project",
      schemaVersion: 1,
      createdAt: "",
      updatedAt: "",
      defaultFolderId: "f1",
      folders: [],
    });
    window.pine.inspectProjectAttachments = vi.fn().mockResolvedValue({
      attachments: [
        {
          name: "main.py",
          path: "/main.py",
          extension: "py",
          size: 18,
          modifiedAt: "",
        },
      ],
    });
    await trigger.trigger("click");
    await flushPromises();
    window.getSelection()?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));
    await new DOMWrapper(document.querySelector('[role="menuitem"]')).trigger(
      "click",
    );
    await flushPromises();
    expect(
      useContentTabsStore().attachmentsFor("session-1")[0].selection,
    ).toEqual({ startLine: 2, endLine: 2, text: "econd\n" });
    expect(trigger.text()).toBe("Send to tab…");
  });

  it("shows file metadata and highlights read-only text", async () => {
    const read = vi.fn().mockResolvedValue({
      ...info,
      kind: "text",
      text: "print(1)\n",
      encoding: "UTF-8",
    });
    const wrapper = render(read);
    await flushPromises();
    expect(read).toHaveBeenCalledWith(fileRequest);
    expect(codeToHtml).toHaveBeenCalledWith(
      "print(1)\n",
      expect.objectContaining({ lang: "python" }),
    );
    const metadata = wrapper.get('[aria-label="File metadata"]');
    expect(metadata.text()).toContain("PY");
    expect(metadata.text()).toContain("2 KB");
    expect(metadata.text()).toContain("UTF-8");
    expect(metadata.text()).toContain("2 lines");
    expect(metadata.text()).not.toContain("Modified");
    expect(wrapper.element.lastElementChild).toBe(metadata.element);
    expect(metadata.text()).not.toContain("Read only");
    expect(wrapper.find("textarea, [contenteditable=true]").exists()).toBe(
      false,
    );
    expect(wrapper.find("pre.shiki").exists()).toBe(true);
  });

  it("previews a presented file through the presented-file channel", async () => {
    const readProject = vi.fn();
    const readPresented = vi.fn().mockResolvedValue({
      ...info,
      kind: "text",
      text: "# Report\n",
      encoding: "UTF-8",
    });
    const wrapper = render(readProject, readPresented);
    await wrapper.setProps({ file: presentedFile });
    await flushPromises();

    expect(readPresented).toHaveBeenCalledWith({ path: "/tmp/report.md" });
    const metadata = wrapper.get('[aria-label="File metadata"]');
    expect(metadata.text()).toContain("2 KB");
    // The project-only actions cannot address a file outside every folder.
    expect(wrapper.find('[data-action="open-default"]').exists()).toBe(false);
    expect(wrapper.find('footer button[aria-haspopup="menu"]').exists()).toBe(
      false,
    );
  });

  it("reports a presented file that can no longer be read", async () => {
    const wrapper = render(
      vi.fn(),
      vi.fn().mockRejectedValue(new Error("not presented")),
    );
    await wrapper.setProps({ file: presentedFile });
    await flushPromises();
    expect(wrapper.text()).toContain("Unable to preview file");
  });

  it("lists only open session tabs and attaches the file through the footer menu", async () => {
    const wrapper = render(
      vi.fn().mockResolvedValue({
        ...info,
        kind: "text",
        text: "hi",
        encoding: "UTF-8",
      }),
    );
    const store = useContentTabsStore();
    const session = {
      id: "s1",
      name: "Review",
      createdAt: "",
      updatedAt: "",
      messageCount: 0,
    };
    store.bindSession("session-1", session);
    const draft = store.createSessionTab({ projectId: "p1" });
    // A session of another project cannot read this file.
    store.openSession({ ...session, id: "s2", name: "Elsewhere" }, "p2");
    store.openFile(fileRequest);
    showProject({
      id: "p1",
      name: "Project",
      schemaVersion: 1,
      createdAt: "",
      updatedAt: "",
      defaultFolderId: "f1",
      folders: [],
    });
    const attachment = {
      name: "main.py",
      path: "/project/src/main.py",
      extension: "py",
      size: 2,
      modifiedAt: "",
    };
    window.pine.inspectProjectAttachments = vi
      .fn()
      .mockResolvedValue({ attachments: [attachment] });
    await flushPromises();
    await wrapper.get('footer button[aria-haspopup="menu"]').trigger("click");
    await flushPromises();
    const choices = Array.from(document.querySelectorAll('[role="menuitem"]'));
    expect(choices.map((item) => item.textContent?.trim())).toEqual([
      "Review",
      "New session",
      "Create session",
    ]);
    await new DOMWrapper(choices[1]).trigger("click");
    await flushPromises();
    expect(store.attachmentsFor(draft.id)).toEqual([attachment]);
    expect(store.attachmentsFor("session-1")).toEqual([]);
    expect(store.fallbackActiveTabId).toBe(draft.id);
    await wrapper.get('footer button[aria-haspopup="menu"]').trigger("click");
    await flushPromises();
    const separator = document.querySelector(
      '[data-slot="dropdown-menu-separator"]',
    );
    const createAction = document.querySelector('[data-action="new-session"]');
    expect(separator).not.toBeNull();
    expect(createAction).not.toBeNull();
    await new DOMWrapper(createAction).trigger("click");
    await flushPromises();
    const createdId = store.fallbackActiveTabId!;
    expect(createdId).not.toBe(draft.id);
    expect(store.tabs.find((tab) => tab.id === createdId)).toMatchObject({
      state: "draft",
    });
    expect(store.attachmentsFor(createdId)).toEqual([attachment]);
  });

  it("ignores stale reads when switching files", async () => {
    let first!: (preview: Preview) => void;
    const read = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Preview>((resolve) => {
            first = resolve;
          }),
      )
      .mockResolvedValueOnce({
        ...info,
        kind: "document",
        url: "pine-project-media://preview/image",
      });
    fileViewer.state.rendererId = "image";
    const wrapper = render(read);
    await flushPromises();
    await wrapper.setProps({ file: { ...file, relativePath: "photo.png" } });
    await flushPromises();
    first({ ...info, kind: "text", text: "old", encoding: "UTF-8" });
    await mountedViewer(wrapper);
    expect(fetch).toHaveBeenLastCalledWith(
      "pine-project-media://preview/image",
      expect.anything(),
    );
    expect(wrapper.find("pre").exists()).toBe(false);
    Object.defineProperties(wrapper.get("img").element, {
      naturalWidth: { value: 640 },
      naturalHeight: { value: 480 },
    });
    await wrapper.get("img").trigger("load");
    expect(wrapper.text()).toContain("640 × 480");
  });

  it("plays video natively with dimensions and duration", async () => {
    const wrapper = render(
      vi.fn().mockResolvedValue({
        ...info,
        kind: "video",
        url: "pine-project-media://preview/video",
      }),
    );
    await flushPromises();
    const video = wrapper.get("video");
    expect(video.attributes()).toMatchObject({
      src: "pine-project-media://preview/video",
      controls: "",
      preload: "metadata",
    });
    expect(video.attributes("autoplay")).toBeUndefined();
    expect(fileViewer.state.instances).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
    Object.defineProperties(video.element, {
      videoWidth: { value: 1920 },
      videoHeight: { value: 1080 },
      duration: { value: 65 },
    });
    await video.trigger("loadedmetadata");
    expect(wrapper.text()).toContain("1920 × 1080");
    expect(wrapper.text()).toContain("1:05");
    await video.trigger("error");
    expect(wrapper.text()).toContain("Unable to preview file");
  });

  it("pauses background video without resetting its playback position", async () => {
    const wrapper = render(
      vi.fn().mockResolvedValue({
        ...info,
        kind: "video",
        url: "pine-project-media://preview/video",
      }),
    );
    await flushPromises();
    const video = wrapper.get("video").element;
    const pause = vi.spyOn(video, "pause");
    video.currentTime = 42;
    await wrapper.setProps({ active: false });
    expect(pause).toHaveBeenCalledTimes(1);
    await wrapper.setProps({ active: true });
    expect(wrapper.get("video").element).toBe(video);
    expect(video.currentTime).toBe(42);
    expect(pause).toHaveBeenCalledTimes(1);
    wrapper.unmount();
    expect(pause).toHaveBeenCalledTimes(2);
  });

  it("renders paged documents with page, search and inversion controls", async () => {
    fileViewer.state.pageCount = 3;
    const wrapper = render(documentPreview());
    useAppearanceStore().colorScheme = "dark";
    const viewer = await mountedViewer(wrapper);
    expect(fetch).toHaveBeenCalledWith(
      "pine-project-media://preview/document",
      expect.anything(),
    );
    expect(viewer.source).toMatchObject({ filename: "main.py" });
    expect(viewer.options).toMatchObject({
      pdf: { toolbar: false },
      locale: "en-US",
    });
    expect(wrapper.get("footer").text()).toContain("3 pages");

    const surface = wrapper.get('[data-slot="file-viewer"]');
    const invertSwitch = wrapper.get('[role="switch"]');
    expect(invertSwitch.attributes("aria-checked")).toBe("true");
    expect(wrapper.get("footer label").text()).toBe("Invert colors");
    expect(surface.classes()).toContain("pine-file-viewer-inverted");
    // Inverted pages are light underneath, so the viewer stays in light mode.
    expect(surface.attributes("data-viewer-theme")).toBe("light");
    await invertSwitch.trigger("click");
    expect(surface.classes()).not.toContain("pine-file-viewer-inverted");
    expect(surface.attributes("data-viewer-theme")).toBe("dark");
    expect(viewer.updateOptions).toHaveBeenLastCalledWith({ theme: "dark" });

    await wrapper.get('[aria-label="Next page"]').trigger("click");
    await flushPromises();
    expect(viewer.applyViewState).toHaveBeenCalledWith(
      { page: 2 },
      { action: "page-step", source: "user" },
    );
    const page = wrapper.get<HTMLInputElement>('[aria-label="Page"]');
    expect(page.element.value).toBe("2");
    page.element.value = "9";
    await page.trigger("change");
    await flushPromises();
    expect(viewer.applyViewState).toHaveBeenLastCalledWith(
      { page: 3 },
      { action: "page-step", source: "user" },
    );

    const search = wrapper.get('input[type="search"]');
    await search.setValue("pine");
    await vi.waitFor(() => expect(viewer.search).toHaveBeenCalledWith("pine"));
    await flushPromises();
    expect(wrapper.get('[role="toolbar"]').text()).toContain("1/2");
    await search.trigger("keydown", { key: "Enter" });
    await flushPromises();
    expect(wrapper.get('[role="toolbar"]').text()).toContain("2/2");

    const text = surface.get("span").element.firstChild!;
    selectText(text, 0, text, "PDF selected text".length);
    await surface.trigger("pointerup");
    expect(wrapper.get('button[aria-haspopup="menu"]').text()).toContain(
      "Send selection to tab",
    );
    await wrapper.get('[data-action="open-default"]').trigger("click");
    expect(window.pine.operateProjectFile).toHaveBeenCalledWith({
      action: "open",
      target: { folderId: "f1", projectId: "p1", relativePath: "src/main.py" },
    });
  });

  it("sends a spreadsheet cell range with its sheet location", async () => {
    fileViewer.state.rendererId = "spreadsheet-openxml";
    const wrapper = render(documentPreview());
    await mountedViewer(wrapper);
    const values = [
      ["Name", "Value"],
      ["Pine", 42],
    ];
    const table = wrapper.get("[data-pine-spreadsheet]")
      .element as HTMLElement & {
      pineSpreadsheet?: unknown;
    };
    table.pineSpreadsheet = {
      sheetName: () => "Sheet1",
      table: () => ({
        ctx: {
          selector: { enable: true, xArr: [0, 2], yArr: [0, 1] },
          database: {
            getVirtualBodyCell: (row: number, column: number) =>
              column === 0
                ? { column: { key: "__index" }, row: { __k: String(row) } }
                : {
                    column: { key: `c${column - 1}` },
                    row: { __k: String(row) },
                    getValue: () => values[row][column - 1],
                  },
          },
        },
      }),
    };
    await wrapper.get('[data-slot="file-viewer"]').trigger("pointerup");
    expect(
      wrapper
        .findComponent(FileViewerPreviewRenderer)
        .emitted("selectionChange")
        ?.at(-1)?.[0],
    ).toEqual({
      startLine: 1,
      endLine: 2,
      label: "Selected content · Sheet1!A1:B2",
      text: "Name\tValue\nPine\t42",
    });
    expect(wrapper.get('button[aria-haspopup="menu"]').text()).toContain(
      "Send selection to tab",
    );
  });

  it("shows the failed state when the document cannot be rendered", async () => {
    fileViewer.state.fail = true;
    const wrapper = render(documentPreview());
    await vi.waitFor(() =>
      expect(wrapper.text()).toContain("Unable to preview file"),
    );
  });

  it("shows unsupported and error states and allows retrying", async () => {
    const read = vi
      .fn()
      .mockRejectedValueOnce(new Error("missing"))
      .mockResolvedValueOnce({
        ...info,
        kind: "unsupported",
        reason: "too-large",
      });
    const wrapper = render(read);
    await flushPromises();
    expect(wrapper.text()).toContain("Unable to preview file");
    await wrapper.get("button").trigger("click");
    await flushPromises();
    expect(wrapper.text()).toContain("2 MB");
    expect(wrapper.find('[role="status"]').exists()).toBe(false);
  });
});
