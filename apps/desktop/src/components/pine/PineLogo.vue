<script setup lang="ts">
import { PINE_LOGO_PATH, PINE_LOGO_VIEW_BOX } from "./pineLogoPath";

defineOptions({ inheritAttrs: false });

const viewBox = [
  PINE_LOGO_VIEW_BOX.x,
  PINE_LOGO_VIEW_BOX.y,
  PINE_LOGO_VIEW_BOX.width,
  PINE_LOGO_VIEW_BOX.height,
].join(" ");
</script>

<template>
  <svg
    v-bind="$attrs"
    :viewBox="viewBox"
    fill="currentColor"
    xmlns="http://www.w3.org/2000/svg"
  >
    <path :d="PINE_LOGO_PATH" fill="currentColor" />
  </svg>
</template>
