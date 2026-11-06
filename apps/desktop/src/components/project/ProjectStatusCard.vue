<script setup lang="ts">
import { useTemplateRef } from "vue";
import { Card } from "@/components/ui/card";
import { useHeightGlide } from "@/composables/useHeightGlide";

/**
 * A card at the end of the transcript, filling its allocated row space.
 * Its height glides as rows come and go.
 */
useHeightGlide(useTemplateRef("box"), useTemplateRef("content"));
</script>

<template>
  <Card
    size="sm"
    class="status-card w-full min-w-0 max-w-full gap-0 p-(--status-card-inset) shadow-none"
  >
    <div ref="box">
      <div ref="content">
        <slot />
      </div>
    </div>
  </Card>
</template>
