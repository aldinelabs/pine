<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { FieldGroup } from "@/components/ui/field";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";

// Tabs reads its Tab panels directly; a stray Tab shows its content inline.
const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Tab">>>();
</script>

<template>
  <FieldGroup data-iui="tab" class="gap-5">
    <IuiNodes :value="props.props.children" />
  </FieldGroup>
</template>
