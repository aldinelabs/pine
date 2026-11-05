<script setup lang="ts">
import { Globe } from "@lucide/vue";
import { ref, watch } from "vue";

interface Props {
  /** Site favicon URL; the globe shows until it loads, or if it fails. */
  src: string;
}

const props = defineProps<Props>();
const failed = ref(false);
watch(
  () => props.src,
  () => (failed.value = false),
);
</script>

<template>
  <img
    v-if="!failed"
    :src="src"
    alt=""
    aria-hidden="true"
    loading="lazy"
    referrerpolicy="no-referrer"
    class="size-[1em] shrink-0 rounded-[3px] object-contain"
    data-slot="citation-favicon"
    @error="failed = true"
  />
  <Globe
    v-else
    class="size-[1em] shrink-0 text-muted-foreground"
    aria-hidden="true"
    data-slot="citation-favicon-fallback"
  />
</template>
