<script setup lang="ts">
import { MicIcon, Volume2Icon } from "@lucide/vue";
import { nextTick, ref } from "vue";
import { useI18n } from "vue-i18n";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import type { LiveContextSpeakerKey } from "@/shared/liveContext";
import {
  LIVE_CONTEXT_SPEAKER_NAME_MAX,
  parseSpeakerKey,
} from "@/shared/liveContextSpeakers";

/**
 * One speaker's label in the Live Context transcript: a pill tinted in the
 * speaker's color, with the source's icon. It opens a menu to rename the
 * speaker or merge it into another one.
 */
const props = defineProps<{
  speaker: LiveContextSpeakerKey;
  label: string;
  /** The other speakers it can be merged into. */
  others: { speaker: LiveContextSpeakerKey; label: string }[];
  /** The label may still change. */
  provisional?: boolean;
}>();
const emit = defineEmits<{
  rename: [name: string];
  merge: [into: LiveContextSpeakerKey];
}>();
const { t } = useI18n();

const COLORS = [
  "bg-sky-500/12 text-sky-700 dark:bg-sky-400/15 dark:text-sky-300",
  "bg-amber-500/14 text-amber-800 dark:bg-amber-400/15 dark:text-amber-300",
  "bg-emerald-500/12 text-emerald-700 dark:bg-emerald-400/15 dark:text-emerald-300",
  "bg-rose-500/12 text-rose-700 dark:bg-rose-400/15 dark:text-rose-300",
  "bg-violet-500/12 text-violet-700 dark:bg-violet-400/15 dark:text-violet-300",
  "bg-teal-500/12 text-teal-700 dark:bg-teal-400/15 dark:text-teal-300",
  "bg-orange-500/12 text-orange-700 dark:bg-orange-400/15 dark:text-orange-300",
  "bg-fuchsia-500/12 text-fuchsia-700 dark:bg-fuchsia-400/15 dark:text-fuchsia-300",
];
const { source, speaker: number } = parseSpeakerKey(props.speaker);
// Mic and system speakers start at different colors, so "1" and "1" differ.
const color = COLORS[(number - 1 + (source === "system" ? 4 : 0)) % 8];

const editing = ref(false);
const draft = ref("");
const input = ref<InstanceType<typeof Input> | null>(null);

async function startRename(): Promise<void> {
  draft.value = props.label;
  editing.value = true;
  await nextTick();
  // After the menu has closed and handed focus back.
  setTimeout(() => {
    const element = input.value?.$el as HTMLInputElement | undefined;
    element?.focus();
    element?.select();
  }, 0);
}

function finishRename(save: boolean): void {
  if (!editing.value) return;
  editing.value = false;
  if (save && draft.value.trim() !== props.label) emit("rename", draft.value);
}
</script>

<template>
  <Input
    v-if="editing"
    ref="input"
    v-model="draft"
    class="h-6 w-40 rounded-full px-2 text-xs"
    :maxlength="LIVE_CONTEXT_SPEAKER_NAME_MAX"
    :aria-label="t('project.workbench.liveContext.speakers.rename')"
    data-testid="live-context-speaker-name"
    @keydown.enter.prevent="finishRename(true)"
    @keydown.escape.prevent="finishRename(false)"
    @blur="finishRename(true)"
  />
  <DropdownMenu v-else>
    <DropdownMenuTrigger as-child>
      <button
        type="button"
        class="focus-visible:ring-ring/30 inline-flex h-5 max-w-full items-center gap-1 rounded-full px-2 text-xs font-medium transition-[opacity,filter] outline-none hover:brightness-95 focus-visible:ring-3 dark:hover:brightness-125"
        :class="[color, provisional && 'opacity-60']"
        :data-speaker="speaker"
        data-testid="live-context-speaker"
      >
        <component
          :is="source === 'mic' ? MicIcon : Volume2Icon"
          class="size-3 shrink-0 opacity-70"
          :aria-label="t(`project.workbench.liveContext.source.${source}`)"
        />
        <span class="truncate">{{ label }}</span>
      </button>
    </DropdownMenuTrigger>
    <DropdownMenuContent align="start">
      <DropdownMenuItem @select="startRename">
        {{ t("project.workbench.liveContext.speakers.rename") }}
      </DropdownMenuItem>
      <DropdownMenuSub v-if="others.length">
        <DropdownMenuSubTrigger>
          {{ t("project.workbench.liveContext.speakers.mergeInto") }}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem
            v-for="other in others"
            :key="other.speaker"
            :data-merge-into="other.speaker"
            @select="emit('merge', other.speaker)"
          >
            {{ other.label }}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
