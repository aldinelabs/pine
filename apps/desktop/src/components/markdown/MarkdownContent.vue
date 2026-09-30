<script lang="ts">
// Register the shadcn-style code block once at module load (not per-instance,
// which would re-register on every mount).
import {
  enableKatex,
  setCustomComponents,
  setDefaultMathOptions,
} from "markstream-vue";
import CodeBlock from "./CodeBlock.vue";
import MarkdownImage from "./MarkdownImage.vue";
import MarkdownTable from "./MarkdownTable.vue";
import { disableMarkdownReplacements } from "./configureMarkdown";
import "katex/dist/katex.min.css";

enableKatex();
setDefaultMathOptions({ strictDelimiters: true });

setCustomComponents("pine-chat", {
  code_block: CodeBlock,
  image: MarkdownImage,
  table: MarkdownTable,
});
</script>

<script setup lang="ts">
import { computed, ref } from "vue";
import { storeToRefs } from "pinia";
import MarkdownRender from "markstream-vue";
import type { BaseNode } from "markstream-vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import "markstream-vue/index.css";
import { useAppearanceStore } from "@/stores/appearance";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

defineProps<{
  /** Accumulated markdown source. Grows while a message streams. */
  source: string;
  /** True once the stream has completed (message finished). */
  final?: boolean;
  /** Preparsed file preview nodes carrying source line metadata. */
  nodes?: BaseNode[];
  /** Muted, small-scale typography for secondary surfaces (thinking
   * panels); tightens markstream's `--ms-*` type scale. */
  compact?: boolean;
}>();

// markstream themes its code block via the `is-dark` prop (its inline style vars
// do not track a `.dark` ancestor), so drive it from the app's color scheme.
const { colorScheme } = storeToRefs(useAppearanceStore());
const isDark = computed(() => colorScheme.value === "dark");
const markdownParseOptions = { streamParse: "auto" } as const;
const { t } = useI18n();
const pendingExternalUrl = ref<string>();

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
    class="markdown-content"
    data-slot="markdown-content"
    :data-streaming="final === false ? 'true' : undefined"
    :data-compact="compact ? 'true' : undefined"
    @click="handleMarkdownClick"
  >
    <!--
      markstream-vue streams Markdown into the DOM as `content` grows (no per-token
      full re-render, no trailing-character lag). It styles every element through
      its own `--ms-*` themeable CSS variables set on the `.markstream-vue`
      container, so the primary styling knob below is overriding those variables,
      not per-tag `:deep()` rules (which fought markstream's var-based sizing).
      `html-policy="safe"` renders the allowlisted structural HTML used by
      Markdown documents (such as details/summary) while stripping unsafe tags
      and attributes. The built-in `LinkNode` already emits `target="_blank"` +
      `rel="noopener noreferrer"`.
    -->
    <!-- New stream deltas fade in (streamdown-style); completed/history
         content renders without deltas so the animation never applies. -->
    <MarkdownRender
      mode="chat"
      :content="source"
      :nodes="nodes"
      :final="final"
      :parse-options="markdownParseOptions"
      :custom-markdown-it="disableMarkdownReplacements"
      html-policy="safe"
      custom-id="pine-chat"
      :smooth-streaming="false"
      :parse-coalesce-ms="32"
      :fade="final === false"
      :max-live-nodes="0"
      :is-dark="isDark"
    />

    <AlertDialog
      :open="pendingExternalUrl !== undefined"
      @update:open="handleExternalLinkDialogOpenChanged"
    >
      <AlertDialogContent class="sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle>
            {{ t("markdown.externalLinkTitle") }}
          </AlertDialogTitle>
          <AlertDialogDescription>
            <span>{{ t("markdown.externalLinkDescription") }}</span>
            <code
              class="mt-2 block max-h-32 overflow-auto break-all rounded-md bg-muted px-3 py-2 text-xs"
            >
              {{ pendingExternalUrl }}
            </code>
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
  --link-color: var(--primary);
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

/* MessageContent owns the gap to the next tool or text block. Keep paragraph
   spacing inside Markdown, but do not add it again at the message boundary. */
.markdown-content
  > :deep(
    .markdown-renderer > .node-slot:last-child > .node-content > :last-child
  ) {
  margin-bottom: 0;
}
</style>
