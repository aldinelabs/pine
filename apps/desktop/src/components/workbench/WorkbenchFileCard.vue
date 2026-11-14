<script setup lang="ts">
import { XIcon } from "@lucide/vue";
import { computed, onBeforeUnmount, useTemplateRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  FILE_COMMENTS_PANEL,
  type FileWorkbenchPanel,
  type WorkbenchPosition,
} from "@/shared/workbench";
import { useWorkbenchStore } from "@/stores/workbench";

/**
 * A card beside a file tab: its details or its comments. The card is the
 * frame; the file tab in front renders the content into it.
 */
const props = defineProps<{
  panel: FileWorkbenchPanel;
  position: WorkbenchPosition;
}>();
const { t } = useI18n();
const workbench = useWorkbenchStore();
const target = useTemplateRef<HTMLElement>("target");

const comments = computed(() => props.panel === FILE_COMMENTS_PANEL);
const count = computed(() =>
  comments.value ? (workbench.activeFile?.commentCount ?? 0) : 0,
);

watch(target, (element) => workbench.setFileCardTarget(props.panel, element), {
  immediate: true,
});
onBeforeUnmount(() => {
  if (workbench.fileCardTargets.get(props.panel) === target.value)
    workbench.setFileCardTarget(props.panel, null);
});
</script>

<template>
  <Card
    size="sm"
    data-testid="workbench-card"
    :data-panel="panel"
    :data-position="position"
    class="isolate h-full min-h-0 gap-0 rounded-(--workbench-radius) py-0 shadow-none ring-0"
  >
    <!-- The same header as the other cards: the title where their panel
         switch sits, controls at the card's inset. -->
    <CardHeader class="flex shrink-0 items-center gap-1 p-(--workbench-inset)">
      <h2
        class="flex h-8 min-w-0 items-center gap-1.5 px-2.5 text-sm font-medium"
      >
        {{
          t(
            comments
              ? "project.preview.annotations.title"
              : "project.preview.details.title",
          )
        }}
        <Badge v-if="count" variant="secondary">{{ count }}</Badge>
      </h2>
      <Button
        variant="ghost"
        size="icon"
        class="ml-auto"
        data-testid="workbench-card-close"
        data-action="hide-sidebar"
        :aria-label="t('project.preview.details.hide')"
        :title="t('project.preview.details.hide')"
        @click="workbench.setOpen(false)"
      >
        <XIcon aria-hidden="true" />
      </Button>
    </CardHeader>
    <CardContent class="relative min-h-0 flex-1 overflow-hidden px-0">
      <div
        ref="target"
        :data-slot="`workbench-${panel}`"
        class="absolute inset-0 flex flex-col"
      />
    </CardContent>
  </Card>
</template>
