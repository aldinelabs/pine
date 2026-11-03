import { Type, type TSchema } from "typebox";
import Value from "typebox/value";
import type { AutomationSpec } from "../../shared/automation";

const MAX_SCRIPT_SOURCE_BYTES = 64 * 1024;

const folderGrant = Type.Object(
  {
    folderId: Type.String({ minLength: 1, maxLength: 200 }),
    path: Type.Optional(Type.String({ maxLength: 4_096 })),
  },
  { additionalProperties: false },
);

const weekday = Type.Union(
  ["MO", "TU", "WE", "TH", "FR", "SA", "SU"].map((day) => Type.Literal(day)),
);

const clock = Type.String({ pattern: "^([01][0-9]|2[0-3]):[0-5][0-9]$" });

const timeWindow = Type.Object(
  {
    days: Type.Optional(Type.Array(weekday, { minItems: 1, maxItems: 7 })),
    from: clock,
    to: clock,
  },
  { additionalProperties: false },
);

const hostName = Type.String({
  minLength: 1,
  maxLength: 253,
  pattern: "^[A-Za-z0-9](?:[A-Za-z0-9.-]*[A-Za-z0-9])?$",
});

const glob = Type.String({ minLength: 1, maxLength: 500 });

const trigger = Type.Union([
  Type.Object(
    {
      kind: Type.Literal("schedule"),
      rrule: Type.String({ minLength: 1, maxLength: 1_000 }),
      timezone: Type.Optional(Type.String({ minLength: 1, maxLength: 100 })),
      missed: Type.Optional(
        Type.Union([Type.Literal("run-once"), Type.Literal("skip")]),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("folder"),
      folderId: Type.String({ minLength: 1, maxLength: 200 }),
      path: Type.Optional(Type.String({ maxLength: 4_096 })),
      include: Type.Optional(Type.Array(glob, { maxItems: 50 })),
      exclude: Type.Optional(Type.Array(glob, { maxItems: 50 })),
      events: Type.Array(
        Type.Union([
          Type.Literal("added"),
          Type.Literal("changed"),
          Type.Literal("removed"),
        ]),
        { minItems: 1, maxItems: 3 },
      ),
      settleSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 600 })),
      batchSeconds: Type.Optional(Type.Integer({ minimum: 0, maximum: 3_600 })),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("system"),
      event: Type.Union([
        Type.Literal("resume"),
        Type.Literal("unlock"),
        Type.Literal("app-start"),
        Type.Literal("idle"),
      ]),
      idleMinutes: Type.Optional(Type.Integer({ minimum: 1, maximum: 1_440 })),
      window: Type.Optional(timeWindow),
      oncePer: Type.Optional(
        Type.Union([Type.Literal("day"), Type.Literal("week")]),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      kind: Type.Literal("script"),
      every: Type.String({ minLength: 3, maxLength: 40 }),
      window: Type.Optional(timeWindow),
      source: Type.String({ minLength: 1, maxLength: MAX_SCRIPT_SOURCE_BYTES }),
      capabilities: Type.Object(
        {
          network: Type.Array(hostName, { maxItems: 20 }),
          read: Type.Array(folderGrant, { maxItems: 20 }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    { kind: Type.Literal("manual") },
    { additionalProperties: false },
  ),
]);

const cel = Type.String({ minLength: 1, maxLength: 4_000 });

export const AutomationSpecSchema = Type.Object(
  {
    version: Type.Literal(1),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    description: Type.Optional(Type.String({ maxLength: 2_000 })),
    enabled: Type.Boolean(),
    triggers: Type.Array(trigger, { minItems: 1, maxItems: 10 }),
    when: Type.Optional(cel),
    payload: Type.Optional(
      Type.Record(
        Type.String({ pattern: "^[A-Za-z_][A-Za-z0-9_]{0,63}$" }),
        cel,
      ),
    ),
    action: Type.Object(
      {
        kind: Type.Literal("agent"),
        instructions: Type.String({ minLength: 1, maxLength: 20_000 }),
        skills: Type.Optional(
          Type.Array(Type.String({ minLength: 1, maxLength: 64 }), {
            maxItems: 10,
          }),
        ),
        model: Type.Optional(
          Type.Object(
            {
              providerId: Type.String({ minLength: 1, maxLength: 200 }),
              modelId: Type.String({ minLength: 1, maxLength: 200 }),
            },
            { additionalProperties: false },
          ),
        ),
        session: Type.Literal("new"),
        permissions: Type.Object(
          {
            read: Type.Array(folderGrant, { maxItems: 30 }),
            write: Type.Array(folderGrant, { maxItems: 30 }),
            network: Type.Array(hostName, { maxItems: 30 }),
            tools: Type.Array(Type.String({ minLength: 1, maxLength: 100 }), {
              maxItems: 60,
            }),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    delivery: Type.Object(
      {
        notify: Type.Union([
          Type.Literal("on-findings"),
          Type.Literal("always"),
          Type.Literal("never"),
        ]),
        outputs: Type.Optional(Type.Array(folderGrant, { maxItems: 20 })),
      },
      { additionalProperties: false },
    ),
    secrets: Type.Optional(
      Type.Array(
        Type.Object(
          {
            name: Type.String({
              minLength: 1,
              maxLength: 64,
              pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
            }),
            env: Type.Optional(
              Type.String({ pattern: "^[A-Z_][A-Z0-9_]{0,63}$" }),
            ),
          },
          { additionalProperties: false },
        ),
        { maxItems: 20 },
      ),
    ),
    limits: Type.Optional(
      Type.Object(
        {
          maxRunsPerDay: Type.Optional(
            Type.Integer({ minimum: 1, maximum: 500 }),
          ),
          maxMinutesPerRun: Type.Optional(
            Type.Integer({ minimum: 1, maximum: 240 }),
          ),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);

export interface SpecIssue {
  path: string;
  message: string;
}

function schemaIssues(schema: TSchema, value: unknown): SpecIssue[] {
  if (Value.Check(schema, value)) return [];
  const seen = new Set<string>();
  const issues: SpecIssue[] = [];
  for (const error of Value.Errors(schema, value)) {
    // A union reports one failure per branch; the instance path is enough.
    const key = `${error.instancePath}:${error.message}`;
    if (seen.has(key) || error.keyword === "boolean") continue;
    seen.add(key);
    issues.push({ path: error.instancePath || "/", message: error.message });
    if (issues.length >= 20) break;
  }
  return issues;
}

/** Structural validation; semantic checks live in validate.ts. */
export function parseAutomationSpec(
  value: unknown,
): { ok: true; spec: AutomationSpec } | { ok: false; issues: SpecIssue[] } {
  const issues = schemaIssues(AutomationSpecSchema, value);
  if (issues.length > 0) return { ok: false, issues };
  const spec = structuredClone(value) as AutomationSpec;
  if (
    spec.triggers.some(
      (trigger) =>
        trigger.kind === "script" &&
        Buffer.byteLength(trigger.source, "utf8") > MAX_SCRIPT_SOURCE_BYTES,
    )
  )
    return {
      ok: false,
      issues: [{ path: "/triggers", message: "Script source exceeds 64 KiB." }],
    };
  return { ok: true, spec };
}
