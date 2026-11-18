<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";

// A List reads its ListItems itself; one placed elsewhere draws on its own.
const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"ListItem">>>();
</script>

<template>
  <div data-iui="list-item" class="flex gap-3 text-sm">
    <span v-if="props.props.marker" class="shrink-0 text-muted-foreground">
      {{ props.props.marker }}
    </span>
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <span class="font-medium">{{ props.props.title }}</span>
      <span v-if="props.props.description" class="text-muted-foreground">
        {{ props.props.description }}
      </span>
      <IuiNodes v-if="props.props.children" :value="props.props.children" />
    </div>
  </div>
</template>
