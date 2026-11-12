<script setup lang="ts">
import { withoutRelayPrefix } from "@/shared/sessions";
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import { handleError } from "@/app/errors/errorHandler";
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
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import type { PineSessionSummary } from "@/shared/sessions";
import { useSessionStore } from "@/stores/session";

const props = withDefaults(
  defineProps<{
    session: PineSessionSummary | null;
    /** Sub-sessions that are deleted together with it. */
    subSessionIds?: string[];
  }>(),
  { subSessionIds: () => [] },
);
const open = defineModel<boolean>("open", { required: true });

const { t } = useI18n();
const sessionStore = useSessionStore();
const tabNavigation = useContentTabNavigation();
const isDeleting = ref(false);

const sessionTitle = computed(
  () =>
    props.session?.name ||
    (props.session?.preview && withoutRelayPrefix(props.session.preview)) ||
    t("sessions.newSession"),
);

async function deleteSession(): Promise<void> {
  const target = props.session;
  if (!target || isDeleting.value) return;

  isDeleting.value = true;
  try {
    const subSessionIds = [...props.subSessionIds];
    await sessionStore.deleteSession(target.id);
    tabNavigation.removeSession(target.id);
    for (const id of subSessionIds) tabNavigation.removeSession(id);
    open.value = false;
  } catch (error) {
    handleError(error, {
      id: "sessions.dialog.delete",
      title: t("errors.sessionDelete.title"),
      description: t("errors.sessionDelete.description"),
    });
  } finally {
    isDeleting.value = false;
  }
}
</script>

<template>
  <AlertDialog v-model:open="open">
    <AlertDialogContent>
      <AlertDialogHeader>
        <AlertDialogTitle>{{ t("sessions.deleteTitle") }}</AlertDialogTitle>
        <AlertDialogDescription>
          {{ t("sessions.deleteDescription", { name: sessionTitle }) }}
          <template v-if="subSessionIds.length">
            {{
              t("sessions.deleteSubSessions", { count: subSessionIds.length })
            }}
          </template>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel :disabled="isDeleting">
          {{ t("common.cancel") }}
        </AlertDialogCancel>
        <AlertDialogAction
          variant="destructive"
          :disabled="isDeleting"
          @click="deleteSession"
        >
          {{ t("common.delete") }}
        </AlertDialogAction>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>
