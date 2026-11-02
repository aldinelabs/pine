<script setup lang="ts">
import { MonitorIcon } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import { isRemoteShell, switchComputer } from "@/lib/remoteShell";

/** Back to the list of computers; only shown inside the RC web page. */
const { t } = useI18n();
const shown = isRemoteShell();
</script>

<template>
  <Button
    v-if="shown"
    data-testid="switch-computer"
    variant="ghost"
    size="sm"
    class="window-no-drag pointer-events-auto text-muted-foreground"
    @click="switchComputer"
  >
    <MonitorIcon data-icon="inline-start" aria-hidden="true" />
    {{ t("project.contentTabs.switchComputer") }}
  </Button>
</template>
