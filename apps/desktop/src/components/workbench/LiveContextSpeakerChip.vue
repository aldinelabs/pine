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
 * One speaker's label in the Live Context transcript: a colored name that
 * opens a menu to rename the speaker or merge it into another one.
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
  "bg-sky-500",
  "bg-amber-500",
  "bg-emerald-500",
  "bg-rose-500",
  "bg-violet-500",
  "bg-teal-500",
  "bg-orange-500",
  "bg-fuchsia-500",
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
    class="h-6 w-40 px-1.5 text-xs"
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
        class="hover:bg-muted text-foreground inline-flex max-w-full items-center gap-1.5 rounded-sm px-1 py-0.5 text-xs font-medium"
        :class="provisional ? 'opacity-60' : undefined"
        :data-speaker="speaker"
        data-testid="live-context-speaker"
      >
        <span
          class="size-2 shrink-0 rounded-full"
          :class="color"
          aria-hidden="true"
        />
        <component
          :is="source === 'mic' ? MicIcon : Volume2Icon"
          class="text-muted-foreground size-3 shrink-0"
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
