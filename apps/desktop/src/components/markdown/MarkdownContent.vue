<script lang="ts">
// Register the shadcn-style code block once at module load (not per-instance,
// which would re-register on every mount).
import {
  enableKatex,
  setCustomComponents,
  setDefaultMathOptions,
} from "markstream-vue";
import CodeBlock from "./CodeBlock.vue";
import MarkdownCitationDefinition from "./MarkdownCitationDefinition.vue";
import MarkdownCitationReference from "./MarkdownCitationReference.vue";
import MarkdownImage from "./MarkdownImage.vue";
import MarkdownTable from "./MarkdownTable.vue";
import { configurePineMarkdown } from "./configureMarkdown";
import { escapeProseDollarDelimiters } from "./escapeProseDollarDelimiters";
import "katex/dist/katex.min.css";

enableKatex();
setDefaultMathOptions({ strictDelimiters: true });

setCustomComponents("pine-chat", {
  code_block: CodeBlock,
  footnote: MarkdownCitationDefinition,
  footnote_reference: MarkdownCitationReference,
  image: MarkdownImage,
  table: MarkdownTable,
});

// The enlarged image view's code, shared by every renderer. It loads ahead
// of the first click so opening does not fetch and evaluate it mid-animation.
let imageViewerChunk:
  Promise<typeof import("./MarkdownImageViewer.vue")> | undefined;
function loadImageViewer(): Promise<
  typeof import("./MarkdownImageViewer.vue")
> {
  imageViewerChunk ??= import("./MarkdownImageViewer.vue").catch(
    (error: unknown) => {
      imageViewerChunk = undefined;
      throw error;
    },
  );
  return imageViewerChunk;
}

let imageViewerPreloadScheduled = false;
function preloadImageViewer(immediate = false): void {
  if (imageViewerChunk) return;
  if (immediate) {
    void loadImageViewer().catch(() => {});
    return;
  }
  if (imageViewerPreloadScheduled) return;
  imageViewerPreloadScheduled = true;
  const load = () => void loadImageViewer().catch(() => {});
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(load, { timeout: 2000 });
  } else {
    setTimeout(load, 200);
  }
}
</script>

<script setup lang="ts">
import {
  computed,
  markRaw,
  provide,
  ref,
  shallowRef,
  useTemplateRef,
  type Component,
} from "vue";
import { storeToRefs } from "pinia";
import MarkdownRender from "markstream-vue";
import type { BaseNode } from "markstream-vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import "markstream-vue/index.css";
import { useAppearanceStore } from "@/stores/appearance";
import {
  markdownCitations,
  parseMarkdownCitations,
  shareMarkdownCitations,
  type MarkdownCitations,
} from "./citation";
import {
  markdownImageDocumentUrl,
  markdownImageZoom,
  type MarkdownImageZoomApi,
  type MarkdownViewerImage,
} from "./markdownImageContext";
import { Button } from "@/components/ui/button";
import DialogScrollArea from "@/components/dialogs/DialogScrollArea.vue";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const props = defineProps<{
  /** Accumulated markdown source. Grows while a message streams. */
  source: string;
  /** True once the stream has completed (message finished). */
  final?: boolean;
  /** Preparsed file preview nodes carrying source line metadata. */
  nodes?: BaseNode[];
  /** Owner-scoped file preview URL; chat has no base document. */
  documentUrl?: string;
  /** Muted, small-scale typography for secondary surfaces (thinking
   * panels); tightens markstream's `--ms-*` type scale. */
  compact?: boolean;
  /** Clicking an image opens an enlarged, zoomable view (file previews). */
  zoomableImages?: boolean;
}>();

const root = useTemplateRef<HTMLDivElement>("root");
const viewerImages = shallowRef<MarkdownViewerImage[]>([]);
const viewerIndex = ref(0);
const viewerOpen = ref(false);
// Mounted on the first image click, once its code has loaded, and kept for
// its close animation.
const imageViewer = shallowRef<Component>();
let openSequence = 0;

/**
 * Collects the document's loaded images when one is clicked, so the view can
 * move between them. Nothing is tracked while no image is open.
 */
