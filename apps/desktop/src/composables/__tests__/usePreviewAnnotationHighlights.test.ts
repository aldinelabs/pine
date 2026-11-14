import { describe, expect, it, vi } from "vitest";
import { effectScope, ref } from "vue";
import { createTextAnchor } from "@/lib/annotationAnchors";
import type { PreviewAnnotation } from "@/stores/previewAnnotations";
import { usePreviewAnnotationHighlights } from "../usePreviewAnnotationHighlights";

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));

function setup(text: string) {
  const host = document.createElement("div");
  const root = document.createElement("pre");
  root.textContent = text;
  host.append(root);
  document.body.append(host);
  return { host, root };
}

function annotationFor(
  root: HTMLElement,
  start: number,
  end: number,
): PreviewAnnotation {
  const node = root.firstChild!;
  const range = document.createRange();
  range.setStart(node, start);
  range.setEnd(node, end);
  return {
    id: "a",
    mode: "code",
    anchor: createTextAnchor(root, range)!,
    text: range.toString(),
    comment: "c",
    createdAt: 0,
    orphaned: false,
    version: "1",
  };
}

function run(
  host: HTMLElement,
  root: HTMLElement,
  annotation: PreviewAnnotation,
) {
  const onPlaced = vi.fn();
  const onLost = vi.fn();
  const scope = effectScope();
  const api = scope.run(() =>
    usePreviewAnnotationHighlights({
      surface: () => ({ root }),
      host: ref(host),
      annotations: ref([annotation]),
      mode: ref("code"),
      activeId: ref(undefined),
      draft: ref(undefined),
      enabled: ref(true),
      lines: () => ({ startLine: 2, endLine: 2 }),
      onPlaced,
      onLost,
      onHit: vi.fn(),
    }),
  )!;
  return { api, scope, onPlaced, onLost };
}

describe("usePreviewAnnotationHighlights", () => {
  it("places a passage where it still is", async () => {
    const { host, root } = setup("alpha beta gamma");
    const { api, scope, onPlaced, onLost } = run(
      host,
      root,
      annotationFor(root, 6, 10),
    );
    await frame();
    expect(api.surface.value?.root).toBe(root);
    expect(api.rangeOf("a")?.toString()).toBe("beta");
    expect(onPlaced).not.toHaveBeenCalled();
    expect(onLost).not.toHaveBeenCalled();
    scope.stop();
    host.remove();
  });

  it("follows a passage that moved and reports one that is gone", async () => {
    const { host, root } = setup("alpha beta gamma");
    const annotation = annotationFor(root, 6, 10);
    root.textContent = "new line\nalpha beta gamma";
    const moved = run(host, root, annotation);
    await frame();
    expect(moved.onPlaced).toHaveBeenCalledWith(
      "a",
      expect.objectContaining({
        anchor: expect.objectContaining({ start: 15, end: 19 }),
        lines: { startLine: 2, endLine: 2 },
      }),
    );
    moved.scope.stop();

    root.textContent = "alpha gamma";
    const lost = run(host, root, annotation);
    await frame();
    expect(lost.onLost).toHaveBeenCalledWith("a");
    lost.scope.stop();
    host.remove();
  });
});
