<script setup lang="ts">
import { computed, ref, shallowRef, watch } from "vue";
import { useI18n } from "vue-i18n";
import { toast } from "vue-sonner";
import { PHONE_FULLSCREEN_DIALOG } from "@/lib/dialogLayout";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import DialogScrollArea from "@/components/dialogs/DialogScrollArea.vue";
import { Textarea } from "@/components/ui/textarea";
import type { PineJsonValue } from "@/shared/agent";
import type {
  AutomationDetail,
  CheckAutomationResult,
} from "@/shared/automation";
import AutomationFactsList from "./AutomationFactsList.vue";

/**
 * Write or change an automation's definition by hand. Pine checks it the way
 * it checks the agent's; saving it here is the user's own approval, so it
 * is only offered in Pine on this computer.
 */
const props = defineProps<{
  projectId: string;
  /** The automation to change; absent for a new one. */
  automation?: AutomationDetail | null;
}>();
const open = defineModel<boolean>("open", { default: false });
const emit = defineEmits<{ saved: [id: string] }>();

const { t } = useI18n();
const text = ref("");
const parseError = ref("");
const checking = ref(false);
const saving = ref(false);
const result = shallowRef<CheckAutomationResult | null>(null);
const saveErrors = ref<string[]>([]);

/** Enough to start from; the check says what is still missing. */
function starter(): PineJsonValue {
  return {
    version: 1,
    name: "",
    enabled: true,
    triggers: [
      {
        kind: "schedule",
        rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
      },
    ],
    action: {
      kind: "agent",
      instructions: "",
      permissions: { tools: ["read"] },
    },
    delivery: { notify: "on-findings" },
  };
}

watch(
  open,
  (isOpen) => {
    if (!isOpen) return;
    text.value = JSON.stringify(props.automation?.spec ?? starter(), null, 2);
    parseError.value = "";
    result.value = null;
    saveErrors.value = [];
  },
  { immediate: true },
);

const dryRunText = computed(() =>
  result.value?.dryRun === undefined
    ? ""
    : JSON.stringify(result.value.dryRun, null, 2),
);

const errors = computed(() => [
  ...(result.value?.errors ?? []),
  ...saveErrors.value,
]);

function parse(): PineJsonValue | undefined {
  parseError.value = "";
  try {
    const value: unknown = JSON.parse(text.value);
    if (!value || typeof value !== "object" || Array.isArray(value))
      throw new Error();
    return value as PineJsonValue;
  } catch {
    parseError.value = t("automations.editor.invalidJson");
    return undefined;
  }
}

async function check(): Promise<void> {
  const spec = parse();
  if (spec === undefined) return;
  checking.value = true;
  saveErrors.value = [];
  try {
    result.value = await window.pine.automations.check({
      projectId: props.projectId,
      spec,
      dryRun: true,
    });
  } catch (cause) {
    toast.error(cause instanceof Error ? cause.message : String(cause));
  } finally {
    checking.value = false;
  }
}

async function save(): Promise<void> {
  const spec = parse();
  if (spec === undefined) return;
  saving.value = true;
  saveErrors.value = [];
  try {
    const saved = await window.pine.automations.save({
      projectId: props.projectId,
      spec,
      ...(props.automation
        ? {
            automationId: props.automation.id,
            baseRevision: props.automation.revision,
          }
        : {}),
    });
    if ("errors" in saved) {
      saveErrors.value = saved.errors;
      return;
    }
    toast.success(t("automations.editor.saved"));
    open.value = false;
    emit("saved", saved.id);
  } catch (cause) {
    saveErrors.value = [cause instanceof Error ? cause.message : String(cause)];
  } finally {
    saving.value = false;
  }
}
</script>

<template>
  <Dialog v-model:open="open">
    <DialogContent
      data-testid="automation-editor"
      :class="[
        'flex max-h-[85vh] flex-col sm:max-w-3xl',
        PHONE_FULLSCREEN_DIALOG,
      ]"
    >
      <DialogHeader>
        <DialogTitle>{{
          automation
            ? t("automations.editor.editTitle", { name: automation.name })
            : t("automations.editor.newTitle")
        }}</DialogTitle>
        <DialogDescription>{{
          t("automations.editor.description")
        }}</DialogDescription>
      </DialogHeader>
      <DialogScrollArea class="flex-1">
        <FieldGroup>
          <Field :data-invalid="!!parseError || errors.length > 0">
            <FieldLabel for="automation-definition">{{
              t("automations.editor.definition")
            }}</FieldLabel>
            <Textarea
              id="automation-definition"
              v-model="text"
              :aria-invalid="!!parseError || errors.length > 0"
              class="min-h-72 font-mono text-xs"
              spellcheck="false"
              @input="result = null"
            />
            <FieldDescription>{{
              t("automations.editor.definitionHelp")
            }}</FieldDescription>
            <FieldError v-if="parseError">{{ parseError }}</FieldError>
            <FieldError v-for="error in errors" :key="error">{{
              error
            }}</FieldError>
          </Field>
          <template v-if="result && result.errors.length === 0">
            <p
              v-for="warning in result.warnings"
              :key="warning"
              class="text-sm text-muted-foreground"
            >
              {{ warning }}
            </p>
            <AutomationFactsList v-if="result.facts" :facts="result.facts" />
            <details v-if="result.dryRun !== undefined" class="text-sm">
              <summary class="cursor-pointer text-muted-foreground">
                {{ t("automations.editor.dryRun") }}
              </summary>
              <pre
                class="mt-2 overflow-x-auto rounded-md bg-muted p-3 text-xs"
                >{{ dryRunText }}</pre>
            </details>
          </template>
        </FieldGroup>
      </DialogScrollArea>
      <DialogFooter>
        <Button variant="outline" @click="open = false">{{
          t("common.cancel")
        }}</Button>
        <Button
          variant="outline"
          :disabled="checking || saving"
          @click="check"
          >{{ t("automations.editor.check") }}</Button
        >
        <Button :disabled="saving || checking" @click="save">{{
          t("automations.editor.save")
        }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