async function openImageViewer(target: HTMLElement): Promise<void> {
  const frames = [
    ...(root.value?.querySelectorAll<HTMLElement>(
      "[data-markdown-image][data-zoomable]",
    ) ?? []),
  ];
  const images: MarkdownViewerImage[] = [];
  let index = -1;
  for (const frame of frames) {
    const image = frame.querySelector("img");
    const src = image?.currentSrc || image?.getAttribute("src");
    if (!image || !src) continue;
    // An SVG with only a viewBox loads without a natural size: fit it from
    // its rendered size instead.
    let width = image.naturalWidth;
    let height = image.naturalHeight;
    if (!width || !height) {
      ({ width, height } = image.getBoundingClientRect());
    }
    if (!width || !height) continue;
    if (frame === target) index = images.length;
    images.push({
      src,
      name: frame.dataset.imageName ?? "",
      element: image,
      width,
      height,
    });
  }
  // Never open a different image than the one clicked.
  if (index < 0) return;
  const sequence = ++openSequence;
  let viewer: Component;
  try {
    viewer = (await loadImageViewer()).default;
  } catch {
    return;
  }
  // A later click started its own open.
  if (sequence !== openSequence) return;
  imageViewer.value ??= markRaw(viewer);
  viewerImages.value = images;
  viewerIndex.value = index;
  viewerOpen.value = true;
}

const imageZoomApi: MarkdownImageZoomApi = {
  open: (target) => void openImageViewer(target),
  preload: preloadImageViewer,
};

provide(
  markdownImageZoom,
  computed(() => (props.zoomableImages ? imageZoomApi : undefined)),
);

provide(
  markdownImageDocumentUrl,
  computed(() => props.documentUrl),
);

provide(
  markdownCitations,
  // Structurally shared: an unchanged map keeps its identity, so citation
  // chips do not re-render on every streamed flush.
  computed<MarkdownCitations>((previous) =>
    shareMarkdownCitations(previous, parseMarkdownCitations(props.source)),
  ),
);

// markstream themes its code block via the `is-dark` prop (its inline style vars
// do not track a `.dark` ancestor), so drive it from the app's color scheme.
const { colorScheme } = storeToRefs(useAppearanceStore());
const isDark = computed(() => colorScheme.value === "dark");
const renderedSource = computed(() =>
  escapeProseDollarDelimiters(props.source),
);
const markdownParseOptions = { streamParse: "auto" } as const;
const { t } = useI18n();
const pendingExternalUrl = ref<string>();
// Most renderers never see a link click: mount the dialog tree on the first
// one and keep it afterwards so its close animation and later opens behave
// as before.
const hasOpenedExternalLinkDialog = ref(false);

function normalizeExternalUrl(link: Element): string | undefined {
  const rawHref = link.getAttribute("href")?.trim();
  if (!rawHref) return undefined;

  const renderedText = link.textContent?.trim();
  const autoCompletedHttpUrl =
    /^http:\/\//iu.test(rawHref) &&
    renderedText === rawHref.slice("http://".length);
  let candidate = autoCompletedHttpUrl
    ? `https://${rawHref.slice("http://".length)}`
    : rawHref;

  if (candidate.startsWith("//")) {
    candidate = `https:${candidate}`;
  } else if (
    !/^[a-z][a-z\d+.-]*:/iu.test(candidate) &&
    !["/", "#", "?", "."].some((prefix) => candidate.startsWith(prefix))
  ) {
    candidate = `https://${candidate}`;
  }

  try {
    const url = new URL(candidate);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      !url.hostname
    ) {
      return undefined;
    }
    return url.href;
  } catch {
    return undefined;
  }
}

function handleMarkdownClick(event: MouseEvent): void {
  if (!(event.target instanceof Element)) return;
  const link = event.target.closest("a");
  if (!link) return;

  event.preventDefault();
  const url = normalizeExternalUrl(link);
  if (!url) return;

  hasOpenedExternalLinkDialog.value = true;
  pendingExternalUrl.value = url;
}

function handleExternalLinkDialogOpenChanged(open: boolean): void {
  if (!open) pendingExternalUrl.value = undefined;
}

async function confirmExternalLink(): Promise<void> {
  const url = pendingExternalUrl.value;
  pendingExternalUrl.value = undefined;
  if (!url) return;

  try {
    await window.pine.openExternalUrl(url);
  } catch {
    toast.error(t("markdown.externalLinkOpenFailed"));
  }
}
</script>

