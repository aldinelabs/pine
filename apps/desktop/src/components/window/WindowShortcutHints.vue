<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Kbd, KbdGroup } from "@/components/ui/kbd";

const { t } = useI18n();

// Electrons's before-input-event maps Ctrl and Cmd onto the same shortcut, so
// the modifier label follows the host platform.
const modifier = computed(() =>
  (window.pine?.platform ?? "darwin") === "darwin" ? "⌘" : "Ctrl",
);

interface ShortcutRow {
  keys: string[];
  label: string;
}

const rows = computed<ShortcutRow[]>(() => [
  { keys: ["N"], label: t("project.contentTabs.shortcuts.newTab") },
  { keys: ["W"], label: t("project.contentTabs.shortcuts.closeTab") },
  { keys: ["⇧", "N"], label: t("project.contentTabs.shortcuts.newWindow") },
]);
</script>

<template>
  <ul
    data-slot="window-shortcut-hints"
    class="grid w-fit grid-cols-[auto_auto] items-center justify-items-start gap-x-3 gap-y-2.5"
  >
    <li v-for="row in rows" :key="row.label" class="contents">
      <KbdGroup>
        <Kbd>{{ modifier }}</Kbd>
        <Kbd v-for="key in row.keys" :key="key">{{ key }}</Kbd>
      </KbdGroup>
      <span class="text-sm text-muted-foreground">{{ row.label }}</span>
    </li>
  </ul>
</template>
