<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { Badge } from "@/components/ui/badge";
import type { IntelligentUiProps } from "@/shared/intelligentUi";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Badge">>>();
</script>

<template>
  <Badge
    data-slot="iui-badge"
    :variant="props.props.variant ?? 'secondary'"
    class="w-fit"
  >
    {{ props.props.text }}
  </Badge>
</template>
