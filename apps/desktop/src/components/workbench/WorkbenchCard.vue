<script setup lang="ts">
import {
  ChevronDownIcon,
  PlusIcon,
  SquareArrowOutUpRight,
  XIcon,
} from "@lucide/vue";
import { computed, type Component } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  WORKBENCH_PANELS,
  isWorkbenchPanel,
  type WorkbenchPanel,
  type WorkbenchPosition,
} from "@/shared/workbench";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { fileName, fileTargetPath } from "@/lib/filePreviewTarget";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";
import { useWorkbenchStore } from "@/stores/workbench";
import WorkbenchArtifactsPanel from "./WorkbenchArtifactsPanel.vue";
import WorkbenchPreviewPanel from "./WorkbenchPreviewPanel.vue";

const props = defineProps<{
  panel: WorkbenchPanel;
  position: WorkbenchPosition;
}>();
const { t } = useI18n();
const workbench = useWorkbenchStore();
const session = useSessionStore();

const PANEL_COMPONENTS: Record<WorkbenchPanel, Component> = {
  artifacts: WorkbenchArtifactsPanel,
  preview: WorkbenchPreviewPanel,
};

const selected = computed({
  get: () => props.panel,
  set: (panel: unknown) => {
    if (isWorkbenchPanel(panel)) workbench.showPanel(props.position, panel);
  },
});

/** A single card can take a second one below it. */
const addablePanels = computed(() =>
  props.position === "top" && !workbench.activeLayout.bottom
    ? WORKBENCH_PANELS.filter((panel) => panel !== props.panel)
    : [],
);

const contentTabs = useContentTabsStore();
const projectStore = useProjectStore();
const navigation = useContentTabNavigation();
const previewTarget = computed(() => workbench.activeLayout.preview?.target);

/** The full previewer, with zoom, selection, and file actions. */
function openPreviewInTab(): void {
  const preview = workbench.activeLayout.preview;
  if (!preview) return;
  const sessionId = session.activeSession?.id;
  const projectId =
    (sessionId ? session.projectOf(sessionId) : undefined) ??
    projectStore.currentProjectId;
  navigation.activate(
    contentTabs.presentFile(preview.target, projectId, preview.toolCallId).id,
  );
}

const summary = computed(() => {
  if (props.panel === "preview" && previewTarget.value)
    return fileName(fileTargetPath(previewTarget.value));
  return "";
});
</script>

<template>
  <Card
    size="sm"
    data-testid="workbench-card"
    :data-panel="panel"
    :data-position="position"
    class="h-full min-h-0 gap-0 rounded-(--workbench-radius) py-0 shadow-none ring-0"
  >
    <!-- Header controls sit at the card's inset on every side, so their
         pills stay concentric with its corners. -->
    <CardHeader class="flex shrink-0 items-center gap-1 p-(--workbench-inset)">
      <DropdownMenu>
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            class="shrink-0"
            data-testid="workbench-card-switch"
            :aria-label="t('project.workbench.switchPanel')"
          >
            {{ t(`project.workbench.panels.${panel}`) }}
            <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          <DropdownMenuRadioGroup v-model="selected">
            <DropdownMenuRadioItem
              v-for="option in WORKBENCH_PANELS"
              :key="option"
              :value="option"
            >
              {{ t(`project.workbench.panels.${option}`) }}
            </DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <span
        class="text-muted-foreground ml-auto min-w-0 truncate px-1 text-xs tabular-nums"
        :title="summary || undefined"
      >
        {{ summary }}
      </span>
      <div class="flex shrink-0 items-center">
        <Button
          v-if="panel === 'preview' && previewTarget"
          variant="ghost"
          size="icon"
          data-testid="workbench-preview-open-tab"
          :aria-label="t('project.workbench.preview.openInTab')"
          :title="t('project.workbench.preview.openInTab')"
          @click="openPreviewInTab"
        >
          <SquareArrowOutUpRight aria-hidden="true" />
        </Button>
        <DropdownMenu v-if="addablePanels.length">
          <DropdownMenuTrigger as-child>
            <Button
              variant="ghost"
              size="icon"
              data-testid="workbench-card-add"
              :aria-label="t('project.workbench.addCard')"
              :title="t('project.workbench.addCard')"
            >
              <PlusIcon aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              v-for="option in addablePanels"
              :key="option"
              @select="workbench.showPanel('bottom', option)"
            >
              {{ t(`project.workbench.panels.${option}`) }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <Button
          variant="ghost"
          size="icon"
          data-testid="workbench-card-close"
          :aria-label="t('project.workbench.closeCard')"
          :title="t('project.workbench.closeCard')"
          @click="workbench.closeCard(panel)"
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
    </CardHeader>
    <CardContent class="relative min-h-0 flex-1 overflow-hidden px-0">
      <Transition
        enter-active-class="transition-opacity duration-500 ease-out-expo"
        enter-from-class="opacity-0"
      >
        <div
          :key="panel"
          class="scroll-fade-y no-scrollbar absolute inset-0 overflow-y-auto"
        >
          <component :is="PANEL_COMPONENTS[panel]" />
        </div>
      </Transition>
    </CardContent>
  </Card>
</template>
