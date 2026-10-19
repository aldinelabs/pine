<script setup lang="ts">
import { EyeIcon, FileWarning } from "@lucide/vue";
import { computed, onBeforeUnmount, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { resolvePreviewRenderer } from "@/components/project/file-preview/previewRenderer";
import { previewRenderers } from "@/components/project/file-preview/previewRenderers";
import { fileName as baseName, fileTargetPath } from "@/lib/filePreviewTarget";
import type {
  FilePreviewChangedEvent,
  FilePreviewTarget,
  ProjectFilePreview,
} from "@/shared/projectFiles";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useProjectStore } from "@/stores/project";
import { useSessionStore } from "@/stores/session";
import { useWorkbenchStore } from "@/stores/workbench";

/**
 * A compact variant of the file preview: the rendered view at its natural
 * size, without zoom, selection, or file actions. The card's "Open in tab"
 * switches to the full previewer.
 */
const { t } = useI18n();
const workbench = useWorkbenchStore();
const contentTabs = useContentTabsStore();
const sessionStore = useSessionStore();
const projectStore = useProjectStore();

const current = computed(() => workbench.activeLayout.preview);
/**
 * A plain copy of the stored target: the store's reactive proxy cannot cross
 * Electron's IPC, which structured-clones every argument.
 */
const target = computed<FilePreviewTarget | null>(() => {
  const stored = current.value?.target;
  if (!stored) return null;
  return stored.source === "project"
    ? {
        source: "project",
        projectId: stored.projectId,
        folderId: stored.folderId,
        relativePath: stored.relativePath,
      }
    : { source: "presented", path: stored.path };
});
const filePath = computed(() =>
  target.value ? fileTargetPath(target.value) : "",
);
const fileName = computed(() => baseName(filePath.value));
const previewKey = computed(() => JSON.stringify(target.value));
const preview = ref<ProjectFilePreview>();
const failed = ref(false);
const revision = ref(0);
const renderer = computed(() => {
  const value = preview.value;
  return value && value.kind !== "unsupported"
    ? resolvePreviewRenderer(previewRenderers, value, filePath.value)
    : undefined;
});

function projectIdOfSession(): string {
  const sessionId = sessionStore.activeSession?.id;
  return (
    (sessionId ? sessionStore.projectOf(sessionId) : undefined) ??
    projectStore.currentProjectId
  );
}

function read(value: FilePreviewTarget): Promise<ProjectFilePreview> {
  return value.source === "project"
    ? window.pine.readProjectFilePreview({
        projectId: value.projectId,
        folderId: value.folderId,
        relativePath: value.relativePath,
      })
    : window.pine.readPresentedFilePreview({ path: value.path });
}

/**
 * A presented file's read grant lasts for the window's lifetime only, so a
 * preview restored after a restart resolves its tool call again.
 */
async function regrant(): Promise<boolean> {
  const toolCallId = current.value?.toolCallId;
  const sessionId = sessionStore.activeSession?.id;
  if (target.value?.source !== "presented" || !toolCallId || !sessionId)
    return false;
  const next = await window.pine
    .reopenPresentedToolFile({
      projectId: projectIdOfSession(),
      sessionId,
      toolCallId,
    })
    .catch(() => null);
  if (!next) return false;
  contentTabs.rememberPresentedTarget(toolCallId, next);
  if (JSON.stringify(next) === previewKey.value) return true;
  workbench.preview({ target: next, toolCallId });
  return false;
}

const watchId = useId();
const unsubscribe = window.pine.onFilePreviewChanged?.(
  (event: FilePreviewChangedEvent) => {
    if (event.watchId === watchId) revision.value += 1;
  },
);
onBeforeUnmount(() => {
  unsubscribe?.();
  void window.pine
    .setWatchedFilePreview?.({ watchId, target: null })
    .catch(() => {});
});

watch(
  () => [previewKey.value, revision.value] as const,
  async ([key], previous, onCleanup) => {
    let active = true;
    onCleanup(() => {
      active = false;
    });
    const value = target.value;
    if (key !== previous?.[0]) preview.value = undefined;
    failed.value = false;
    if (!value) return;
    // Watching for changes is best effort; it must never block the read.
    if (key !== previous?.[0]) {
      try {
        void window.pine
          .setWatchedFilePreview?.({ watchId, target: value })
          .catch(() => {});
      } catch {
        // A file that cannot be watched still previews once.
      }
    }
    try {
      const result = await read(value).catch(async (error: unknown) => {
        if (await regrant()) return read(value);
        throw error;
      });
      if (active) preview.value = result;
    } catch {
      if (active) failed.value = true;
    }
  },
  { immediate: true },
);
</script>

<template>
  <div data-testid="workbench-preview" class="flex h-full min-h-0 flex-col">
    <Empty v-if="!target" class="flex-1 border-0">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <EyeIcon aria-hidden="true" />
        </EmptyMedia>
        <EmptyDescription>
          {{ t("project.workbench.preview.empty") }}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
    <template v-else>
      <Empty
        v-if="failed || preview?.kind === 'unsupported'"
        class="flex-1 border-0"
      >
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <FileWarning aria-hidden="true" />
          </EmptyMedia>
          <EmptyDescription>
            {{
              failed
                ? t("project.workbench.preview.failed")
                : t("project.workbench.preview.unsupported")
            }}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
      <div v-else-if="!preview" class="flex flex-col gap-2 p-3">
        <Skeleton class="h-4 w-3/4" />
        <Skeleton class="h-4 w-1/2" />
        <Skeleton class="h-4 w-2/3" />
      </div>
      <component
        :is="renderer.component"
        v-else-if="renderer"
        :key="`${previewKey}:${renderer.id}`"
        class="min-h-0 flex-1"
        :preview="preview"
        :file-name="fileName"
        :file-path="filePath"
        :active="true"
        mode="rendered"
        :zoom="100"
        :render-zoom="100"
        :inverted="false"
        :selection-label="t('project.preview.selectedContent')"
        @failed="failed = true"
      />
    </template>
  </div>
</template>
