<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  ref,
  useId,
  useTemplateRef,
  watch,
} from "vue";
import { useI18n } from "vue-i18n";
import {
  ExternalLink,
  FileQuestion,
  FileWarning,
  Plus,
  Send,
  SquareTerminal,
} from "@lucide/vue";
import { handleError } from "@/app/errors/errorHandler";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { useContentTabsStore } from "@/stores/contentTabs";
import { useAppearanceStore } from "@/stores/appearance";
import { useAttentionFlashStore } from "@/stores/attentionFlash";
import { useFileToSession } from "@/composables/useFileToSession";
import { Skeleton } from "@/components/ui/skeleton";
import {
  fileName as pathBaseName,
  fileTargetPath,
} from "@/lib/filePreviewTarget";
import type { AttachmentSelection } from "@/shared/attachments";
import type {
  ProjectFilePreview,
  FilePreviewTarget,
  FilePreviewChangedEvent,
} from "@/shared/projectFiles";
import type { FileContentTab } from "@/stores/contentTabs";
import { resolvePreviewRenderer } from "./file-preview/previewRenderer";
import type {
  PreviewRendererHandle,
  PreviewRendererMetadata,
} from "./file-preview/previewRenderer";
import { previewRenderers } from "./file-preview/previewRenderers";

const props = withDefaults(
  defineProps<{ file: FileContentTab; active?: boolean }>(),
  { active: true },
);
const { t, locale } = useI18n();
// Presented files live outside the project, so the project-entry actions
// (open with the default app, reveal, send to a session) are not available.
const projectTarget = computed(() =>
  props.file.source === "project" ? props.file : null,
);
const filePath = computed(() => fileTargetPath(props.file));
const preview = ref<ProjectFilePreview>();
const viewMode = ref<"code" | "rendered">("rendered");
const renderSwitchId = useId();
const invertSwitchId = useId();
const rendererInstance = useTemplateRef<PreviewRendererHandle>("renderer");
const renderer = computed(() => {
  const value = preview.value;
  return value && value.kind !== "unsupported"
    ? resolvePreviewRenderer(previewRenderers, value, filePath.value)
    : undefined;
});
const capabilities = computed(() => {
  const value = preview.value;
  if (!renderer.value || !value || value.kind === "unsupported")
    return { zoom: false, invert: false, renderToggle: false };
  return renderer.value.capabilities({
    preview: value,
    filePath: filePath.value,
    mode: viewMode.value,
  });
});
const rendered = computed(
  () => capabilities.value.renderToggle && viewMode.value === "rendered",
);
const selectedRange = ref<AttachmentSelection>();
const menuOpen = ref(false);
const menuSelection = ref<AttachmentSelection>();

function updateSelection(): void {
  if (menuOpen.value) return;
  if (rendererInstance.value?.readSelection)
    selectedRange.value = props.active
      ? rendererInstance.value.readSelection()
      : undefined;
}

function handleSelectionChange(
  selection: AttachmentSelection | undefined,
): void {
  if (!menuOpen.value)
    selectedRange.value = props.active ? selection : undefined;
}

function handleMetadataChange(metadata: PreviewRendererMetadata): void {
  contentMetadata.value = { ...contentMetadata.value, ...metadata };
}

function updateMenu(open: boolean): void {
  if (open) {
    updateSelection();
    menuSelection.value = selectedRange.value;
  }
  menuOpen.value = open;
  if (!open) updateSelection();
}

