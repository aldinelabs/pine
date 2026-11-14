<script setup lang="ts">
import SwitchComputerButton from "@/components/window/SwitchComputerButton.vue";
import {
  ChevronDownIcon,
  MessageSquareTextIcon,
  PlusIcon,
  WorkflowIcon,
  XIcon,
} from "@lucide/vue";
import { storeToRefs } from "pinia";
import type { ComponentPublicInstance } from "vue";
import {
  computed,
  inject,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import { useResizeObserver } from "@vueuse/core";
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
import { handleError } from "@/app/errors/errorHandler";
import { PINE_LOGO_PATH, PINE_LOGO_VIEW_BOX } from "@/components/pine";
import aldineOnLight from "@/assets/aldine/aldine-horizontal-on-light.svg";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  FlickeringGrid,
  type FlickeringGridShape,
} from "@/components/ui/flickering-grid";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";
import { WINDOW_TAB_CLOSE_HANDLER_KEY } from "@/composables/useWindowTabShortcuts";
import {
  dragContainsAttachments,
  useAttachmentDrop,
} from "@/composables/useAttachmentDrop";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { cn } from "@/lib/utils";
import { fileIcon } from "@/lib/fileIcon";
import { fileTargetPath } from "@/lib/filePreviewTarget";
import {
  CONTENT_TAB_DRAG_TYPE,
  writeContentTabDrag,
} from "@/lib/contentTabDrag";
import { useAppearanceStore } from "@/stores/appearance";
import { useAttentionFlashStore } from "@/stores/attentionFlash";
import { useWorkbenchStore } from "@/stores/workbench";
import type { ProjectContentTab } from "@/stores/contentTabs";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useSessionStore } from "@/stores/session";
import { onSessionEvent } from "@/client/sessionEvents";
import { useProjectStore } from "@/stores/project";
import { useQuickComposerHandoffStore } from "@/stores/quickComposerHandoff";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "vue-sonner";
import ProjectSessionView from "./ProjectSessionView.vue";
import ProjectFilePreview from "./ProjectFilePreview.vue";
import ProjectTabsOverflowMenu from "./ProjectTabsOverflowMenu.vue";
import RetainedPanel from "./RetainedPanel.vue";
import WindowShortcutHints from "@/components/window/WindowShortcutHints.vue";

const { t } = useI18n();
const { state: sidebarState, isMobile } = useSidebar();
const contentTabsStore = useContentTabsStore();
const attentionFlash = useAttentionFlashStore();
const tabNavigation = useContentTabNavigation();
const sessionStore = useSessionStore();
const projectStore = useProjectStore();
const { activeTab: activeContentTab, activeTabId, tabs } = tabNavigation;
const { activeSession } = storeToRefs(sessionStore);
const windowCloseTabHandler = inject(WINDOW_TAB_CLOSE_HANDLER_KEY, null);

// A floating composer message for a project this window holds opens in a
// new draft here, which sends it once it shows.
const quickComposerHandoff = useQuickComposerHandoffStore();
let stopQuickComposerDelivery: (() => void) | undefined;
onMounted(() => {
  stopQuickComposerDelivery = window.pine.onQuickComposerDelivered?.(
    (handoff) => {
      void tabNavigation
        .openNewDraft(handoff.projectId)
        .then(() => quickComposerHandoff.deliver(handoff));
    },
  );
});
onBeforeUnmount(() => stopQuickComposerDelivery?.());

const sessionTabs = computed(() =>
  tabs.value.filter((tab) => tab.kind === "session"),
);
watch(
  () =>
    new Set(
      sessionTabs.value.flatMap((tab) =>
        tab.state === "bound" ? [tab.sessionId] : [],
      ),
    ),
  (openSessionIds, previousSessionIds) => {
    for (const sessionId of previousSessionIds) {
      if (!openSessionIds.has(sessionId))
        sessionStore.dropSessionCache(sessionId);
    }
  },
);
const shouldReserveWindowControlsSpace = computed(
  () => sidebarState.value === "collapsed" || isMobile.value,
);
// The open workbench sits under the trailing titlebar controls, so the tab
// actions can move flush to the content edge.
const workbench = useWorkbenchStore();
const shouldReserveTrailingControlsSpace = computed(
  () => !workbench.displayedOpen || workbench.isClosing || isMobile.value,
);

