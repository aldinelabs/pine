import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { createMemoryHistory, createRouter } from "vue-router";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import { useAppearanceStore } from "@/stores/appearance";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { codeToHtml } from "@/lib/codeHighlight";
import { Slider } from "@/components/ui/slider";
import type { ProjectFilePreview as Preview } from "@/shared/projectFiles";
import ProjectFilePreview from "../ProjectFilePreview.vue";
import ProjectHtmlPreview from "../ProjectHtmlPreview.vue";
import ProjectOfficePreview from "../ProjectOfficePreview.vue";
import ProjectPdfPreview from "../ProjectPdfPreview.vue";

vi.mock("@/lib/codeHighlight", () => ({
  codeToHtml: vi
    .fn()
    .mockResolvedValue('<pre class="shiki"><code>highlighted</code></pre>'),
}));
vi.mock("vue-pdf-embed/dist/index.essential.mjs", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  default: {
    name: "VuePdfEmbed",
    props: {
      source: { type: String, required: true },
      width: Number,
      textLayer: Boolean,
    },
    emits: ["loaded", "loading-failed", "rendering-failed"],
    template:
      '<div data-pdf-engine="vue-pdf-embed"><span>PDF selected text</span></div>',
  },
}));
vi.mock("@vue-office/docx", () => ({
  default: {
    name: "VueOfficeDocx",
    props: ["src"],
    emits: ["error", "cellSelected", "cellsSelected", "switchSheet"],
    template:
      '<div data-office-engine="docx" :data-source="src"><span>Document selected text</span></div>',
  },
}));
vi.mock("@vue-office/excel", () => ({
  default: {
    name: "VueOfficeExcel",
    props: ["src", "options"],
    emits: ["error", "cellSelected", "cellsSelected", "switchSheet"],
    template:
      '<div data-office-engine="excel" :data-source="src" :data-legacy-xls="options?.xls || undefined" />',
  },
}));
vi.mock("@vue-office/pptx", () => ({
  default: {
    name: "VueOfficePptx",
    props: ["src"],
    emits: ["error", "cellSelected", "cellsSelected", "switchSheet"],
    template:
      '<div data-office-engine="pptx" :data-source="src"><span>Document selected text</span></div>',
  },
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
};
const wrappers: ReturnType<typeof mount>[] = [];
function render(
  read: (request: unknown) => Promise<Preview>,
  readPresented: (request: unknown) => Promise<Preview> = vi.fn(),
) {
  const pinia = createPinia();
  setActivePinia(pinia);
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/", component: {} }],
  });
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
  window.getSelection()?.removeAllRanges();
  vi.mocked(codeToHtml).mockResolvedValue(
    '<pre class="shiki"><code>highlighted</code></pre>',
  );
});

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

  it("renders HTML in a sandboxed iframe by default and switches to source", async () => {
    const source =
      '<!doctype html><html><body><h1>Hello</h1><script>window.top.alert("unsafe")</script></body></html>';
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
    await flushPromises();

    const htmlPreview = wrapper.findComponent(ProjectHtmlPreview);
    expect(htmlPreview.exists()).toBe(true);
    const frame = htmlPreview.get("iframe");
    expect(frame.attributes("srcdoc")).toBe(source);
    expect(frame.attributes("sandbox")).toBe("allow-same-origin");
    expect(frame.attributes("referrerpolicy")).toBe("no-referrer");
    expect(frame.attributes("title")).toBe("index.html");

    const mode = wrapper.get('[role="switch"]');
    expect(mode.attributes("aria-checked")).toBe("true");
    const slider = wrapper.findComponent(Slider);
    expect(slider.exists()).toBe(true);
    slider.vm.$emit("update:modelValue", [150]);
    slider.vm.$emit("valueCommit", [150]);
    await flushPromises();
    expect(htmlPreview.props("zoom")).toBe(150);
    expect(frame.attributes("style")).toContain("transform: scale(1.5)");
    expect(wrapper.get('[aria-label="File metadata"]').text()).toContain(
      "HTML",
    );

    await mode.trigger("click");
    await flushPromises();
    expect(wrapper.findComponent(ProjectHtmlPreview).exists()).toBe(false);
    expect(wrapper.find("pre.shiki").exists()).toBe(true);
    expect(wrapper.findComponent(Slider).exists()).toBe(false);
  });

  it("zooms an image preview with a trackpad pinch without changing ordinary scrolling", async () => {
    const wrapper = render(
      vi.fn().mockResolvedValue({
        ...info,
        kind: "image",
        url: "data:image/png;base64,aGVsbG8=",
      }),
    );
    await flushPromises();
    const image = wrapper.get<HTMLImageElement>("img").element;
    Object.defineProperties(image, {
      naturalWidth: { value: 1000 },
      naturalHeight: { value: 800 },
    });
    image.dispatchEvent(new Event("load"));
    await flushPromises();
    expect(image.style.width).toBe("1000px");
    const section = wrapper.element;
    const ordinaryWheel = new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: -40,
    });
    section.dispatchEvent(ordinaryWheel);
    expect(ordinaryWheel.defaultPrevented).toBe(false);

    await wrapper.trigger("wheel", { ctrlKey: true, deltaY: -40 });
    await flushPromises();
    expect(wrapper.get('[aria-label="File metadata"]').text()).toContain(
      "120%",
    );
    expect(image.style.width).toBe("1200px");
    expect(image.style.height).toBe("960px");
    expect(
      wrapper.get('[data-slot="image-preview-viewport"]').classes(),
    ).toContain("overflow-auto");
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

    useProjectStore().activeProject = {
      id: "p1",
      name: "Project",
      schemaVersion: 1,
      createdAt: "",
      updatedAt: "",
      defaultFolderId: "f1",
      folders: [],
    };
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
    useProjectStore().activeProject = {
      id: "p1",
      name: "Project",
      schemaVersion: 1,
      createdAt: "",
      updatedAt: "",
      defaultFolderId: "f1",
      folders: [],
    };
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
    const draft = store.createSessionTab();
    store.openFile(fileRequest);
    useProjectStore().activeProject = {
      id: "p1",
      name: "Project",
      schemaVersion: 1,
      createdAt: "",
      updatedAt: "",
      defaultFolderId: "f1",
      folders: [],
    };
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
        kind: "image",
        url: "pine-project-media://preview/image",
      });
    const wrapper = render(read);
    await flushPromises();
    await wrapper.setProps({ file: { ...file, relativePath: "photo.png" } });
    await flushPromises();
    first({ ...info, kind: "text", text: "old", encoding: "UTF-8" });
    await flushPromises();
    expect(wrapper.get("img").attributes("src")).toBe(
      "pine-project-media://preview/image",
    );
    expect(wrapper.find("pre").exists()).toBe(false);
    Object.defineProperties(wrapper.get("img").element, {
      naturalWidth: { value: 640 },
      naturalHeight: { value: 480 },
    });
    await wrapper.get("img").trigger("load");
    expect(wrapper.text()).toContain("640 × 480");
  });

  it("renders video controls and dimensions with duration", async () => {
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
      controls: "",
      preload: "metadata",
    });
    expect(video.attributes("autoplay")).toBeUndefined();
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

  it("renders PDF documents with the PDF library and reports page count", async () => {
    const wrapper = render(
      vi.fn().mockResolvedValue({
        ...info,
        kind: "pdf",
        url: "pine-project-media://preview/document",
      }),
    );
    useAppearanceStore().colorScheme = "dark";
    await flushPromises();
    await vi.waitFor(() => {
      expect(wrapper.findComponent(ProjectPdfPreview).exists()).toBe(true);
    });
    const pdfPreview = wrapper.findComponent(ProjectPdfPreview);
    const pdf = pdfPreview.findComponent({ name: "VuePdfEmbed" });
    expect(pdf.exists()).toBe(true);
    expect(pdf.props()).toMatchObject({
      source: "pine-project-media://preview/document",
      textLayer: true,
    });
    expect(pdfPreview.props("inverted")).toBe(true);
    const invertSwitch = wrapper.get('[role="switch"]');
    expect(invertSwitch.attributes("aria-checked")).toBe("true");
    expect(wrapper.get("footer label").text()).toBe("Invert colors");
    const slider = wrapper.findComponent(Slider);
    expect(slider.exists()).toBe(true);
    expect(slider.attributes("aria-label")).toBe("Zoom");
    slider.vm.$emit("update:modelValue", [150]);
    await flushPromises();
    expect(pdfPreview.props("renderZoom")).toBe(100);
    slider.vm.$emit("valueCommit", [150]);
    await flushPromises();
    expect(pdfPreview.props("zoom")).toBe(150);
    expect(pdfPreview.props("renderZoom")).toBe(150);
    expect(wrapper.get("footer").text()).toContain("150%");
    await invertSwitch.trigger("click");
    expect(pdfPreview.props("inverted")).toBe(false);
    pdf.vm.$emit("loaded", { numPages: 3 });
    await flushPromises();
    expect(wrapper.get("footer").text()).toContain("3 pages");
    const pdfText = pdf.get("span").element.firstChild!;
    selectText(pdfText, 0, pdfText, "PDF selected text".length);
    await pdfPreview.get(".scroll-fade").trigger("pointerup");
    expect(pdfPreview.emitted("selectionChange")?.at(-1)?.[0]).toEqual({
      startLine: 1,
      endLine: 1,
      label: "Selected content",
      text: "PDF selected text",
    });
    expect(wrapper.get('button[aria-haspopup="menu"]').text()).toContain(
      "Send selection to tab",
    );
    await wrapper.get('[data-action="open-default"]').trigger("click");
    expect(window.pine.operateProjectFile).toHaveBeenCalledWith({
      action: "open",
      target: { folderId: "f1", relativePath: "src/main.py" },
    });
    pdf.vm.$emit("rendering-failed", new Error("invalid PDF"));
    await flushPromises();
    expect(wrapper.text()).toContain("Unable to preview file");
  });

  it.each([
    ["docx", "docx"],
    ["xls", "excel"],
    ["xlsx", "excel"],
    ["pptx", "pptx"],
  ] as const)(
    "renders %s documents with vue-office",
    async (format, engine) => {
      const source = "pine-project-media://preview/" + format;
      const wrapper = render(
        vi.fn().mockResolvedValue({
          ...info,
          kind: "office",
          format,
          url: source,
        }),
      );
      useAppearanceStore().colorScheme = "dark";
      await vi.waitFor(() => {
        expect(wrapper.findComponent(ProjectOfficePreview).exists()).toBe(true);
      });
      const officePreview = wrapper.findComponent(ProjectOfficePreview);
      if (format === "xls" || format === "xlsx") {
        expect(
          officePreview.find('[data-slot="office-preview-sizer"]').exists(),
        ).toBe(false);
      }
      expect(officePreview.props("inverted")).toBe(true);
      const slider = wrapper.findComponent(Slider);
      slider.vm.$emit("update:modelValue", [130]);
      slider.vm.$emit("valueCommit", [130]);
      await flushPromises();
      expect(officePreview.props("zoom")).toBe(130);
      expect(officePreview.props("renderZoom")).toBe(130);
      const invertSwitch = wrapper.get('[role="switch"]');
      expect(invertSwitch.attributes("aria-checked")).toBe("true");
      await invertSwitch.trigger("click");
      expect(officePreview.props("inverted")).toBe(false);
      await vi.waitFor(() => {
        const viewer = officePreview.find(`[data-office-engine="${engine}"]`);
        expect(viewer.exists()).toBe(true);
        expect(viewer.attributes("data-source")).toBe(source);
        expect(viewer.attributes("data-legacy-xls")).toBe(
          format === "xls" ? "true" : undefined,
        );
      });
      if (format === "xls" || format === "xlsx") {
        const excel = officePreview.findComponent({ name: "VueOfficeExcel" });
        expect(excel.element.getAttribute("style") ?? "").not.toContain("zoom");
        const options = excel.props("options") as {
          transformData: (value: unknown) => unknown;
        };
        const workbook = [
          {
            name: "Sheet1",
            cols: { 0: { width: 80 } },
            styles: [{ font: { size: 10 } }],
            rows: {
              0: {
                height: 20,
                cells: { 0: { text: "Name" }, 1: { text: "Value" } },
              },
              1: { cells: { 0: { text: "Pine" }, 1: { text: 42 } } },
            },
          },
        ];
        options.transformData(workbook);
        expect(workbook[0].rows[0].height).toBe(26);
        expect(workbook[0].cols[0].width).toBe(104);
        expect(workbook[0].styles[0].font.size).toBe(13);
        excel.vm.$emit("cellsSelected", {
          startRowIndex: 0,
          startColumnIndex: 0,
          endRowIndex: 1,
          endColumnIndex: 1,
        });
        await flushPromises();
        expect(officePreview.emitted("selectionChange")?.at(-1)?.[0]).toEqual({
          startLine: 1,
          endLine: 2,
          label: "Selected content · Sheet1!A1:B2",
          text: "Name\tValue\nPine\t42",
        });
      } else {
        const documentText = officePreview.get("span").element.firstChild!;
        selectText(
          documentText,
          0,
          documentText,
          "Document selected text".length,
        );
        await officePreview.get(".scroll-fade").trigger("pointerup");
        expect(officePreview.emitted("selectionChange")?.at(-1)?.[0]).toEqual({
          startLine: 1,
          endLine: 1,
          label: "Selected content",
          text: "Document selected text",
        });
      }
      expect(wrapper.get('button[aria-haspopup="menu"]').text()).toContain(
        "Send selection to tab",
      );
      officePreview.vm.$emit("failed");
      await flushPromises();
      expect(wrapper.text()).toContain("Unable to preview file");
    },
  );

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
