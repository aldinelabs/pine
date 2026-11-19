<script setup lang="ts">
import {
  ChevronDownIcon,
  MicIcon,
  MicOffIcon,
  UsersRoundIcon,
  Volume2Icon,
  VolumeOffIcon,
} from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  LIVE_CONTEXT_LOCALES,
  LIVE_CONTEXT_SOURCES,
  type LiveContextSource,
} from "@/shared/liveContext";

/**
 * Before a capture, one row like the composer's footer: the sources as two
 * independent toggles (at least one stays on), the spoken language in a
 * menu that also holds speaker labels, and Start.
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

const ICONS = {
  mic: { on: MicIcon, off: MicOffIcon },
  system: { on: Volume2Icon, off: VolumeOffIcon },
} as const;

const languageNames = computed(
  () =>
    new Intl.DisplayNames([uiLocale.value], {
      type: "language",
      languageDisplay: "standard",
      style: "short",
    }),
);
/** "Chinese (China)": for the menu, where every choice shows its region. */
function languageName(option: string): string {
  return languageNames.value.of(option) ?? option;
}
/**
 * The button's short name: the language alone ("English") unless another
 * choice speaks it too ("Chinese (China)" next to "Chinese (Taiwan)").
 */
function shortLanguageName(option: string): string {
  const base = option.split("-")[0];
  const shared = LIVE_CONTEXT_LOCALES.filter(
    (candidate) => candidate.split("-")[0] === base,
  );
  return shared.length > 1
    ? languageName(option)
    : (languageNames.value.of(base) ?? option);
}

function updateSources(value: unknown): void {
  if (!Array.isArray(value)) return;
  const next = LIVE_CONTEXT_SOURCES.filter((source) => value.includes(source));
  // The last source on stays on.
  if (next.length > 0) sources.value = next;
}

function updateLocale(value: unknown): void {
  if (typeof value === "string") locale.value = value;
}

const speakersOn = computed(
  () => props.speakersAvailable === true && identifySpeakers.value,
);
</script>

<template>
  <div class="flex min-w-0 items-center gap-1" data-testid="live-context-setup">
    <ToggleGroup
      type="multiple"
      size="sm"
      :spacing="1"
      :model-value="sources"
      :disabled="disabled"
      :aria-label="t('project.workbench.liveContext.sources')"
      class="shrink-0"
      data-testid="live-context-sources"
      @update:model-value="updateSources"
    >
      <ToggleGroupItem
        v-for="source in LIVE_CONTEXT_SOURCES"
        :key="source"
        :value="source"
        :data-source="source"
        :aria-label="t(`project.workbench.liveContext.source.${source}`)"
        :title="t(`project.workbench.liveContext.source.${source}`)"
        class="text-muted-foreground aria-pressed:text-foreground data-[state=on]:text-foreground"
      >
        <component
          :is="sources.includes(source) ? ICONS[source].on : ICONS[source].off"
          aria-hidden="true"
        />
      </ToggleGroupItem>
    </ToggleGroup>
    <DropdownMenu>
      <DropdownMenuTrigger as-child>
        <Button
          variant="ghost"
          size="sm"
          class="min-w-0 shrink"
          :disabled="disabled"
          :aria-label="`${t('project.workbench.liveContext.options')}: ${languageName(locale)}`"
          :title="t('project.workbench.liveContext.options')"
          data-testid="live-context-options"
        >
          <span class="min-w-0 truncate">{{ shortLanguageName(locale) }}</span>
          <UsersRoundIcon
            v-if="speakersOn"
            class="text-muted-foreground"
            :aria-label="t('project.workbench.liveContext.speakers.identify')"
            data-testid="live-context-speakers-on"
          />
          <ChevronDownIcon data-icon="inline-end" aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent side="top" align="start" class="w-64">
        <DropdownMenuLabel class="flex flex-col gap-0.5">
          <span>{{ t("project.workbench.liveContext.language") }}</span>
          <span class="text-muted-foreground/80 font-normal">
            {{ t("project.workbench.liveContext.languageNote") }}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          :model-value="locale"
          @update:model-value="updateLocale"
        >
          <DropdownMenuRadioItem
            v-for="option in LIVE_CONTEXT_LOCALES"
            :key="option"
            :value="option"
            :data-locale="option"
          >
            {{ languageName(option) }}
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <template v-if="speakersAvailable">
          <DropdownMenuSeparator />
          <DropdownMenuCheckboxItem
            v-model="identifySpeakers"
            data-testid="live-context-identify-speakers"
            @select.prevent
          >
            <span class="flex min-w-0 flex-col gap-0.5">
              <span>{{
                t("project.workbench.liveContext.speakers.identify")
              }}</span>
              <span
                class="text-muted-foreground text-xs font-normal whitespace-normal"
              >
                {{ t("project.workbench.liveContext.speakers.note") }}
              </span>
            </span>
          </DropdownMenuCheckboxItem>
        </template>
      </DropdownMenuContent>
    </DropdownMenu>
    <Button
      size="sm"
      class="ml-auto shrink-0"
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
</template>
