<script setup lang="ts">
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { storeToRefs } from "pinia";
import { CheckIcon, CopyIcon } from "@lucide/vue";
import { toast } from "vue-sonner";
import { Button } from "@/components/ui/button";
import { codeToHtml } from "@/lib/codeHighlight";
import { cn } from "@/lib/utils";
import type { FileLineRange } from "@/shared/projectFiles";
import { useAppearanceStore } from "@/stores/appearance";

/**
 * The `node` markstream hands a custom `code_block` renderer. `code` is the
 * fenced code text; `language` is the fence's info string (empty when absent).
 */
interface CodeBlockNodeProps {
  type: "code_block";
  language: string;
  code: string;
  raw?: string;
  loading?: boolean;
}

const props = defineProps<{
  node: CodeBlockNodeProps;
  loading?: boolean;
  layout?: "block" | "preview";
  /** Preview layout only: line ranges to tint. */
  highlightLines?: readonly FileLineRange[];
  /**
   * Preview layout only: marks this line so a scroll container can bring it
   * into view; the mark spans the highlighted range that starts there.
   */
  revealLine?: number;
}>();

const { colorScheme } = storeToRefs(useAppearanceStore());
const language = computed(
  () => props.node.language.trim().split(/\s+/)[0]?.toLowerCase() || "text",
);
const lineNumbers = computed(() =>
  Array.from(
    { length: props.node.code.split(/\r\n|\r|\n/).length },
    (_, index) => index + 1,
  ),
);
/** Lines never wrap in the preview layout, so line N sits at a fixed offset. */
function lineBand(start: number, end: number): Record<string, string> {
  return {
    top: `calc(var(--code-preview-padding) + ${start - 1} * var(--code-preview-line))`,
    height: `calc(${end - start + 1} * var(--code-preview-line))`,
  };
}
const highlightBands = computed(() =>
  props.layout === "preview"
    ? (props.highlightLines ?? []).map(({ start, end }) => ({
        key: `${start}-${end}`,
        style: lineBand(start, end),
      }))
    : [],
);
const revealBand = computed(() => {
  const line = props.revealLine;
  if (props.layout !== "preview" || line === undefined) return undefined;
  const range = props.highlightLines?.find(({ start }) => start === line);
  return lineBand(line, range?.end ?? line);
});
const isLoading = computed(
  () => props.loading === true || props.node.loading === true,
);
const rootElement = useTemplateRef<HTMLElement>("root");
const isNearViewport = ref(
  props.layout === "preview" || typeof IntersectionObserver === "undefined",
);
let visibilityObserver: IntersectionObserver | undefined;

onMounted(() => {
  const root = rootElement.value;
  if (
    props.layout === "preview" ||
    !root ||
    typeof IntersectionObserver === "undefined"
  ) {
    isNearViewport.value = true;
    return;
  }
  visibilityObserver = new IntersectionObserver(
    ([entry]) => {
      if (entry?.isIntersecting) {
        isNearViewport.value = true;
        visibilityObserver?.disconnect();
        visibilityObserver = undefined;
      }
    },
    { rootMargin: "600px 0px" },
  );
  visibilityObserver.observe(root);
});

const html = ref("");
interface HighlightRequest {
  code: string;
  language: string;
}

let disposed = false;
let highlighting = false;
let pendingHighlight: HighlightRequest | undefined;

async function drainHighlightQueue(): Promise<void> {
  if (highlighting) return;
  highlighting = true;

  try {
    while (pendingHighlight && !disposed) {
      const request = pendingHighlight;
      pendingHighlight = undefined;

      try {
        const text = await codeToHtml(request.code, {
          lang: request.language,
          themes: { light: "vitesse-light", dark: "vitesse-dark" },
          // Keep both palettes in the DOM so theme changes are synchronous and
          // never clear highlighted code while another render is pending.
          defaultColor: false,
        });
        if (
          !disposed &&
          !isLoading.value &&
          request.code === props.node.code &&
          request.language === language.value
        ) {
          html.value = text;
        }
      } catch {
        // The template keeps a preformatted, Vue-escaped source fallback.
      }
    }
  } finally {
    highlighting = false;
  }
}

watch(
  () =>
    [
      props.node.code,
      language.value,
      isLoading.value,
      isNearViewport.value,
    ] as const,
  ([code, currentLanguage, loading, visible]) => {
    // An open fence changes on every stream update. Keep it as escaped plain
    // text until it closes instead of repeatedly highlighting its full prefix.
    html.value = "";
    if (loading || !visible) {
      pendingHighlight = undefined;
      return;
    }

    // Stable updates can still arrive while an earlier highlight is running
    // (for example, file previews). Keep one task in flight and overwrite the
    // queued request so obsolete work never accumulates.
    pendingHighlight = { code, language: currentLanguage };
    void drainHighlightQueue();
  },
  { immediate: true },
);

const hovered = ref(false);
const copied = ref(false);
let resetTimer: ReturnType<typeof setTimeout> | undefined;
onUnmounted(() => {
  disposed = true;
  pendingHighlight = undefined;
  visibilityObserver?.disconnect();
  clearTimeout(resetTimer);
});

async function copyCode(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.node.code);
    copied.value = true;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      copied.value = false;
    }, 1600);
  } catch {
    toast.error("复制代码失败");
  }
}
</script>

