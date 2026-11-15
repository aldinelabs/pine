<script setup lang="ts">
import {
  ArrowLeftIcon,
  EyeIcon,
  GitCompareIcon,
  RotateCcwIcon,
} from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { handleError } from "@/app/errors/errorHandler";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/formatBytes";
import type {
  ArtifactVersion,
  ArtifactVersionDiff,
  ArtifactVersionHistory,
} from "@/shared/artifacts";
import type { FilePreviewTarget } from "@/shared/projectFiles";

const props = defineProps<{
  open: boolean;
  projectId: string;
  sessionId: string;
  /** The absolute path the submissions recorded. */
  path: string;
  /** The name the Artifacts list shows. */
  name: string;
}>();

const emit = defineEmits<{
  "update:open": [open: boolean];
  preview: [target: FilePreviewTarget];
  restored: [];
}>();

const { t, locale } = useI18n();

const history = ref<ArtifactVersionHistory>();
const loading = ref(false);
const busy = ref(false);
const comparing = ref<{
  version: ArtifactVersion;
  diff?: ArtifactVersionDiff;
}>();
const restoring = ref<ArtifactVersion>();

function target() {
  return {
    projectId: props.projectId,
    sessionId: props.sessionId,
    path: props.path,
  };
}

function request(version: ArtifactVersion) {
  return { ...target(), version: version.ref };
}

async function load(): Promise<void> {
  loading.value = true;
  try {
    history.value = await window.pine.artifactVersions(target());
  } catch (error) {
    handleError(error, {
      id: "project.workbench.artifacts.versions",
      title: t("project.workbench.artifacts.versions.loadFailed"),
    });
    emit("update:open", false);
  } finally {
    loading.value = false;
  }
}

watch(
  () => [props.open, props.path, props.sessionId] as const,
  ([open]) => {
    comparing.value = undefined;
    restoring.value = undefined;
    if (!open) return;
    history.value = undefined;
    void load();
  },
  { immediate: true },
);

const time = computed(
  () =>
    new Intl.DateTimeFormat(locale.value, {
      dateStyle: "medium",
      timeStyle: "short",
    }),
);

function stateLabel(version: ArtifactVersion): string | undefined {
  if (version.state === "pruned")
    return t("project.workbench.artifacts.versions.pruned");
  if (version.state === "too-large")
    return t("project.workbench.artifacts.versions.tooLarge");
  if (version.state === "failed")
    return t("project.workbench.artifacts.versions.failed");
  return undefined;
}

function versionKey(version: ArtifactVersion): string {
  return version.ref.kind === "submission"
    ? `submission:${version.ref.toolCallId}`
    : `backup:${version.ref.id}`;
}

async function preview(version: ArtifactVersion): Promise<void> {
  busy.value = true;
  try {
    emit("preview", await window.pine.openArtifactVersion(request(version)));
    emit("update:open", false);
  } catch (error) {
    handleError(error, {
      id: "project.workbench.artifacts.versions",
      title: t("project.workbench.artifacts.openFailed"),
    });
  } finally {
    busy.value = false;
  }
}

async function compare(version: ArtifactVersion): Promise<void> {
  comparing.value = { version };
  try {
    const diff = await window.pine.diffArtifactVersion(request(version));
    if (comparing.value?.version === version)
      comparing.value = { version, diff };
  } catch (error) {
    comparing.value = undefined;
    handleError(error, {
      id: "project.workbench.artifacts.versions",
      title: t("project.workbench.artifacts.versions.compareFailed"),
    });
  }
}

function diffMessage(diff: ArtifactVersionDiff): string | undefined {
  if (diff.status === "identical")
    return t("project.workbench.artifacts.versions.identical");
  if (diff.status !== "unsupported") return undefined;
  if (diff.reason === "binary")
    return t("project.workbench.artifacts.versions.binary");
  if (diff.reason === "missing")
    return t("project.workbench.artifacts.versions.missing");
  return t("project.workbench.artifacts.versions.diffTooLarge");
}

