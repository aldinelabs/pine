<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import HelpGuideButton from "@/components/help/HelpGuideButton.vue";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel, FieldTitle } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { formatTokenCount } from "@/lib/format-token-count";
import { useAppearanceStore } from "@/stores/appearance";
import { useCurrencyStore } from "@/stores/currency";
import { useSessionStore } from "@/stores/session";

const { t } = useI18n();
const sessionStore = useSessionStore();
const { activeSession, contextUsage: usage } = storeToRefs(sessionStore);
const currencyStore = useCurrencyStore();
const appearanceStore = useAppearanceStore();
const isCompacting = ref(false);

/** A menu separator's look: edge to edge across the popover's padding. */
const DIVIDER_CLASS =
  "bg-border/50 -mx-1.5 my-1.5 data-[orientation=horizontal]:w-auto";
const isOpen = ref(false);

onMounted(() => void currencyStore.load());

const RING_RADIUS = 8;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

/** Integer percentage shown next to the ring; ? while unknown. */
const usagePercentText = computed(() =>
  usage.value?.percent == null ? "0" : usage.value.percent.toFixed(0),
);

/** 0–1 clamped ring fill fraction. */
const usageFraction = computed(() => {
  const percent = usage.value?.percent;
  if (percent == null) return 0;
  return Math.min(1, Math.max(0, percent / 100));
});

const ringDashOffset = computed(
  () => RING_CIRCUMFERENCE * (1 - usageFraction.value),
);

const costLimit = computed(() => sessionStore.activeCostLimit);

/** 0–100 share of the cost limit spent; null without a limit. */
const costPercent = computed(() => {
  if (costLimit.value == null || !usage.value) return null;
  return Math.min(100, (usage.value.cost / costLimit.value) * 100);
});

const limitReached = computed(
  () => costPercent.value != null && costPercent.value >= 100,
);

const usageToneClass = computed(() => {
  const percent = usage.value?.percent;
  return (percent != null && percent >= 80) || limitReached.value
    ? "text-destructive"
    : "text-muted-foreground";
});

/** The limit as typed, in the display currency. */
function draftFor(limitUsd: number | null): string {
  return limitUsd == null
    ? ""
    : String(Number(currencyStore.fromUsd(limitUsd).toFixed(2)));
}

const limitDraft = ref("");
watch(
  [costLimit, () => currencyStore.currency, () => currencyStore.rates],
  () => {
    limitDraft.value = draftFor(costLimit.value);
  },
  { immediate: true },
);

function commitLimit(): void {
  const value = Number.parseFloat(limitDraft.value);
  sessionStore.setActiveCostLimit(
    Number.isFinite(value) && value > 0 ? currencyStore.toUsd(value) : null,
  );
  limitDraft.value = draftFor(costLimit.value);
}

/** A round starting limit, about five US dollars in the display currency. */
function defaultLimitUsd(): number {
  const amount = currencyStore.fromUsd(5);
  const magnitude = 10 ** Math.floor(Math.log10(amount));
  return currencyStore.toUsd(
    Math.max(1, Math.round(amount / magnitude) * magnitude),
  );
}

function toggleLimit(enabled: boolean): void {
  sessionStore.setActiveCostLimit(enabled ? defaultLimitUsd() : null);
  limitDraft.value = draftFor(costLimit.value);
}

const usedTokensText = computed(() =>
  usage.value?.tokens == null
    ? t("project.composer.contextUsage.unknown")
    : usage.value.tokens.toLocaleString("en-US"),
);

const contextWindowText = computed(() =>
  usage.value
    ? formatTokenCount(usage.value.contextWindow)
    : t("project.composer.contextUsage.unknown"),
);

const precisePercentText = computed(() =>
  usage.value?.percent == null
    ? t("project.composer.contextUsage.unknown")
    : `${usage.value.percent.toFixed(1)}%`,
);

const costText = computed(() =>
  usage.value
    ? currencyStore.format(usage.value.cost)
    : t("project.composer.contextUsage.unknown"),
);

/**
 * Session cost beside the percentage. Hidden while nothing has been charged:
 * Pi reports 0 both before the first priced reply and for models without
 * pricing (local or custom models), and "$0.00" would read as "free".
 */
