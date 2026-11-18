<script setup lang="ts">
import { ExternalLinkIcon } from "@lucide/vue";
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { isWebUrl, useOpenUrl } from "./context";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Link">>>();
const openUrl = useOpenUrl();
/** Only http(s) links are links; anything else shows as its text. */
const href = computed(() =>
  isWebUrl(props.props.url) ? props.props.url.trim() : undefined,
);
</script>

<template>
  <a
    v-if="href"
    data-iui="link"
    :href="href"
    class="inline-flex items-baseline gap-0.5 font-medium text-primary underline underline-offset-4 hover:decoration-2"
    @click.prevent="openUrl(href)"
  >
    {{ props.props.text || href }}
    <ExternalLinkIcon class="size-3 shrink-0 self-center opacity-70" />
  </a>
  <span v-else data-iui="link">{{ props.props.text }}</span>
</template>
