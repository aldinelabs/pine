<script setup lang="ts">
import { XIcon } from "@lucide/vue";
import type { Component } from "vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * A short message above the Live Context bar: what happened, what to do,
 * and up to two actions. "warning" needs the user; "destructive" stopped
 * things; "neutral" is a side note (the icon can still carry a colour).
 * With `dismissLabel` it closes from a small × at its top right.
 */
withDefaults(
  defineProps<{
    icon: Component;
    title: string;
    description?: string;
    tone?: "neutral" | "warning" | "destructive";
    /** Tints the icon only, for a calm notice that still stands out. */
    iconTone?: "warning";
    dismissLabel?: string;
  }>(),
  {
    tone: "neutral",
    description: undefined,
    iconTone: undefined,
    dismissLabel: undefined,
  },
);
const emit = defineEmits<{ dismiss: [] }>();
</script>

<template>
  <div
    role="status"
    :data-tone="tone"
    :class="
      cn(
        'flex gap-2 rounded-(--workbench-inner-radius) py-2.5 pr-2.5 pl-3 text-xs',
        tone === 'neutral' && 'bg-muted',
        tone === 'warning' &&
          'bg-amber-500/10 dark:bg-amber-400/10 [&_[data-notice-icon]]:text-amber-600 dark:[&_[data-notice-icon]]:text-amber-400',
        tone === 'destructive' &&
          'bg-destructive/10 dark:bg-destructive/15 [&_[data-notice-icon]]:text-destructive',
        iconTone === 'warning' &&
          '[&_[data-notice-icon]]:text-amber-600 dark:[&_[data-notice-icon]]:text-amber-400',
        dismissLabel && 'py-2 pr-1.5',
      )
    "
  >
    <component
      :is="icon"
      data-notice-icon
      class="text-muted-foreground mt-0.5 size-4 shrink-0"
      aria-hidden="true"
    />
    <div class="flex min-w-0 flex-1 flex-col gap-0.5">
      <p class="text-foreground text-sm leading-5 font-medium">
        {{ title }}
      </p>
      <p
        v-if="description"
        class="text-muted-foreground leading-normal break-words"
      >
        {{ description }}
      </p>
      <div v-if="$slots.actions" class="mt-1.5 flex flex-wrap gap-1">
        <slot name="actions" />
      </div>
    </div>
    <Button
      v-if="dismissLabel"
      size="icon-xs"
      variant="ghost"
      class="text-muted-foreground -mt-0.5 shrink-0"
      data-testid="live-context-dismiss-error"
      :aria-label="dismissLabel"
      :title="dismissLabel"
      @click="emit('dismiss')"
    >
      <XIcon aria-hidden="true" />
    </Button>
  </div>
</template>
