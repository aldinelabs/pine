<script setup lang="ts">
import { PINE_LOGO_PATH, PINE_LOGO_VIEW_BOX } from "@/logo";
</script>

<template>
  <svg :viewBox="PINE_LOGO_VIEW_BOX" fill="currentColor" aria-hidden="true">
    <path :d="PINE_LOGO_PATH" />
  </svg>
</template>
