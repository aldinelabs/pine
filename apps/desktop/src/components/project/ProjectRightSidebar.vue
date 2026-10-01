<script setup lang="ts">
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar";
</script>

<template>
  <Sidebar side="right" collapsible="offcanvas">
    <div
      aria-hidden="true"
      class="window-drag h-[var(--window-titlebar-height)] shrink-0"
    />
    <SidebarHeader>
      <slot name="header" />
    </SidebarHeader>

    <SidebarContent class="relative overflow-hidden">
      <slot />
    </SidebarContent>

    <SidebarFooter>
      <slot name="footer" />
    </SidebarFooter>
  </Sidebar>
</template>
