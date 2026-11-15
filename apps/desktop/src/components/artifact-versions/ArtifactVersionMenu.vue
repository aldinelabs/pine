<script setup lang="ts">
import { CheckIcon, HistoryIcon } from "@lucide/vue";
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBytes } from "@/lib/formatBytes";
import type { ArtifactVersion } from "@/shared/artifacts";
import { useArtifactVersionStore } from "@/stores/artifactVersions";
import { versionKey, versionTimeFormat } from "./versionFormat";

/**
 * The preview's version switcher: the file as it is now, then every kept
 * version newest first. Picking one shows it in the same preview.
 */
const props = defineProps<{
  viewKey: string;
  /** Shows the label beside the icon, as in a file tab's footer. */
  labelled?: boolean;
}>();

const { t, locale } = useI18n();
const versions = useArtifactVersionStore();
const view = computed(() => versions.viewOf(props.viewKey));
const open = ref(false);
const time = computed(() => versionTimeFormat(locale.value));

async function reload(): Promise<void> {
  try {
    await versions.load(props.viewKey);
  } catch (error) {
    open.value = false;
    handleError(error, {
      id: "artifact-versions.load",
      title: t("project.workbench.artifacts.versions.loadFailed"),
    });
  }
}

function setOpen(value: boolean): void {
  open.value = value;
  if (value) void reload();
}

// The Artifacts list's "Version history" opens this menu, which may only
// be mounted once the preview shows the file.
watch(
  () => view.value?.menuRequested,
  (requested) => {
    if (!requested) return;
    versions.clearMenuRequest(props.viewKey);
    setOpen(true);
  },
  { immediate: true },
);

function isShown(version: ArtifactVersion): boolean {
  const viewing = view.value?.viewing;
  return !!viewing && versionKey(viewing) === versionKey(version);
}

function details(version: ArtifactVersion): string {
  const state =
    version.state === "pruned"
      ? t("project.workbench.artifacts.versions.pruned")
      : version.state === "too-large"
        ? t("project.workbench.artifacts.versions.tooLarge")
        : version.state === "failed"
          ? t("project.workbench.artifacts.versions.failed")
          : undefined;
  return [
    version.ref.kind === "backup"
      ? t("project.workbench.artifacts.versions.backup")
      : version.title,
    version.size === undefined
      ? undefined
      : formatBytes(version.size, locale.value),
    state,
  ]
    .filter(Boolean)
    .join(" · ");
}

async function select(version: ArtifactVersion): Promise<void> {
  try {
    await versions.show(props.viewKey, version);
  } catch (error) {
    handleError(error, {
      id: "artifact-versions.open",
      title: t("project.workbench.artifacts.versions.openFailed"),
    });
  }
}
</script>

<template>
  <DropdownMenu v-if="view" :open="open" @update:open="setOpen">
    <DropdownMenuTrigger as-child>
      <Button
        data-testid="artifact-version-menu"
        variant="ghost"
        :size="labelled ? 'sm' : 'icon'"
        :aria-pressed="!!view.viewing"
        :class="view.viewing && 'bg-muted text-foreground'"
        :aria-label="t('project.workbench.artifacts.versions.menu')"
        :title="t('project.workbench.artifacts.versions.menu')"
      >
        <HistoryIcon :data-icon="labelled ? 'inline-start' : undefined" />
        <template v-if="labelled">
          {{ t("project.workbench.artifacts.versions.menu") }}
        </template>
      </Button>
    </DropdownMenuTrigger>
    <DropdownMenuContent
      align="end"
      class="max-h-96 w-max max-w-[min(24rem,calc(100vw-2rem))] min-w-56"
      @close-auto-focus.prevent
    >
      <DropdownMenuLabel>
        {{ t("project.workbench.artifacts.versions.menu") }}
      </DropdownMenuLabel>
      <p
        v-if="view.history?.missing || view.history?.modified"
        class="px-3 pb-2 text-xs text-muted-foreground"
      >
        {{
          view.history.missing
            ? t("project.workbench.artifacts.versions.missing")
            : t("project.workbench.artifacts.versions.modified")
        }}
      </p>
      <DropdownMenuGroup>
        <DropdownMenuItem
          data-testid="artifact-version-current-file"
          :disabled="view.history?.missing"
          @select="versions.showCurrent(viewKey)"
        >
          <span class="min-w-0 flex-1 truncate">
            {{ t("project.workbench.artifacts.versions.currentFile") }}
          </span>
          <CheckIcon v-if="!view.viewing" aria-hidden="true" />
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <DropdownMenuSeparator />
      <div v-if="!view.history" class="flex flex-col gap-1 p-1">
        <Skeleton v-for="index in 3" :key="index" class="h-12 w-full" />
      </div>
      <p
        v-else-if="!view.history.versions.length"
        class="px-3 py-4 text-center text-sm text-muted-foreground"
      >
        {{ t("project.workbench.artifacts.versions.empty") }}
      </p>
      <DropdownMenuGroup v-else>
        <DropdownMenuItem
          v-for="version in view.history.versions"
          :key="versionKey(version)"
          data-testid="artifact-version"
          :disabled="version.state !== 'available'"
          class="h-12"
          @select="select(version)"
        >
          <span class="flex min-w-0 flex-1 flex-col">
            <span class="flex items-center gap-2">
              <span class="truncate">{{ time.format(version.time) }}</span>
              <Badge v-if="version.current" variant="secondary">
                {{ t("project.workbench.artifacts.versions.current") }}
              </Badge>
            </span>
            <span class="truncate text-xs font-normal text-muted-foreground">
              {{ details(version) }}
            </span>
          </span>
          <CheckIcon v-if="isShown(version)" aria-hidden="true" />
        </DropdownMenuItem>
      </DropdownMenuGroup>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
