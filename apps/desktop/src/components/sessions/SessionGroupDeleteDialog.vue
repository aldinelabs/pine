<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { PineSessionGroup } from "@/shared/projects";

const props = withDefaults(
  defineProps<{
    group: PineSessionGroup | null;
    isDeleting?: boolean;
  }>(),
  { isDeleting: false },
);
const emit = defineEmits<{
  confirm: [];
}>();
const open = defineModel<boolean>("open", { required: true });

const { t } = useI18n();
const groupName = computed(() => props.group?.name ?? "");
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{
          t("sessions.deleteGroupTitle")
        }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("sessions.deleteGroupDescription", { name: groupName }) }}
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isDeleting">
          {{ t("common.cancel") }}
        </AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          :disabled="isDeleting"
          @click="emit('confirm')"
        >
          {{ t("common.delete") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
