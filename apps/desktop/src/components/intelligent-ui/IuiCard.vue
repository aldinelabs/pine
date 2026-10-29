<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";
import { CARD_SURFACE_CLASS, useSurface } from "./surface";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Card">>>();
const surface = useSurface();
</script>

<template>
  <Card
    data-slot="iui-card"
    size="sm"
    :class="['min-w-0', CARD_SURFACE_CLASS[surface]]"
  >
    <CardHeader v-if="props.props.title || props.props.description">
      <CardTitle v-if="props.props.title">{{ props.props.title }}</CardTitle>
      <CardDescription v-if="props.props.description">
        {{ props.props.description }}
      </CardDescription>
    </CardHeader>
    <CardContent class="flex flex-col gap-3">
      <IuiNodes :value="props.props.children" />
    </CardContent>
  </Card>
</template>
