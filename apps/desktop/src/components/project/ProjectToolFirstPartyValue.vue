<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import CodeBlock from "@/components/markdown/CodeBlock.vue";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { fileLanguage } from "@/lib/fileLanguage";
import type { PineToolCall } from "@/shared/sessions";
import ProjectToolValueTable from "./ProjectToolValueTable.vue";
import { toolOutputParts, type ToolDetailView } from "./toolViewAdapter";

const props = defineProps<{
  toolCall: PineToolCall;
  section: "parameters" | "result";
  view: Exclude<ToolDetailView, "generic" | "search" | "fetch" | "edit">;
}>();

const { t } = useI18n();
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
const input = computed(() => record(props.toolCall.input));
const details = computed(() => record(record(props.toolCall.output).details));
const parts = computed(() => toolOutputParts(props.toolCall.output));
const questions = computed(() =>
  Array.isArray(input.value.questions) ? input.value.questions.map(record) : [],
);
const answers = computed(() =>
  Array.isArray(details.value.answers) ? details.value.answers.map(record) : [],
);
const files = computed(() =>
  Array.isArray(details.value.files) ? details.value.files.map(record) : [],
);
const resources = computed(() =>
  Array.isArray(details.value.resources)
    ? details.value.resources.map(record)
    : [],
);
const code = computed(() => {
  if (props.view === "shell") {
    return typeof input.value.command === "string"
      ? input.value.command
      : undefined;
  }
  if (
    (props.toolCall.name === "write" ||
      props.toolCall.name === "create_skill" ||
      props.toolCall.name === "edit_skill") &&
    typeof input.value.content === "string"
  ) {
    return input.value.content;
  }
  return undefined;
});
const codeLanguage = computed(() =>
  props.view === "shell"
    ? props.toolCall.name.includes("powershell")
      ? "powershell"
      : "shellscript"
    : props.view === "skill"
      ? "markdown"
      : fileLanguage(
          typeof input.value.path === "string" ? input.value.path : "",
        ),
);
function displayImageReference(value: unknown): unknown {
  const candidate =
    typeof value === "string" ? value : record(record(value).image_url).url;
  return typeof candidate === "string" && candidate.startsWith("data:")
    ? t("project.transcript.toolDetails.embeddedImage")
    : (candidate ?? value);
}
const parameterFields = computed(() =>
  Object.fromEntries(
    Object.entries(input.value)
      .filter(([key]) => {
        if (key === "command" && props.view === "shell") return false;
        if (key === "content" && code.value !== undefined) return false;
        if (
          key === "questions" &&
          props.view === "questionnaire" &&
          questions.value.length
        )
          return false;
        if (key === "prompt" && props.view === "media") return false;
        return true;
      })
      .map(([key, value]) => [
        key,
        key === "input_references" &&
        props.view === "media" &&
        Array.isArray(value)
          ? value.map(displayImageReference)
          : value,
      ]),
  ),
);
const resultDetails = computed(() =>
  Object.fromEntries(
    Object.entries(details.value).filter(([key]) => {
      if (key === "answers" && props.view === "questionnaire") return false;
      if (key === "files" && props.view === "media") return false;
      if (key === "resources" && props.view === "skill") return false;
      return true;
    }),
  ),
);
const hasSpecialResult = computed(
  () =>
    (props.view === "questionnaire" && answers.value.length > 0) ||
    (props.view === "media" && files.value.length > 0) ||
    (props.view === "skill" && resources.value.length > 0),
);
</script>

