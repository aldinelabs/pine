<script setup lang="ts">
import {
  createFormValidation,
  provideFormValidation,
  type ComponentRenderProps,
} from "@openuidev/vue-lang";
import { FieldGroup } from "@/components/ui/field";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Form">>>();

// Fields inside register their rules here; a Button inside that sends a
// message checks them all first.
provideFormValidation(createFormValidation());
</script>

<template>
  <form data-iui="form" class="min-w-0" novalidate @submit.prevent>
    <FieldGroup class="gap-5">
      <IuiNodes :value="props.props.children" />
    </FieldGroup>
  </form>
</template>
