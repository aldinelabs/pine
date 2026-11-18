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
  /** Keep the view still while an edited message is resent. */
  holdViewForRewrite: engine.context.holdViewForRewrite,
  releaseRewriteHold: engine.context.releaseRewriteHold,
  /** Send a turn without moving the view, or scroll to sent turns again. */
  holdViewForNextTurn: engine.context.holdViewForNextTurn,
  releaseTurnHold: engine.context.releaseTurnHold,
  revealNextTurn: engine.context.revealNextTurn,
  scrollToEnd: engine.context.scrollToEnd,
});
</script>

<template>
  <slot />
</template>