<template>
  <div v-if="section === 'parameters'" class="flex min-w-0 flex-col gap-3">
    <div
      v-if="view === 'questionnaire' && questions.length"
      class="flex flex-col gap-4"
    >
      <section
        v-for="(question, index) in questions"
        :key="index"
        class="flex flex-col gap-2"
      >
        <Separator v-if="index > 0" class="mb-2" />
        <p
          v-if="question.header || question.multiSelect"
          class="text-xs text-muted-foreground"
        >
          {{ question.header
          }}{{ question.header && question.multiSelect ? " · " : ""
          }}{{
            question.multiSelect
              ? t("project.transcript.toolDetails.multipleChoice")
              : ""
          }}
        </p>
        <p class="font-medium whitespace-pre-wrap">{{ question.question }}</p>
        <ol class="flex flex-col gap-2 pl-4">
          <li
            v-for="(option, optionIndex) in Array.isArray(question.options)
              ? question.options
              : []"
            :key="optionIndex"
            class="list-decimal text-sm"
          >
            <span class="font-medium">{{ record(option).label }}</span>
            <span
              v-if="record(option).description"
              class="text-muted-foreground"
            >
              — {{ record(option).description }}</span
            >
            <pre
              v-if="record(option).preview"
              class="mt-1 whitespace-pre-wrap break-words text-xs text-muted-foreground"
              >{{ record(option).preview }}</pre>
          </li>
        </ol>
      </section>
    </div>
    <p
      v-if="view === 'media' && typeof input.prompt === 'string'"
      class="whitespace-pre-wrap break-words text-sm"
    >
      {{ input.prompt }}
    </p>
    <CodeBlock
      v-if="code !== undefined"
      layout="preview"
      :loading="toolCall.status === 'running'"
      :node="{ type: 'code_block', code, language: codeLanguage }"
    />
    <ProjectToolValueTable
      v-if="Object.keys(parameterFields).length"
      :value="parameterFields"
      :empty-label="t('project.transcript.toolDetails.noParameters')"
    />
    <p
      v-else-if="
        !questions.length &&
        code === undefined &&
        !(view === 'media' && input.prompt)
      "
      class="text-sm text-muted-foreground"
    >
      {{ t("project.transcript.toolDetails.noParameters") }}
    </p>
  </div>

  <div v-else class="flex min-w-0 flex-col gap-3">
    <Table
      v-if="view === 'questionnaire' && answers.length"
      class="table-fixed"
    >
      <TableHeader
        ><TableRow>
          <TableHead>{{
            t("project.transcript.toolDetails.question")
          }}</TableHead>
          <TableHead>{{
            t("project.transcript.toolDetails.answer")
          }}</TableHead>
        </TableRow></TableHeader
      >
      <TableBody>
        <TableRow v-for="(answer, index) in answers" :key="index">
          <TableCell class="align-top whitespace-normal">{{
            answer.question
          }}</TableCell>
          <TableCell class="align-top whitespace-pre-wrap break-words">{{
            answer.answer ??
            (Array.isArray(answer.selected) ? answer.selected.join(", ") : "—")
          }}</TableCell>
        </TableRow>
      </TableBody>
    </Table>
    <Table v-if="view === 'media' && files.length" class="table-fixed">
      <TableHeader
        ><TableRow>
          <TableHead>{{ t("project.transcript.toolDetails.file") }}</TableHead>
          <TableHead>{{
            t("project.transcript.toolDetails.format")
          }}</TableHead>
        </TableRow></TableHeader
      >
      <TableBody>
        <TableRow v-for="(file, index) in files" :key="index">
          <TableCell class="break-all font-mono text-xs">{{
            file.path
          }}</TableCell>
          <TableCell class="whitespace-normal">
            {{ file.mimeType
            }}<span
              v-if="typeof file.bytes === 'number'"
              class="text-muted-foreground"
            >
              · {{ file.bytes }} B</span
            >
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
    <Table v-if="view === 'skill' && resources.length" class="table-fixed">
      <TableHeader
        ><TableRow>
          <TableHead>{{ t("project.transcript.toolDetails.file") }}</TableHead>
          <TableHead>{{ t("project.transcript.toolDetails.kind") }}</TableHead>
        </TableRow></TableHeader
      >
      <TableBody>
        <TableRow v-for="(resource, index) in resources" :key="index">
          <TableCell class="break-all font-mono text-xs">{{
            resource.path
          }}</TableCell>
          <TableCell>
            {{ resource.kind
            }}<span
              v-if="typeof resource.size === 'number'"
              class="text-muted-foreground"
            >
              · {{ resource.size }} B</span
            >
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
    <template v-if="!hasSpecialResult">
      <template v-for="(part, index) in parts" :key="index">
        <pre
          v-if="part.type === 'text'"
          class="max-h-80 overflow-auto rounded-md bg-muted p-3 font-mono text-xs whitespace-pre-wrap break-words"
          >{{ part.text }}</pre>
        <img
          v-else-if="part.imageUrl"
          :src="part.imageUrl"
          :alt="t('project.transcript.toolDetails.imageResult')"
          class="max-h-80 max-w-full rounded-md object-contain"
        />
        <Badge v-else variant="outline">{{
          t("project.transcript.toolDetails.imageResult")
        }}</Badge>
      </template>
    </template>
    <ProjectToolValueTable
      v-if="Object.keys(resultDetails).length"
      :value="resultDetails"
      :empty-label="t('project.transcript.toolDetails.noResult')"
    />
    <ProjectToolValueTable
      v-if="
        !parts.length && !hasSpecialResult && !Object.keys(resultDetails).length
      "
      :value="toolCall.output"
      :empty-label="t('project.transcript.toolDetails.noResult')"
    />
  </div>
</template>
