import type { Component } from "vue";
import type { AttachmentSelection } from "@/shared/attachments";
import type { FileReveal, ProjectFilePreview } from "@/shared/projectFiles";

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
  renderZoom: number;
  inverted: boolean;
  selectionLabel: string;
  /** Line to scroll to and lines to tint; only text renderers use it. */
  reveal?: FileReveal;
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
};

export interface PreviewRendererHandle {
  readSelection?: () => AttachmentSelection | undefined;
}

export interface PreviewRendererCapabilities {
  zoom: boolean;
  invert: boolean;
  renderToggle: boolean;
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
  supports: (preview: RenderablePreview, filePath: string) => boolean;
  capabilities: (
    context: PreviewRendererContext,
  ) => PreviewRendererCapabilities;
}

export function resolvePreviewRenderer(
  renderers: readonly PreviewRenderer[],
  preview: RenderablePreview,
  filePath: string,
): PreviewRenderer | undefined {
  return renderers.find((renderer) => renderer.supports(preview, filePath));
}
