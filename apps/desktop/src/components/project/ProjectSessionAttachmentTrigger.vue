<script setup lang="ts">
import { useI18n } from "vue-i18n";
import { AttachmentTrigger } from "@/components/ui/attachment";
import { useContentTabNavigation } from "@/composables/useContentTabNavigation";
import type { PineAttachment } from "@/shared/attachments";
import { useSessionStore } from "@/stores/session";

/** Opens an attached conversation in a session tab. */
const props = defineProps<{ attachment: PineAttachment }>();

const { t } = useI18n();
const navigation = useContentTabNavigation();
const sessionStore = useSessionStore();

function open(): void {
  const attached = props.attachment.session;
  if (!attached) return;
  const known = sessionStore.allRecentSessions.find(
    (session) => session.id === attached.sessionId,
  );
  navigation.openSession(
    known ?? {
      id: attached.sessionId,
      ...(props.attachment.name ? { name: props.attachment.name } : {}),
      createdAt: props.attachment.modifiedAt,
      updatedAt: props.attachment.modifiedAt,
      messageCount: 0,
    },
    attached.projectId,
  );
}
</script>

<template>
  <AttachmentTrigger
    type="button"
    class="cursor-pointer"
    :aria-label="
      t('project.composer.openAttachment', {
        name:
          attachment.name || t('project.composer.untitledSessionAttachment'),
      })
    "
    @click="open"
  />
</template>