watch(viewMode, () => {
  selectedRange.value = undefined;
  menuSelection.value = undefined;
});
const tabsStore = useContentTabsStore();
const appearanceStore = useAppearanceStore();
const attentionFlash = useAttentionFlashStore();
const sessionTabs = computed(() =>
  tabsStore.tabs.filter((tab) => tab.kind === "session"),
);
const { isSending, sendFile, sendFileToNewSession } = useFileToSession();
const failed = ref(false);
const revision = ref(0);
const stale = ref(false);
const fileName = computed(() => pathBaseName(filePath.value));
const contentMetadata = ref<PreviewRendererMetadata>();
const previewInverted = ref(false);
const previewZoom = ref([100]);
const appliedZoom = ref(100);
const renderedZoom = ref(100);
const zoom = computed(() => previewZoom.value[0] ?? 100);
let zoomFrame: number | undefined;
let zoomCommitTimer: ReturnType<typeof setTimeout> | undefined;
let pendingZoom = 100;
const fileType = computed(() => {
  const name = fileName.value;
  const extension = name.includes(".") ? name.split(".").at(-1) : undefined;
  return (
    extension?.toUpperCase() ||
    t(`project.preview.${preview.value?.kind === "text" ? "text" : "file"}`)
  );
});
const fileSize = computed(() => {
  const size = preview.value?.size ?? 0;
  const unit =
    size >= 1024 ** 3 ? 3 : size >= 1024 ** 2 ? 2 : size >= 1024 ? 1 : 0;
  return `${new Intl.NumberFormat(locale.value, { maximumFractionDigits: unit ? 1 : 0 }).format(size / 1024 ** unit)} ${["B", "KB", "MB", "GB"][unit]}`;
});
const lineCount = computed(() =>
  preview.value?.kind === "text"
    ? preview.value.text.split(/\r\n|\r|\n/).length
    : 0,
);
const duration = computed(() => {
  const seconds = contentMetadata.value?.duration;
  if (seconds === undefined || !Number.isFinite(seconds)) return "";
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
});

function scheduleZoom(value: number): void {
  pendingZoom = value;
  if (zoomFrame !== undefined) return;
  zoomFrame = requestAnimationFrame(() => {
    appliedZoom.value = pendingZoom;
    zoomFrame = undefined;
  });
}

function commitZoom(value: number[]): void {
  if (zoomCommitTimer) clearTimeout(zoomCommitTimer);
  const committed = value[0] ?? 100;
  pendingZoom = committed;
  if (zoomFrame !== undefined) {
    cancelAnimationFrame(zoomFrame);
    zoomFrame = undefined;
  }
  appliedZoom.value = committed;
  renderedZoom.value = committed;
}

function handlePreviewWheel(event: WheelEvent): void {
  if (!capabilities.value.zoom || !(event.ctrlKey || event.metaKey)) return;
  event.preventDefault();
  const next = Math.max(50, Math.min(200, zoom.value - event.deltaY * 0.5));
  previewZoom.value = [Math.round(next)];
  scheduleZoom(Math.round(next));
  if (zoomCommitTimer) clearTimeout(zoomCommitTimer);
  zoomCommitTimer = setTimeout(() => commitZoom(previewZoom.value), 180);
}

async function openWithDefaultApplication(): Promise<void> {
  const target = projectTarget.value;
  if (!target) return;
  try {
    await window.pine.operateProjectFile({
      action: "open",
      target: {
        folderId: target.folderId,
        relativePath: target.relativePath,
      },
    });
  } catch (error) {
    handleError(error, {
      id: "project.preview.open-default",
      title: t("project.preview.openDefaultFailed"),
    });
  }
}

const watchId = useId();
const previewTarget = computed<FilePreviewTarget>(() => {
  const file = props.file;
  return file.source === "project"
    ? {
        source: "project",
        projectId: file.projectId,
        folderId: file.folderId,
        relativePath: file.relativePath,
      }
    : { source: "presented", path: file.path };
});
const previewKey = computed(() => JSON.stringify(previewTarget.value));
let watchReady: Promise<void> = Promise.resolve();

function handleFilePreviewChanged(event: FilePreviewChangedEvent): void {
  if (event.watchId !== watchId) return;
  attentionFlash.flashOnce(props.file.id);
  if (props.active) revision.value += 1;
  else stale.value = true;
}

const unsubscribeFileWatcher = window.pine.onFilePreviewChanged?.(
  handleFilePreviewChanged,
);
watch(
  previewKey,
  (_key, _previous, onCleanup) => {
    watchReady =
      window.pine
        .setWatchedFilePreview?.({
          watchId,
          target: previewTarget.value,
        })
        .catch((error: unknown) => {
          console.error("Failed to watch file preview.", error);
        }) ?? Promise.resolve();
    onCleanup(() => {
      void window.pine
        .setWatchedFilePreview?.({ watchId, target: null })
        .catch(() => {});
    });
  },
  { immediate: true },
);