async function restore(): Promise<void> {
  const version = restoring.value;
  if (!version || busy.value) return;
  busy.value = true;
  try {
    await window.pine.restoreArtifactVersion(request(version));
    restoring.value = undefined;
    toast.success(t("project.workbench.artifacts.versions.restored"), {
      description: props.name,
    });
    emit("restored");
    await load();
  } catch (error) {
    handleError(error, {
      id: "project.workbench.artifacts.versions",
      title: t("project.workbench.artifacts.versions.restoreFailed"),
    });
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{{
          t("project.workbench.artifacts.versions.title")
        }}</DialogTitle>
        <DialogDescription class="truncate" :title="path">
          {{ name }}
        </DialogDescription>
      </DialogHeader>

      <div
        v-if="comparing"
        data-testid="artifact-version-diff"
        class="flex min-h-0 flex-col gap-3"
      >
        <div class="flex items-center gap-2">
          <Button variant="ghost" size="sm" @click="comparing = undefined">
            <ArrowLeftIcon aria-hidden="true" />
            {{ t("project.workbench.artifacts.versions.back") }}
          </Button>
          <span class="truncate text-sm text-muted-foreground">
            {{
              t("project.workbench.artifacts.versions.comparing", {
                time: time.format(comparing.version.time),
              })
            }}
          </span>
        </div>
        <Skeleton v-if="!comparing.diff" class="h-80 w-full" />
        <p
          v-else-if="diffMessage(comparing.diff)"
          class="flex h-80 items-center justify-center text-sm text-muted-foreground"
        >
          {{ diffMessage(comparing.diff) }}
        </p>
        <ScrollArea
          v-else-if="comparing.diff.status === 'ok'"
          class="h-80 rounded-md border"
        >
          <div class="font-mono text-xs">
            <div
              v-for="(hunk, hunkIndex) in comparing.diff.hunks"
              :key="hunkIndex"
            >
              <div class="bg-muted px-3 py-1 text-muted-foreground">
                @@ −{{ hunk.oldStart }} +{{ hunk.newStart }} @@
              </div>
              <div
                v-for="(line, lineIndex) in hunk.lines"
                :key="lineIndex"
                class="px-3 whitespace-pre-wrap break-all"
                :class="{
                  'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300':
                    line.type === 'add',
                  'bg-red-500/10 text-red-700 dark:text-red-300':
                    line.type === 'remove',
                }"
              >
                {{
                  line.type === "add"
                    ? "+"
                    : line.type === "remove"
                      ? "−"
                      : " "
                }}{{ line.text }}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>

      <div v-else class="flex min-h-0 flex-col gap-3">
        <p
          v-if="history?.missing || history?.modified"
          class="rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground"
        >
          {{
            history.missing
              ? t("project.workbench.artifacts.versions.missing")
              : t("project.workbench.artifacts.versions.modified")
          }}
        </p>
        <div v-if="loading && !history" class="flex flex-col gap-2">
          <Skeleton v-for="index in 3" :key="index" class="h-12 w-full" />
        </div>
        <p
          v-else-if="history && history.versions.length === 0"
          class="py-6 text-center text-sm text-muted-foreground"
        >
          {{ t("project.workbench.artifacts.versions.empty") }}
        </p>
        <ScrollArea v-else-if="history" class="max-h-96">
          <ul class="flex flex-col gap-1">
            <li
              v-for="version in history.versions"
              :key="versionKey(version)"
              data-testid="artifact-version"
              class="flex items-center gap-3 rounded-md px-3 py-2 hover:bg-muted/60"
            >
              <div class="flex min-w-0 flex-1 flex-col">
                <span class="flex items-center gap-2 text-sm">
                  <span class="truncate">{{ time.format(version.time) }}</span>
                  <Badge v-if="version.current" variant="secondary">
                    {{ t("project.workbench.artifacts.versions.current") }}
                  </Badge>
                </span>
                <span class="truncate text-xs text-muted-foreground">
                  {{
                    [
                      version.ref.kind === "backup"
                        ? t("project.workbench.artifacts.versions.backup")
                        : version.title,
                      version.size === undefined
                        ? undefined
                        : formatBytes(version.size, locale),
                      stateLabel(version),
                    ]
                      .filter(Boolean)
                      .join(" · ")
                  }}
                </span>
              </div>
              <template v-if="version.state === 'available'">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :disabled="busy"
                  :title="t('project.workbench.artifacts.preview')"
                  :aria-label="t('project.workbench.artifacts.preview')"
                  @click="preview(version)"
                >
                  <EyeIcon aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :disabled="busy || history.missing"
                  :title="t('project.workbench.artifacts.versions.compare')"
                  :aria-label="
                    t('project.workbench.artifacts.versions.compare')
                  "
                  @click="compare(version)"
                >
                  <GitCompareIcon aria-hidden="true" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  :disabled="busy || version.current || !history.restorable"
                  :title="t('project.workbench.artifacts.versions.restore')"
                  :aria-label="
                    t('project.workbench.artifacts.versions.restore')
                  "
                  @click="restoring = version"
                >
                  <RotateCcwIcon aria-hidden="true" />
                </Button>
              </template>
            </li>
          </ul>
        </ScrollArea>
        <p
          v-if="history && !history.restorable && history.versions.length"
          class="text-xs text-muted-foreground"
        >
          {{ t("project.workbench.artifacts.versions.readOnly") }}
        </p>
      </div>
    </DialogContent>
  </Dialog>

  <AlertDialog
    :open="!!restoring"
    @update:open="
      (value) => {
        if (!value && !busy) restoring = undefined;
      }
    "
  >
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{
          t("project.workbench.artifacts.versions.restoreTitle")
        }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{
            t("project.workbench.artifacts.versions.restoreDescription", {
              name,
              time: restoring ? time.format(restoring.time) : "",
            })
          }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="busy">{{
          t("common.cancel")
        }}</AlertDialogCancel>
        <Button :disabled="busy" @click="restore">
          {{ t("project.workbench.artifacts.versions.restore") }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
