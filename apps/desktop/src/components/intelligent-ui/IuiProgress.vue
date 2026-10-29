<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { Progress } from "@/components/ui/progress";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"Progress">>>();

const value = computed(() => {
  const raw = Number(props.props.value);
  return Number.isFinite(raw) ? Math.min(100, Math.max(0, raw)) : 0;
});
</script>

<template>
  <div data-slot="iui-progress" class="flex min-w-0 flex-col gap-2">
    <div
      v-if="props.props.label"
      class="flex items-center justify-between gap-3 text-sm"
    >
      <span>{{ props.props.label }}</span>
      <span class="text-muted-foreground tabular-nums">
        {{ Math.round(value) }}%
      </span>
    </div>
    <!-- Same track as the native Slider, which stays visible on muted
         surfaces where the Progress track's muted fill would vanish. -->
    <Progress :model-value="value" class="bg-input/90" />
  </div>
</template>
