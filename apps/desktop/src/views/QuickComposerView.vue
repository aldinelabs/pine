<script setup lang="ts">
import { useEventListener, useResizeObserver } from "@vueuse/core";
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  provide,
  ref,
  useTemplateRef,
} from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import ProjectSessionComposer from "@/components/project/ProjectSessionComposer.vue";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { DRAFT_PROJECT_OPENER_KEY } from "@/composables/useDraftProjectOpener";
import type { PineApprovalMode } from "@/shared/agent";
import type { PineAttachment } from "@/shared/attachments";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
import { DURATION_MS, EASE_OUT_EXPO } from "@/lib/motion";
import {
  QUICK_COMPOSER_ENTRANCE_SCALE,
  QUICK_COMPOSER_EXPAND_MS,
  QUICK_COMPOSER_GLASS_INSET,
  QUICK_COMPOSER_GLASS_RADIUS,
  type QuickComposerContext,
  type QuickComposerPermission,
  type QuickComposerRect,
  type QuickComposerShown,
} from "@/shared/quickComposer";
import { useProjectStore } from "@/stores/project";

/**
 * The floating composer summoned by the global shortcut. It fills the area
 * the new window will take, with the composer where that window's will be,
 * so the window can appear around it once the message is sent.
 */
const { t } = useI18n();
const projectStore = useProjectStore();
const composer =
  useTemplateRef<InstanceType<typeof ProjectSessionComposer>>("composer");
const backdrop = useTemplateRef<HTMLElement>("backdrop");
const cardElement = useTemplateRef<HTMLElement>("card");
const projectId = ref<string>(TEMPORARY_WORKSPACE_PROJECT_ID);
const draft = ref("");
const attachments = ref<PineAttachment[]>([]);
const approvalMode = ref<PineApprovalMode>("auto-approve");
/**
 * The controls below the input sit in from the card's round corners, and
 * move to where a window has them as the card grows into it.
 */
const isExpanding = ref(false);
/** What was sent stays in place until the new window covers it. */
const isSending = ref(false);

// The panel only records the project; the window that sends opens it.
provide(DRAFT_PROJECT_OPENER_KEY, () => Promise.resolve(true));

function focusComposer(): void {
  void nextTick(() => composer.value?.focus());
}

/**
 * Blurs into focus and grows about the card's centre, where main grows the
 * glass, while main fades the windows in.
 */
function playEntrance(): void {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const element = backdrop.value;
  const rect = card.value;
  if (!element) return;
  if (rect)
    element.style.transformOrigin = `${rect.x + rect.width / 2}px ${
      rect.y + rect.height / 2
    }px`;
  element.animate(
    [
      {
        filter: "blur(10px)",
        transform: `scale(${QUICK_COMPOSER_ENTRANCE_SCALE})`,
      },
      { filter: "blur(0)", transform: "none" },
    ],
    { duration: DURATION_MS, easing: EASE_OUT_EXPO },
  );
}

/**
 * What main captured from the app the user was in, replaced each time the
 * panel shows. Main keeps it too and sends it with the message unless the
 * user dropped it.
 */
let shownId = 0;
const context = ref<PineAttachment[]>([]);
const missingPermissions = ref<QuickComposerPermission[]>([]);

function dismissContext(): void {
  context.value = [];
}

function handleContext(captured: QuickComposerContext): void {
  if (captured.shownId !== shownId || isSending.value) return;
  context.value = captured.attachments;
  missingPermissions.value = captured.missing;
}

function requestPermission(): void {
  const [permission] = missingPermissions.value.includes("screen")
    ? (["screen"] as const)
    : missingPermissions.value;
  if (permission)
    void window.pine
      .requestQuickComposerPermission(permission)
      .catch(() => undefined);
}

const permissionMessage = computed(() => {
  const missing = missingPermissions.value;
  if (missing.length > 1) return t("quickComposer.permission.both");
  if (missing[0] === "screen") return t("quickComposer.permission.screen");
  if (missing[0] === "accessibility")
    return t("quickComposer.permission.accessibility");
  return "";
});

/** A hidden panel drops its context at once rather than closing it. */
const contextAnimates = ref(true);

