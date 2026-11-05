<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSideChatStore } from "@/stores/sideChat";

/** Asks before a plain side chat, which is not saved, goes away. */
const { t } = useI18n();
const sideChats = useSideChatStore();
const open = computed({
  get: () => sideChats.discardRequest !== null,
  set: (value: boolean) => {
    if (!value) sideChats.answerDiscard(false);
  },
});
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{
          t("project.sideChat.discardTitle")
        }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("project.sideChat.discardDescription") }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
        <!-- A plain button: the dialog's own action would close it first,
             which answers the request as cancelled. -->
        <Button variant="destructive" @click="sideChats.answerDiscard(true)">
          {{ t("project.sideChat.discard") }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
