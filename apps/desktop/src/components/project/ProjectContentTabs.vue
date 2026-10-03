<script setup lang="ts">
import { MessageSquareTextIcon, PlusIcon, XIcon } from "@lucide/vue";
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
import { TEMPORARY_WORKSPACE_PROJECT_ID } from "@/shared/projects";
import { handleError } from "@/app/errors/errorHandler";
import { PineLogo } from "@/components/pine";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useSidebar } from "@/components/ui/sidebar";
import { WINDOW_TAB_CLOSE_HANDLER_KEY } from "@/composables/useWindowTabShortcuts";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { usePresentedFiles } from "@/composables/usePresentedFiles";
import { cn } from "@/lib/utils";
import { fileIcon } from "@/lib/fileIcon";
import { fileTargetPath } from "@/lib/filePreviewTarget";
import {
  CONTENT_TAB_DRAG_TYPE,
  writeContentTabDrag,
} from "@/lib/contentTabDrag";
import { useAttentionFlashStore } from "@/stores/attentionFlash";
import { useProjectRightSidebarStore } from "@/stores/projectRightSidebar";
import type { ProjectContentTab } from "@/stores/contentTabs";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useSessionStore } from "@/stores/session";
import { useProjectStore } from "@/stores/project";
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
// The open right sidebar sits under the trailing titlebar controls, so the
// tab actions can move flush to the content edge.
const rightSidebar = useProjectRightSidebarStore();
const shouldReserveTrailingControlsSpace = computed(
  () => !rightSidebar.open || rightSidebar.isClosing || isMobile.value,
);

const tabButtons = new Map<string, HTMLButtonElement>();
const tabStrip = useTemplateRef<HTMLDivElement>("tabStrip");
const tabList = useTemplateRef<HTMLDivElement>("tabList");
const tabItems = useTemplateRef<HTMLDivElement>("tabItems");
const tabListHasOverflow = ref<boolean | null>(null);
let tabListResizeObserver: ResizeObserver | null = null;
let closingTab = false;
let tabShiftAnimationScheduled = false;
let pendingTabPositions: Map<string, number> | null = null;
const tabShiftAnimations = new WeakMap<HTMLElement, Animation>();
const draggingTabId = ref<string | null>(null);
const dropPosition = ref<{ tabId: string; side: "before" | "after" } | null>(
  null,
);

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
  tabNavigation.close(tabId);
}

function closeTabFromWindowShortcut(tabId: string): void {
  void closeTab(tabId);
}

onMounted(() => {
  if (windowCloseTabHandler) {
    windowCloseTabHandler.value = closeTabFromWindowShortcut;
  }
  updateTabListOverflow();
  if (!tabList.value || typeof ResizeObserver === "undefined") return;

  tabListResizeObserver = new ResizeObserver(updateTabListOverflow);
  tabListResizeObserver.observe(tabList.value);
});

onBeforeUnmount(() => {
  if (windowCloseTabHandler?.value === closeTabFromWindowShortcut) {
    windowCloseTabHandler.value = null;
  }
  tabListResizeObserver?.disconnect();
  tabListResizeObserver = null;
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
  )
    dropPosition.value = null;
}

function dragOverTab(event: DragEvent, tabId?: string): void {
  if (!draggingTabId.value || !event.dataTransfer) return;
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

// Opening a flashing tab is the user's acknowledgement; hovering it counts
// too, and `usePresentedFiles` prunes the rest when a tab is closed.
watch(activeTabId, (tabId) => attentionFlash.stop(tabId), { immediate: true });

// A confirmed ui_teleport moves a session out of the temporary workspace;
// its tabs follow, which also switches the sidebars to the new project.
onMounted(() => {
  const stop = window.pine.onSessionEvent((event) => {
    if (event.type === "session-teleported")
      contentTabsStore.moveSessionToProject(event.sessionId, event.projectId);
  });
  onBeforeUnmount(stop);
});

usePresentedFiles({
  reveal: (tabId) => {
    // The tab may not be mounted yet when the presentation arrives.
    void nextTick(() => revealTab(tabId));
  },
  isActive: (tabId) => tabId === activeTabId.value,
});

function getTabLabel(tab: ProjectContentTab): string {
  return "label" in tab && tab.label
    ? tab.label
    : t("project.contentTabs.newSession");
}

function tabIcon(tab: ProjectContentTab) {
  return tab.kind === "session"
    ? MessageSquareTextIcon
    : fileIcon(fileTargetPath(tab));
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
        tabNavigation.close(tab.id);
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
  <div class="relative flex h-full min-h-0 flex-col bg-background">
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
      <!-- The tab list shrinks to its tabs, so "+" trails the last tab and,
           once the tabs overflow, stays put at the strip's end. -->
      <div
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
          class="scroll-fade-x pointer-events-auto flex min-w-0 flex-initial items-center justify-start self-stretch overflow-x-auto no-scrollbar"
          :class="
            cn(
              tabListHasOverflow === false && 'scroll-fade-none',
              draggingTabId ? 'window-no-drag' : 'window-drag',
            )
          "
        >
          <div
            ref="tabItems"
            data-slot="project-content-tab-items"
            class="window-drag flex min-w-max shrink-0 items-center gap-1 py-1"
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
                :draggable="true"
                @dragstart="startTabDrag($event, tab)"
                @dragend="endTabDrag"
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
                  class="h-8 w-full min-w-0 justify-start group-hover/tab:pr-10 group-has-[:focus-visible]/tab:pr-10"
                  @click="activateTab(tab.id)"
                  @keydown="moveTabFocus(index, $event)"
                >
                  <component :is="tabIcon(tab)" data-icon="inline-start" />
                  <span class="truncate">{{ getTabLabel(tab) }}</span>
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
          @click="tabNavigation.createSessionTab()"
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
        v-if="!tabs.length"
        class="window-no-drag pointer-events-auto"
        variant="ghost"
        size="icon-sm"
        :aria-label="t('project.contentTabs.addTab')"
        @click="tabNavigation.createSessionTab()"
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
      role="region"
      :aria-label="t('project.contentTabs.emptyTitle')"
      class="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-16 overflow-hidden p-8"
    >
      <PineLogo
        aria-hidden="true"
        class="pointer-events-none size-64 text-muted-foreground/10 select-none"
      />
      <WindowShortcutHints />
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
