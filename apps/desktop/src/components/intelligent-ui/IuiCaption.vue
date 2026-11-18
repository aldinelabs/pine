<script setup lang="ts">
import type { ComponentRenderProps } from "@openuidev/vue-lang";
import type { IntelligentUiProps } from "@/shared/intelligentUi";
import { pick } from "./layout";
import { TONE_TEXT } from "./tones";

const props =
  defineProps<ComponentRenderProps<IntelligentUiProps<"Caption">>>();
</script>

<template>
  <p
    data-iui="caption"
    :class="[
      'text-xs leading-relaxed text-pretty whitespace-pre-line',
      pick(TONE_TEXT, props.props.tone) ?? TONE_TEXT.muted,
    ]"
  >
    {{ props.props.text }}
  </p>
</template>
