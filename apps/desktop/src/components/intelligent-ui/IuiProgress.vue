<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { Field, FieldTitle } from "@/components/ui/field";
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
  <Field data-iui="progress">
    <div
      v-if="props.props.label"
      class="flex items-center justify-between gap-3"
    >
      <FieldTitle>{{ props.props.label }}</FieldTitle>
      <span class="text-sm text-muted-foreground tabular-nums">
        {{ Math.round(value) }}%
      </span>
    </div>
    <!-- Same track as the native Slider, which stays visible on muted
         surfaces where the Progress track's muted fill would vanish. -->
    <Progress :model-value="value" class="bg-input/90" />
  </Field>
</template>
