<script setup lang="ts">
import type { MessageScrollerProviderProps } from "./useMessageScroller";
import { provideMessageScroller } from "./useMessageScroller";

const props = withDefaults(defineProps<MessageScrollerProviderProps>(), {
  active: true,
});

const engine = provideMessageScroller(props);

defineExpose({
  isFollowingBottom: engine.context.isFollowingBottom,
  /** Read-only: whether the viewport is pinned to the live end. */
  followingBottom: engine.context.followingBottom,
});
</script>

<template>
  <slot />
</template>
