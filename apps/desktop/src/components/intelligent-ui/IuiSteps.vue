<script setup lang="ts">
import type { ElementNode } from "@openuidev/lang-core";
import { CheckIcon } from "@lucide/vue";
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import {
  Stepper,
  StepperDescription,
  StepperIndicator,
  StepperItem,
  StepperSeparator,
  StepperTitle,
} from "@/components/ui/stepper";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { childList } from "./layout";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Steps">>>();

/** Steps are read here; a string stands for a step with only a title. */
const steps = computed(() =>
  childList(props.props.items).flatMap((item) => {
    if (typeof item === "string") return [{ title: item, description: "" }];
    const element = item as ElementNode | null;
    if (element?.type !== "element" || element.typeName !== "Step") return [];
    const stepProps = element.props as IntelligentUiProps<"Step">;
    return [
      {
        title: String(stepProps.title ?? ""),
        description: stepProps.description ?? "",
      },
    ];
  }),
);
/** Without a current step, none shows as done or active. */
const current = computed(() => {
  const value = Number(props.props.current);
  return Number.isFinite(value) && value >= 1 ? Math.round(value) : 0;
});
</script>

<template>
  <!-- Display only: the steps have no triggers, so they cannot be clicked. -->
  <Stepper
    v-if="steps.length > 0"
    data-iui="steps"
    orientation="vertical"
    :model-value="current"
    class="flex w-full min-w-0 flex-col"
  >
    <StepperItem
      v-for="(step, index) in steps"
      :key="index"
      v-slot="{ state }"
      :step="index + 1"
      class="relative w-full items-start gap-3"
    >
      <StepperSeparator
        v-if="index < steps.length - 1"
        class="absolute top-8 left-3.5 h-[calc(100%-2rem)] w-px bg-border group-data-[state=completed]:bg-primary/50"
      />
      <StepperIndicator
        class="size-7 shrink-0 text-xs font-medium tabular-nums ring-1 ring-border group-data-[state=active]:ring-primary group-data-[state=completed]:bg-primary/15 group-data-[state=completed]:text-primary group-data-[state=completed]:ring-transparent group-data-[state=inactive]:text-muted-foreground"
      >
        <CheckIcon v-if="state === 'completed'" class="size-3.5" />
        <span v-else>{{ index + 1 }}</span>
      </StepperIndicator>
      <div
        class="flex min-w-0 flex-1 flex-col gap-0.5 pt-1"
        :class="index < steps.length - 1 && 'pb-5'"
      >
        <StepperTitle
          class="text-sm leading-snug font-medium whitespace-normal group-data-[state=inactive]:text-foreground"
        >
          {{ step.title }}
        </StepperTitle>
        <StepperDescription
          v-if="step.description"
          class="text-sm leading-relaxed text-pretty"
        >
          {{ step.description }}
        </StepperDescription>
      </div>
    </StepperItem>
  </Stepper>
</template>
