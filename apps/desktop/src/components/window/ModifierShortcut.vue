<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useModifierHold } from "@/composables/useModifierHold";
import { cn } from "@/lib/utils";

const props = defineProps<{
  class?: HTMLAttributes["class"];
  keyLabel: string;
}>();

// Electron maps Ctrl and Cmd onto the same shortcut, so the modifier label
// follows the host platform.
const modifier =
  (window.pine?.platform ?? "darwin") === "darwin" ? "⌘" : "Ctrl";
// Hints stay out of the way until the modifier is held.
const visible = useModifierHold();
</script>

<template>
  <KbdGroup
    :class="
      cn(
        'transition-opacity duration-300 ease-out-expo',
        visible ? 'opacity-100' : 'opacity-0',
        props.class,
      )
    "
    :data-visible="visible"
    aria-hidden="true"
  >
    <Kbd>{{ modifier }}</Kbd>
    <Kbd>{{ keyLabel }}</Kbd>
  </KbdGroup>
</template>
