import path from "node:path";
import type {
  AutomationFacts,
  AutomationFolderGrant,
  AutomationFolderLabel,
  AutomationSpec,
  AutomationTriggerFact,
  AutomationWarning,
} from "../../shared/automation";
import {
  AUTOMATION_DEFAULTS,
  automationSecretEnvName,
} from "../../shared/automation";
import {
  automationToolById,
  automationToolByName,
  automationToolName,
} from "../../shared/automationTools";
import type { PineProject } from "../../shared/projects";
import { checkCel } from "./cel";
import { parseAutomationSpec } from "./schema";
import { checkScriptSyntax } from "./script";
import {
  isValidTimeZone,
  parseIsoDuration,
  parseRrule,
  smallestGapMs,
  systemTimeZone,
} from "./time";

const MIN_INTERVAL_MS = 5 * 60_000;
const RESERVED_ENV = new Set([
  "PATH",
  "HOME",
  "USER",
  "SHELL",
  "TMPDIR",
  "PINE_TMPDIR",
  "NODE_OPTIONS",
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
]);

export interface ValidationEnvironment {
  project: PineProject;
  secrets: { name: string; hasValue: boolean }[];
  /** Skill names available to the project; undefined skips the check. */
  skills?: string[];
  /** Whether a model exists; undefined skips the check. */
  hasModel?: (providerId: string, modelId: string) => boolean;
  /** Configured MCP server names; undefined skips the check. */
  mcpServers?: string[];
  /** System events the host can observe. */
  systemEvents: ReadonlySet<string>;
  afterExternalContent?: boolean;
  now?: Date;
}

export interface ValidationResult {
  errors: string[];
  warnings: AutomationWarning[];
  spec?: AutomationSpec;
  facts?: AutomationFacts;
}

/** Portable relative path inside a folder, without `..` or a leading slash. */
export function normalizeGrantPath(value: string | undefined): string {
  const portable = (value ?? "").replaceAll("\\", "/");
  const normalized = path.posix
    .normalize(`/${portable}`)
    .slice(1)
    .replace(/\/$/, "");
  return normalized === "." ? "" : normalized;
}

function grantPathError(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const portable = value.replaceAll("\\", "/");
  if (
    portable.includes("\0") ||
    path.posix.isAbsolute(portable) ||
    /^[A-Za-z]:/.test(portable)
  )
    return "must be a relative path inside the folder";
  if (portable.split("/").includes("..")) return "must not contain ..";
  return undefined;
}

function contains(parent: string, child: string): boolean {
  return parent === "" || child === parent || child.startsWith(`${parent}/`);
}

export function grantsOverlap(
  a: AutomationFolderGrant,
  b: AutomationFolderGrant,
): boolean {
  if (a.folderId !== b.folderId) return false;
  const left = normalizeGrantPath(a.path);
  const right = normalizeGrantPath(b.path);
  return contains(left, right) || contains(right, left);
}

export function grantCovers(
  grants: readonly AutomationFolderGrant[],
  target: AutomationFolderGrant,
): boolean {
  return grants.some(
    (grant) =>
      grant.folderId === target.folderId &&
      contains(normalizeGrantPath(grant.path), normalizeGrantPath(target.path)),
  );
}

export function folderLabel(
  project: PineProject,
  grant: AutomationFolderGrant,
): AutomationFolderLabel {
  const folder = project.folders.find(
    (candidate) => candidate.id === grant.folderId,
  );
  const relative = normalizeGrantPath(grant.path);
  return {
    folderId: grant.folderId,
    folderName: folder?.name ?? grant.folderId,
    ...(relative ? { path: relative } : {}),
    ...(!folder || !folder.isAvailable ? { missing: true } : {}),
  };
}

/** Replaces tool names with their stable IDs. */
export function toStoredSpec(spec: AutomationSpec): AutomationSpec {
  const stored = structuredClone(spec);
  stored.action.permissions.tools = spec.action.permissions.tools.map(
    (name) => automationToolByName(name)?.id ?? name,
  );
  return stored;
}

