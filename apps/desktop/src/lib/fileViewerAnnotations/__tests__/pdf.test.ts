import { afterEach, describe, expect, it, vi } from "vitest";
import type { FileViewerInstance } from "@file-viewer/core";
import { fileViewerAnnotationAdapter } from "..";
import { pdfAnnotations } from "../pdf";
import { annotationText } from "@/lib/annotationAnchors";

function mount(html: string): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = html;
  document.body.append(root);
  return root;
}

const textLayer = (text: string) =>
  `<div class="textLayer" tabindex="0">` +
  `<span class="markedContent"><span role="presentation">${text}</span></span>` +
  `<br role="presentation"><span role="presentation">第二行</span>` +
  `<div class="endOfContent"></div></div>`;

/**
 * pdf.js's DOM: pages 1 and 2 drawn with text, page 3 drawn without its text
 * layer yet, page 4 only laid out. happy-dom does not inherit custom
 * properties, so page 3 repeats the viewer's `--scale-factor`.
 */
function pdfViewer(): HTMLElement {
  return mount(`
    <div class="pdf-shell">
      <div class="pdf-wrapper">
        <div class="pdfViewer" style="--scale-factor: 2">
          <div class="page" data-page-number="1">
            <div class="canvasWrapper"><canvas></canvas></div>
            ${textLayer("Hello")}
            <div class="annotationLayer"></div>
          </div>
          <div class="page" data-page-number="2">
            <div class="canvasWrapper"><canvas></canvas></div>
            ${textLayer("你好")}
          </div>
          <div class="page" data-page-number="3" style="--scale-factor: 2">
            <div class="canvasWrapper"><canvas></canvas></div>
          </div>
          <div class="page" data-page-number="4"></div>
        </div>
      </div>
    </div>`);
}

function page(root: HTMLElement, number: number): HTMLElement {
  return root.querySelector<HTMLElement>(
    `.page[data-page-number="${number}"]`,
  )!;
}

function viewerWith(applyViewState = vi.fn(() => Promise.resolve(null))) {
  return {
    viewer: { applyViewState } as unknown as FileViewerInstance,
    applyViewState,
  };
}

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("pdfAnnotations", () => {
  it("serves the pdf renderer with text and areas", () => {
    expect(fileViewerAnnotationAdapter("pdf")).toBe(pdfAnnotations);
    expect(pdfAnnotations.capabilities).toEqual({
      annotate: true,
      annotateRegions: true,
    });
  });

  it("offers a surface per page whose text layer is rendered", () => {
    const root = pdfViewer();
    const surfaces = pdfAnnotations.surfaces!(root);

    expect(surfaces).toEqual([
      {
        root: page(root, 1).querySelector(".textLayer"),
        excluded: ".endOfContent",
        segment: "page:1",
        place: { kind: "page", number: 1 },
      },
      {
        root: page(root, 2).querySelector(".textLayer"),
        excluded: ".endOfContent",
        segment: "page:2",
        place: { kind: "page", number: 2 },
      },
    ]);
  });

  it("keeps the selection helper out of the page's text", () => {
    const root = pdfViewer();
    const [surface] = pdfAnnotations.surfaces!(root);
    // pdf.js moves the helper next to the selection while the user drags.
    const helper = surface.root.querySelector(".endOfContent")!;
    helper.textContent = "x";
    surface.root.querySelector(".markedContent")!.append(helper);

    expect(annotationText(surface.root, surface.excluded)).toBe("Hello第二行");
  });

  it("offers each drawn page's box as a target, sized in points", () => {
    const root = pdfViewer();
    for (const box of root.querySelectorAll<HTMLElement>(".canvasWrapper")) {
      vi.spyOn(box, "offsetWidth", "get").mockReturnValue(1190);
      vi.spyOn(box, "offsetHeight", "get").mockReturnValue(1684);
    }
    const targets = pdfAnnotations.targets!(root);

    expect(targets.map((target) => target.segment)).toEqual([
      "page:1",
      "page:2",
      "page:3",
    ]);
    expect(targets[2]).toEqual({
      element: page(root, 3).querySelector(".canvasWrapper"),
      segment: "page:3",
      place: { kind: "page", number: 3 },
      size: { width: 595, height: 842 },
    });
  });

  it("leaves the size out until the page is laid out", () => {
    const root = pdfViewer();

    expect(pdfAnnotations.targets!(root)[0].size).toBeUndefined();
  });

  it("turns to the page and waits for its text layer", async () => {
    const root = pdfViewer();
    const { viewer, applyViewState } = viewerWith(
      vi.fn(() => {
        setTimeout(() =>
          page(root, 4).insertAdjacentHTML("beforeend", textLayer("Four")),
        );
        return Promise.resolve(null);
      }),
    );

    await pdfAnnotations.reveal!(root, { segment: "page:4" }, viewer);

    expect(applyViewState).toHaveBeenCalledWith(
      { page: 4 },
      { action: "page-change", source: "api" },
    );
    expect(pdfAnnotations.surfaces!(root).at(-1)?.segment).toBe("page:4");
  });

  it("waits for the drawn page when revealing an area", async () => {
    const root = pdfViewer();
    const { viewer } = viewerWith(
      vi.fn(() => {
        setTimeout(() =>
          page(root, 4).insertAdjacentHTML(
            "beforeend",
            '<div class="canvasWrapper"></div>',
          ),
        );
        return Promise.resolve(null);
      }),
    );

    await pdfAnnotations.reveal!(
      root,
      {
        place: { kind: "page", number: 4 },
        shape: { kind: "region", x: 0, y: 0, width: 0.5, height: 0.5 },
      },
      viewer,
    );

    expect(page(root, 4).querySelector(".canvasWrapper")).not.toBeNull();
  });

  it("gives up when the page never draws or the viewer never settles", async () => {
    vi.useFakeTimers();
    const root = pdfViewer();
    const { viewer } = viewerWith(vi.fn(() => new Promise<null>(() => {})));
    let done = false;

    void pdfAnnotations.reveal!(root, { segment: "page:4" }, viewer)?.then(
      () => (done = true),
    );
    await vi.advanceTimersByTimeAsync(2999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });

  it("ignores requests for pages the document does not have", async () => {
    const root = pdfViewer();
    const { viewer, applyViewState } = viewerWith();

    await pdfAnnotations.reveal!(root, { segment: "page:9" }, viewer);
    await pdfAnnotations.reveal!(root, { segment: "slide:1" }, viewer);

    expect(applyViewState).not.toHaveBeenCalled();
  });
});
