<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { FieldGroup } from "@/components/ui/field";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";
import { CARD_SURFACE_CLASS, useSurface } from "./surface";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Card">>>();
const surface = useSurface();
</script>

<template>
  <Card
    data-iui="card"
    size="sm"
    :class="['min-w-0', CARD_SURFACE_CLASS[surface]]"
  >
    <CardHeader v-if="props.props.title || props.props.description">
      <CardTitle v-if="props.props.title">{{ props.props.title }}</CardTitle>
      <CardDescription v-if="props.props.description">
        {{ props.props.description }}
      </CardDescription>
    </CardHeader>
    <!-- Same rhythm as Pine's settings forms: fields and blocks a FieldGroup
         apart, each field's own parts closer together. -->
    <CardContent>
      <FieldGroup class="gap-5">
        <IuiNodes :value="props.props.children" />
      </FieldGroup>
    </CardContent>
  </Card>
</template>