/** Replaces tool IDs with current names; removed tools keep a marker. */
export function fromStoredSpec(spec: AutomationSpec): AutomationSpec {
  const current = structuredClone(spec);
  current.action.permissions.tools = spec.action.permissions.tools.map((id) => {
    const entry = automationToolById(id);
    if (!entry) return id;
    return entry.removed ? `removed:${id}` : automationToolName(entry);
  });
  return current;
}

export function removedToolsOf(storedSpec: AutomationSpec): string[] {
  return storedSpec.action.permissions.tools.filter((id) => {
    const entry = automationToolById(id);
    return !entry || entry.removed;
  });
}

export function buildFacts(
  spec: AutomationSpec,
  project: PineProject,
): AutomationFacts {
  const label = (grant: AutomationFolderGrant) => folderLabel(project, grant);
  const triggers = spec.triggers.map((trigger): AutomationTriggerFact => {
    switch (trigger.kind) {
      case "schedule":
        return {
          kind: "schedule",
          rrule: trigger.rrule,
          ...(trigger.timezone ? { timezone: trigger.timezone } : {}),
          missed: trigger.missed ?? AUTOMATION_DEFAULTS.missed,
        };
      case "folder":
        return {
          kind: "folder",
          folder: label({ folderId: trigger.folderId, path: trigger.path }),
          include: trigger.include ?? [],
          exclude: trigger.exclude ?? [],
          events: trigger.events,
        };
      case "system":
        return {
          kind: "system",
          event: trigger.event,
          ...(trigger.idleMinutes ? { idleMinutes: trigger.idleMinutes } : {}),
          ...(trigger.window ? { window: trigger.window } : {}),
          ...(trigger.oncePer ? { oncePer: trigger.oncePer } : {}),
        };
      case "script":
        return {
          kind: "script",
          every: trigger.every,
          ...(trigger.window ? { window: trigger.window } : {}),
          network: trigger.capabilities.network,
          read: trigger.capabilities.read.map(label),
          source: trigger.source,
        };
      default:
        return { kind: "manual" };
    }
  });
  return {
    name: spec.name,
    triggers,
    read: spec.action.permissions.read.map(label),
    write: spec.action.permissions.write.map(label),
    network: spec.action.permissions.network,
    tools: spec.action.permissions.tools,
    mcp: spec.action.permissions.mcp ?? [],
    secrets: (spec.secrets ?? []).map((secret) => secret.name),
    skills: spec.action.skills ?? [],
    ...(spec.action.model ? { model: spec.action.model } : {}),
    notify: spec.delivery.notify,
    outputs: (spec.delivery.outputs ?? []).map(label),
    limits: {
      maxRunsPerDay:
        spec.limits?.maxRunsPerDay ?? AUTOMATION_DEFAULTS.maxRunsPerDay,
      maxMinutesPerRun:
        spec.limits?.maxMinutesPerRun ?? AUTOMATION_DEFAULTS.maxMinutesPerRun,
    },
  };
}

export function buildWarnings(
  spec: AutomationSpec,
  project: PineProject,
  afterExternalContent = false,
): AutomationWarning[] {
  const warnings: AutomationWarning[] = [];
  const scriptHosts = new Set<string>();
  for (const trigger of spec.triggers) {
    if (trigger.kind !== "script") continue;
    for (const host of trigger.capabilities.network) scriptHosts.add(host);
    if (
      trigger.capabilities.read.length > 0 &&
      trigger.capabilities.network.length > 0
    )
      warnings.push({
        code: "script-read-and-network",
        hosts: trigger.capabilities.network,
      });
  }
  const tools = spec.action.permissions.tools.map((name) =>
    automationToolByName(name),
  );
  const networkTools = tools
    .filter((entry) => entry?.network)
    .map((entry) => automationToolName(entry!));
  const executionHosts = [...spec.action.permissions.network];
  if (executionHosts.length > 0 || networkTools.length > 0)
    warnings.push({
      code: "network-execution",
      hosts: [...executionHosts, ...networkTools.map((tool) => `${tool}:*`)],
    });
  const secrets = (spec.secrets ?? []).map((secret) => secret.name);
  const reachable = [
    ...new Set([
      ...scriptHosts,
      ...executionHosts,
      ...(networkTools.length > 0 ? ["*"] : []),
    ]),
  ];
  if (secrets.length > 0 && reachable.length > 0)
    warnings.push({ code: "secret-network", secrets, hosts: reachable });
  for (const trigger of spec.triggers) {
    if (trigger.kind !== "folder") continue;
    const watched = { folderId: trigger.folderId, path: trigger.path };
    if (
      spec.action.permissions.write.some((grant) =>
        grantsOverlap(grant, watched),
      )
    )
      warnings.push({
        code: "folder-overlaps-write",
        folder: folderLabel(project, watched),
      });
  }
  const privileged = tools
    .filter((entry) => entry?.privileged)
    .map((entry) => automationToolName(entry!));
  if (privileged.length > 0)
    warnings.push({ code: "privileged-tools", tools: privileged });
  const mcpServers = (spec.action.permissions.mcp ?? []).map(
    (grant) => grant.server,
  );
  if (mcpServers.length > 0)
    warnings.push({ code: "mcp-outside-sandbox", servers: mcpServers });
  if (afterExternalContent) warnings.push({ code: "after-external-content" });
  return warnings;
}