<template>
  <div
    ref="root"
    :class="cn('relative', layout === 'preview' ? 'w-full' : 'my-6')"
    data-slot="code-block"
    @mouseenter="hovered = true"
    @mouseleave="hovered = false"
  >
    <div class="overflow-hidden rounded-lg bg-muted">
      <div
        class="code-highlight"
        :data-color-scheme="colorScheme"
        :data-layout="layout"
      >
        <div :class="layout === 'preview' ? 'code-preview' : undefined">
          <div
            v-for="band in highlightBands"
            :key="band.key"
            class="code-preview-line-highlight"
            data-slot="code-line-highlight"
            aria-hidden="true"
            :style="band.style"
          />
          <div
            v-if="revealBand"
            class="code-preview-reveal"
            data-slot="code-reveal"
            aria-hidden="true"
            :style="revealBand"
          />
          <div
            v-if="layout === 'preview'"
            class="code-preview-gutter"
            aria-hidden="true"
          >
            <span
              v-for="lineNumber in lineNumbers"
              :key="lineNumber"
              class="code-preview-line-number"
            >
              {{ lineNumber }}
            </span>
          </div>
          <div
            :class="layout === 'preview' ? 'code-preview-scroll' : undefined"
          >
            <div v-if="html" v-html="html"></div>
            <pre v-else><code>{{ node.code }}</code></pre>
          </div>
        </div>
      </div>
    </div>
    <div
      data-slot="code-block-toolbar"
      :class="
        cn(
          'absolute right-2 top-2 flex items-center gap-1 rounded-md bg-muted transition-opacity duration-150 ease-out focus-within:pointer-events-auto focus-within:opacity-100 motion-reduce:transition-none',
          hovered ? 'opacity-100' : 'pointer-events-none opacity-0',
        )
      "
    >
      <span
        data-slot="code-block-language"
        class="pointer-events-none px-1 font-mono text-xs text-muted-foreground select-none"
      >
        {{ language }}
      </span>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="复制代码"
        @click="copyCode"
      >
        <CheckIcon v-if="copied" data-icon="inline-start" />
        <CopyIcon v-else data-icon="inline-start" />
      </Button>
    </div>
  </div>
</template>

<style scoped>
/* Highlighted and fallback code share the same layout. Shiki already inserts
   newlines between its inline line spans; block spans would double the spacing. */
.code-highlight :deep(pre) {
  margin: 0;
  padding: 0.75rem 1rem; /* px-4 py-3, matching the original code block */
  border-radius: 0;
  background: transparent;
  white-space: pre;
  overflow-wrap: normal;
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: 0.875rem;
  line-height: 1.5;
  color: inherit;
}

.code-highlight :deep(pre code) {
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  background: transparent;
  padding: 0;
}

/* File previews keep line numbers fixed while long lines scroll inside the code area. */
.code-highlight[data-layout="preview"] .code-preview {
  --code-preview-padding: 1rem;
  --code-preview-line: calc(0.875rem * 1.5);
  position: relative;
  /* Line highlights paint below the code but above the block's background. */
  isolation: isolate;
  display: flex;
  min-width: 0;
}

.code-highlight[data-layout="preview"] .code-preview-line-highlight,
.code-highlight[data-layout="preview"] .code-preview-reveal {
  position: absolute;
  inset-inline: 0;
  pointer-events: none;
}

/* The agent's attention color, as on presented tabs and highlighted cards. */
.code-highlight[data-layout="preview"] .code-preview-line-highlight {
  z-index: -1;
  background-color: color-mix(in oklch, var(--color-warning) 16%, transparent);
  box-shadow: inset 2px 0 0 var(--color-warning);
}

.code-highlight[data-layout="preview"] .code-preview-gutter {
  flex: 0 0 auto;
  min-width: 3ch;
  padding: 1rem 0.75rem;
  border-right: 1px solid color-mix(in oklch, currentColor 12%, transparent);
  color: color-mix(in oklch, currentColor 45%, transparent);
  font-family: var(--font-mono);
  font-size: 0.875rem;
  line-height: 1.5;
  text-align: right;
  user-select: none;
}

.code-highlight[data-layout="preview"] .code-preview-line-number {
  display: block;
}

.code-highlight[data-layout="preview"] .code-preview-scroll {
  min-width: 0;
  flex: 1 1 auto;
  overflow-x: auto;
  scrollbar-width: none;
}

.code-highlight[data-layout="preview"] .code-preview-scroll::-webkit-scrollbar {
  display: none;
}

.code-highlight[data-layout="preview"] .code-preview-scroll > div,
.code-highlight[data-layout="preview"] .code-preview-scroll > pre {
  width: max-content;
  min-width: 100%;
}

.code-highlight[data-layout="preview"] :deep(pre) {
  max-width: none;
  padding: 1rem;
  overflow: visible;
}

/* Shiki emits both palettes as token variables. Explicitly apply each palette
   from the app preference, including when switching back to light mode. */
.code-highlight[data-color-scheme="light"] :deep(.shiki),
.code-highlight[data-color-scheme="light"] :deep(.shiki span) {
  color: var(--shiki-light);
  font-style: var(--shiki-light-font-style, normal);
  font-weight: var(--shiki-light-font-weight, normal);
  text-decoration: var(--shiki-light-text-decoration, none);
}

.code-highlight[data-color-scheme="dark"] :deep(.shiki),
.code-highlight[data-color-scheme="dark"] :deep(.shiki span) {
  color: var(--shiki-dark);
  font-style: var(--shiki-dark-font-style, normal);
  font-weight: var(--shiki-dark-font-weight, normal);
  text-decoration: var(--shiki-dark-text-decoration, none);
}
</style>
