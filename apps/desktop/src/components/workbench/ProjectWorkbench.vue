<script setup lang="ts">
import { computed, nextTick, ref, useTemplateRef, watch } from "vue";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { Sidebar } from "@/components/ui/sidebar";
import type { WorkbenchPanel } from "@/shared/workbench";
import { useWorkbenchStore } from "@/stores/workbench";
import WorkbenchCard from "./WorkbenchCard.vue";

interface PanelHandle {
  collapse: () => void;
  resize: (size: number) => void;
}

/**
 * The column beside the conversation. Both cards always exist in the split
 * view; a missing second card is collapsed, so adding, removing, and resizing
 * cards animates instead of re-laying out the column.
 */
const workbench = useWorkbenchStore();
const layout = computed(() => workbench.activeLayout);
const bottomPanel = useTemplateRef<PanelHandle>("bottomPanel");
const isDragging = ref(false);
/** Keeps the bottom card's content while it collapses away. */
const renderedBottom = ref<WorkbenchPanel | null>(layout.value.bottom);

watch(
  () =>
    [
      workbench.arrangement,
      workbench.activeKey,
      layout.value.bottom,
      layout.value.split,
    ] as const,
  async () => {
    const { bottom, split } = layout.value;
    if (bottom) renderedBottom.value = bottom;
    await nextTick();
    if (!bottomPanel.value) return;
    if (bottom) bottomPanel.value.resize(100 - split);
    else bottomPanel.value.collapse();
  },
);

function handleLayout(sizes: number[]): void {
  const [top] = sizes;
  if (isDragging.value && layout.value.bottom && top !== undefined)
    workbench.setSplit(top);
}

function handleDragging(dragging: boolean): void {
  isDragging.value = dragging;
}

const panelClass = computed(() =>
  isDragging.value
    ? "min-h-0"
    : "min-h-0 transition-[flex-grow] duration-500 ease-out-expo",
);
</script>

<template>
  <!-- The column extends the main area: same background, no divider. -->
  <Sidebar
    side="right"
    collapsible="offcanvas"
    data-testid="project-workbench"
    data-workbench
    class="group-data-[side=right]:border-l-0 [&>[data-slot=sidebar-inner]]:bg-background"
  >
    <div
      aria-hidden="true"
      class="window-drag h-[var(--window-titlebar-height)] shrink-0"
    />
    <div class="flex min-h-0 flex-1 flex-col pr-3 pb-3">
      <ResizablePanelGroup direction="vertical" @layout="handleLayout">
        <ResizablePanel
          id="workbench-top"
          :order="1"
          :min-size="20"
          :default-size="layout.bottom ? layout.split : 100"
          :class="panelClass"
        >
          <WorkbenchCard v-if="layout.top" :panel="layout.top" position="top" />
        </ResizablePanel>
        <ResizableHandle
          v-show="layout.bottom"
          data-testid="workbench-divider"
          class="bg-transparent data-[orientation=vertical]:h-3"
          @dragging="handleDragging"
        />
        <ResizablePanel
          id="workbench-bottom"
          ref="bottomPanel"
          :order="2"
          collapsible
          :collapsed-size="0"
          :min-size="20"
          :default-size="layout.bottom ? 100 - layout.split : 0"
          :class="panelClass"
        >
          <WorkbenchCard
            v-if="renderedBottom"
            :panel="renderedBottom"
            position="bottom"
            :inert="!layout.bottom"
          />
        </ResizablePanel>
      </ResizablePanelGroup>
    </div>
  </Sidebar>
</template>