function checkGrant(
  errors: string[],
  where: string,
  project: PineProject,
  grant: AutomationFolderGrant,
  needsWrite = false,
): void {
  const folder = project.folders.find(
    (candidate) => candidate.id === grant.folderId,
  );
  const pathError = grantPathError(grant.path);
  if (pathError) errors.push(`${where}.path ${pathError}.`);
  if (!folder) {
    const known = project.folders.map(
      (candidate) => `${candidate.id} (${candidate.name})`,
    );
    errors.push(
      `${where}: folder "${grant.folderId}" is not in this project. Folders: ${known.join(", ") || "none"}.`,
    );
    return;
  }
  if (!folder.isAvailable)
    errors.push(`${where}: folder "${folder.name}" is unavailable.`);
  if (needsWrite && folder.access !== "read-write")
    errors.push(
      `${where}: folder "${folder.name}" is read-only in this project.`,
    );
}

/** Full validation; the returned spec is normalized and still uses names. */
export async function validateAutomationSpec(
  value: unknown,
  environment: ValidationEnvironment,
): Promise<ValidationResult> {
  const parsed = parseAutomationSpec(value);
  if (!parsed.ok)
    return {
      errors: parsed.issues.map((issue) => `${issue.path}: ${issue.message}`),
      warnings: [],
    };
  const spec = parsed.spec;
  const { project } = environment;
  const errors: string[] = [];
  const now = environment.now ?? new Date();

  for (const [index, trigger] of spec.triggers.entries()) {
    const where = `triggers[${index}]`;
    switch (trigger.kind) {
      case "schedule": {
        const timeZone = trigger.timezone ?? systemTimeZone();
        if (!isValidTimeZone(timeZone)) {
          errors.push(
            `${where}.timezone "${timeZone}" is not a known time zone.`,
          );
          break;
        }
        try {
          const rule = parseRrule(trigger.rrule);
          const gap = smallestGapMs(rule, now, timeZone);
          if (gap === undefined)
            errors.push(`${where}.rrule never occurs again.`);
          else if (gap < MIN_INTERVAL_MS)
            errors.push(
              `${where}.rrule fires more often than every 5 minutes.`,
            );
        } catch (error) {
          errors.push(`${where}.rrule: ${(error as Error).message}`);
        }
        break;
      }
      case "folder":
        checkGrant(errors, where, project, {
          folderId: trigger.folderId,
          path: trigger.path,
        });
        break;
      case "system":
        if (!environment.systemEvents.has(trigger.event))
          errors.push(
            `${where}: this Pine cannot observe the "${trigger.event}" event.`,
          );
        if (trigger.event === "idle" && !trigger.idleMinutes)
          errors.push(`${where}.idleMinutes is required for the idle event.`);
        break;
      case "script": {
        const interval = parseIsoDuration(trigger.every);
        if (interval === undefined)
          errors.push(
            `${where}.every must be an ISO 8601 duration such as PT15M.`,
          );
        else if (interval < MIN_INTERVAL_MS)
          errors.push(`${where}.every must be at least PT5M.`);
        const syntax = await checkScriptSyntax(trigger.source);
        if (syntax) errors.push(`${where}.source: ${syntax}`);
        trigger.capabilities.network = trigger.capabilities.network.map(
          (host) => host.toLowerCase(),
        );
        for (const [grantIndex, grant] of trigger.capabilities.read.entries())
          checkGrant(
            errors,
            `${where}.capabilities.read[${grantIndex}]`,
            project,
            grant,
          );
        break;
      }
      default:
        break;
    }
  }
  if (spec.triggers.filter((trigger) => trigger.kind === "manual").length > 1)
    errors.push("Use at most one manual trigger.");

  if (spec.when) {
    const error = checkCel(spec.when, "bool");
    if (error) errors.push(`when: ${error}`);
  }
  for (const [key, expression] of Object.entries(spec.payload ?? {})) {
    const error = checkCel(expression);
    if (error) errors.push(`payload.${key}: ${error}`);
  }

  const permissions = spec.action.permissions;
  permissions.network = permissions.network.map((host) => host.toLowerCase());
  for (const [index, grant] of permissions.read.entries())
    checkGrant(errors, `action.permissions.read[${index}]`, project, grant);
  for (const [index, grant] of permissions.write.entries())
    checkGrant(
      errors,
      `action.permissions.write[${index}]`,
      project,
      grant,
      true,
    );
  const unknownTools = permissions.tools.filter(
    (name) => !automationToolByName(name),
  );
  if (unknownTools.length > 0)
    errors.push(
      `action.permissions.tools: unknown or unavailable tools ${unknownTools.join(", ")}.`,
    );
  permissions.tools = [
    ...new Set(
      permissions.tools.map((name) => {
        const entry = automationToolByName(name);
        return entry ? automationToolName(entry) : name;
      }),
    ),
  ];
  const mcpSeen = new Set<string>();
  for (const [index, grant] of (permissions.mcp ?? []).entries()) {
    const at = `action.permissions.mcp[${index}]`;
    if (mcpSeen.has(grant.server))
      errors.push(`${at}: server "${grant.server}" is listed twice.`);
    mcpSeen.add(grant.server);
    if (
      environment.mcpServers &&
      !environment.mcpServers.includes(grant.server)
    )
      errors.push(
        `${at}: MCP server "${grant.server}" is not configured. Configured servers: ${environment.mcpServers.join(", ") || "none"}.`,
      );
    grant.tools = [...new Set(grant.tools)];
  }
  if (permissions.mcp?.length === 0) delete permissions.mcp;
  for (const skill of spec.action.skills ?? [])
    if (environment.skills && !environment.skills.includes(skill))
      errors.push(`action.skills: skill "${skill}" does not exist.`);
  if (
    spec.action.model &&
    environment.hasModel &&
    !environment.hasModel(
      spec.action.model.providerId,
      spec.action.model.modelId,
    )
  )
    errors.push(
      `action.model: ${spec.action.model.providerId}/${spec.action.model.modelId} is not in the model catalog.`,
    );
  for (const [index, output] of (spec.delivery.outputs ?? []).entries()) {
    checkGrant(errors, `delivery.outputs[${index}]`, project, output);
    if (!grantCovers(permissions.write, output))
      errors.push(
        `delivery.outputs[${index}] is outside action.permissions.write.`,
      );
  }

  const envNames = new Set<string>();
  for (const use of spec.secrets ?? []) {
    const secret = environment.secrets.find(
      (candidate) => candidate.name === use.name,
    );
    if (!secret)
      errors.push(
        `secrets: "${use.name}" does not exist. Ask the user to add it under Automations → Secrets.`,
      );
    else if (!secret.hasValue)
      errors.push(
        `secrets: "${use.name}" has no value yet. Ask the user to fill it in.`,
      );
    const env = automationSecretEnvName(use);
    if (envNames.has(env))
      errors.push(`secrets: environment variable ${env} is used twice.`);
    if (RESERVED_ENV.has(env)) errors.push(`secrets: ${env} is reserved.`);
    envNames.add(env);
  }

  return {
    errors,
    warnings: buildWarnings(spec, project, environment.afterExternalContent),
    spec,
    facts: buildFacts(spec, project),
  };
}
