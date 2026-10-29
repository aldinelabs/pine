<script setup lang="ts">
import { CircleStopIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";

const { t } = useI18n();
</script>

<template>
  <Marker data-slot="stopped-marker">
    <MarkerIcon>
      <CircleStopIcon />
    </MarkerIcon>
    <MarkerContent>{{ t("project.transcript.stopped") }}</MarkerContent>
  </Marker>
</template>
