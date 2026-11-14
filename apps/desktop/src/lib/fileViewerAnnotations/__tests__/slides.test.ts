import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileViewerInstance } from "@file-viewer/core";
import { slideAnnotations } from "../slides";

const viewer = {} as FileViewerInstance;

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

function pptxDeck(contentClass = "flyfish-pptx-content"): string {
  return `
    <div class="pptx-viewer-shell">
      <div class="pptx-loading" hidden><span>Parsing PPTX...</span></div>
      <button class="pptx-slideshow-button">Start slideshow</button>
      <div class="pptx-render-surface">
        <div class="flyfish-pptx-scale-box">
          <div class="${contentClass}">
            <div class="flyfish-pptx-slide-slot" data-slide-number="1">
              <div class="slide" style="width: 960px; height: 540px">
                <svg></svg><span class="text-block">Title</span>
              </div>
            </div>
            <div class="flyfish-pptx-slide-slot" data-slide-number="2"></div>
            <div class="flyfish-pptx-slide-slot" data-slide-number="3">
              <section class="slide flyfish-pptx-slide-error" data-slide-index="3">
                <div class="flyfish-pptx-slide-error-card">Slide 3 failed</div>
              </section>
            </div>
          </div>
        </div>
      </div>
    </div>`;
}

function keynote(active: number): string {
  const ids = ["s-1", "s-2", "s-3"];
  return `
    <div class="iwork-viewer">
      <nav class="iwork-nav">
        ${ids
          .map(
            (id, index) =>
              `<button type="button" data-scene-id="${id}"${index === active ? ' class="active"' : ""}>Slide ${index + 1}</button>`,
          )
          .join("")}
      </nav>
      <main class="iwork-stage">
        <section class="iwork-scene-wrap" data-scene-id="${ids[active]}" style="width: 512px; height: 384px">
          <article class="iwork-scene" style="width: 1024px; height: 768px; transform: scale(0.5)">
            <div class="iwork-text-layer"><div class="iwork-text">Hello</div></div>
          </article>
        </section>
      </main>
    </div>`;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("slideAnnotations", () => {
  it("serves the presentation renderers", () => {
    expect(slideAnnotations.renderers).toEqual([
      "office-presentation",
      "office-presentation-binary",
      "apple-keynote",
    ]);
    expect(slideAnnotations.capabilities).toEqual({
      annotate: true,
      annotateRegions: true,
    });
  });

  describe("pptx", () => {
    it("offers each mounted slide, not the viewer's chrome", () => {
      const root = mount(pptxDeck());
      const surfaces = slideAnnotations.surfaces!(root);
      expect(
        surfaces.map(({ segment, place }) => ({ segment, place })),
      ).toEqual([
        { segment: "slide:1", place: { kind: "slide", number: 1 } },
        { segment: "slide:3", place: { kind: "slide", number: 3 } },
      ]);
      expect(surfaces[0].root.textContent).not.toContain("Start slideshow");
      expect(surfaces[0].root.classList.contains("slide")).toBe(true);
      expect(surfaces[1].excluded).toBe(".flyfish-pptx-slide-error-card");
    });

    it("draws areas on the slide box with its natural size", () => {
      const root = mount(pptxDeck());
      const [first] = slideAnnotations.targets!(root);
      expect(first).toMatchObject({
        segment: "slide:1",
        place: { kind: "slide", number: 1 },
        size: { width: 960, height: 540 },
      });
      expect(first.element).toBe(root.querySelector(".slide"));
    });

    it("numbers slides placed straight in the content", () => {
      const root = mount(`
        <div class="flyfish-pptx-content">
          <style></style>
          <div class="slide"></div>
          <div class="slide"></div>
        </div>`);
      expect(slideAnnotations.targets!(root).map((t) => t.segment)).toEqual([
        "slide:1",
        "slide:2",
      ]);
    });

    it("offers nothing during the slideshow", () => {
      const root = mount(pptxDeck("flyfish-pptx-content is-presenting"));
      expect(slideAnnotations.surfaces!(root)).toEqual([]);
      expect(slideAnnotations.targets!(root)).toEqual([]);
    });

    it("scrolls an unmounted slide's slot into view", async () => {
      const root = mount(pptxDeck());
      const scroll = vi.fn();
      const slot = root.querySelector<HTMLElement>('[data-slide-number="2"]')!;
      slot.scrollIntoView = scroll;
      await slideAnnotations.reveal!(
        root,
        { place: { kind: "slide", number: 2 } },
        viewer,
      );
      expect(scroll).toHaveBeenCalledWith({
        block: "start",
        inline: "nearest",
      });
    });

    it("reads the slide from the segment when no place is given", async () => {
      const root = mount(pptxDeck());
      const scroll = vi.fn();
      root.querySelector<HTMLElement>(
        '[data-slide-number="3"]',
      )!.scrollIntoView = scroll;
      await slideAnnotations.reveal!(root, { segment: "slide:3" }, viewer);
      expect(scroll).toHaveBeenCalledOnce();
    });
  });

  describe("ppt", () => {
    it("offers areas on each page but no text", () => {
      const root = mount(`
        <div class="ppt-binary-shell">
          <div class="ppt-binary-loading">Loading</div>
          <div class="ppt-binary-slides">
            <div class="ppt-binary-page" data-slide-index="0"><canvas></canvas></div>
            <div class="ppt-binary-page" data-slide-index="1"><canvas></canvas></div>
          </div>
        </div>`);
      expect(slideAnnotations.surfaces!(root)).toEqual([]);
      const targets = slideAnnotations.targets!(root);
      expect(targets.map((t) => t.place)).toEqual([
        { kind: "slide", number: 1 },
        { kind: "slide", number: 2 },
      ]);
      expect(targets[0].size).toBeUndefined();
    });

    it("scrolls a page into view", async () => {
      const root = mount(`
        <div class="ppt-binary-page" data-slide-index="0"></div>
        <div class="ppt-binary-page" data-slide-index="1"></div>`);
      const scroll = vi.fn();
      root.querySelector<HTMLElement>(
        '[data-slide-index="1"]',
      )!.scrollIntoView = scroll;
      await slideAnnotations.reveal!(root, { segment: "slide:2" }, viewer);
      expect(scroll).toHaveBeenCalledOnce();
    });
  });

  describe("keynote", () => {
    it("numbers the shown slide by its place in the navigation", () => {
      const root = mount(keynote(1));
      const [surface] = slideAnnotations.surfaces!(root);
      expect(surface).toMatchObject({
        segment: "slide:2",
        place: { kind: "slide", number: 2 },
      });
      expect(surface.root.textContent?.trim()).toBe("Hello");
      const [target] = slideAnnotations.targets!(root);
      expect(target.element).toBe(root.querySelector(".iwork-scene"));
      expect(target.size).toEqual({ width: 1024, height: 768 });
    });

    it("switches slides with the navigation", async () => {
      const root = mount(keynote(0));
      const buttons = root.querySelectorAll<HTMLButtonElement>("nav button");
      const third = vi.fn();
      const first = vi.fn();
      buttons[2].addEventListener("click", third);
      buttons[0].addEventListener("click", first);
      await slideAnnotations.reveal!(
        root,
        { place: { kind: "slide", number: 3 } },
        viewer,
      );
      await slideAnnotations.reveal!(
        root,
        { place: { kind: "slide", number: 1 } },
        viewer,
      );
      expect(third).toHaveBeenCalledOnce();
      expect(first).not.toHaveBeenCalled();
    });
  });

  it("ignores requests without a slide", async () => {
    const root = mount(pptxDeck());
    const scroll = vi.fn();
    root
      .querySelectorAll<HTMLElement>(".flyfish-pptx-slide-slot")
      .forEach((slot) => (slot.scrollIntoView = scroll));
    await slideAnnotations.reveal!(
      root,
      { place: { kind: "page", number: 1 } },
      viewer,
    );
    expect(scroll).not.toHaveBeenCalled();
  });
});