const triggerCostText = computed(() => {
  const cost = usage.value?.cost ?? 0;
  if (!(cost > 0)) return null;
  // The footer is tight: the bare symbol ("¥") rather than "CN¥".
  const minimum = currencyStore.toUsd(0.01);
  const options = { narrow: true };
  return cost < minimum
    ? `<${currencyStore.format(minimum, 2, options)}`
    : currencyStore.format(cost, 2, options);
});

/**
 * The trigger's accessible name carries the percentage and cost too: a
 * narrow composer footer hides them from view.
 */
const triggerLabel = computed(() =>
  [
    t("project.composer.contextUsage.label"),
    `${usagePercentText.value}%`,
    triggerCostText.value,
  ]
    .filter(Boolean)
    .join(", "),
);

const cacheHitRateText = computed(() =>
  usage.value?.cacheHitRate == null
    ? t("project.composer.contextUsage.unknown")
    : `${usage.value.cacheHitRate.toFixed(1)}%`,
);

async function compactContext(): Promise<void> {
  if (!activeSession.value || isCompacting.value) return;
  isCompacting.value = true;
  try {
    await sessionStore.compactContext();
  } catch (error) {
    handleError(error, {
      id: "context-compaction-manual",
      title: t("errors.contextCompaction.title"),
      description: t("errors.contextCompaction.description"),
    });
  } finally {
    isCompacting.value = false;
  }
}
</script>

