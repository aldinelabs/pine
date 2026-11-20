<script setup lang="ts">
/**
 * A keycap hint inside the composer, such as the reply suggestion's "Tab"
 * or Optimize prompt's "⌘↵". Its keys are <kbd> segments in the slot. On
 * the light composer surface the default key fill nearly matches it, so it
 * is a white cap with a hairline ring there; dark keeps the default fill.
 */
</script>

<template>
  <span
    class="inline-flex h-5 shrink-0 items-center gap-1.5 rounded-lg bg-muted px-1.5 font-sans text-xs font-medium text-muted-foreground ring-1 ring-foreground/10 select-none in-data-[slot=input-group]:bg-background dark:ring-0 dark:in-data-[slot=input-group]:bg-input"
    aria-hidden="true"
  >
    <slot />
  </span>
</template>
