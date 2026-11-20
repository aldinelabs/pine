<script setup lang="ts">
import { MergeIcon, MicIcon, Volume2Icon } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { useLiveContextSpeakers } from "@/composables/useLiveContextSpeakers";
import type { LiveContextSpeakerKey } from "@/shared/liveContext";
import { LIVE_CONTEXT_SPEAKER_NAME_MAX } from "@/shared/liveContextSpeakers";

/**
 * Every speaker in the conversation's Live Context: its color and source,
 * its name to edit in place (Enter or leaving the field saves, Esc puts it
 * back, empty goes back to "Speaker n"), how many segments it speaks in,
 * and Merge into.
 */
const { t } = useI18n();
const { rows, rename, merge } = useLiveContextSpeakers();

function save(speaker: LiveContextSpeakerKey, current: string, event: Event) {
  const name = (event.target as HTMLInputElement).value.trim();
  if (name !== current) rename(speaker, name);
}

function revert(current: string, event: KeyboardEvent): void {
  const input = event.target as HTMLInputElement;
  input.value = current;
  input.blur();
}
</script>

<template>
  <ul class="flex flex-col" data-testid="live-context-speakers-list">
    <li
      v-for="row in rows"
      :key="row.speaker"
      class="flex h-9 items-center gap-2 px-1"
      :data-speaker="row.speaker"
    >
      <span
        class="flex size-6 shrink-0 items-center justify-center rounded-full"
        :class="row.color"
        :title="t(`project.workbench.liveContext.source.${row.source}`)"
      >
        <component
          :is="row.source === 'mic' ? MicIcon : Volume2Icon"
          class="size-3.5"
          aria-hidden="true"
        />
      </span>
      <!-- Keyed by the name, so a rename elsewhere refreshes it. -->
      <Input
        :key="`${row.speaker}:${row.name}`"
        :default-value="row.name"
        :placeholder="row.fallback"
        :maxlength="LIVE_CONTEXT_SPEAKER_NAME_MAX"
        :aria-label="
          t('project.workbench.liveContext.speakers.nameOf', {
            name: row.label,
          })
        "
        class="h-7 min-w-0 flex-1 text-sm"
        data-testid="live-context-speaker-input"
        @keydown.enter.prevent="($event.target as HTMLElement).blur()"
        @keydown.escape.prevent.stop="revert(row.name, $event)"
        @change="save(row.speaker, row.name, $event)"
      />
      <span
        class="text-muted-foreground w-8 shrink-0 text-right text-xs tabular-nums"
        :title="t('project.workbench.liveContext.speakers.segments', row.count)"
        data-testid="live-context-speaker-count"
        >{{ row.count }}</span
      >
      <DropdownMenu v-if="rows.length > 1">
        <DropdownMenuTrigger as-child>
          <Button
            variant="ghost"
            size="icon-sm"
            class="text-muted-foreground shrink-0"
            data-testid="live-context-speaker-merge"
            :aria-label="t('project.workbench.liveContext.speakers.mergeInto')"
            :title="t('project.workbench.liveContext.speakers.mergeInto')"
          >
            <MergeIcon aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuLabel>
            {{
              t("project.workbench.liveContext.speakers.mergeLabel", {
                name: row.label,
              })
            }}
          </DropdownMenuLabel>
          <DropdownMenuItem
            v-for="other in rows.filter((each) => each.speaker !== row.speaker)"
            :key="other.speaker"
            :data-merge-into="other.speaker"
            @select="merge(row.speaker, other.speaker)"
          >
            <component
              :is="other.source === 'mic' ? MicIcon : Volume2Icon"
              aria-hidden="true"
            />
            {{ other.label }}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  </ul>
</template>
