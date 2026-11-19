<script setup lang="ts">
import {
  ChevronDownIcon,
  LanguagesIcon,
  MicIcon,
  UsersRoundIcon,
} from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import LiveContextSourceToggle from "@/components/workbench/LiveContextSourceToggle.vue";
import {
  LIVE_CONTEXT_LOCALES,
  type LiveContextSource,
} from "@/shared/liveContext";

/**
 * Before a capture: which sources to hear, the options people rarely change
 * (language, speaker labels) behind one button that shows them, and Start.
 */
const sources = defineModel<LiveContextSource[]>("sources", {
  required: true,
});
const locale = defineModel<string>("locale", { required: true });
const identifySpeakers = defineModel<boolean>("identifySpeakers", {
  default: false,
});
const props = defineProps<{
  /** This build can label speakers. */
  speakersAvailable?: boolean;
  /** There is a transcript already, so Start continues it. */
  continues?: boolean;
  disabled?: boolean;
}>();
const emit = defineEmits<{ start: [] }>();
const { t, locale: uiLocale } = useI18n();

const languageNames = computed(
  () => new Intl.DisplayNames([uiLocale.value], { type: "language" }),
);
function languageName(option: string): string {
  return languageNames.value.of(option) ?? option;
}

function updateLocale(value: unknown): void {
  if (typeof value === "string") locale.value = value;
}

const speakersOn = computed(
  () => props.speakersAvailable === true && identifySpeakers.value,
);
</script>

<template>
  <div class="flex flex-col gap-2" data-testid="live-context-setup">
    <LiveContextSourceToggle v-model="sources" :disabled="disabled" />
    <div class="flex items-center gap-2">
      <Popover>
        <PopoverTrigger as-child>
          <Button
            variant="outline"
            class="text-muted-foreground min-w-0 flex-1 justify-start"
            :disabled="disabled"
            :aria-label="t('project.workbench.liveContext.options')"
            :title="t('project.workbench.liveContext.options')"
            data-testid="live-context-options"
          >
            <LanguagesIcon data-icon="inline-start" aria-hidden="true" />
            <span class="text-foreground min-w-0 truncate">
              {{ languageName(locale) }}
            </span>
            <UsersRoundIcon
              v-if="speakersOn"
              class="shrink-0"
              :aria-label="t('project.workbench.liveContext.speakers.identify')"
              data-testid="live-context-speakers-on"
            />
            <ChevronDownIcon class="ml-auto shrink-0" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" class="w-72 gap-4">
          <div class="flex flex-col gap-2">
            <Label for="live-context-language">
              {{ t("project.workbench.liveContext.language") }}
            </Label>
            <Select :model-value="locale" @update:model-value="updateLocale">
              <SelectTrigger id="live-context-language" class="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem
                    v-for="option in LIVE_CONTEXT_LOCALES"
                    :key="option"
                    :value="option"
                  >
                    {{ languageName(option) }}
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
            <p class="text-muted-foreground text-xs">
              {{ t("project.workbench.liveContext.languageNote") }}
            </p>
          </div>
          <div v-if="speakersAvailable" class="flex flex-col gap-2">
            <div class="flex items-center justify-between gap-3">
              <Label for="live-context-identify-speakers">
                {{ t("project.workbench.liveContext.speakers.identify") }}
              </Label>
              <Switch
                id="live-context-identify-speakers"
                v-model="identifySpeakers"
                data-testid="live-context-identify-speakers"
              />
            </div>
            <p class="text-muted-foreground text-xs">
              {{ t("project.workbench.liveContext.speakers.note") }}
            </p>
          </div>
        </PopoverContent>
      </Popover>
      <Button
        class="shrink-0"
        data-testid="live-context-start"
        :disabled="disabled || sources.length === 0"
        @click="emit('start')"
      >
        <MicIcon data-icon="inline-start" aria-hidden="true" />
        {{
          continues
            ? t("project.workbench.liveContext.continue")
            : t("project.workbench.liveContext.start")
        }}
      </Button>
    </div>
  </div>
</template>
