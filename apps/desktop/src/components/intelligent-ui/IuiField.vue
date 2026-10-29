<script setup lang="ts">
import { Label } from "@/components/ui/label";

/** Label above an input, matching shadcn field spacing. */
defineProps<{ label?: string; for?: string }>();
</script>

<template>
  <div data-slot="iui-field" class="flex min-w-0 flex-col gap-1.5">
    <Label v-if="label" :for="$props.for">{{ label }}</Label>
    <slot />
  </div>
</template>
