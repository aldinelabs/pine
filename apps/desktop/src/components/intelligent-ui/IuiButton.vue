<script setup lang="ts">
import { useIsStreaming, type ComponentRenderProps } from "@openuidev/vue-lang";
import { computed } from "vue";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { useRunAction } from "./context";
import { iuiIcon } from "./icons";

const props = defineProps<ComponentRenderProps<IntelligentUiProps<"Button">>>();
const isStreaming = useIsStreaming();
const runAction = useRunAction();

const SIZE = { sm: "sm", md: "default", lg: "lg" } as const;
/** A soft fill in the button's colour, for secondary actions with a tone. */
const SOFT = {
  primary: "bg-primary/10 text-primary hover:bg-primary/15",
  danger: "",
  success:
    "bg-emerald-600/10 text-emerald-700 hover:bg-emerald-600/15 dark:bg-emerald-400/15 dark:text-emerald-400",
} as const;
const SOLID = {
  primary: "",
  danger:
    "bg-destructive text-white hover:bg-destructive/85 dark:bg-destructive/80",
  success:
    "bg-emerald-600 text-white hover:bg-emerald-600/85 dark:bg-emerald-500",
} as const;
const OUTLINE = {
  primary: "",
  danger: "text-destructive hover:text-destructive",
  success:
    "text-emerald-700 hover:text-emerald-700 dark:text-emerald-400 dark:hover:text-emerald-400",
} as const;

/** soft is shadcn's tinted secondary; a danger soft button is its destructive. */
const variant = computed(() => {
  const { variant: requested, color } = props.props;
  if (requested === "soft")
    return color === "danger" ? "destructive" : "secondary";
  return requested ?? "default";
});

const toneClass = computed(() => {
  const color = props.props.color;
  if (!color || !(color in SOLID)) return undefined;
  const requested = props.props.variant ?? "default";
  if (requested === "soft") return SOFT[color];
  if (requested === "default") return SOLID[color];
  if (requested === "outline" || requested === "ghost") return OUTLINE[color];
  return undefined;
});
const icon = computed(() => iuiIcon(props.props.icon));
</script>

<template>
  <Button
    data-iui="button"
    type="button"
    :class="cn(props.props.block ? 'w-full' : 'w-fit', toneClass)"
    :variant="variant"
    :size="SIZE[props.props.size ?? 'md'] ?? 'default'"
    :disabled="isStreaming || props.props.disabled === true"
    @click="runAction(props.props.label, props.props.action)"
  >
    <component :is="icon" v-if="icon" data-icon="inline-start" />
    {{ props.props.label }}
  </Button>
</template>
