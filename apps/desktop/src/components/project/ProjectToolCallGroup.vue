<script setup lang="ts">
import { ChevronRightIcon, ShieldBanIcon } from "@lucide/vue";
import { computed, ref, useId, watch } from "vue";
import { useI18n } from "vue-i18n";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import { Spinner } from "@/components/ui/spinner";
import type { PineToolCall } from "@/shared/sessions";
import type { PineTranscriptMessage } from "@/stores/session";
import ProjectToolCallMarker from "./ProjectToolCallMarker.vue";
import {
  countToolKinds,
  isDeniedTool,
  isRunningTool,
  TOOL_KIND_ORDER,
  toolIconForName,
} from "./toolKinds";

const props = defineProps<{
  message: PineTranscriptMessage;
  toolCalls: PineToolCall[];
  /** Transcript-level expansion policy: the last two tool runs of an active
   * response stay open until it ends. Absent for static history — the reader
   * can still toggle any run manually. */
  expanded?: boolean;
  /** Tool calls held by the auto-reviewer (auto-approve mode). */
  reviewingToolCallIds?: ReadonlySet<string>;
  /** Tool calls waiting for the user's decision (Let Me Review mode). */
  awaitingApprovalToolCallIds?: ReadonlySet<string>;
  openFile?: (path: string, toolCallId: string) => boolean;
}>();
const { locale, t } = useI18n();
const contentId = useId();
const isExpanded = ref(false);

const anyRunning = computed(() =>
  props.toolCalls.some((toolCall) => isRunningTool(toolCall)),
);
const allDone = computed(() => !anyRunning.value);

/**
 * Summarize a tool run by grouping its calls by kind, e.g. "Read 3 files,
 * edited 2 files, ran 5 commands". Kinds are emitted in a fixed order and
 * joined with a separator, and each uses the active or complete tense
 * depending on whether the run is still in flight.
 */
const summaryLabel = computed(() => {
  const counts = countToolKinds(props.toolCalls);
  const parts = TOOL_KIND_ORDER.flatMap((kind): string[] => {
    const count = counts.get(kind);
    if (!count) return [];
    const tense = allDone.value ? "complete" : "active";
    return [t(`project.transcript.toolSteps.${kind}.${tense}`, { count })];
  });
  const separator = locale.value.startsWith("zh") ? "，" : ", ";
  return parts.join(separator);
});

const iconByToolCall = computed(() =>
  props.toolCalls.map((toolCall) => toolIconForName(toolCall.name)),
);

/**
 * The transcript owns expansion policy; a defined prop value takes effect
 * immediately (opening newly trailing runs, folding runs that fell out of
 * the activity window or when the response ends), while manual toggles keep
 * working between policy updates.
 */
watch(
  () => props.expanded,
  (expanded) => {
    if (expanded !== undefined) isExpanded.value = expanded;
  },
  { immediate: true },
);

function toggleExpanded(): void {
  isExpanded.value = !isExpanded.value;
}
</script>

<template>
  <!-- Compensate the last expanded row's hit-area padding at the boundary. -->
  <div class="group/tool-steps" :class="isExpanded && '-mb-1'">
    <Marker
      as="button"
      type="button"
      class="w-fit cursor-pointer rounded-sm select-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      :aria-controls="contentId"
      :aria-expanded="isExpanded"
      @click="toggleExpanded"
    >
      <span class="flex shrink-0 items-center gap-1" data-tool-icons>
        <component
          :is="
            isDeniedTool(toolCalls[index])
              ? ShieldBanIcon
              : iconByToolCall[index]
          "
          v-for="(_, index) in iconByToolCall"
          :key="index"
          class="size-4"
          :class="isDeniedTool(toolCalls[index]) && 'text-warning'"
          :aria-hidden="true"
        />
      </span>

      <MarkerContent>{{ summaryLabel }}</MarkerContent>

      <MarkerIcon>
        <Spinner v-if="anyRunning && !isExpanded" />
        <ChevronRightIcon
          v-else
          class="transition-transform duration-500 ease-out motion-reduce:transition-none"
          :class="isExpanded && 'rotate-90'"
        />
      </MarkerIcon>
    </Marker>

    <div
      :id="contentId"
      data-tool-calls-content
      class="grid transition-[grid-template-rows,opacity] duration-500 ease-out-expo motion-reduce:transition-none"
      :class="
        isExpanded ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
      "
      :aria-hidden="!isExpanded"
    >
      <div class="min-h-0 overflow-hidden">
        <!-- Header gap: 8px + 4px row padding. Between rows: 4px + 8px. -->
        <div class="mt-2 flex flex-col gap-1 pl-6">
          <ProjectToolCallMarker
            v-for="toolCall in toolCalls"
            :key="toolCall.id"
            :tool-call="toolCall"
            :context-tool-calls="toolCalls"
            nested
            :reviewing="props.reviewingToolCallIds?.has(toolCall.id) ?? false"
            :awaiting-approval="
              props.awaitingApprovalToolCallIds?.has(toolCall.id) ?? false
            "
            :open-file="openFile"
          />
        </div>
      </div>
    </div>
  </div>
</template>
