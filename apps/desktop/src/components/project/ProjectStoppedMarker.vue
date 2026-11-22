<script setup lang="ts">
import { CircleStopIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import FirstUseHint from "@/components/help/FirstUseHint.vue";
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
  <FirstUseHint
    id="stopped"
    class="mt-2"
    :text="t('help.hints.stopped')"
    :guide="{ topic: 'steer-stop', step: 1 }"
  />
</template>
