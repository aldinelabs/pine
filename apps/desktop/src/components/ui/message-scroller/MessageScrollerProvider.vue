<script setup lang="ts">
import type { MessageScrollerProviderProps } from "./useMessageScroller";
import { provideMessageScroller } from "./useMessageScroller";

const props = withDefaults(defineProps<MessageScrollerProviderProps>(), {
  active: true,
});

const engine = provideMessageScroller(props);

defineExpose({ isFollowingBottom: engine.context.isFollowingBottom });
</script>

<template>
  <slot />
</template>
