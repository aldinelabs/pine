<script setup lang="ts">
import { computed } from "vue";
import { cn } from "@/lib/utils";
import { USER_COLOR_CLASSES } from "@/lib/userColors";
import {
  userInitial,
  type PineUserAvatar,
  type PineUserColor,
} from "@/shared/users";

/** A user's emoji, or the first letter of their name, on their colour. */
const props = withDefaults(
  defineProps<{
    name: string;
    avatar: PineUserAvatar | null;
    color: PineUserColor;
    size?: "xs" | "sm" | "md" | "lg" | "xl";
    class?: string;
  }>(),
  { size: "md", class: undefined },
);

const SIZES = {
  xs: "size-5 text-[0.625rem]",
  sm: "size-7 text-xs",
  md: "size-9 text-sm",
  lg: "size-14 text-xl",
  xl: "size-24 text-4xl",
} as const;

const EMOJI_SIZES = {
  xs: "text-xs",
  sm: "text-base",
  md: "text-lg",
  lg: "text-3xl",
  xl: "text-5xl",
} as const;

const initial = computed(() => userInitial(props.name));
</script>

<template>
  <span
    data-slot="user-avatar"
    aria-hidden="true"
    :class="
      cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-medium leading-none',
        SIZES[props.size],
        USER_COLOR_CLASSES[props.color].tile,
        props.class,
      )
    "
  >
    <span v-if="props.avatar" :class="EMOJI_SIZES[props.size]">
      {{ props.avatar }}
    </span>
    <template v-else>{{ initial }}</template>
  </span>
</template>