watch(
  () => [previewKey.value, revision.value] as const,
  async ([key], previous, onCleanup) => {
    let active = true;
    onCleanup(() => {
      active = false;
    });
    const fileChanged = key !== previous?.[0];
    if (fileChanged) {
      preview.value = undefined;
      viewMode.value = "rendered";
      contentMetadata.value = undefined;
      previewInverted.value = false;
      previewZoom.value = [100];
      if (zoomCommitTimer) clearTimeout(zoomCommitTimer);
      appliedZoom.value = 100;
      renderedZoom.value = 100;
      pendingZoom = 100;
      stale.value = false;
    }
    selectedRange.value = undefined;
    menuSelection.value = undefined;
    failed.value = false;
    try {
      // Subscribe before the first read so a write during loading cannot fall
      // between the content snapshot and installation of the watcher.
      await watchReady;
      if (!active) return;
      const target = previewTarget.value;
      const result =
        target.source === "project"
          ? await window.pine.readProjectFilePreview({
              projectId: target.projectId,
              folderId: target.folderId,
              relativePath: target.relativePath,
            })
          : await window.pine.readPresentedFilePreview({ path: target.path });
      if (active) {
        if (!fileChanged && "url" in result) {
          const url = new URL(result.url);
          url.searchParams.set("revision", String(revision.value));
          result.url = url.href;
        }
        preview.value = result;
        if (fileChanged)
          previewInverted.value =
            capabilities.value.invert && appearanceStore.colorScheme === "dark";
      }
    } catch {
      if (active) failed.value = true;
    }
  },
  { immediate: true },
);

watch(
  () => props.active,
  (active) => {
    if (!active) selectedRange.value = undefined;
    else if (stale.value) {
      stale.value = false;
      revision.value += 1;
    }
  },
);

watch(
  () => appearanceStore.colorScheme,
  (colorScheme) => {
    if (capabilities.value.invert)
      previewInverted.value = colorScheme === "dark";
  },
);
watch(zoom, scheduleZoom);
onBeforeUnmount(() => {
  unsubscribeFileWatcher?.();
  if (zoomFrame !== undefined) cancelAnimationFrame(zoomFrame);
  if (zoomCommitTimer) clearTimeout(zoomCommitTimer);
});
</script>

