<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed, useId } from "vue";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  intelligentUiOptions,
  type IntelligentUiProps,
} from "@/shared/intelligentUi";
import { useBoundValue, useFieldRules } from "./context";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"RadioGroup">>>();
const id = useId();
const isStreaming = useIsStreaming();
const bound = useBoundValue<string | null>(() => props.props.value);
const options = computed(() => intelligentUiOptions(props.props.options));
const variant = computed(() => props.props.variant ?? "list");
const model = computed({
  get: () => bound.value ?? undefined,
  // Pills are a single toggle group, which clears on re-click; keep one.
  set: (value: unknown) => {
    if (typeof value === "string" && value) bound.value = value;
  },
});
const error = useFieldRules(
  () => props.props.rules,
  () => bound.value,
);
</script>

<template>
  <FieldSet
    data-iui="radio-group"
    :data-variant="variant"
    :data-invalid="error ? true : undefined"
  >
    <FieldLegend v-if="props.props.label" variant="label">
      {{ props.props.label }}
    </FieldLegend>
    <ToggleGroup
      v-if="variant === 'pills'"
      v-model="model"
      type="single"
      variant="outline"
      size="sm"
      :spacing="2"
      class="flex-wrap"
      :disabled="isStreaming"
    >
      <ToggleGroupItem
        v-for="option in options"
        :key="option.value"
        :value="option.value"
        class="rounded-full"
      >
        {{ option.label }}
      </ToggleGroupItem>
    </ToggleGroup>
    <!-- Choice cards: shadcn's FieldLabel wrapping a Field. -->
    <RadioGroup
      v-else-if="variant === 'cards'"
      v-model="model"
      :disabled="isStreaming"
    >
      <FieldLabel
        v-for="(option, index) in options"
        :key="option.value"
        :for="`${id}-${index}`"
      >
        <Field orientation="horizontal">
          <FieldContent>
            <FieldTitle>{{ option.label }}</FieldTitle>
            <FieldDescription v-if="option.description">
              {{ option.description }}
            </FieldDescription>
          </FieldContent>
          <RadioGroupItem :id="`${id}-${index}`" :value="option.value" />
        </Field>
      </FieldLabel>
    </RadioGroup>
    <RadioGroup v-else v-model="model" :disabled="isStreaming">
      <Field
        v-for="(option, index) in options"
        :key="option.value"
        orientation="horizontal"
      >
        <RadioGroupItem :id="`${id}-${index}`" :value="option.value" />
        <FieldContent v-if="option.description">
          <FieldLabel :for="`${id}-${index}`" class="font-normal">
            {{ option.label }}
          </FieldLabel>
          <FieldDescription>{{ option.description }}</FieldDescription>
        </FieldContent>
        <FieldLabel v-else :for="`${id}-${index}`" class="font-normal">
          {{ option.label }}
        </FieldLabel>
      </Field>
    </RadioGroup>
    <FieldError v-if="error" :errors="[error]" />
  </FieldSet>
</template>
