<script setup lang="ts">
import type { HTMLAttributes } from "vue";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useModifierHold } from "@/composables/useModifierHold";
import { cn } from "@/lib/utils";

const props = withDefaults(
  defineProps<{
    class?: HTMLAttributes["class"];
    keyLabel: string;
    /** The shortcut's own modifier: Cmd/Ctrl, or Option/Alt. */
    modifier?: "mod" | "alt";
  }>(),
  { modifier: "mod" },
);

// Electron maps Ctrl and Cmd onto the same shortcut, so the modifier label
// follows the host platform.
const isMac = (window.pine?.platform ?? "darwin") === "darwin";
const modifierLabel =
  props.modifier === "alt" ? (isMac ? "⌥" : "Alt") : isMac ? "⌘" : "Ctrl";
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
    <Kbd>{{ modifierLabel }}</Kbd>
    <Kbd>{{ keyLabel }}</Kbd>
  </KbdGroup>
</template>
