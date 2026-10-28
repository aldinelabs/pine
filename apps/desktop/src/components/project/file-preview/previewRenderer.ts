import type { Component, InjectionKey, ShallowRef } from "vue";
import type { AttachmentSelection } from "@/shared/attachments";
import type {
  FileLineRange,
  FileReveal,
  ProjectFilePreview,
} from "@/shared/projectFiles";

export type PreviewDisplayMode = "code" | "rendered";
export type RenderablePreview = Exclude<
  ProjectFilePreview,
  { kind: "unsupported" }
>;

export interface PreviewRendererProps {
  preview: RenderablePreview;
  fileName: string;
  filePath: string;
  active: boolean;
  mode: PreviewDisplayMode;
  zoom: number;
  inverted: boolean;
  selectionLabel: string;
  /** Line to scroll to and lines to tint; only text renderers use it. */
  reveal?: FileReveal;
  /** Lines that changed when the file was last re-read; only source views tint them. */
  changedLines?: readonly FileLineRange[];
  /** The workbench card shows the content alone, without in-preview controls. */
  compact?: boolean;
}

export interface PreviewRendererMetadata {
  width?: number;
  height?: number;
  duration?: number;
  pageCount?: number;
}

export type PreviewRendererEvents = {
  failed: [];
  metadataChange: [metadata: PreviewRendererMetadata];
  selectionChange: [selection: AttachmentSelection | undefined];
  zoomWheel: [event: WheelEvent];
  /** Controls a renderer can only offer once its content has loaded. */
  capabilitiesChange: [capabilities: Partial<PreviewRendererCapabilities>];
  /** The renderer changed its own zoom, in percent (fit, gestures). */
  zoomChange: [zoom: number];
};

export interface PreviewRendererHandle {
  readSelection?: () => AttachmentSelection | undefined;
  /** Fits the content to the preview's width; offered with `fitWidth`. */
  fitWidth?: () => void;
}

/**
 * The preview's top bar. Renderers teleport their own controls (search, pages,
 * sheets, layers) into it and report `toolbar` once they have any.
 */
export const previewToolbarKey: InjectionKey<
  Readonly<ShallowRef<HTMLElement | null>>
> = Symbol("previewToolbar");

export interface PreviewRendererCapabilities {
  zoom: boolean;
  invert: boolean;
  renderToggle: boolean;
  /** Zoom bounds in percent; the preview defaults to 50–200. */
  zoomMin?: number;
  zoomMax?: number;
  /** The renderer zooms on Ctrl/⌘ + wheel and pinch itself. */
  gestureZoom?: boolean;
  /** The renderer can fit its content to the preview's width. */
  fitWidth?: boolean;
  /** The renderer placed controls in the preview's top bar. */
  toolbar?: boolean;
}

export interface PreviewRendererContext {
  preview: RenderablePreview;
  filePath: string;
  mode: PreviewDisplayMode;
}

/** A renderer owns its format-specific UI and reports only shared preview events. */
export interface PreviewRenderer {
  id: string;
  component: Component;
  supports: (context: PreviewRendererContext) => boolean;
  capabilities: (
    context: PreviewRendererContext,
  ) => PreviewRendererCapabilities;
}

export function resolvePreviewRenderer(
  renderers: readonly PreviewRenderer[],
  context: PreviewRendererContext,
): PreviewRenderer | undefined {
  return renderers.find((renderer) => renderer.supports(context));
}
