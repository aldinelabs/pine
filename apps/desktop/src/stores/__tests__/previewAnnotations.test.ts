import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import {
  annotationFileKey,
  annotationQuotes,
  MAX_ANNOTATION_TEXT,
  MAX_ANNOTATIONS,
  type NewPreviewAnnotation,
  type PreviewAnnotation,
  usePreviewAnnotationsStore,
} from "../previewAnnotations";

const key = annotationFileKey({
  projectId: "p1",
  folderId: "f1",
  relativePath: "src/a.ts",
});

function input(
  start: number,
  overrides: Partial<NewPreviewAnnotation> = {},
): NewPreviewAnnotation {
  return {
    mode: "code",
    anchor: { start, end: start + 3, exact: "abc", prefix: "", suffix: "" },
    text: "abc",
    comment: "note",
    version: "v1",
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("annotationFileKey", () => {
  it("distinguishes files and folders without ambiguity", () => {
    const a = annotationFileKey({
      projectId: "p",
      folderId: "f:a",
      relativePath: "b",
    });
    const b = annotationFileKey({
      projectId: "p",
      folderId: "f",
      relativePath: "a:b",
    });
    expect(a).not.toBe(b);
  });
});

describe("preview annotations store", () => {
  it("adds comments with trimmed text and comment", () => {
    const store = usePreviewAnnotationsStore();
    const added = store.add(
      key,
      input(0, { text: "  hello\r\nworld  ", comment: "  why?  " }),
    );
    expect(added).toMatchObject({
      text: "hello\nworld",
      comment: "why?",
      orphaned: false,
      version: "v1",
    });
    expect(added?.id).toBeTruthy();
    expect(store.annotationsFor(key)).toEqual([added]);
  });

  it("caps the passage text", () => {
    const store = usePreviewAnnotationsStore();
    const added = store.add(
      key,
      input(0, { text: "x".repeat(MAX_ANNOTATION_TEXT + 10) }),
    );
    expect(added?.text).toBe(`${"x".repeat(MAX_ANNOTATION_TEXT)}…`);
  });

  it("rejects empty comments", () => {
    const store = usePreviewAnnotationsStore();
    expect(store.add(key, input(0, { comment: "   " }))).toBeUndefined();
    expect(store.annotationsFor(key)).toEqual([]);
    expect(store.groups).toEqual({});
  });

  it("stops at the per-file limit", () => {
    const store = usePreviewAnnotationsStore();
    for (let i = 0; i < MAX_ANNOTATIONS; i++)
      expect(store.add(key, input(i))).toBeDefined();
    expect(store.add(key, input(999))).toBeUndefined();
    expect(store.annotationsFor(key)).toHaveLength(MAX_ANNOTATIONS);
    const other = annotationFileKey({
      projectId: "p1",
      folderId: "f1",
      relativePath: "src/b.ts",
    });
    expect(store.add(other, input(0))).toBeDefined();
  });

  it("keeps comments in document order", () => {
    const store = usePreviewAnnotationsStore();
    const noLinesLate = store.add(key, input(50));
    const line5 = store.add(
      key,
      input(90, { lines: { startLine: 5, endLine: 5 } }),
    );
    const noLinesEarly = store.add(key, input(10));
    const line2b = store.add(
      key,
      input(30, { lines: { startLine: 2, endLine: 3 } }),
    );
    const line2a = store.add(
      key,
      input(20, { lines: { startLine: 2, endLine: 2 } }),
    );
    expect(store.annotationsFor(key).map((a) => a.id)).toEqual([
      line2a?.id,
      line2b?.id,
      line5?.id,
      noLinesEarly?.id,
      noLinesLate?.id,
    ]);
  });

  it("updates comments but ignores empty ones", () => {
    const store = usePreviewAnnotationsStore();
    const added = store.add(key, input(0))!;
    store.updateComment(key, added.id, "  changed ");
    expect(store.annotationsFor(key)[0].comment).toBe("changed");
    store.updateComment(key, added.id, "  ");
    expect(store.annotationsFor(key)[0].comment).toBe("changed");
  });

  it("removes and clears, dropping empty groups", () => {
    const store = usePreviewAnnotationsStore();
    const a = store.add(key, input(0))!;
    store.add(key, input(5));
    store.remove(key, a.id);
    expect(store.annotationsFor(key)).toHaveLength(1);
    store.clear(key);
    expect(store.annotationsFor(key)).toEqual([]);
    expect(key in store.groups).toBe(false);

    const b = store.add(key, input(0))!;
    store.remove(key, b.id);
    expect(key in store.groups).toBe(false);
  });

  it("orphans a comment and places it again", () => {
    const store = usePreviewAnnotationsStore();
    const first = store.add(
      key,
      input(0, { lines: { startLine: 1, endLine: 1 } }),
    )!;
    const second = store.add(
      key,
      input(40, { lines: { startLine: 4, endLine: 4 } }),
    )!;

    store.orphan(key, first.id, "v2");
    expect(store.annotationsFor(key)[0]).toMatchObject({
      id: first.id,
      orphaned: true,
      version: "v2",
    });

    const anchor = {
      start: 80,
      end: 83,
      exact: "abc",
      prefix: "",
      suffix: "",
    };
    store.place(key, first.id, {
      anchor,
      lines: { startLine: 9, endLine: 10 },
      version: "v3",
    });
    const list = store.annotationsFor(key);
    expect(list.map((a) => a.id)).toEqual([second.id, first.id]);
    expect(list[1]).toMatchObject({
      anchor,
      lines: { startLine: 9, endLine: 10 },
      orphaned: false,
      version: "v3",
    });

    store.place(key, first.id, { anchor, version: "v4" });
    expect(store.annotationsFor(key)[1].lines).toBeUndefined();
  });

  it("takes a file's comments in order and clears them", () => {
    const store = usePreviewAnnotationsStore();
    const late = store.add(key, input(30))!;
    const early = store.add(key, input(10))!;
    const taken = store.take(key);
    expect(taken.map((a) => a.id)).toEqual([early.id, late.id]);
    expect(store.annotationsFor(key)).toEqual([]);
    expect(key in store.groups).toBe(false);
    expect(store.take(key)).toEqual([]);
  });
});

describe("annotationQuotes", () => {
  it("maps comments to quotes with file and line ranges", () => {
    const base: Omit<PreviewAnnotation, "id" | "lines"> = {
      mode: "code",
      anchor: { start: 0, end: 3, exact: "abc", prefix: "", suffix: "" },
      text: "abc",
      comment: "c",
      createdAt: 0,
      orphaned: false,
      version: "v1",
    };
    const quotes = annotationQuotes("src/a.ts", [
      { ...base, id: "1", lines: { startLine: 12, endLine: 12 } },
      { ...base, id: "2", lines: { startLine: 12, endLine: 18 } },
      { ...base, id: "3", text: "def", comment: "d" },
      { ...base, id: "4", text: "gone", comment: "e", orphaned: true },
    ]);
    expect(quotes).toEqual([
      { text: "abc", file: "src/a.ts", comment: "c", lines: "12" },
      { text: "abc", file: "src/a.ts", comment: "c", lines: "12-18" },
      { text: "def", file: "src/a.ts", comment: "d" },
      { text: "gone", file: "src/a.ts", comment: "e", stale: true },
    ]);
  });
});
