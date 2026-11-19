<script setup lang="ts">
import type { Component } from "vue";
import { cn } from "@/lib/utils";

/**
 * A short message in the Live Context panel: what happened, what to do, and
 * up to two actions. "warning" needs the user; "destructive" stopped things.
 */
withDefaults(
  defineProps<{
    icon: Component;
    title: string;
    description?: string;
    tone?: "neutral" | "warning" | "destructive";
  }>(),
  { tone: "neutral", description: undefined },
);
</script>

<template>
  <div
    role="status"
    :data-tone="tone"
    :class="
      cn(
        'flex gap-2.5 rounded-2xl px-3 py-2.5 text-xs',
        tone === 'neutral' && 'bg-muted/60',
        tone === 'warning' &&
          'bg-amber-500/10 dark:bg-amber-400/10 [&_[data-notice-icon]]:text-amber-600 dark:[&_[data-notice-icon]]:text-amber-400',
        tone === 'destructive' &&
          'bg-destructive/10 dark:bg-destructive/15 [&_[data-notice-icon]]:text-destructive',
      )
    "
  >
    <component
      :is="icon"
      data-notice-icon
      class="text-muted-foreground mt-px size-4 shrink-0"
      aria-hidden="true"
    />
    <div class="flex min-w-0 flex-1 flex-col gap-1">
      <p class="text-foreground text-[13px] leading-5 font-medium">
        {{ title }}
      </p>
      <p
        v-if="description"
        class="text-muted-foreground leading-relaxed break-words"
      >
        {{ description }}
      </p>
      <div v-if="$slots.actions" class="mt-1 flex flex-wrap gap-1.5">
        <slot name="actions" />
      </div>
    </div>
  </div>
</template>
