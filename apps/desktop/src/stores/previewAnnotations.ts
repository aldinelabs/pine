import { acceptHMRUpdate, defineStore } from "pinia";
import { ref } from "vue";
import type {
  AnnotationLines,
  PreviewDisplayMode,
} from "@/components/project/file-preview/previewRenderer";
import type { TextAnchor } from "@/lib/annotationAnchors";
import type { PineQuote } from "@/shared/quotes";

/** Most comments one file keeps. */
export const MAX_ANNOTATIONS = 50;
/** Longest passage a comment keeps, in characters. */
export const MAX_ANNOTATION_TEXT = 2_000;

export interface PreviewAnnotation {
  id: string;
  /** The view the comment was made in; anchors count in that view's text. */
  mode: PreviewDisplayMode;
  anchor: TextAnchor;
  lines?: AnnotationLines;
  /** The passage as the user selected it, trimmed and capped. */
  text: string;
  comment: string;
  createdAt: number;
  /** The file changed and the passage is no longer in it. */
  orphaned: boolean;
  /** The file version (`modifiedAt`) the anchor was last placed in. */
  version: string;
}

export type NewPreviewAnnotation = Pick<
  PreviewAnnotation,
  "mode" | "anchor" | "lines" | "text" | "comment" | "version"
>;

export interface AnnotationPlacement {
  anchor: TextAnchor;
  lines?: AnnotationLines;
  version: string;
}

const EMPTY: readonly PreviewAnnotation[] = Object.freeze([]);

/** Comments belong to a file, not a tab, so reopening the file finds them. */
export function annotationFileKey(target: {
  projectId: string;
  folderId: string;
  relativePath: string;
}): string {
  return JSON.stringify([
    target.projectId,
    target.folderId,
    target.relativePath,
  ]);
}

function capText(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n").trim();
  return normalized.length > MAX_ANNOTATION_TEXT
    ? `${normalized.slice(0, MAX_ANNOTATION_TEXT)}…`
    : normalized;
}

/** Document order: by start line, then offset; comments without lines last. */
function compareAnnotations(
  a: PreviewAnnotation,
  b: PreviewAnnotation,
): number {
  const aLine = a.lines?.startLine;
  const bLine = b.lines?.startLine;
  if (aLine !== undefined && bLine !== undefined && aLine !== bLine)
    return aLine - bLine;
  if (aLine === undefined && bLine !== undefined) return 1;
  if (aLine !== undefined && bLine === undefined) return -1;
  return a.anchor.start - b.anchor.start;
}

function formatLines(lines: AnnotationLines): string {
  return lines.endLine > lines.startLine
    ? `${lines.startLine}-${lines.endLine}`
    : `${lines.startLine}`;
}

/** The quotes a set of comments travels as when sent to a session. */
export function annotationQuotes(
  filePath: string,
  annotations: readonly PreviewAnnotation[],
): PineQuote[] {
  return annotations.map((annotation) => ({
    text: annotation.text,
    file: filePath,
    comment: annotation.comment,
    ...(annotation.lines ? { lines: formatLines(annotation.lines) } : {}),
    ...(annotation.orphaned ? { stale: true as const } : {}),
  }));
}

/**
 * Preview comments, grouped by file. Each group is kept in document order and
 * lives only in memory; empty groups are dropped.
 */
export const usePreviewAnnotationsStore = defineStore(
  "previewAnnotations",
  () => {
    const groups = ref<Record<string, PreviewAnnotation[]>>({});

    function write(key: string, annotations: PreviewAnnotation[]): void {
      const next = { ...groups.value };
      if (annotations.length)
        next[key] = [...annotations].sort(compareAnnotations);
      else delete next[key];
      groups.value = next;
    }

    function edit(
      key: string,
      id: string,
      change: (annotation: PreviewAnnotation) => PreviewAnnotation,
    ): void {
      const current = groups.value[key];
      if (!current?.some((annotation) => annotation.id === id)) return;
      write(
        key,
        current.map((annotation) =>
          annotation.id === id ? change(annotation) : annotation,
        ),
      );
    }

    function annotationsFor(key: string): readonly PreviewAnnotation[] {
      return groups.value[key] ?? EMPTY;
    }

    function add(
      key: string,
      input: NewPreviewAnnotation,
    ): PreviewAnnotation | undefined {
      const comment = input.comment.trim();
      const current = groups.value[key] ?? [];
      if (!comment || current.length >= MAX_ANNOTATIONS) return undefined;
      const annotation: PreviewAnnotation = {
        id: crypto.randomUUID(),
        mode: input.mode,
        anchor: input.anchor,
        ...(input.lines ? { lines: input.lines } : {}),
        text: capText(input.text),
        comment,
        createdAt: Date.now(),
        orphaned: false,
        version: input.version,
      };
      write(key, [...current, annotation]);
      return annotation;
    }

    function updateComment(key: string, id: string, comment: string): void {
      const trimmed = comment.trim();
      if (!trimmed) return;
      edit(key, id, (annotation) => ({ ...annotation, comment: trimmed }));
    }

    function remove(key: string, id: string): void {
      const current = groups.value[key];
      if (!current) return;
      const next = current.filter((annotation) => annotation.id !== id);
      if (next.length !== current.length) write(key, next);
    }

    function clear(key: string): void {
      if (groups.value[key]) write(key, []);
    }

    /** Record where a comment's passage sits in the current file version. */
    function place(
      key: string,
      id: string,
      placement: AnnotationPlacement,
    ): void {
      edit(key, id, (annotation) => {
        const next: PreviewAnnotation = {
          ...annotation,
          anchor: placement.anchor,
          version: placement.version,
          orphaned: false,
        };
        if (placement.lines) next.lines = placement.lines;
        else delete next.lines;
        return next;
      });
    }

    /** Mark a comment whose passage is gone from this file version. */
    function orphan(key: string, id: string, version: string): void {
      edit(key, id, (annotation) => ({
        ...annotation,
        orphaned: true,
        version,
      }));
    }

    /** Hand over a file's comments in document order and forget them. */
    function take(key: string): PreviewAnnotation[] {
      const current = groups.value[key];
      if (!current) return [];
      write(key, []);
      return [...current];
    }

    return {
      add,
      annotationsFor,
      clear,
      groups,
      orphan,
      place,
      remove,
      take,
      updateComment,
    };
  },
);

if (import.meta.hot) {
  import.meta.hot.accept(
    acceptHMRUpdate(usePreviewAnnotationsStore, import.meta.hot),
  );
}
