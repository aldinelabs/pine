import type { FileViewerAnnotationAdapter } from ".";
import type {
  AnnotationRevealRequest,
  AnnotationSurface,
  AnnotationTarget,
} from "@/components/project/file-preview/previewRenderer";

/**
 * A slide as rendered now: `text` holds its selectable text (absent when the
 * slide is a picture), `box` is the element that scales with zoom.
 */
interface RenderedSlide {
  number: number;
  box: HTMLElement;
  text?: HTMLElement;
  size?: { width: number; height: number };
}

/** Text drawn on a slide that is not part of the slide (renderer error cards). */
const EXCLUDED_TEXT = ".flyfish-pptx-slide-error-card";

/**
 * PowerPoint (.pptx): `.flyfish-pptx-content > .flyfish-pptx-slide-slot
 * [data-slide-number] > .slide`, scaled together by a CSS transform on the
 * content. Slides outside the scroll window are unmounted, leaving an empty
 * slot. While the slideshow runs, the content carries `is-presenting` and is
 * moved into an overlay outside the preview; no slides are offered then, so
 * comments are only made and shown in the scrolling deck.
 */
function pptxSlides(root: HTMLElement): RenderedSlide[] {
  const slides: RenderedSlide[] = [];
  for (const content of root.querySelectorAll<HTMLElement>(
    ".flyfish-pptx-content:not(.is-presenting)",
  )) {
    const slots = content.querySelectorAll<HTMLElement>(
      ":scope > .flyfish-pptx-slide-slot",
    );
    if (slots.length > 0) {
      for (const slot of slots) {
        const number = Number(slot.dataset.slideNumber);
        const slide = slot.querySelector<HTMLElement>(":scope > .slide");
        if (slide && number > 0) slides.push(pptxSlide(slide, number));
      }
    } else {
      // Decks rendered without windowing put the slides straight in the content.
      content
        .querySelectorAll<HTMLElement>(":scope > .slide")
        .forEach((slide, index) => {
          slides.push(pptxSlide(slide, index + 1));
        });
    }
  }
  return slides;
}

function pptxSlide(slide: HTMLElement, number: number): RenderedSlide {
  return { number, box: slide, text: slide, size: styleSize(slide) };
}

/**
 * Legacy PowerPoint (.ppt): each slide is a canvas in
 * `.ppt-binary-page[data-slide-index]` (0-based), sized to the zoom. There is
 * no text to select, and the natural slide size is not in the DOM.
 */
function pptSlides(root: HTMLElement): RenderedSlide[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(".ppt-binary-page[data-slide-index]"),
    (page) => ({ number: Number(page.dataset.slideIndex) + 1, box: page }),
  ).filter((slide) => Number.isInteger(slide.number) && slide.number > 0);
}

/**
 * Keynote: only the slide picked in `.iwork-nav` is rendered, as
 * `.iwork-scene-wrap[data-scene-id] > .iwork-scene`; the scene has the slide's
 * own size and a CSS scale transform. Its number is its place in the nav.
 */
function keynoteSlides(root: HTMLElement): RenderedSlide[] {
  const order = keynoteSceneIds(root);
  const slides: RenderedSlide[] = [];
  for (const wrap of root.querySelectorAll<HTMLElement>(
    ".iwork-stage > .iwork-scene-wrap[data-scene-id]",
  )) {
    const scene = wrap.querySelector<HTMLElement>(":scope > .iwork-scene");
    const index = order.indexOf(wrap.dataset.sceneId ?? "");
    if (!scene || index < 0) continue;
    slides.push({
      number: index + 1,
      box: scene,
      text: scene,
      size: styleSize(scene),
    });
  }
  return slides;
}

function keynoteSceneIds(root: HTMLElement): string[] {
  return Array.from(
    root.querySelectorAll<HTMLButtonElement>(
      ".iwork-nav > button[data-scene-id]",
    ),
    (button) => button.dataset.sceneId ?? "",
  );
}

/** The size an element is laid out at before transforms, from its inline style. */
function styleSize(
  element: HTMLElement,
): { width: number; height: number } | undefined {
  const width = Number.parseFloat(element.style.width);
  const height = Number.parseFloat(element.style.height);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function renderedSlides(root: HTMLElement): RenderedSlide[] {
  return [...pptxSlides(root), ...pptSlides(root), ...keynoteSlides(root)];
}

function slideNumber(request: AnnotationRevealRequest): number | undefined {
  if (request.place?.kind === "slide") return request.place.number;
  const match = /^slide:(\d+)$/.exec(request.segment ?? "");
  return match ? Number(match[1]) : undefined;
}

function reveal(root: HTMLElement, request: AnnotationRevealRequest): void {
  const number = slideNumber(request);
  if (!number) return;

  // Keynote shows one slide at a time; its nav buttons switch slides.
  const button = root.querySelectorAll<HTMLButtonElement>(
    ".iwork-nav > button[data-scene-id]",
  )[number - 1];
  if (button) {
    if (!button.classList.contains("active")) button.click();
    return;
  }

  // An unmounted .pptx slide keeps its slot, which mounts it once scrolled in.
  const slide =
    root.querySelector<HTMLElement>(
      `.flyfish-pptx-content:not(.is-presenting) > .flyfish-pptx-slide-slot[data-slide-number="${number}"]`,
    ) ??
    renderedSlides(root).find((candidate) => candidate.number === number)?.box;
  slide?.scrollIntoView({ block: "start", inline: "nearest" });
}

/** Presentations: text and areas on each slide. */
export const slideAnnotations: FileViewerAnnotationAdapter = {
  renderers: [
    "office-presentation",
    "office-presentation-binary",
    "apple-keynote",
  ],
  capabilities: { annotate: true, annotateRegions: true },
  surfaces: (root) =>
    renderedSlides(root).flatMap((slide): AnnotationSurface[] =>
      slide.text
        ? [
            {
              root: slide.text,
              excluded: EXCLUDED_TEXT,
              segment: `slide:${slide.number}`,
              place: { kind: "slide", number: slide.number },
            },
          ]
        : [],
    ),
  targets: (root) =>
    renderedSlides(root).map((slide): AnnotationTarget => ({
      element: slide.box,
      segment: `slide:${slide.number}`,
      place: { kind: "slide", number: slide.number },
      ...(slide.size ? { size: slide.size } : {}),
    })),
  reveal,
};
