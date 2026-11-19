<script setup lang="ts">
import { SquareArrowOutUpRight, XIcon } from "@lucide/vue";
import { computed, type Component } from "vue";
import { useI18n } from "vue-i18n";
import ProjectBackgroundTaskPanel from "@/components/project/ProjectBackgroundTaskPanel.vue";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  FILE_COMMENTS_PANEL,
  FILE_DETAILS_PANEL,
  LIVE_CONTEXT_PANEL,
  type AgentWorkbenchPanel,
  type WorkbenchPanel,
  type WorkbenchPosition,
} from "@/shared/workbench";
import WorkbenchCardAddMenu from "./WorkbenchCardAddMenu.vue";
import WorkbenchCardPanelMenu from "./WorkbenchCardPanelMenu.vue";
import WorkbenchFileCard from "./WorkbenchFileCard.vue";
import WorkbenchLiveContextPanel from "./WorkbenchLiveContextPanel.vue";
import WorkbenchSideChatCard from "./WorkbenchSideChatCard.vue";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import { fileName, fileTargetPath } from "@/lib/filePreviewTarget";
import { cn } from "@/lib/utils";
import { artifactKey } from "@/shared/artifacts";
import { useAttentionFlashStore } from "@/stores/attentionFlash";
import { useBackgroundTasksStore } from "@/stores/backgroundTasks";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";
import { useWorkbenchStore } from "@/stores/workbench";
import WorkbenchArtifactsPanel from "./WorkbenchArtifactsPanel.vue";
import WorkbenchFilesPanel from "./WorkbenchFilesPanel.vue";
import WorkbenchPreviewPanel from "./WorkbenchPreviewPanel.vue";
import ArtifactVersionMenu from "@/components/artifact-versions/ArtifactVersionMenu.vue";
import { useWorkbenchArtifactVersions } from "@/composables/useWorkbenchArtifactVersions";

const props = defineProps<{
  panel: WorkbenchPanel;
  position: WorkbenchPosition;
}>();
const { t } = useI18n();
const workbench = useWorkbenchStore();
const session = useSessionStore();
const backgroundTasks = useBackgroundTasksStore();
const attentionFlash = useAttentionFlashStore();
/** The panel's content changed in a way it cannot point at itself. */
const changeFlashId = computed(() => `workbench-card:${props.position}`);

const HIGHLIGHT_CLASS =
  "attention-flash [--attention-flash-box-shadow:none] [--attention-flash-overlay-z-index:50] before:pointer-events-none before:absolute before:inset-0 before:z-50 before:rounded-[inherit] before:outline-1 before:-outline-offset-1 before:outline-(--attention-flash-color) before:content-['']";

const PANEL_COMPONENTS: Record<
  AgentWorkbenchPanel | typeof LIVE_CONTEXT_PANEL,
  Component
> = {
  artifacts: WorkbenchArtifactsPanel,
  tasks: ProjectBackgroundTaskPanel,
  preview: WorkbenchPreviewPanel,
  files: WorkbenchFilesPanel,
  [LIVE_CONTEXT_PANEL]: WorkbenchLiveContextPanel,
};

const contentTabs = useContentTabsStore();
const projectStore = useProjectStore();
const navigation = useContentTabNavigation();
const previewTarget = computed(() => workbench.activeLayout.preview?.target);
const { key: versionViewKey } = useWorkbenchArtifactVersions();

/** The full previewer, with zoom, selection, and file actions. */
function openPreviewInTab(): void {
  const preview = workbench.activeLayout.preview;
  if (!preview) return;
  const sessionId = session.activeSession?.id;
  const projectId =
    (sessionId ? session.projectOf(sessionId) : undefined) ??
    projectStore.currentProjectId;
  navigation.activate(
    contentTabs.presentFile(
      preview.target,
      projectId,
      preview.toolCallId
        ? artifactKey(preview.toolCallId, preview.artifactPath)
        : undefined,
      preview.reveal,
      sessionId && preview.artifactPath
        ? { sessionId, path: preview.artifactPath }
        : undefined,
    ).id,
  );
  // The file now lives in its tab; the card goes back to waiting for one.
  workbench.clearPreview();
}

const summary = computed(() => {
  if (props.panel === "preview" && previewTarget.value)
    return fileName(fileTargetPath(previewTarget.value));
  if (props.panel === "tasks" && backgroundTasks.runningCount > 0)
    return t("project.backgroundTasks.running", {
      count: backgroundTasks.runningCount,
    });
  return "";
});
</script>

<template>
  <WorkbenchSideChatCard v-if="panel === 'side-chat'" :position="position" />
  <WorkbenchFileCard
    v-else-if="panel === FILE_DETAILS_PANEL || panel === FILE_COMMENTS_PANEL"
    :panel="panel"
    :position="position"
  />
  <Card
    v-else
    size="sm"
    data-testid="workbench-card"
    :data-panel="panel"
    :data-position="position"
    :data-highlighted="workbench.isHighlighted(panel) || undefined"
    :class="
      cn(
        // `isolate` keeps previewers' own z-indexes inside the card, so the
        // overlays below can sit above every previewer.
        'isolate h-full min-h-0 gap-0 rounded-(--workbench-radius) py-0 shadow-none ring-0',
        // The agent pointed the user here: the same pulse as a presented tab.
        // The splitter clips anything outside the card, so the border is an
        // inset ring instead of the pulse's outer shadow. It is drawn by an
        // overlay above the content: an outline on the card itself is painted
        // under positioned previewer content (canvases, iframes, toolbars).
        workbench.isHighlighted(panel) && HIGHLIGHT_CLASS,
        // A one-shot info pulse, as on a content tab whose file changed.
        attentionFlash.isFlashingOnce(changeFlashId) &&
          'attention-flash attention-flash-once [--attention-flash-overlay-z-index:50]',
      )
    "
    @pointerenter="workbench.acknowledge(panel)"
    @focusin="workbench.acknowledge(panel)"
  >
    <!-- Header controls sit at the card's inset on every side, so their
         pills stay concentric with its corners. -->
    <CardHeader class="flex shrink-0 items-center gap-1 p-(--workbench-inset)">
      <WorkbenchCardPanelMenu :panel="panel" :position="position" />
      <span
        class="text-muted-foreground ml-auto min-w-0 truncate px-1 text-xs tabular-nums"
        :title="summary || undefined"
      >
        {{ summary }}
      </span>
      <div class="flex shrink-0 items-center">
        <ArtifactVersionMenu
          v-if="panel === 'preview' && versionViewKey"
          :view-key="versionViewKey"
        />
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
        <WorkbenchCardAddMenu :panel="panel" :position="position" />
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
        <!-- Live context scrolls its transcript itself, so its controls
             stay put under it instead of riding the card's scroll and
             elastic overscroll. -->
        <div
          :key="panel"
          class="absolute inset-0"
          :class="
            panel === LIVE_CONTEXT_PANEL
              ? 'flex flex-col overflow-hidden'
              : 'scroll-fade-y no-scrollbar overflow-y-auto'
          "
        >
          <component
            :is="
              PANEL_COMPONENTS[
                panel as AgentWorkbenchPanel | typeof LIVE_CONTEXT_PANEL
              ]
            "
            @content-changed="attentionFlash.flashOnce(changeFlashId)"
          />
        </div>
      </Transition>
    </CardContent>
  </Card>
</template>
