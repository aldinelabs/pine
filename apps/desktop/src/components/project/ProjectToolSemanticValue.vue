<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import CodeBlock from "@/components/markdown/CodeBlock.vue";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableEmpty,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { PineToolCall } from "@/shared/sessions";
import ProjectToolFirstPartyValue from "./ProjectToolFirstPartyValue.vue";
import ProjectToolValueTable from "./ProjectToolValueTable.vue";
import {
  editDiffCode,
  editHunks,
  webResults,
  type ToolDetailView,
} from "./toolViewAdapter";

const props = defineProps<{
  toolCall: PineToolCall;
  section: "parameters" | "result";
  view: ToolDetailView;
}>();

const { t } = useI18n();
const input = computed(() => {
  const value = props.toolCall.input;
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
});
const hunks = computed(() => editHunks(props.toolCall.input));
const results = computed(() => webResults(props.toolCall.output));
const webDetails = computed(() => {
  const output = props.toolCall.output;
  if (typeof output !== "object" || output === null || Array.isArray(output))
    return {};
  const details = (output as Record<string, unknown>).details;
  if (typeof details !== "object" || details === null || Array.isArray(details))
    return {};
  return Object.fromEntries(
    Object.entries(details).filter(([key]) => key !== "faviconDataUrl"),
  );
});
const primaryParameter = computed(() =>
  props.view === "search" ? input.value.query : input.value.urls,
);
const otherParameters = computed(() => {
  return Object.fromEntries(
    Object.entries(input.value).filter(
      ([key]) => key !== "query" && key !== "urls",
    ),
  );
});
const isWeb = computed(() => props.view === "search" || props.view === "fetch");
const semanticResult = computed(
  () => isWeb.value && results.value !== undefined,
);
const fallbackView = computed<
  Exclude<ToolDetailView, "generic" | "search" | "fetch" | "edit">
>(() =>
  props.view === "edit" || props.view === "search" || props.view === "fetch"
    ? "file"
    : props.view === "generic"
      ? "file"
      : props.view,
);
const emptyLabel = computed(() =>
  t(
    props.section === "parameters"
      ? "project.transcript.toolDetails.noParameters"
      : "project.transcript.toolDetails.noResult",
  ),
);
</script>

<template>
  <div
    v-if="section === 'parameters' && view === 'edit'"
    class="flex flex-col gap-4"
  >
    <p
      v-if="typeof input.path === 'string'"
      class="break-all font-mono text-xs text-muted-foreground"
    >
      {{ input.path }}
    </p>
    <div
      v-for="(hunk, index) in hunks"
      :key="index"
      class="flex flex-col gap-2"
    >
      <p v-if="hunks.length > 1" class="text-sm font-medium">
        {{ t("project.transcript.toolDetails.editHunk", { count: index + 1 }) }}
      </p>
      <CodeBlock
        :loading="toolCall.status === 'running'"
        :node="{
          type: 'code_block',
          code: editDiffCode(hunk),
          language: 'diff',
        }"
      />
    </div>
  </div>

  <div
    v-else-if="section === 'parameters' && isWeb"
    class="flex flex-col gap-3"
  >
    <div
      v-if="typeof primaryParameter === 'string'"
      class="flex flex-wrap gap-2"
    >
      <Badge variant="secondary" class="max-w-full whitespace-normal">{{
        primaryParameter
      }}</Badge>
    </div>
    <div
      v-else-if="Array.isArray(primaryParameter)"
      class="flex flex-wrap gap-2"
    >
      <Badge
        v-for="(url, index) in primaryParameter"
        :key="index"
        variant="outline"
        class="max-w-full break-all whitespace-normal font-mono"
      >
        {{ url }}
      </Badge>
    </div>
    <ProjectToolValueTable
      v-if="Object.keys(otherParameters).length"
      :value="otherParameters"
      :empty-label="emptyLabel"
    />
    <p v-else-if="!primaryParameter" class="text-sm text-muted-foreground">
      {{ emptyLabel }}
    </p>
  </div>

  <div
    v-else-if="section === 'result' && semanticResult && view === 'search'"
    data-web-results
  >
    <Table class="table-fixed">
      <TableHeader>
        <TableRow>
          <TableHead class="w-1/3">{{
            t("project.transcript.toolDetails.webPage")
          }}</TableHead>
          <TableHead>{{
            t("project.transcript.toolDetails.webSnippet")
          }}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableEmpty v-if="!results?.length" :colspan="2">{{
          emptyLabel
        }}</TableEmpty>
        <TableRow v-for="(result, index) in results" v-else :key="index">
          <TableCell class="align-top whitespace-normal">
            <div class="font-medium wrap-break-word">
              {{ result.title || result.url || "—" }}
            </div>
            <div
              v-if="result.url"
              class="mt-1 break-all font-mono text-xs text-muted-foreground"
            >
              {{ result.url }}
            </div>
          </TableCell>
          <TableCell class="align-top whitespace-pre-wrap break-words">
            {{ result.snippet || result.content || "—" }}
            <pre
              v-if="Object.keys(result.metadata).length"
              class="mt-2 overflow-auto font-mono text-xs text-muted-foreground whitespace-pre-wrap"
              >{{ JSON.stringify(result.metadata, null, 2) }}</pre>
          </TableCell>
        </TableRow>
      </TableBody>
    </Table>
    <ProjectToolValueTable
      v-if="Object.keys(webDetails).length"
      :value="webDetails"
      :empty-label="emptyLabel"
    />
  </div>

  <div
    v-else-if="section === 'result' && semanticResult && view === 'fetch'"
    class="flex flex-col gap-3"
    data-web-results
  >
    <div
      v-for="(result, index) in results"
      :key="index"
      class="flex min-w-0 flex-col gap-1"
    >
      <p v-if="result.title" class="font-medium">{{ result.title }}</p>
      <p
        v-if="result.url"
        class="break-all font-mono text-xs text-muted-foreground"
      >
        {{ result.url }}
      </p>
      <pre
        v-if="result.content || result.snippet"
        class="max-h-80 overflow-auto rounded-md bg-muted p-3 text-xs whitespace-pre-wrap break-words"
        >{{ result.content || result.snippet }}</pre>
      <ProjectToolValueTable
        v-if="Object.keys(result.metadata).length"
        :value="result.metadata"
        :empty-label="emptyLabel"
      />
    </div>
    <p v-if="!results?.length" class="text-sm text-muted-foreground">
      {{ emptyLabel }}
    </p>
    <ProjectToolValueTable
      v-if="Object.keys(webDetails).length"
      :value="webDetails"
      :empty-label="emptyLabel"
    />
  </div>

  <ProjectToolFirstPartyValue
    v-else-if="view !== 'generic'"
    :tool-call="toolCall"
    :section="section"
    :view="fallbackView"
  />

  <ProjectToolValueTable
    v-else
    :value="section === 'parameters' ? toolCall.input : toolCall.output"
    :empty-label="emptyLabel"
  />
</template>
