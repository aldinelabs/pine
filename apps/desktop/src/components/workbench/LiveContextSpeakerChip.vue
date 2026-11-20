<script setup lang="ts">
import {
  MergeIcon,
  MicIcon,
  PencilIcon,
  RotateCcwIcon,
  Volume2Icon,
} from "@lucide/vue";
import { computed, nextTick, ref } from "vue";
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
import { speakerColor } from "@/lib/liveContextSpeakerColor";
import type { LiveContextSpeakerKey } from "@/shared/liveContext";
import {
  LIVE_CONTEXT_SPEAKER_NAME_MAX,
  parseSpeakerKey,
} from "@/shared/liveContextSpeakers";

/**
 * One speaker's label in the Live Context transcript: a pill tinted in the
 * speaker's color, with the source's icon. Clicking it opens a menu to
 * rename the speaker in place (Enter saves, Esc cancels, an empty name
 * goes back to "Speaker n"), restore the default name, or merge it into
 * another speaker.
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

const { source, speaker: number } = parseSpeakerKey(props.speaker);
const color = speakerColor(props.speaker);
/** "Speaker 2": the label before any rename, and what clearing restores. */
const defaultLabel = computed(() =>
  t("project.workbench.liveContext.speakers.numbered", { n: number }),
);
const renamed = computed(() => props.label !== defaultLabel.value);

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
  if (!save) return;
  const name = draft.value.trim();
  // Unchanged, or cleared while it already has its default name.
  if (name === props.label || (!name && !renamed.value)) return;
  emit("rename", name);
}
</script>

<template>
  <Input
    v-if="editing"
    ref="input"
    v-model="draft"
    class="h-5 w-auto max-w-48 min-w-20 rounded-full px-2 text-xs font-medium [field-sizing:content] md:text-xs"
    :class="color"
    :maxlength="LIVE_CONTEXT_SPEAKER_NAME_MAX"
    :placeholder="defaultLabel"
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
        class="focus-visible:ring-ring/30 inline-flex h-5 max-w-full cursor-pointer items-center gap-1 rounded-full px-2 text-xs font-medium transition-[opacity,filter] outline-none hover:brightness-95 focus-visible:ring-3 data-[state=open]:brightness-95 dark:hover:brightness-125 dark:data-[state=open]:brightness-125"
        :class="[color, provisional && 'opacity-60']"
        :title="t('project.workbench.liveContext.speakers.chipHint')"
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
      <DropdownMenuItem data-action="rename" @select="startRename">
        <PencilIcon aria-hidden="true" />
        {{ t("project.workbench.liveContext.speakers.rename") }}
      </DropdownMenuItem>
      <DropdownMenuItem
        v-if="renamed"
        data-action="reset-name"
        @select="emit('rename', '')"
      >
        <RotateCcwIcon aria-hidden="true" />
        {{
          t("project.workbench.liveContext.speakers.resetName", {
            name: defaultLabel,
          })
        }}
      </DropdownMenuItem>
      <DropdownMenuSub v-if="others.length">
        <DropdownMenuSubTrigger>
          <MergeIcon aria-hidden="true" />
          {{ t("project.workbench.liveContext.speakers.mergeInto") }}
        </DropdownMenuSubTrigger>
        <DropdownMenuSubContent>
          <DropdownMenuItem
            v-for="other in others"
            :key="other.speaker"
            :data-merge-into="other.speaker"
            @select="emit('merge', other.speaker)"
          >
            <component
              :is="
                parseSpeakerKey(other.speaker).source === 'mic'
                  ? MicIcon
                  : Volume2Icon
              "
              aria-hidden="true"
            />
            {{ other.label }}
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </DropdownMenuContent>
  </DropdownMenu>
</template>