const tabButtons = new Map<string, HTMLButtonElement>();
const tabStrip = useTemplateRef<HTMLDivElement>("tabStrip");
const tabList = useTemplateRef<HTMLDivElement>("tabList");
const tabItems = useTemplateRef<HTMLDivElement>("tabItems");
/** Ripples glow past white in dark mode; on a light page they darken in the
 * foreground colour instead, since light beyond white reads as white. */
const { colorScheme } = storeToRefs(useAppearanceStore());
const isDarkScheme = computed(() => colorScheme.value === "dark");
const emptyRegion = useTemplateRef<HTMLDivElement>("emptyRegion");
const emptyLogo = useTemplateRef<HTMLDivElement>("emptyLogo");
const emptyGrid =
  useTemplateRef<InstanceType<typeof FlickeringGrid>>("emptyGrid");

/** The empty page's logo is drawn by the dot grid itself; an invisible box in
 * the layout decides where. The region is the logo box's offset parent, so its
 * offsets are already in the grid's coordinates. */
const emptyLogoShape = ref<FlickeringGridShape>();
/** The empty page lets pointer events through to the root, so a press that
 * lands on the root itself is a press on the empty page. */
function rippleEmptyPage(event: PointerEvent) {
  if (event.target !== event.currentTarget || event.button !== 0) return;
  const region = emptyRegion.value?.getBoundingClientRect();
  if (!region) return;
  emptyGrid.value?.ripple(
    event.clientX - region.left,
    event.clientY - region.top,
  );
}

useResizeObserver([emptyRegion, emptyLogo], () => {
  const logo = emptyLogo.value;
  emptyLogoShape.value = logo
    ? {
        path: PINE_LOGO_PATH,
        viewBox: PINE_LOGO_VIEW_BOX,
        x: logo.offsetLeft,
        y: logo.offsetTop,
        width: logo.offsetWidth,
        height: logo.offsetHeight,
      }
    : undefined;
});
const tabListHasOverflow = ref<boolean | null>(null);
let closingTab = false;
let tabShiftAnimationScheduled = false;
let pendingTabPositions: Map<string, number> | null = null;
const tabShiftAnimations = new WeakMap<HTMLElement, Animation>();
const draggingTabId = ref<string | null>(null);
const dropPosition = ref<{ tabId: string; side: "before" | "after" } | null>(
  null,
);
/** The session tab that files or a session are being dragged over. */
const attachmentDropTabId = ref<string | null>(null);
const { attachDrop } = useAttachmentDrop();

function updateTabListOverflow(): void {
  const viewport = tabList.value;
  if (!viewport) return;
  tabListHasOverflow.value = viewport.scrollWidth > viewport.clientWidth;
}

/**
 * A mouse wheel only scrolls vertically, so turn it into horizontal motion.
 * Horizontal trackpad swipes already scroll the list and pass through.
 */
function scrollTabListWithWheel(event: WheelEvent): void {
  const viewport = tabList.value;
  if (!viewport || viewport.scrollWidth <= viewport.clientWidth) return;
  if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
  event.preventDefault();
  const delta =
    event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? event.deltaY * 16
      : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
        ? event.deltaY * viewport.clientWidth
        : event.deltaY;
  viewport.scrollLeft += delta;
}

function tabElementKey(element: HTMLElement): string {
  return element.dataset.tabId ?? `separator:${element.dataset.tabSeparatorId}`;
}

function captureTabPositions(): Map<string, number> {
  const positions = new Map<string, number>();
  for (const element of tabItems.value?.querySelectorAll<HTMLElement>(
    "[data-tab-id], [data-tab-separator-id]",
  ) ?? []) {
    positions.set(tabElementKey(element), element.getBoundingClientRect().left);
  }
  return positions;
}

function animateTabShifts(positions: Map<string, number>): void {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

  // Browser scroll clamping may shift the entire strip in the same frame as
  // removal. Animate each surviving item from its former screen position so
  // both that shift and ordinary gap filling keep their momentum.
  for (const element of tabItems.value?.querySelectorAll<HTMLElement>(
    "[data-tab-id], [data-tab-separator-id]",
  ) ?? []) {
    const before = positions.get(tabElementKey(element));
    if (before === undefined) continue;
    tabShiftAnimations.get(element)?.cancel();
    const delta = before - element.getBoundingClientRect().left;
    if (Math.abs(delta) < 0.5) continue;
    const animation = element.animate?.(
      [{ transform: `translateX(${delta}px)` }, { transform: "translateX(0)" }],
      { duration: 320, easing: "cubic-bezier(0.16, 1, 0.3, 1)" },
    );
    if (animation) tabShiftAnimations.set(element, animation);
  }
}

