<script setup lang="ts">
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { Skeleton } from "@/components/ui/skeleton";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { fileLanguage } from "@/lib/fileLanguage";
import type { ArtifactVersionDiff } from "@/shared/artifacts";
import MarkdownVersionDiff from "./MarkdownVersionDiff.vue";

/**
 * The changes from a kept version to the current file, in place of the
 * preview: line by line, or for Markdown rendered as it reads.
 */
const props = defineProps<{
  diff?: ArtifactVersionDiff;
  /** The file's name, which decides whether a rendered comparison applies. */
  fileName?: string;
}>();
const { t } = useI18n();

const markdown = computed(
  () => !!props.fileName && fileLanguage(props.fileName) === "markdown",
);
const mode = ref<"rendered" | "source">("rendered");
const rendered = computed(
  () =>
    markdown.value && mode.value === "rendered" && props.diff?.status === "ok",
);

const message = computed(() => {
  const diff = props.diff;
  if (!diff || diff.status === "ok") return undefined;
  if (diff.status === "identical")
    return t("project.workbench.artifacts.versions.identical");
  if (diff.reason === "binary")
    return t("project.workbench.artifacts.versions.binary");
  if (diff.reason === "missing")
    return t("project.workbench.artifacts.versions.missing");
  return t("project.workbench.artifacts.versions.diffTooLarge");
});
</script>

<template>
  <div
    data-testid="artifact-version-diff"
    class="flex min-h-0 flex-1 flex-col overflow-auto"
  >
    <div v-if="!diff" class="flex flex-col gap-2 p-3">
      <Skeleton class="h-4 w-3/4" />
      <Skeleton class="h-4 w-1/2" />
      <Skeleton class="h-4 w-2/3" />
    </div>
    <p
      v-else-if="message"
      class="flex flex-1 items-center justify-center p-6 text-center text-sm text-muted-foreground"
    >
      {{ message }}
    </p>
    <template v-else-if="diff.status === 'ok'">
      <div
        v-if="markdown"
        class="sticky top-0 z-10 flex shrink-0 justify-end bg-background/90 px-3 py-1.5 backdrop-blur"
      >
        <ToggleGroup
          type="single"
          variant="outline"
          size="sm"
          :model-value="mode"
          :aria-label="t('project.workbench.artifacts.versions.compare')"
          @update:model-value="
            (value) => {
              if (value === 'rendered' || value === 'source') mode = value;
            }
          "
        >
          <ToggleGroupItem
            value="rendered"
            data-testid="artifact-version-diff-rendered"
          >
            {{ t("project.workbench.artifacts.versions.rendered") }}
          </ToggleGroupItem>
          <ToggleGroupItem
            value="source"
            data-testid="artifact-version-diff-source"
          >
            {{ t("project.workbench.artifacts.versions.source") }}
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
      <MarkdownVersionDiff
        v-if="rendered"
        :before="diff.before"
        :after="diff.after"
      />
      <div v-else class="py-2 font-mono text-xs">
        <div v-for="(hunk, hunkIndex) in diff.hunks" :key="hunkIndex">
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
            {{ line.type === "add" ? "+" : line.type === "remove" ? "−" : " "
            }}{{ line.text }}
          </div>
        </div>
      </div>
    </template>
  </div>
</template>
