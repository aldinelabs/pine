<script setup lang="ts">
import { MonitorIcon } from "@lucide/vue";
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  isRemoteShell,
  switchComputer,
  usePairedComputerCount,
} from "@/lib/remoteShell";

/**
 * Back to the list of computers; only inside the RC web page, and only when
 * a computer is paired, so another can be added from the list.
 */
const { t } = useI18n();
const pairedComputers = usePairedComputerCount();
const shown = computed(() => isRemoteShell() && pairedComputers.value >= 1);
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
