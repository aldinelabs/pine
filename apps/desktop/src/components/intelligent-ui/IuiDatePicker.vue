<script setup lang="ts">
import { CalendarDate, parseDate } from "@internationalized/date";
import { CalendarIcon } from "@lucide/vue";
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import type { DateValue } from "reka-ui";
import { computed, ref, useId } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useBoundValue, useFieldRules } from "./context";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"DatePicker">>>();
const id = useId();
const { t, locale } = useI18n();
const isStreaming = useIsStreaming();
const bound = useBoundValue<string | null>(() => props.props.value);
const open = ref(false);

/** A "YYYY-MM-DD" string as a calendar date, or undefined. */
function toDate(value: unknown): CalendarDate | undefined {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value.trim()))
    return undefined;
  try {
    return parseDate(value.trim());
  } catch {
    return undefined;
  }
}

const model = computed({
  get: () => toDate(bound.value),
  set: (value: DateValue | undefined) => {
    if (!value) return;
    bound.value = value.toString().slice(0, 10);
    open.value = false;
  },
});
const shown = computed(() => {
  const date = model.value;
  if (!date) return undefined;
  // The date is a calendar day: midnight UTC, shown in UTC so no time zone
  // moves it to the day before.
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(date.toDate("UTC"));
});
const error = useFieldRules(
  () => props.props.rules,
  () => bound.value,
);
</script>

<template>
  <Field data-iui="date-picker" :data-invalid="error ? true : undefined">
    <FieldLabel v-if="props.props.label" :for="id">
      {{ props.props.label }}
    </FieldLabel>
    <Popover v-model:open="open">
      <PopoverTrigger as-child>
        <Button
          :id="id"
          type="button"
          variant="outline"
          class="w-full max-w-64 justify-start font-normal"
          :class="!shown && 'text-muted-foreground'"
          :disabled="isStreaming"
          :aria-invalid="error ? true : undefined"
        >
          <CalendarIcon data-icon="inline-start" />
          {{ shown ?? t("intelligentUi.datePicker.placeholder") }}
        </Button>
      </PopoverTrigger>
      <PopoverContent class="w-auto p-0" align="start">
        <Calendar
          v-model="model"
          :locale="locale"
          :min-value="toDate(props.props.min)"
          :max-value="toDate(props.props.max)"
          :default-placeholder="model"
          initial-focus
        />
      </PopoverContent>
    </Popover>
    <FieldError v-if="error" :errors="[error]" />
  </Field>
</template>