<template>
  <div
    ref="root"
    class="markdown-content"
    data-slot="markdown-content"
    :data-streaming="final === false ? 'true' : undefined"
    :data-compact="compact ? 'true' : undefined"
    @click="handleMarkdownClick"
  >
    <!--
      markstream-vue streams Markdown into the DOM as `content` grows (no per-token
      full re-render, no trailing-character lag). It styles content through
      themeable CSS variables on the `.markstream-vue` container. The overrides
      below map those variables to Pine's semantic palette, including for nested
      Markdown renderers inside table cells; per-tag `:deep()` rules fought
      markstream's variable-based sizing.
      `html-policy="safe"` renders the allowlisted structural HTML used by
      Markdown documents (such as details/summary) while stripping unsafe tags
      and attributes. The built-in `LinkNode` already emits `target="_blank"` +
      `rel="noopener noreferrer"`.
    -->
    <!-- New stream deltas fade in (streamdown-style); completed/history
         content renders without deltas so the animation never applies. -->
    <MarkdownRender
      mode="chat"
      :content="renderedSource"
      :nodes="nodes"
      :final="final"
      :parse-options="markdownParseOptions"
      :custom-markdown-it="configurePineMarkdown"
      html-policy="safe"
      custom-id="pine-chat"
      :smooth-streaming="false"
      :parse-coalesce-ms="32"
      :fade="final === false"
      :max-live-nodes="0"
      :is-dark="isDark"
    />

    <component
      :is="imageViewer"
      v-if="imageViewer"
      v-model:open="viewerOpen"
      v-model:index="viewerIndex"
      :images="viewerImages"
    />

    <AlertDialog
      v-if="hasOpenedExternalLinkDialog"
      :open="pendingExternalUrl !== undefined"
      @update:open="handleExternalLinkDialogOpenChanged"
    >
      <AlertDialogContent class="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("markdown.externalLinkTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription as="div">
            <span>{{ t("markdown.externalLinkDescription") }}</span>
            <DialogScrollArea class="mt-2 max-h-32" edge-inset="0rem">
              <code
                class="block break-all rounded-md bg-muted px-3 py-2 text-xs"
                >{{ pendingExternalUrl }}</code
              >
            </DialogScrollArea>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
          <Button
            data-testid="confirm-external-link"
            @click="confirmExternalLink"
          >
            {{ t("markdown.openExternalLink") }}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
</template>

<style scoped>
@reference "../../index.css";

.markdown-content {
  overflow-wrap: anywhere;
}

/* Offscreen history must skip layout/paint: with content-visibility forced
   visible, every streaming flush relaid out the entire transcript and pinned
   the CPU. markstream's default `content-visibility: auto` is restored here
   with the `auto`-keyword intrinsic size so the browser remembers each
   renderer's last-rendered height — re-entering view does not resize. The
   transcript's viewport-anchor restore (useMessageScroller) covers the one
   remaining estimate → real height swap when a message is first revealed. */
.markdown-content :deep(.markdown-renderer) {
  content-visibility: auto;
  contain-intrinsic-size: auto 800px auto 600px;
}

/* The actively streaming renderer keeps full layout: its height changes on
   every flush, and a stale intrinsic placeholder would fight the transcript's
   scroll following. */
.markdown-content[data-streaming] :deep(.markdown-renderer) {
  content-visibility: visible;
  contain-intrinsic-size: none;
}

/* markstream sets the base/heading font sizes through its own CSS variables on
   the `.markstream-vue` container (base `font-size: var(--ms-text-body)` =
   1rem, headings `var(--ms-text-h1..h6)`). Without overriding these, the body
   is pinned to markstream's 1rem (16px) even though the chat message base is
   `text-sm` (14px) — which is what made the prose look oversized. Restore the
   pre-refactor (markdown-it era) sizes here. */
