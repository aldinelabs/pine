<script setup lang="ts">
import { computed } from "vue";
import CodeBlock from "@/components/markdown/CodeBlock.vue";

const props = defineProps<{
  value: unknown;
  emptyLabel: string;
}>();

/** Tool payloads often arrive as serialized JSON; show them as structure. */
function parseJsonString(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const candidate = value.trim();
  if (!(
    (candidate.startsWith("{") && candidate.endsWith("}")) ||
    (candidate.startsWith("[") && candidate.endsWith("]"))
  )) {
    return value;
  }
  try {
    return JSON.parse(candidate) as unknown;
  } catch {
    return value;
  }
}

function toJson(value: unknown): string {
  const ancestors: object[] = [];
  return (
    JSON.stringify(
      value,
      function (this: unknown, _key, child: unknown) {
        // `this` is the holder; drop ancestors we have already left.
        while (ancestors.length && ancestors.at(-1) !== this) ancestors.pop();
        const parsed = parseJsonString(child);
        if (typeof parsed === "bigint") return parsed.toString();
        if (typeof parsed !== "object" || parsed === null) return parsed;
        if (ancestors.includes(parsed)) return "[Circular]";
        ancestors.push(parsed);
        return parsed;
      },
      2,
    ) ?? String(value)
  );
}

const block = computed(() => {
  if (props.value === undefined) return undefined;
  const parsed = parseJsonString(props.value);
  // A bare string reads better as text than as one escaped JSON literal.
  if (typeof parsed === "string") return { code: parsed, language: "text" };
  return { code: toJson(parsed), language: "json" };
});
</script>

<template>
  <div
    v-if="block"
    data-tool-json-value
    class="tool-json-value min-w-0 [&_[data-slot=code-block]]:my-0"
  >
    <CodeBlock
      wrap
      :node="{ type: 'code_block', code: block.code, language: block.language }"
    />
  </div>
  <p v-else class="text-sm text-muted-foreground">{{ emptyLabel }}</p>
</template>

<style scoped>
.tool-json-value :deep(.code-highlight) {
  max-height: 24rem;
  overflow-y: auto;
}

.tool-json-value :deep(.code-highlight pre) {
  font-size: 0.75rem;
}
</style>
