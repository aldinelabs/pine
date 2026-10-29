<script setup lang="ts">
import {
  BuiltinActionType,
  Renderer,
  type ActionEvent,
  type ParseResult,
} from "@openuidev/vue-lang";
import { computed, inject, ref } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { INTELLIGENT_UI_FENCE_LANGUAGE } from "@/shared/intelligentUi";
import CodeBlock from "@/components/markdown/CodeBlock.vue";
import { intelligentUiHostKey } from "./context";
import {
  interactionMessage,
  readBlockState,
  writeBlockState,
} from "./blockState";
import { intelligentUiLibrary } from "./library";

const props = defineProps<{
  /** OpenUI Lang source from the fence. Grows while the reply streams. */
  code: string;
  /** True until the fence closes. */
  streaming: boolean;
  /** The transcript message the block belongs to, for keeping its state. */
  messageId?: string;
}>();

const { t } = useI18n();
const host = inject(intelligentUiHostKey, undefined);

// Read once: the store owns state after mount, and a later initialState
// would reset what the user changed.
const stateKey = computed(() =>
  props.messageId && !props.streaming
    ? `${props.messageId}\n${props.code}`
    : undefined,
);
const initialState = readBlockState(stateKey.value);

function handleStateUpdate(next: Record<string, unknown>): void {
  writeBlockState(stateKey.value, next);
}

const hasRoot = ref(false);
function handleParseResult(result: ParseResult | null): void {
  hasRoot.value = Boolean(result?.root);
}
/** Show the source instead of an empty block when nothing renders. */
const showSource = computed(() => !props.streaming && !hasRoot.value);

const pendingUrl = ref<string>();

function handleAction(event: ActionEvent): void {
  if (event.type === BuiltinActionType.ContinueConversation) {
    const message = interactionMessage(
      event.humanFriendlyMessage,
      event.formState ?? {},
    );
    if (!message) return;
    if (!host) {
      toast.error(t("intelligentUi.sendUnavailable"));
      return;
    }
    host.send(message);
  } else if (event.type === BuiltinActionType.OpenUrl) {
    const url: unknown = event.params?.url;
    if (typeof url === "string" && /^https?:\/\//iu.test(url))
      pendingUrl.value = url;
  }
}

async function openPendingUrl(): Promise<void> {
  const url = pendingUrl.value;
  pendingUrl.value = undefined;
  if (!url) return;
  try {
    await window.pine.openExternalUrl(url);
  } catch {
    toast.error(t("markdown.externalLinkOpenFailed"));
  }
}
</script>

<template>
  <CodeBlock
    v-if="showSource"
    :node="{
      type: 'code_block',
      language: INTELLIGENT_UI_FENCE_LANGUAGE,
      code: props.code,
    }"
  />
  <!-- Stays mounted while hidden: the Renderer is what reports a root. -->
  <div
    v-show="!showSource"
    data-slot="intelligent-ui-block"
    class="intelligent-ui-block my-2 min-w-0 font-sans text-sm"
  >
    <Renderer
      :response="props.code"
      :library="intelligentUiLibrary"
      :is-streaming="props.streaming"
      :initial-state="initialState"
      :on-action="handleAction"
      :on-state-update="handleStateUpdate"
      :on-parse-result="handleParseResult"
    />
  </div>
  <AlertDialog
    :open="pendingUrl !== undefined"
    @update:open="(open: boolean) => !open && (pendingUrl = undefined)"
  >
    <AlertDialogContent class="sm:max-w-lg">
      <AlertDialogHeader>
        <AlertDialogTitle>
          {{ t("markdown.externalLinkTitle") }}
        </AlertDialogTitle>
        <AlertDialogDescription>
          <span>{{ t("markdown.externalLinkDescription") }}</span>
          <code
            class="mt-2 block max-h-32 overflow-auto break-all rounded-md bg-muted px-3 py-2 text-xs"
          >
            {{ pendingUrl }}
          </code>
        </AlertDialogDescription>
      </AlertDialogHeader>
      <AlertDialogFooter>
        <AlertDialogCancel>{{ t("common.cancel") }}</AlertDialogCancel>
        <Button @click="openPendingUrl">
          {{ t("markdown.openExternalLink") }}
        </Button>
      </AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>
</template>

<style scoped>
/* Blocks sit in the reading column; keep its spacing off the UI chrome. */
.intelligent-ui-block :deep(:is(h3, h4, h5, p, ul, ol)) {
  margin: 0;
}
</style>