/**
 * Resets for the next showing while hidden, and measures the card again, so
 * the glass already has its size when the panel next appears.
 */
async function handleHidden(): Promise<void> {
  contextAnimates.value = false;
  dismissContext();
  missingPermissions.value = [];
  // The card shrinks back from the window the last message opened into.
  for (const animation of cardElement.value?.getAnimations() ?? [])
    animation.cancel();
  isExpanding.value = false;
  // A sent message starts over; a dismissed one is kept for next time.
  if (isSending.value) {
    isSending.value = false;
    draft.value = "";
    attachments.value = [];
    projectId.value = TEMPORARY_WORKSPACE_PROJECT_ID;
  }
  await nextTick();
  contextAnimates.value = true;
  measureCard();
}

function handleShown(shown: QuickComposerShown): void {
  shownId = shown.id;
  playEntrance();
  passThrough = true;
  void projectStore.loadProjects().catch(() => undefined);
  focusComposer();
}

let stopShown: (() => void) | undefined;
let stopContext: (() => void) | undefined;
let stopHidden: (() => void) | undefined;
onMounted(() => {
  // Clear the page so only the composer shows over other apps.
  document.documentElement.dataset.quickComposer = "";
  stopShown = window.pine.onQuickComposerShown(handleShown);
  stopContext = window.pine.onQuickComposerContext(handleContext);
  stopHidden = window.pine.onQuickComposerHidden(() => void handleHidden());
  void projectStore.loadProjects().catch(() => undefined);
  focusComposer();
});
onBeforeUnmount(() => {
  stopShown?.();
  stopContext?.();
  stopHidden?.();
  delete document.documentElement.dataset.quickComposer;
});

async function submit(message: string): Promise<void> {
  const element: unknown = composer.value?.$el;
  if (isSending.value || !(element instanceof HTMLElement)) return;
  const rect = element.getBoundingClientRect();
  const sent = attachments.value;
  isSending.value = true;
  // The composer clears its attachments once it has emitted the message.
  await nextTick();
  attachments.value = sent;
  try {
    const windowRadius = await window.pine.submitQuickComposer({
      message,
      approvalMode: approvalMode.value,
      projectId: projectId.value,
      withContext: context.value.length > 0,
      composerRect: {
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      },
    });
    // The window that holds the project took the message; the panel only
    // fades out.
    if (windowRadius !== null) openIntoWindow(windowRadius);
  } catch {
    isSending.value = false;
    toast.error(t("errors.sessionPrompt.title"), {
      description: t("errors.sessionPrompt.description"),
    });
  }
}

/**
 * Grows the card to the whole panel, the area the new window takes, and to
 * its roundness, while main grows the glass the same way; the window fades
 * in over them afterwards.
 */
function openIntoWindow(windowRadius: number | undefined): void {
  isExpanding.value = true;
  const element = cardElement.value;
  const area = backdrop.value;
  if (!element || !area || !card.value) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const { x, y, width, height } = card.value;
  element.animate(
    [
      {
        left: `${x}px`,
        top: `${y}px`,
        width: `${width}px`,
        height: `${height}px`,
        borderRadius: `${QUICK_COMPOSER_GLASS_RADIUS}px`,
      },
      {
        left: "0px",
        top: "0px",
        width: `${area.clientWidth}px`,
        height: `${area.clientHeight}px`,
        borderRadius: `${windowRadius ?? QUICK_COMPOSER_GLASS_RADIUS}px`,
      },
    ],
    {
      duration: QUICK_COMPOSER_EXPAND_MS,
      easing: EASE_OUT_EXPO,
      fill: "forwards",
    },
  );
}

/**
 * The card behind the composer's controls. Main puts Liquid Glass under it;
 * without glass the card draws an opaque background instead, so the
 * controls stay readable over any app.
 */
const card = ref<QuickComposerRect | null>(null);
const hasGlass = ref(false);
const composerElement = computed(() => {
  const element: unknown = composer.value?.$el;
  return element instanceof HTMLElement ? element : undefined;
});
const cardStyle = computed(() =>
  card.value
    ? {
        left: `${card.value.x}px`,
        top: `${card.value.y}px`,
        width: `${card.value.width}px`,
        height: `${card.value.height}px`,
        borderRadius: `${QUICK_COMPOSER_GLASS_RADIUS}px`,
      }
    : { display: "none" },
);