<template>
  <Popover v-model:open="isOpen">
    <PopoverTrigger as-child>
      <Button
        data-slot="context-usage-trigger"
        type="button"
        variant="ghost"
        size="sm"
        :class="usageToneClass"
        :aria-label="triggerLabel"
      >
        <svg
          data-icon="inline-start"
          viewBox="0 0 20 20"
          fill="none"
          :class="usageToneClass"
          aria-hidden="true"
        >
          <circle
            class="stroke-current opacity-25"
            cx="10"
            cy="10"
            :r="RING_RADIUS"
            stroke-width="2"
          />
          <circle
            v-if="usageFraction > 0"
            class="stroke-current transition-[stroke-dashoffset] duration-500"
            cx="10"
            cy="10"
            :r="RING_RADIUS"
            stroke-width="2"
            stroke-linecap="round"
            :stroke-dasharray="RING_CIRCUMFERENCE"
            :stroke-dashoffset="ringDashOffset"
            transform="rotate(-90 10 10)"
          />
        </svg>
        <span data-slot="context-usage-percent" class="tabular-nums">
          {{ usagePercentText }}%
        </span>
        <!-- The divider goes with the cost, so a narrow footer hides both. -->
        <span
          v-if="triggerCostText"
          data-slot="context-usage-cost"
          class="flex items-center gap-1.5"
        >
          <!-- A drawn bar rather than "|", which reaches past the digits. A
               thin, light line reads shorter than the figures' strokes, so it
               is drawn a little taller (0.85em) than their 0.73em to look
               the same height, and about as thick as their 1.6px stems
               (0.11em). -->
          <span
            data-slot="context-usage-divider"
            class="h-[0.85em] w-[0.11em] shrink-0 bg-current opacity-55"
            aria-hidden="true"
          />
          <span data-testid="context-usage-trigger-cost" class="tabular-nums">
            {{ triggerCostText }}
          </span>
        </span>
      </Button>
    </PopoverTrigger>

    <!-- Opened by pointer or keyboard, focus stays on the trigger rather than
         ringing the first button, as in the live context popover. -->
    <PopoverContent
      side="top"
      align="start"
      class="w-72 gap-0 p-1.5"
      @open-auto-focus.prevent
    >
      <!-- Laid out like the approval menu: the dividers run edge to edge and
           the guide is a menu-style row at the foot. The sections' own
           padding makes up the popover's usual 1rem inset. -->
      <Field data-testid="context-section" class="gap-2 p-2.5">
        <div class="flex items-baseline justify-between gap-4">
          <FieldTitle>
            {{ t("project.composer.contextUsage.label") }}
          </FieldTitle>
          <span
            class="text-lg font-semibold tabular-nums"
            :class="usageToneClass"
          >
            {{ precisePercentText }}
          </span>
        </div>
        <Progress :model-value="usageFraction * 100" class="h-1.5" />
        <dl class="flex flex-col gap-1">
          <div class="flex items-baseline justify-between gap-4">
            <dt class="text-muted-foreground">
              {{ t("project.composer.contextUsage.usedTokens") }}
            </dt>
            <dd class="font-medium tabular-nums">
              {{ usedTokensText }}
              <span class="text-muted-foreground font-normal">
                / {{ contextWindowText }}
              </span>
            </dd>
          </div>
          <div
            v-if="usage?.cacheHitRate != null"
            class="flex items-baseline justify-between gap-4"
          >
            <dt class="text-muted-foreground">
              {{ t("project.composer.contextUsage.cacheHitRate") }}
            </dt>
            <dd class="font-medium tabular-nums">{{ cacheHitRateText }}</dd>
          </div>
        </dl>
        <Button
          data-testid="compact-context-button"
          type="button"
          variant="outline"
          size="sm"
          :disabled="!activeSession || isCompacting"
          @click="compactContext"
        >
          <Spinner v-if="isCompacting" data-icon="inline-start" />
          {{
            isCompacting
              ? t("project.composer.contextUsage.compacting")
              : t("project.composer.contextUsage.compactNow")
          }}
        </Button>
      </Field>

      <Separator :class="DIVIDER_CLASS" />

      <Field data-testid="cost-section" class="gap-2 p-2.5">
        <div class="flex items-baseline justify-between gap-4">
          <FieldTitle>
            {{ t("project.composer.contextUsage.cost") }}
          </FieldTitle>
          <span
            class="font-medium tabular-nums"
            :class="limitReached ? 'text-destructive' : ''"
          >
            {{ costText }}
            <span
              v-if="costLimit != null"
              class="text-muted-foreground font-normal"
            >
              / {{ currencyStore.format(costLimit, 2) }}
            </span>
          </span>
        </div>
        <Progress
          v-if="costPercent != null"
          :model-value="costPercent"
          :class="[
            'h-1.5',
            limitReached
              ? '[&_[data-slot=progress-indicator]]:bg-destructive'
              : '',
          ]"
        />
        <Field orientation="horizontal">
          <FieldLabel
            for="session-cost-limit-toggle"
            class="text-muted-foreground font-normal"
          >
            {{ t("project.composer.contextUsage.costLimit") }}
          </FieldLabel>
          <Switch
            id="session-cost-limit-toggle"
            data-testid="cost-limit-toggle"
            :model-value="costLimit != null"
            @update:model-value="toggleLimit"
          />
        </Field>
        <!-- Collapses to zero height instead of unmounting so it can ease.
               The negative margin cancels the field's gap while collapsed. -->
        <div
          data-testid="cost-limit-field"
          :inert="costLimit == null"
          :class="[
            'ease-out-expo grid transition-[grid-template-rows,opacity,margin] duration-500 motion-reduce:transition-none',
            costLimit == null
              ? '-mt-2 grid-rows-[0fr] opacity-0'
              : 'mt-0 grid-rows-[1fr] opacity-100',
          ]"
        >
          <!-- The padding keeps the focus ring inside the clipped area. -->
          <div class="-m-1 min-h-0 overflow-hidden p-1">
            <div
              class="border-input focus-within:border-ring focus-within:ring-ring/50 flex h-8 items-center gap-1.5 rounded-lg border px-2.5 focus-within:ring-3"
            >
              <span class="text-muted-foreground text-sm" aria-hidden="true">
                {{ currencyStore.symbol }}
              </span>
              <Input
                v-model="limitDraft"
                data-testid="cost-limit-input"
                type="number"
                inputmode="decimal"
                min="0"
                step="0.5"
                placeholder="0.00"
                :aria-label="t('project.composer.contextUsage.costLimit')"
                class="h-auto min-w-0 flex-1 [appearance:textfield] border-0 bg-transparent p-0 text-sm tabular-nums shadow-none focus-visible:ring-0 [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                @blur="commitLimit"
                @keydown.enter.prevent="commitLimit"
              />
              <span class="text-muted-foreground text-xs">
                {{ currencyStore.currency }}
              </span>
            </div>
          </div>
        </div>
      </Field>

      <!-- The guide opens over the popover's place, so the popover closes. -->
      <template v-if="appearanceStore.helpGuides">
        <Separator :class="DIVIDER_CLASS" />
        <HelpGuideButton
          topic="context-window"
          :label="t('help.contextWindowGuide')"
          @open="isOpen = false"
        />
      </template>
    </PopoverContent>
  </Popover>
</template>
