<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { cn } from "@/lib/utils";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { IuiNodes } from "./context";
import { listEntries } from "./listItems";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"List">>>();

const entries = computed(() => listEntries(props.props.items));
/** Plain strings keep the native list; richer items get a marker column. */
const rich = computed(
  () =>
    props.props.timeline === true ||
    entries.value.some(
      (entry) =>
        entry.description !== undefined ||
        entry.marker !== undefined ||
        entry.children !== undefined,
    ),
);
const tag = computed(() => (props.props.ordered ? "ol" : "ul"));
</script>

<template>
  <component
    :is="tag"
    v-if="!rich"
    data-iui="list"
    :class="[
      'flex flex-col gap-1 pl-5 text-sm leading-relaxed marker:text-muted-foreground',
      props.props.ordered ? 'list-decimal' : 'list-disc',
    ]"
  >
    <li v-for="(entry, index) in entries" :key="index">
      {{ entry.title }}
    </li>
  </component>
  <component
    :is="tag"
    v-else
    data-iui="list"
    :data-timeline="props.props.timeline ? true : undefined"
    class="flex flex-col text-sm"
  >
    <li
      v-for="(entry, index) in entries"
      :key="index"
      class="flex gap-3"
      data-iui="list-item"
    >
      <div class="flex shrink-0 flex-col items-center">
        <span
          :class="
            cn(
              'flex min-w-5 items-center justify-center text-muted-foreground tabular-nums',
              entry.marker === undefined && !props.props.ordered
                ? 'h-[1.625rem]'
                : 'h-[1.625rem] text-xs font-medium',
            )
          "
        >
          <template v-if="entry.marker !== undefined">{{
            entry.marker
          }}</template>
          <template v-else-if="props.props.ordered">{{ index + 1 }}.</template>
          <span
            v-else
            :class="
              cn(
                'size-1.5 rounded-full bg-muted-foreground/70',
                props.props.timeline && 'size-2 ring-2 ring-border',
              )
            "
          />
        </span>
        <span
          v-if="props.props.timeline && index < entries.length - 1"
          class="w-px flex-1 bg-border"
        />
      </div>
      <div
        :class="
          cn(
            'flex min-w-0 flex-1 flex-col gap-0.5 pt-0.5',
            index < entries.length - 1 &&
              (props.props.timeline ? 'pb-4' : 'pb-2'),
          )
        "
      >
        <span class="leading-relaxed font-medium">{{ entry.title }}</span>
        <span
          v-if="entry.description"
          class="leading-relaxed text-pretty text-muted-foreground"
        >
          {{ entry.description }}
        </span>
        <div v-if="entry.children" class="mt-1 flex flex-col gap-2">
          <IuiNodes :value="entry.children" />
        </div>
      </div>
    </li>
  </component>
</template>
