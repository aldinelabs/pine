<script setup lang="ts">
import { storeToRefs } from "pinia";
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
import { Button } from "@/components/ui/button";
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
import { useCurrencyStore } from "@/stores/currency";
import { useSessionStore } from "@/stores/session";

const { t } = useI18n();
const sessionStore = useSessionStore();
const { activeSession, contextUsage: usage } = storeToRefs(sessionStore);
const currencyStore = useCurrencyStore();
const isCompacting = ref(false);

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

const costLimit = computed(() =>
  sessionStore.costLimitFor(activeSession.value?.id),
);

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
  const sessionId = activeSession.value?.id;
  if (!sessionId) return;
  const value = Number.parseFloat(limitDraft.value);
  sessionStore.setCostLimit(
    sessionId,
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
  const sessionId = activeSession.value?.id;
  if (!sessionId) return;
  sessionStore.setCostLimit(sessionId, enabled ? defaultLimitUsd() : null);
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
  <Popover>
    <PopoverTrigger as-child>
      <Button
        data-slot="context-usage-trigger"
        type="button"
        variant="ghost"
        size="sm"
        :class="usageToneClass"
        :aria-label="t('project.composer.contextUsage.label')"
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
        <span class="tabular-nums">{{ usagePercentText }}%</span>
      </Button>
    </PopoverTrigger>

    <PopoverContent side="top" align="start" class="w-72 gap-4">
      <section class="flex flex-col gap-2" data-testid="context-section">
        <div class="flex items-baseline justify-between gap-4">
          <span class="text-sm font-medium">
            {{ t("project.composer.contextUsage.label") }}
          </span>
          <span
            class="text-lg font-semibold tabular-nums"
            :class="usageToneClass"
          >
            {{ precisePercentText }}
          </span>
        </div>
        <Progress :model-value="usageFraction * 100" class="h-1.5" />
        <dl class="flex flex-col gap-1 text-sm">
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
      </section>

      <Separator />

      <section class="flex flex-col gap-2" data-testid="cost-section">
        <div class="flex items-baseline justify-between gap-4">
          <span class="text-sm font-medium">
            {{ t("project.composer.contextUsage.cost") }}
          </span>
          <span
            class="text-sm font-medium tabular-nums"
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
        <div class="flex items-center justify-between gap-4">
          <label
            class="text-muted-foreground text-sm"
            for="session-cost-limit-toggle"
          >
            {{ t("project.composer.contextUsage.costLimit") }}
          </label>
          <Switch
            id="session-cost-limit-toggle"
            data-testid="cost-limit-toggle"
            :model-value="costLimit != null"
            :disabled="!activeSession"
            @update:model-value="toggleLimit"
          />
        </div>
        <!-- Collapses to zero height instead of unmounting so it can ease. The
          negative margin cancels the section's gap while collapsed. -->
        <div
          data-testid="cost-limit-field"
          :inert="costLimit == null"
          :class="[
            'grid transition-[grid-template-rows,opacity,margin] duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none',
            costLimit == null
              ? '-mt-2 grid-rows-[0fr] opacity-0'
              : 'mt-0 grid-rows-[1fr] opacity-100',
          ]"
        >
          <div class="min-h-0 overflow-hidden p-px">
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
      </section>
    </PopoverContent>
  </Popover>
</template>