.markdown-content :deep(.markstream-vue) {
  color: var(--foreground);
  --link-color: var(--primary);
  --inline-code-bg: var(--muted);
  --inline-code-fg: var(--foreground);
  --inline-code-border: var(--border);
  --code-bg: var(--muted);
  --code-fg: var(--foreground);
  --code-border: var(--border);
  --code-header-bg: var(--muted);
  --code-selection-bg: color-mix(in oklab, var(--accent) 30%, transparent);
  --code-line-number: var(--muted-foreground);
  --code-action-fg: var(--muted-foreground);
  --code-action-hover-bg: var(--accent);
  --code-action-hover-fg: var(--accent-foreground);
  --code-action-active-bg: var(--primary);
  --code-action-active-fg: var(--primary-foreground);
  --table-border: var(--border);
  --table-header-bg: var(--muted);
  --blockquote-border: color-mix(
    in oklab,
    var(--muted-foreground) 20%,
    transparent
  );
  --list-marker: color-mix(in oklab, var(--muted-foreground) 50%, transparent);
  --list-counter-marker: var(--muted-foreground);
  --hr-border: var(--border);
  --admonition-bg: var(--muted);
  --admonition-border: var(--border);
  --admonition-fg: var(--foreground);
  --admonition-muted: var(--muted-foreground);
  --admonition-header-bg: color-mix(in oklab, var(--muted) 50%, transparent);
  --tooltip-bg: var(--popover);
  --tooltip-fg: var(--popover-foreground);
  --tooltip-border: var(--border);
  --modal-bg: var(--popover);
  --modal-fg: var(--popover-foreground);
  --diagram-bg: var(--muted);
  --diagram-border: var(--border);
  --diagram-header-bg: var(--muted);
  --loading-spinner: var(--muted-foreground);
  --loading-shimmer: color-mix(in oklab, var(--muted) 50%, transparent);
  --image-placeholder-bg: var(--muted);
  --focus-ring: var(--ring);
  --ms-text-body: 0.875rem; /* text-sm — matches the chat message base */
  --ms-leading-body: 1.75;
  --ms-text-h1: 1.5rem; /* text-2xl */
  --ms-text-h2: 1.25rem; /* text-xl */
  --ms-text-h3: 1.125rem; /* text-lg */
  --ms-text-h4: 1rem; /* text-base */
  --ms-text-h5: 0.875rem; /* text-sm */
  --ms-text-h6: 0.875rem;
  --ms-weight-h1: 600; /* font-semibold */
  --ms-weight-h2: 600;
  --ms-weight-h3: 600;
  --ms-weight-h4: 600;
  /* Match the streamdown/ElevenLabs Response fade duration for stream deltas. */
  --stream-update-fade-duration: 180ms;
}

/* Compact variant for secondary surfaces (thinking panels): body matches the
   panel's previous text-sm size; headings collapse toward body size so
   markdown headings stay inside the muted small-type panel. */
.markdown-content[data-compact] :deep(.markstream-vue) {
  color: var(--muted-foreground);
  --ms-text-body: 0.875rem;
  --ms-leading-body: 1.6;
  --ms-text-h1: 0.875rem;
  --ms-text-h2: 0.875rem;
  --ms-text-h3: 0.875rem;
  --ms-text-h4: 0.875rem;
  --ms-text-h5: 0.875rem;
  --ms-text-h6: 0.875rem;
  --ms-weight-h1: 600;
  --ms-weight-h2: 600;
  --ms-weight-h3: 600;
  --ms-weight-h4: 600;
  --ms-flow-paragraph-y: 0.375rem;
  --ms-flow-list-y: 0.375rem;
  --ms-flow-codeblock-y: 0.5rem;
  --ms-flow-heading-1-mt: 0.75rem;
  --ms-flow-heading-2-mt: 0.75rem;
  --ms-flow-heading-3-mt: 0.75rem;
  --ms-flow-heading-1-mb: 0.25rem;
  --ms-flow-heading-2-mb: 0.25rem;
  --ms-flow-heading-3-mb: 0.25rem;
}

/* App-specific affordances that differ from markstream's defaults (it uses its
   own accent color, no underline, and per-element flow spacing for gaps). */
.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4) {
  @apply tracking-tight;
}

.markdown-content :deep(h2) {
  @apply border-b pb-2;
}

.markdown-content :deep(a) {
  @apply font-medium underline underline-offset-4;
}

.markdown-content :deep(code.inline-code) {
  @apply rounded bg-muted px-[0.3rem] py-[0.2rem] font-mono text-sm font-normal;
}

.markdown-content :deep(pre code) {
  @apply bg-transparent p-0 font-normal;
}

/* markstream's flow spacing gives each block a top margin; neutralize the very
   first one so the message doesn't start with a gap. */
.markdown-content :deep(.node-slot:first-child .node-content > :first-child) {
  margin-top: 0;
}

/* Inline citations replace their footnote definitions. Hide the entire
   definition slot, not just its contents, so no flow spacing remains. */
.markdown-content
  :deep(.node-slot[data-node-type="footnote"]:has([data-citation-definition])) {
  display: none;
}

/* MessageContent owns the gap to the next block. Ignore hidden citation
   definitions when finding the last visible block; ordinary footnotes and
   paragraph spacing inside Markdown remain unchanged. */
.markdown-content
  > :deep(
    .markdown-renderer
      > .node-slot:nth-last-child(
        1 of :not([data-node-type="footnote"]:has([data-citation-definition]))
      )
      > .node-content
      > :last-child
  ) {
  margin-bottom: 0;
}
</style>
