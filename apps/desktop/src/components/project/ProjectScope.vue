<script setup lang="ts">
import { provideScopedProject } from "@/composables/useScopedProject";

const props = defineProps<{ projectId: string }>();
provideScopedProject(() => props.projectId);
</script>

<template>
  <slot />
</template>
