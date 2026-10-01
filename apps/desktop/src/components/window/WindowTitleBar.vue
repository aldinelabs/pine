<script setup lang="ts">
withDefaults(defineProps<{ controlsOnly?: boolean }>(), {
  controlsOnly: false,
});
</script>

<template>
  <div
    v-if="!controlsOnly"
    aria-hidden="true"
    data-slot="window-titlebar-drag-region"
    class="window-drag absolute inset-x-0 top-0 z-20 h-[var(--window-titlebar-height)]"
  />
  <div
    v-else
    aria-hidden="true"
    data-slot="window-titlebar-sidebar-drag-region"
    class="window-titlebar-sidebar-drag-region window-drag absolute top-0 left-0 z-30 h-[var(--window-titlebar-height)]"
  />
  <header
    data-slot="window-titlebar"
    class="pointer-events-none absolute inset-x-0 top-0 z-40"
  >
    <div
      class="relative flex min-h-[var(--window-titlebar-height)] w-[env(titlebar-area-width,100%)] items-center gap-1 py-[var(--window-titlebar-padding-block)] pr-3 pl-[var(--window-titlebar-leading-offset)] [margin-left:env(titlebar-area-x,0px)]"
    >
      <div
        data-slot="window-titlebar-leading"
        class="window-no-drag pointer-events-auto flex min-w-0 items-center gap-1"
      >
        <slot name="leading" />
      </div>

      <div
        data-slot="window-titlebar-trailing"
        class="window-no-drag pointer-events-auto ml-auto flex min-w-0 items-center gap-1"
      >
        <slot name="trailing" />
      </div>
    </div>
  </header>
</template>

<style scoped>
.window-titlebar-sidebar-drag-region {
  width: var(--sidebar-width);
}

/* Keep the whole selector inside :global(); Vue drops anything after a
   leading :global(...) and would apply the width to the sidebar wrapper. */
:global(
  [data-slot="sidebar-wrapper"]:has(
      [data-slot="sidebar"][data-side="left"][data-state="collapsed"]
    )
    .window-titlebar-sidebar-drag-region
) {
  width: 0;
}

@media (max-width: 768px) {
  .window-titlebar-sidebar-drag-region {
    width: 0;
  }
}
</style>
