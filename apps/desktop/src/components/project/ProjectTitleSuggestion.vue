<script setup lang="ts">
import { PencilLineIcon } from "@lucide/vue";
import { ref } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { Button } from "@/components/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item";
import type { TitleSuggestionReply } from "@/shared/sessions";
import { useSessionStore } from "@/stores/session";

/**
 * The agent's proposed title for a session the user named. It applies only
 * when the user accepts it; "Not now" and "Don't suggest again" keep the
 * user's title.
 */
const props = defineProps<{
  sessionId: string;
  suggestion: string;
}>();
const { t } = useI18n();
const sessionStore = useSessionStore();
const isReplying = ref(false);

async function reply(answer: "accept" | TitleSuggestionReply): Promise<void> {
  if (isReplying.value) return;
  isReplying.value = true;
  try {
    await sessionStore.replyTitleSuggestion(props.sessionId, answer);
  } catch {
    toast.error(t("project.composer.titleSuggestionFailed"));
  } finally {
    isReplying.value = false;
  }
}
</script>

<template>
  <!-- The transcript tail cancels the gap above it (-mt-8), so the card
       restores it with its own top margin, as the staged messages do. -->
  <Item
    data-slot="title-suggestion"
    variant="outline"
    size="sm"
    class="pointer-events-auto mt-8"
    role="group"
    :aria-label="t('project.composer.titleSuggestion', { title: suggestion })"
  >
    <ItemMedia variant="icon">
      <PencilLineIcon />
    </ItemMedia>
    <ItemContent class="min-w-0">
      <ItemTitle class="wrap-break-word">
        {{ t("project.composer.titleSuggestion", { title: suggestion }) }}
      </ItemTitle>
      <ItemDescription>
        {{ t("project.composer.titleSuggestionHint") }}
      </ItemDescription>
    </ItemContent>
    <ItemActions class="flex-wrap justify-end">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        data-reply="never"
        :disabled="isReplying"
        @click="reply('never')"
      >
        {{ t("project.composer.titleSuggestionNever") }}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        data-reply="dismiss"
        :disabled="isReplying"
        @click="reply('dismiss')"
      >
        {{ t("project.composer.titleSuggestionDismiss") }}
      </Button>
      <Button
        type="button"
        size="sm"
        data-reply="accept"
        :disabled="isReplying"
        @click="reply('accept')"
      >
        {{ t("project.composer.titleSuggestionAccept") }}
      </Button>
    </ItemActions>
  </Item>
</template>
