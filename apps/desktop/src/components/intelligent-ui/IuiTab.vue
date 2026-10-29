<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";

// Tabs reads its Tab panels directly; a stray Tab shows its content inline.
const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Tab">>>();
</script>

<template>
  <div data-slot="iui-tab" class="flex flex-col gap-3">
    <IuiNodes :value="props.props.children" />
  </div>
</template>
