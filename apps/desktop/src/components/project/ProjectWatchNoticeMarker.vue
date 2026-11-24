<script setup lang="ts">
import { BellIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import type { PineWatchNotice } from "@/shared/sessions";

/** A reminder the user asked the Assistant for, as it went off. */
defineProps<{ notice: PineWatchNotice }>();

const { t } = useI18n();
</script>

<template>
  <Marker data-testid="project-watch-notice-marker">
    <MarkerIcon>
      <BellIcon />
    </MarkerIcon>
    <MarkerContent>
      {{ t("project.transcript.watchNotice", { label: notice.label }) }}
    </MarkerContent>
  </Marker>
</template>
