<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";

// An Accordion reads its items itself; one placed elsewhere shows open.
const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"AccordionItem">>>();
</script>

<template>
  <section data-iui="accordion-item" class="flex flex-col gap-2">
    <h5 class="text-sm font-medium">{{ props.props.title }}</h5>
    <IuiNodes :value="props.props.children" />
  </section>
</template>