function closeTab(tabId: string): void {
  void tabNavigation.close(tabId);
}

function closeTabFromWindowShortcut(tabId: string): void {
  void closeTab(tabId);
}

onMounted(() => {
  if (windowCloseTabHandler) {
    windowCloseTabHandler.value = closeTabFromWindowShortcut;
  }
  updateTabListOverflow();
});
/*
 * A sidebar opening or closing moves the tab list's edge on its side. Keep
 * the tabs where they are on screen, so the edge that moved covers or shows
 * tabs on that side only: the left sidebar anchors the tabs to the right
 * edge, the right sidebar to the left one. Read in the observer callback,
 * after layout, so the measurement forces none.
 */
let tabListLeft: number | undefined;
function keepTabsInPlace(): void {
  const viewport = tabList.value;
  if (!viewport) {
    tabListLeft = undefined;
    return;
  }
  const left = viewport.getBoundingClientRect().left;
  const moved = tabListLeft === undefined ? 0 : left - tabListLeft;
  tabListLeft = left;
  if (Math.abs(moved) < 0.5 || viewport.scrollWidth <= viewport.clientWidth)
    return;
  viewport.scrollTo({ left: viewport.scrollLeft + moved, behavior: "instant" });
}

// The strip comes and goes with the phone layout, so observe whichever list
// is mounted.
useResizeObserver(tabList, () => {
  keepTabsInPlace();
  updateTabListOverflow();
});

onBeforeUnmount(() => {
  if (windowCloseTabHandler?.value === closeTabFromWindowShortcut) {
    windowCloseTabHandler.value = null;
  }
});

function startTabDrag(event: DragEvent, tab: ProjectContentTab): void {
  if (!event.dataTransfer) return;
  writeContentTabDrag(event.dataTransfer, tab);
  draggingTabId.value = tab.id;
}

function endTabDrag(): void {
  draggingTabId.value = null;
  dropPosition.value = null;
}

function leaveTabList(event: DragEvent): void {
  if (
    !(event.relatedTarget instanceof Node) ||
    !tabStrip.value?.contains(event.relatedTarget)
  ) {
    dropPosition.value = null;
    attachmentDropTabId.value = null;
  }
}