<template>
  <section
    class="flex h-full min-h-0 flex-col"
    :aria-label="fileName"
    @wheel.capture="handlePreviewWheel"
  >
    <Empty v-if="failed" class="flex-1" role="alert">
      <EmptyHeader>
        <EmptyMedia variant="icon"><FileWarning /></EmptyMedia>
        <EmptyTitle>{{ t("project.preview.failedTitle") }}</EmptyTitle>
        <EmptyDescription>{{
          t("project.preview.failedDescription")
        }}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent
        ><Button variant="outline" @click="revision += 1">{{
          t("project.preview.retry")
        }}</Button></EmptyContent
      >
    </Empty>
    <div
      v-else-if="!preview"
      class="flex flex-1 flex-col gap-3 p-6"
      role="status"
      :aria-label="t('project.files.loading')"
    >
      <Skeleton class="h-4 w-3/4" /><Skeleton class="h-4 w-1/2" /><Skeleton
        class="h-4 w-2/3"
      />
    </div>
    <Empty
      v-else-if="preview.kind === 'unsupported' || !renderer"
      class="flex-1"
    >
      <EmptyHeader>
        <EmptyMedia variant="icon"><FileQuestion /></EmptyMedia>
        <EmptyTitle>{{ t("project.preview.unsupportedTitle") }}</EmptyTitle>
        <EmptyDescription>{{
          t(
            preview.kind === "unsupported" && preview.reason === "too-large"
              ? "project.preview.tooLarge"
              : "project.preview.unsupportedDescription",
          )
        }}</EmptyDescription>
      </EmptyHeader>
    </Empty>
    <component
      :is="renderer.component"
      v-else
      ref="renderer"
      :key="`${previewKey}:${renderer.id}`"
      class="min-h-0 flex-1"
      :preview="preview"
      :file-name="fileName"
      :file-path="filePath"
      :active="active"
      :mode="viewMode"
      :zoom="appliedZoom"
      :render-zoom="renderedZoom"
      :inverted="previewInverted"
      :selection-label="t('project.preview.selectedContent')"
      @failed="failed = true"
      @metadata-change="handleMetadataChange"
      @selection-change="handleSelectionChange"
      @zoom-wheel="handlePreviewWheel"
    />
    <footer
      class="mt-auto flex min-h-12 shrink-0 flex-wrap items-center gap-x-4 gap-y-1 pl-5 pr-2 py-2 text-sm text-muted-foreground"
      :title="filePath"
      :aria-label="t('project.preview.metadata')"
    >
      <template v-if="preview">
        <span>{{ fileType }}</span>
        <span>{{ fileSize }}</span>
        <template v-if="preview.kind === 'text'">
          <span>{{ preview.encoding }}</span>
          <span>{{ t("project.preview.lines", { count: lineCount }) }}</span>
        </template>
        <span
          v-if="
            contentMetadata?.width !== undefined &&
            contentMetadata.height !== undefined
          "
          >{{ contentMetadata.width }} × {{ contentMetadata.height }}</span
        >
        <span v-if="duration">{{ duration }}</span>
        <span v-if="contentMetadata?.pageCount">{{
          t("project.preview.pages", { count: contentMetadata.pageCount })
        }}</span>
      </template>
      <Skeleton v-else-if="!failed" class="h-3 w-40" />
      <div v-if="capabilities.zoom" class="flex items-center gap-2 pr-2">
        <Slider
          v-model="previewZoom"
          class="w-28"
          :min="50"
          :max="200"
          :step="10"
          :aria-label="t('project.preview.zoom')"
          :title="t('project.preview.zoomValue', { value: zoom })"
          @value-commit="commitZoom"
        />
        <span class="w-10 text-right tabular-nums">{{ zoom }}%</span>
      </div>
      <div v-if="capabilities.invert" class="flex items-center gap-2">
        <Switch
          :id="invertSwitchId"
          size="sm"
          :model-value="previewInverted"
          @update:model-value="previewInverted = $event"
        />
        <Label :for="invertSwitchId">{{
          t("project.preview.invertColors")
        }}</Label>
      </div>
      <div v-if="capabilities.renderToggle" class="flex items-center gap-2">
        <Switch
          :id="renderSwitchId"
          size="sm"
          :model-value="rendered"
          @update:model-value="viewMode = $event ? 'rendered' : 'code'"
        />
        <Label :for="renderSwitchId">{{ t("project.preview.rendered") }}</Label>
      </div>
      <div v-if="projectTarget" class="ml-auto flex items-center gap-3">
        <Button
          v-if="preview"
          data-action="open-default"
          variant="ghost"
          size="sm"
          @click="openWithDefaultApplication"
        >
          <ExternalLink data-icon="inline-start" />
          {{ t("project.preview.openDefault") }}
        </Button>
        <DropdownMenu :open="menuOpen" @update:open="updateMenu">
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              :disabled="isSending"
              @pointerdown.prevent="updateSelection"
            >
              <Send data-icon="inline-start" />{{
                t(
                  selectedRange
                    ? "project.preview.sendSelectionToTab"
                    : "project.preview.sendToTab",
                )
              }}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="end"
            class="w-64"
            @close-auto-focus.prevent
          >
            <DropdownMenuGroup>
              <DropdownMenuItem
                v-for="tab in sessionTabs"
                :key="tab.id"
                @select="sendFile(projectTarget, tab.id, menuSelection)"
              >
                <SquareTerminal />
                <span class="truncate">{{
                  "label" in tab && tab.label
                    ? tab.label
                    : t("project.contentTabs.newSession")
                }}</span>
              </DropdownMenuItem>
              <DropdownMenuItem v-if="!sessionTabs.length" disabled>{{
                t("project.preview.noSessionTabs")
              }}</DropdownMenuItem>
            </DropdownMenuGroup>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem
                data-action="new-session"
                @select="sendFileToNewSession(projectTarget, menuSelection)"
              >
                <Plus />{{ t("project.preview.newSession") }}
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </footer>
  </section>
</template>