function measureCard(): void {
  const element = composerElement.value;
  if (!element) return;
  let top = Infinity;
  let left = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;
  for (const child of element.children) {
    const rect = child.getBoundingClientRect();
    if (!rect.width || !rect.height) continue;
    top = Math.min(top, rect.top);
    left = Math.min(left, rect.left);
    right = Math.max(right, rect.right);
    bottom = Math.max(bottom, rect.bottom);
  }
  if (!Number.isFinite(top)) return;
  const inset = QUICK_COMPOSER_GLASS_INSET;
  const next = {
    x: left - inset,
    y: top - inset,
    width: right - left + 2 * inset,
    height: bottom - top + 2 * inset,
  };
  const current = card.value;
  if (
    current &&
    current.x === next.x &&
    current.y === next.y &&
    current.width === next.width &&
    current.height === next.height
  )
    return;
  card.value = next;
  void window.pine
    .setQuickComposerGlass(next)
    .then((applied) => (hasGlass.value = applied))
    .catch(() => (hasGlass.value = false));
}
// The composer grows with its message and attachments.
useResizeObserver(composerElement, measureCard);

/** Hit-testing leaves only what the page draws clickable. */
let passThrough = true;
function isEmptyArea(target: Element | null): boolean {
  return (
    !target ||
    target === document.documentElement ||
    target === document.body ||
    target.id === "app" ||
    target.id === "pine-root" ||
    target.hasAttribute("data-quick-composer-backdrop")
  );
}
useEventListener(window, "mousemove", (event: MouseEvent) => {
  const next = isEmptyArea(
    document.elementFromPoint(event.clientX, event.clientY),
  );
  if (next === passThrough) return;
  passThrough = next;
  void window.pine.setQuickComposerPassThrough(next);
});

// Escape dismisses the panel unless a menu or dialog takes it first.
useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if (
    event.key !== "Escape" ||
    event.defaultPrevented ||
    event.isComposing ||
    document.querySelector("[data-dismissable-layer]")
  )
    return;
  event.preventDefault();
  void window.pine.hideQuickComposer();
});
</script>

<template>
  <!-- In project windows the sidebar provides this; match its delay. -->
  <TooltipProvider :delay-duration="0">
    <div
      ref="backdrop"
      data-quick-composer-backdrop
      class="relative isolate flex h-full flex-col justify-end"
      :inert="isSending"
    >
      <!-- Over the glass the card is nearly opaque, letting only a little
           colour through; without glass it is opaque. A backdrop blur in
           this transparent window would blur to black. -->
      <div
        ref="card"
        data-slot="quick-composer-card"
        :class="[
          'absolute -z-10',
          hasGlass ? 'bg-background/50' : 'border bg-background shadow-xl',
        ]"
        :style="cardStyle"
      />
      <!-- Over any app, so it carries its own opaque background. -->
      <div
        v-if="permissionMessage && !isSending"
        data-slot="quick-composer-permission"
        class="mb-2 self-center flex max-w-full items-center gap-2 rounded-full border bg-background py-1 pr-1 pl-3 text-xs text-muted-foreground shadow-md"
      >
        <span class="truncate">{{ permissionMessage }}</span>
        <Button size="xs" variant="secondary" @click="requestPermission">
          {{ t("quickComposer.openSettings") }}
        </Button>
      </div>
      <ProjectSessionComposer
        ref="composer"
        v-model="draft"
        v-model:attachments="attachments"
        v-model:approvalMode="approvalMode"
        is-active
        :project-id="projectId"
        :context="context"
        :context-animates="contextAnimates"
        :edge-inset="!isExpanding"
        @dismiss-context="dismissContext"
        @select-project="projectId = $event"
        @submit="submit"
      />
    </div>
  </TooltipProvider>
</template>

<style scoped>
/* The composer always has focus here, so its focus border and ring would
   outline the card's edge the whole time. */
[data-quick-composer-backdrop] :deep([data-slot="input-group"]) {
  border-color: transparent;
  box-shadow: none;
}
</style>