/** Files and sessions dropped on a session tab attach to its composer. */
function dragAttachmentsOverTab(event: DragEvent, tabId?: string): void {
  const tab = tabId ? tabs.value.find((item) => item.id === tabId) : undefined;
  if (tab?.kind !== "session" || !dragContainsAttachments(event)) {
    attachmentDropTabId.value = null;
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";
  attachmentDropTabId.value = tab.id;
}

function dropAttachmentsOnTab(event: DragEvent): void {
  const tabId = attachmentDropTabId.value;
  attachmentDropTabId.value = null;
  const tab = tabs.value.find((item) => item.id === tabId);
  if (tab?.kind !== "session" || !dragContainsAttachments(event)) return;
  event.preventDefault();
  event.stopPropagation();
  activateTab(tab.id);
  void attachDrop(event.dataTransfer, tab.id, tab.projectId);
}

function dragOverTab(event: DragEvent, tabId?: string): void {
  if (!draggingTabId.value) {
    dragAttachmentsOverTab(event, tabId);
    return;
  }
  if (!event.dataTransfer) return;
  event.preventDefault();
  event.stopPropagation();
  event.dataTransfer.dropEffect = "move";
  const bounds = (event.currentTarget as HTMLElement).getBoundingClientRect();
  const targetId = tabId ?? tabs.value.at(-1)?.id;
  if (targetId)
    dropPosition.value = {
      tabId: targetId,
      side:
        !tabId || event.clientX >= bounds.left + bounds.width / 2
          ? "after"
          : "before",
    };
  const viewport = tabList.value;
  if (viewport) {
    const rect = viewport.getBoundingClientRect();
    if (event.clientX < rect.left + 24) viewport.scrollLeft -= 20;
    else if (event.clientX > rect.right - 24) viewport.scrollLeft += 20;
  }
}

function dropTab(event: DragEvent): void {
  if (!draggingTabId.value) {
    dropAttachmentsOnTab(event);
    return;
  }
  const tabId = event.dataTransfer?.getData(CONTENT_TAB_DRAG_TYPE);
  if (!tabId || tabId !== draggingTabId.value || !dropPosition.value) return;
  event.preventDefault();
  event.stopPropagation();
  contentTabsStore.moveTab(
    tabId,
    dropPosition.value.tabId,
    dropPosition.value.side,
  );
  endTabDrag();
  void nextTick(() => revealTab(activeTabId.value));
}

/**
 * Scroll one tab fully into view without changing which tab is active. Called
 * for the active tab and for a tab the agent just presented, so a flash that
 * would otherwise happen off-screen behind the tab list's overflow is seen.
 */
function revealTab(tabId: string): void {
  const viewport = tabList.value;
  const button = tabButtons.get(tabId);
  if (!viewport || !button || viewport.clientWidth === 0) return;

  const viewportRect = viewport.getBoundingClientRect();
  const buttonRect = button.getBoundingClientRect();
  const left = viewportRect.left + viewport.clientLeft;
  const right = left + viewport.clientWidth;
  if (buttonRect.left >= left && buttonRect.right <= right) return;

  // Center clipped tabs so the edge fade does not obscure the label. Scroll
  // only this viewport; scrollIntoView can also move its ancestors.
  const target =
    viewport.scrollLeft +
    (buttonRect.left + buttonRect.right - left - right) / 2;
  viewport.scrollTo({
    left: Math.max(
      0,
      Math.min(target, viewport.scrollWidth - viewport.clientWidth),
    ),
    behavior: window.matchMedia?.("(prefers-reduced-motion: reduce)").matches
      ? "instant"
      : "smooth",
  });
}

watch(
  () => tabs.value.map((tab) => tab.id),
  (tabIds, previousTabIds) => {
    if (!previousTabIds.some((tabId) => !tabIds.includes(tabId))) return;

    // Sample before Vue patches the list so every tab-removal path gets the
    // same FLIP animation, including native window shortcuts such as Cmd+W.
    pendingTabPositions = captureTabPositions();
    closingTab = true;
    if (tabShiftAnimationScheduled) return;

    tabShiftAnimationScheduled = true;
    void nextTick(() => {
      tabShiftAnimationScheduled = false;
      const positions = pendingTabPositions;
      pendingTabPositions = null;
      if (positions) animateTabShifts(positions);
      closingTab = false;
    });
  },
  { flush: "sync" },
);

watch(
  [activeTabId, tabList, tabs],
  () => {
    if (!closingTab) revealTab(activeTabId.value);
    updateTabListOverflow();
  },
  { flush: "post" },
);

// A tab the agent opened behind the current one starts flashing; bring it
// into view so the flash is not hidden past the tab list's edge.
watch(
  () => tabs.value.filter((tab) => attentionFlash.isFlashing(tab.id)),
  (flashing, previous) => {
    const started = flashing.filter((tab) => !previous?.includes(tab));
    const newest = started.at(-1);
    if (newest && !closingTab) revealTab(newest.id);
  },
  { flush: "post" },
);

// Opening a flashing tab is the user's acknowledgement; hovering it counts
// too, and closing a tab drops its flash.
watch(activeTabId, (tabId) => attentionFlash.stop(tabId), { immediate: true });
watch(
  () => tabs.value.map((tab) => tab.id),
  (ids) => attentionFlash.retain(ids),
  { flush: "sync" },
);
onBeforeUnmount(() => attentionFlash.stopAll());

// A confirmed ui_session_teleport moves a session to another project;
// its tabs follow, which also switches the sidebars to the new project.
onMounted(() => {
  const stop = onSessionEvent((event) => {
    if (event.type === "session-teleported")
      contentTabsStore.moveSessionToProject(event.sessionId, event.projectId);
  });
  onBeforeUnmount(stop);
});

function getTabLabel(tab: ProjectContentTab): string {
  return "label" in tab && tab.label
    ? tab.label
    : t("project.contentTabs.newSession");
}

function isTabRunning(tab: ProjectContentTab): boolean {
  return (
    tab.kind === "session" &&
    tab.state === "bound" &&
    sessionStore.isSessionRunning(tab.sessionId)
  );
}

// A session that is working has become more than a glance.
watch(
  () => tabs.value.filter((tab) => isTabRunning(tab)).map((tab) => tab.id),
  (runningIds) => runningIds.forEach((id) => contentTabsStore.keepTab(id)),
  { immediate: true },
);

function tabIcon(tab: ProjectContentTab) {
  if (tab.kind !== "session") return fileIcon(fileTargetPath(tab));
  // An automation run keeps its icon until the user replies to it.
  return tab.state === "bound" && sessionStore.automationRunOf(tab.sessionId)
    ? WorkflowIcon
    : MessageSquareTextIcon;
}

function shouldShowSeparator(index: number): boolean {
  if (index === 0) return false;

  return (
    tabs.value[index - 1]?.id !== activeTabId.value &&
    tabs.value[index]?.id !== activeTabId.value
  );
}

function setTabButton(
  tabId: string,
  element: Element | ComponentPublicInstance | null,
): void {
  let button: HTMLButtonElement | null = null;
  if (element instanceof HTMLButtonElement) {
    button = element;
  } else if (
    element &&
    "$el" in element &&
    element.$el instanceof HTMLButtonElement
  ) {
    button = element.$el;
  }
  if (button) tabButtons.set(tabId, button);
  else tabButtons.delete(tabId);
}

/** Hidden tabs still ask for attention through the switcher. */
const hasBackgroundAttention = computed(() =>
  tabs.value.some(
    (tab) => tab.id !== activeTabId.value && attentionFlash.isFlashing(tab.id),
  ),
);

function activateTab(tabId: string): void {
  tabNavigation.activate(tabId);
}

function moveTabFocus(index: number, event: KeyboardEvent): void {
  let nextIndex: number | null = null;
  if (event.key === "ArrowLeft") nextIndex = index - 1;
  if (event.key === "ArrowRight") nextIndex = index + 1;
  if (event.key === "Home") nextIndex = 0;
  if (event.key === "End") nextIndex = tabs.value.length - 1;
  if (nextIndex === null) return;

  event.preventDefault();
  const normalizedIndex = (nextIndex + tabs.value.length) % tabs.value.length;
  const tab = tabs.value[normalizedIndex];
  tabNavigation.activate(tab.id);
  void nextTick(() => tabButtons.get(tab.id)?.focus({ preventScroll: true }));
}

/**
 * The active tab decides the window's project: switching tabs moves the
 * sidebars and accent colour to the tab's project, opening its runtime on
 * first use. Other projects stay open, so switching back costs nothing.
 */
let activationSequence = 0;
watch(
  () => {
    const tab = activeContentTab.value;
    return tab?.kind === "session" && tab.state === "bound"
      ? `${tab.id}:${tab.projectId}:${tab.sessionId}`
      : `${tab?.id}:${tab?.projectId}:${tab?.kind === "session" ? tab.state : "file"}`;
  },
  async () => {
    const tab = activeContentTab.value;
    if (!tab) {
      // With no tab left, the sidebars fall back to No Project.
      activationSequence += 1;
      projectStore.setCurrentProject(TEMPORARY_WORKSPACE_PROJECT_ID);
      void projectStore
        .ensureOpen(TEMPORARY_WORKSPACE_PROJECT_ID)
        .catch(() => undefined);
      return;
    }
    const sequence = ++activationSequence;
    projectStore.setCurrentProject(tab.projectId);

    if (tab.kind === "session" && tab.state === "draft") {
      sessionStore.startDraft();
    }
    try {
      const result = await projectStore.ensureOpen(tab.projectId);
      if (sequence !== activationSequence) return;
      if (!result.opened) {
        // Another window owns this project and main has focused it. A draft
        // that only defaulted there starts in No Project instead.
        if (tab.kind === "session" && tab.state === "draft") {
          contentTabsStore.setDraftProject(
            tab.id,
            TEMPORARY_WORKSPACE_PROJECT_ID,
          );
          return;
        }
        toast.info(t("projects.openElsewhere"));
        void tabNavigation.close(tab.id);
        return;
      }
    } catch (error) {
      if (sequence !== activationSequence) return;
      handleError(error, {
        id: `project.open.${tab.projectId}`,
        title: t("errors.projectOpen.title"),
        description: t("errors.projectOpen.description"),
      });
      return;
    }

    if (tab.kind !== "session" || tab.state !== "bound") return;
    if (activeSession.value?.id === tab.sessionId) return;
    void sessionStore.resume(tab.projectId, tab.sessionId).catch((error) => {
      handleError(error, {
        id: "sessions.tabs.resume",
        title: t("errors.sessionResume.title"),
        description: t("errors.sessionResume.description"),
      });
    });
  },
  { immediate: true },
);

watch(activeSession, (session) => {
  if (!session) return;
  contentTabsStore.updateSession(session);
});
</script>

<template>
  <div
    class="relative flex h-full min-h-0 flex-col bg-background"
    @pointerdown="rippleEmptyPage"
  >
    <div
      data-slot="project-content-tabs-titlebar"
      :class="
        cn(
          'window-drag pointer-events-auto relative z-30 flex h-[var(--window-titlebar-height)] shrink-0 items-center gap-2 pr-3 pl-3 transition-[padding] delay-(--window-resize-delay) duration-500 ease-out-expo',
          shouldReserveTrailingControlsSpace &&
            'pr-[calc(var(--window-titlebar-controls-width)+var(--window-titlebar-trailing-actions-width))]',
          shouldReserveWindowControlsSpace &&
            'pl-[calc(var(--window-titlebar-leading-offset)+var(--window-titlebar-leading-extra)+var(--window-titlebar-control-height)+0.75rem)]',
        )
      "
    >
      <!-- A phone has no room for a strip: the active tab's title opens a
           list of every tab instead. -->
      <div
        v-if="isMobile"
        data-slot="project-content-tab-switcher"
        class="window-no-drag pointer-events-auto flex min-w-0 flex-1 items-center gap-1"
      >
        <DropdownMenu v-if="activeContentTab">
          <DropdownMenuTrigger as-child>
            <Button
              data-slot="project-content-tab-switcher-trigger"
              variant="ghost"
              size="sm"
              class="min-w-0 shrink justify-start"
              :aria-label="t('project.contentTabs.switchTab')"
            >
              <component
                :is="tabIcon(activeContentTab)"
                data-icon="inline-start"
              />
              <span
                data-slot="session-title"
                :data-running="isTabRunning(activeContentTab) || undefined"
                :class="
                  cn('truncate', isTabRunning(activeContentTab) && 'shimmer')
                "
                >{{ getTabLabel(activeContentTab) }}</span
              >
              <span
                v-if="isTabRunning(activeContentTab)"
                aria-hidden="true"
                data-slot="session-running-dot"
                class="hidden size-1.5 shrink-0 rounded-full bg-primary motion-reduce:inline-block"
              />
              <span
                v-if="hasBackgroundAttention"
                aria-hidden="true"
                class="size-1.5 shrink-0 rounded-full bg-primary"
              />
              <ChevronDownIcon data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            class="w-72 max-w-[calc(100vw-2rem)]"
          >
            <DropdownMenuLabel>
              {{ t("project.contentTabs.tabListLabel") }}
            </DropdownMenuLabel>
            <DropdownMenuRadioGroup
              :model-value="activeTabId"
              @update:model-value="activateTab(String($event))"
            >
              <div
                v-for="tab in tabs"
                :key="tab.id"
                data-slot="project-content-tab-switcher-item"
                class="flex items-center gap-1"
              >
                <DropdownMenuRadioItem :value="tab.id" class="min-w-0 flex-1">
                  <component :is="tabIcon(tab)" aria-hidden="true" />
                  <span
                    :data-running="isTabRunning(tab) || undefined"
                    :class="cn('truncate', isTabRunning(tab) && 'shimmer')"
                    >{{ getTabLabel(tab) }}</span
                  >
                  <span
                    v-if="isTabRunning(tab)"
                    aria-hidden="true"
                    data-slot="session-running-dot"
                    class="hidden size-1.5 shrink-0 rounded-full bg-primary motion-reduce:inline-block"
                  />
                  <span
                    v-if="
                      tab.id !== activeTabId &&
                      attentionFlash.isFlashing(tab.id)
                    "
                    aria-hidden="true"
                    class="ml-auto size-1.5 shrink-0 rounded-full bg-primary"
                  />
                </DropdownMenuRadioItem>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  class="shrink-0"
                  :aria-label="
                    t('project.contentTabs.closeTab', {
                      name: getTabLabel(tab),
                    })
                  "
                  @click="closeTab(tab.id)"
                >
                  <XIcon />
                </Button>
              </div>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          class="shrink-0"
          variant="ghost"
          size="icon-sm"
          :aria-label="t('project.contentTabs.addTab')"
          @click="tabNavigation.openNewDraft()"
        >
          <PlusIcon />
        </Button>
      </div>

      <!-- The tab list shrinks to its tabs, so "+" trails the last tab and,
           once the tabs overflow, stays put at the strip's end. -->
      <div
        v-else
        ref="tabStrip"
        data-slot="project-content-tab-strip"
        :class="
          cn(
            'flex min-w-0 flex-1 items-center gap-1 self-stretch',
            draggingTabId ? 'window-no-drag' : 'window-drag',
          )
        "
        @dragover="dragOverTab($event)"
        @drop="dropTab"
        @dragleave="leaveTabList"
      >
        <div
          ref="tabList"
          data-slot="project-content-tab-list"
          role="tablist"
          :aria-label="t('project.contentTabs.tabListLabel')"
          @wheel="scrollTabListWithWheel"
          class="scroll-fade-x pointer-events-auto -mx-1 flex min-w-0 flex-initial items-center justify-start self-stretch overflow-x-auto no-scrollbar"
          :class="
            cn(
              tabListHasOverflow === false && 'scroll-fade-none',
              draggingTabId ? 'window-no-drag' : 'window-drag',
            )
          "
        >
          <!-- Drag regions swallow wheel events, so the gaps between tabs
               stay no-drag to keep the list scrollable across separators. -->
          <div
            ref="tabItems"
            data-slot="project-content-tab-items"
            class="window-no-drag flex min-w-max shrink-0 items-center gap-1 px-1 py-1"
          >
            <template v-for="(tab, index) in tabs" :key="tab.id">
              <Separator
                v-if="index > 0"
                :data-tab-separator-id="tab.id"
                orientation="vertical"
                :class="
                  cn(
                    'project-content-tab-separator window-no-drag h-7 self-center transition-opacity',
                    shouldShowSeparator(index) ? 'opacity-100' : 'opacity-0',
                  )
                "
              />

              <div
                data-slot="project-content-tab"
                :class="
                  cn(
                    'window-no-drag group/tab relative flex h-8 w-40 min-w-40 items-center rounded-2xl',
                    // Presented tabs keep a warning pulse until acknowledged;
                    // file changes use a one-shot info pulse.
                    attentionFlash.isFlashing(tab.id) && 'attention-flash',
                    attentionFlash.isFlashingOnce(tab.id) && [
                      'attention-flash',
                      'attention-flash-once',
                    ],
                  )
                "
                :data-tab-id="tab.id"
                :data-attachment-drop="
                  attachmentDropTabId === tab.id || undefined
                "
                :draggable="true"
                @dragstart="startTabDrag($event, tab)"
                @dragend="endTabDrag"
                @dragenter="dragOverTab($event, tab.id)"
                @dragover="dragOverTab($event, tab.id)"
                @drop="dropTab"
                @pointerenter="attentionFlash.stop(tab.id)"
              >
                <span
                  v-if="
                    dropPosition?.tabId === tab.id && draggingTabId !== tab.id
                  "
                  aria-hidden="true"
                  class="pointer-events-none absolute inset-y-1 w-0.5 rounded-full bg-primary"
                  :class="
                    dropPosition.side === 'before' ? '-left-1' : '-right-1'
                  "
                />
                <Button
                  :id="`project-content-tab-${tab.id}`"
                  :ref="(element) => setTabButton(tab.id, element)"
                  role="tab"
                  :aria-controls="`project-content-panel-${tab.id}`"
                  :aria-selected="activeTabId === tab.id"
                  :tabindex="activeTabId === tab.id ? 0 : -1"
                  :variant="activeTabId === tab.id ? 'secondary' : 'ghost'"
                  size="sm"
                  :class="
                    cn(
                      'h-8 w-full min-w-0 justify-start group-hover/tab:pr-10 group-has-[:focus-visible]/tab:pr-10',
                      attachmentDropTabId === tab.id &&
                        'ring-2 ring-primary ring-inset',
                    )
                  "
                  @click="activateTab(tab.id)"
                  @dblclick="contentTabsStore.keepTab(tab.id)"
                  @mousedown.middle.prevent
                  @auxclick.middle.prevent="closeTab(tab.id)"
                  @keydown="moveTabFocus(index, $event)"
                >
                  <component :is="tabIcon(tab)" data-icon="inline-start" />
                  <span
                    data-slot="session-title"
                    :data-running="isTabRunning(tab) || undefined"
                    :class="cn('truncate', isTabRunning(tab) && 'shimmer')"
                    >{{ getTabLabel(tab) }}</span
                  >
                  <span
                    v-if="isTabRunning(tab)"
                    aria-hidden="true"
                    data-slot="session-running-dot"
                    class="hidden size-1.5 shrink-0 rounded-full bg-primary motion-reduce:inline-block"
                  />
                </Button>

                <Button
                  class="pointer-events-none absolute inset-y-0 right-2 my-auto opacity-0 transition-opacity group-hover/tab:pointer-events-auto group-hover/tab:opacity-100 group-has-[:focus-visible]/tab:pointer-events-auto group-has-[:focus-visible]/tab:opacity-100"
                  variant="ghost"
                  size="icon-xs"
                  :aria-label="
                    t('project.contentTabs.closeTab', {
                      name: getTabLabel(tab),
                    })
                  "
                  @click.stop="closeTab(tab.id)"
                >
                  <XIcon />
                </Button>
              </div>
            </template>
          </div>
        </div>
        <Button
          v-if="tabs.length"
          data-slot="project-content-add-tab"
          class="window-no-drag pointer-events-auto shrink-0"
          variant="ghost"
          size="icon-sm"
          :aria-label="t('project.contentTabs.addTab')"
          @click="tabNavigation.openNewDraft()"
        >
          <PlusIcon />
        </Button>
        <div
          aria-hidden="true"
          data-slot="project-content-tab-drag-space"
          class="window-drag min-w-0 flex-1 self-stretch"
        />
      </div>

      <Button
        v-if="!tabs.length && !isMobile"
        class="window-no-drag pointer-events-auto"
        variant="ghost"
        size="icon-sm"
        :aria-label="t('project.contentTabs.addTab')"
        @click="tabNavigation.openNewDraft()"
      >
        <PlusIcon />
      </Button>

      <ProjectTabsOverflowMenu v-if="tabs.length" />
    </div>

    <div
      v-if="activeContentTab"
      class="relative min-h-0 flex-1 overflow-hidden"
    >
      <RetainedPanel
        v-for="tab in tabs"
        :id="`project-content-panel-${tab.id}`"
        :key="tab.id"
        role="tabpanel"
        :aria-labelledby="`project-content-tab-${tab.id}`"
        :active="activeTabId === tab.id"
      >
        <!-- A tab's views talk to its project's runtime, so they wait
             for the project to open in this window. -->
        <div
          v-if="!projectStore.isOpen(tab.projectId)"
          class="flex flex-1 items-center justify-center"
        >
          <Spinner class="text-muted-foreground" />
        </div>
        <ProjectSessionView
          v-else-if="tab.kind === 'session'"
          :tab-id="tab.id"
          :project-id="tab.projectId"
          :session-id="tab.state === 'bound' ? tab.sessionId : undefined"
        />
        <ProjectFilePreview
          v-else
          :file="tab"
          :active="activeTabId === tab.id"
        />
      </RetainedPanel>
    </div>
    <div
      v-else
      ref="emptyRegion"
      role="region"
      :aria-label="t('project.contentTabs.emptyTitle')"
      class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-16 overflow-hidden p-8"
    >
      <FlickeringGrid
        ref="emptyGrid"
        aria-hidden="true"
        class="absolute inset-0"
        :flicker-chance="0.1"
        :grid-gap="3"
        color="var(--primary)"
        :max-opacity="0.3"
        :square-size="3"
        :vignette="0.76"
        :ripple-color="isDarkScheme ? undefined : 'var(--foreground)'"
        :ripple-hdr-gain="isDarkScheme ? 8 : 1"
        :ripple-vignette-floor="0.15"
        :shape="emptyLogoShape"
      />
      <div
        ref="emptyLogo"
        aria-hidden="true"
        data-slot="empty-tabs-logo"
        class="size-64"
      />
      <SwitchComputerButton class="relative" />
      <!-- A mask tints the logo with the muted text colour in either scheme. -->
      <span
        data-slot="empty-tabs-brand"
        role="img"
        aria-label="Aldine"
        class="relative -mt-8 -mb-12 block h-6 w-[73px] bg-muted-foreground"
        :style="{
          maskImage: `url(${aldineOnLight})`,
          WebkitMaskImage: `url(${aldineOnLight})`,
          maskSize: 'contain',
          WebkitMaskSize: 'contain',
          maskRepeat: 'no-repeat',
          WebkitMaskRepeat: 'no-repeat',
          maskPosition: 'center',
          WebkitMaskPosition: 'center',
        }"
      />
      <WindowShortcutHints class="relative" />
    </div>
  </div>
</template>

<style scoped>
.project-content-tab-separator {
  -webkit-mask-image: linear-gradient(
    to bottom,
    transparent,
    black 18%,
    black 82%,
    transparent
  );
  mask-image: linear-gradient(
    to bottom,
    transparent,
    black 18%,
    black 82%,
    transparent
  );
}
</style>
