<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { Badge } from "@/components/ui/badge";
import type {
  AutomationFacts,
  AutomationFolderLabel,
  AutomationTriggerFact,
} from "@/shared/automation";

const props = defineProps<{
  facts: AutomationFacts;
  /** Marks the sections that differ from this version. */
  previous?: AutomationFacts;
}>();

const { t } = useI18n();

function folder(label: AutomationFolderLabel): string {
  const name = label.path
    ? `${label.folderName}/${label.path}`
    : label.folderName;
  return label.missing ? `${name} (${t("automations.facts.missing")})` : name;
}

function trigger(fact: AutomationTriggerFact): string {
  switch (fact.kind) {
    case "schedule":
      return t("automations.facts.schedule", {
        rule: fact.rrule,
        zone: fact.timezone ?? t("automations.facts.localTime"),
      });
    case "folder":
      return t("automations.facts.folder", {
        folder: folder(fact.folder),
        events: fact.events
          .map((event) => t(`automations.facts.change.${event}`))
          .join(", "),
        include: fact.include.length ? fact.include.join(", ") : "*",
      });
    case "system":
      return [
        t(`automations.facts.system.${fact.event}`, {
          minutes: fact.idleMinutes ?? 10,
        }),
        fact.window
          ? t("automations.facts.window", {
              from: fact.window.from,
              to: fact.window.to,
            })
          : "",
        fact.oncePer ? t(`automations.facts.oncePer.${fact.oncePer}`) : "",
      ]
        .filter(Boolean)
        .join(" · ");
    case "script":
      return t("automations.facts.script", {
        every: fact.every,
        hosts: fact.network.join(", ") || t("automations.facts.none"),
      });
    default:
      return t("automations.facts.manual");
  }
}

const rows = computed(() => {
  const facts = props.facts;
  const list = (values: string[]) =>
    values.join(", ") || t("automations.facts.none");
  const changed = (key: keyof AutomationFacts) =>
    props.previous !== undefined &&
    JSON.stringify(props.previous[key]) !== JSON.stringify(facts[key]);
  return [
    {
      key: "triggers",
      label: t("automations.facts.triggers"),
      values: facts.triggers.map(trigger),
      changed: changed("triggers"),
    },
    {
      key: "read",
      label: t("automations.facts.read"),
      values: [list(facts.read.map(folder))],
      changed: changed("read"),
    },
    {
      key: "write",
      label: t("automations.facts.write"),
      values: [list(facts.write.map(folder))],
      changed: changed("write"),
    },
    {
      key: "network",
      label: t("automations.facts.network"),
      values: [list(facts.network)],
      changed: changed("network"),
    },
    {
      key: "tools",
      label: t("automations.facts.tools"),
      values: [list(facts.tools)],
      changed: changed("tools"),
    },
    ...(facts.mcp.length || props.previous?.mcp.length
      ? [
          {
            key: "mcp",
            label: t("automations.facts.mcp"),
            values: facts.mcp.length
              ? facts.mcp.map(
                  (grant) => `${grant.server}: ${grant.tools.join(", ")}`,
                )
              : [t("automations.facts.none")],
            changed: changed("mcp"),
          },
        ]
      : []),
    {
      key: "model",
      label: t("automations.facts.model"),
      values: [
        facts.model
          ? [
              `${facts.model.providerId}/${facts.model.modelId}`,
              facts.model.thinkingLevel
                ? t("automations.facts.thinking", {
                    level: facts.model.thinkingLevel,
                  })
                : "",
            ]
              .filter(Boolean)
              .join(" · ")
          : t("automations.facts.defaultModel"),
      ],
      changed: changed("model"),
    },
    ...(facts.secrets.length || props.previous?.secrets.length
      ? [
          {
            key: "secrets",
            label: t("automations.facts.secrets"),
            values: [list(facts.secrets)],
            changed: changed("secrets"),
          },
        ]
      : []),
    ...(facts.skills.length
      ? [
          {
            key: "skills",
            label: t("automations.facts.skills"),
            values: [list(facts.skills)],
            changed: changed("skills"),
          },
        ]
      : []),
    ...(facts.outputs.length
      ? [
          {
            key: "outputs",
            label: t("automations.facts.outputs"),
            values: [list(facts.outputs.map(folder))],
            changed: changed("outputs"),
          },
        ]
      : []),
    {
      key: "limits",
      label: t("automations.facts.limits"),
      values: [
        t("automations.facts.limitValues", {
          runs: facts.limits.maxRunsPerDay,
          minutes: facts.limits.maxMinutesPerRun,
        }),
      ],
      changed: changed("limits"),
    },
  ];
});
</script>

<template>
  <dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
    <template v-for="row in rows" :key="row.key">
      <dt class="text-muted-foreground">
        {{ row.label }}
        <Badge v-if="row.changed" variant="secondary" class="ml-1">{{
          t("automations.facts.changed")
        }}</Badge>
      </dt>
      <dd class="min-w-0 break-words">
        <p v-for="(value, index) in row.values" :key="index">{{ value }}</p>
      </dd>
    </template>
  </dl>
</template>
