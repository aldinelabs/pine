<script setup lang="ts">
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

withDefaults(
  defineProps<{
    label: string;
    /** The key that does the same, shown in the tooltip. */
    shortcut?: string;
    /** A second line in the tooltip. */
    hint?: string;
    /** Left out for buttons that are not toggles. */
    pressed?: boolean;
    disabled?: boolean;
  }>(),
  { shortcut: undefined, hint: undefined, pressed: undefined },
);
defineEmits<{ click: [event: MouseEvent] }>();
</script>

<template>
  <Tooltip>
    <TooltipTrigger as-child>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        class="aria-pressed:bg-muted aria-pressed:text-foreground"
        :aria-label="label"
        :aria-pressed="pressed"
        :disabled="disabled"
        @click="$emit('click', $event)"
      >
        <slot />
      </Button>
    </TooltipTrigger>
    <TooltipContent>
      <span class="flex flex-col gap-0.5">
        <span class="flex items-center gap-2">
          {{ label }}
          <Kbd v-if="shortcut">{{ shortcut }}</Kbd>
        </span>
        <span v-if="hint" class="max-w-56 opacity-80">{{ hint }}</span>
      </span>
    </TooltipContent>
  </Tooltip>
</template>
