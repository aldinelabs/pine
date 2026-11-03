import type { PineJsonValue } from "./agent";

/**
 * Automations: agent-written definitions that wake an agent run when their
 * deterministic detectors find something new. See docs/automation.md.
 */

export const LIST_AUTOMATIONS_CHANNEL = "automations:list" as const;
export const GET_AUTOMATION_CHANNEL = "automations:get" as const;
export const LIST_AUTOMATION_RUNS_CHANNEL = "automations:runs" as const;
export const GET_AUTOMATION_RUN_CHANNEL = "automations:run" as const;
export const SET_AUTOMATION_ENABLED_CHANNEL =
  "automations:set-enabled" as const;
export const RUN_AUTOMATION_NOW_CHANNEL = "automations:run-now" as const;
export const DELETE_AUTOMATION_CHANNEL = "automations:delete" as const;
export const MARK_AUTOMATION_RUNS_READ_CHANNEL =
  "automations:mark-runs-read" as const;
export const KEEP_AUTOMATION_RUN_CHANNEL = "automations:keep-run" as const;
export const CONTINUE_AUTOMATION_RUN_CHANNEL =
  "automations:continue-run" as const;
export const RESPOND_AUTOMATION_APPROVAL_CHANNEL =
  "automations:respond-approval" as const;
export const LIST_AUTOMATION_APPROVALS_CHANNEL =
  "automations:approvals" as const;
export const LIST_AUTOMATION_SECRETS_CHANNEL = "automations:secrets" as const;
export const SET_AUTOMATION_SECRET_CHANNEL = "automations:set-secret" as const;
export const DELETE_AUTOMATION_SECRET_CHANNEL =
  "automations:delete-secret" as const;
/** Main → a desktop window: a notification asked to show an automation. */
export const AUTOMATIONS_REVEAL_CHANNEL = "automations:reveal" as const;

export interface AutomationRevealEvent {
  projectId: string;
  automationId: string;
  runId?: string;
}

/** Main → interfaces: automations, runs or approvals changed. */
export const AUTOMATIONS_CHANGED_CHANNEL = "automations:changed" as const;

export type CelExpression = string;

export type AutomationWeekday = "MO" | "TU" | "WE" | "TH" | "FR" | "SA" | "SU";

export interface AutomationTimeWindow {
  days?: AutomationWeekday[];
  /** "HH:mm", local time. */
  from: string;
  to: string;
}

export interface AutomationFolderGrant {
  folderId: string;
  /** Portable relative directory inside the folder; defaults to its root. */
  path?: string;
}

export type AutomationFileChange = "added" | "changed" | "removed";

export type AutomationSystemEvent = "resume" | "unlock" | "app-start" | "idle";

export interface AutomationScriptCapabilities {
  /** Exact host names the script may fetch. */
  network: string[];
  read: AutomationFolderGrant[];
}

export type AutomationTrigger =
  | {
      kind: "schedule";
      rrule: string;
      timezone?: string;
      missed?: "run-once" | "skip";
    }
  | {
      kind: "folder";
      folderId: string;
      path?: string;
      include?: string[];
      exclude?: string[];
      events: AutomationFileChange[];
      settleSeconds?: number;
      batchSeconds?: number;
    }
  | {
      kind: "system";
      event: AutomationSystemEvent;
      idleMinutes?: number;
      window?: AutomationTimeWindow;
      oncePer?: "day" | "week";
    }
  | {
      kind: "script";
      every: string;
      window?: AutomationTimeWindow;
      source: string;
      capabilities: AutomationScriptCapabilities;
    }
  | { kind: "manual" };

export type AutomationTriggerKind = AutomationTrigger["kind"];

export interface AutomationPermissionEnvelope {
  read: AutomationFolderGrant[];
  write: AutomationFolderGrant[];
  network: string[];
  /** Pine tool names; stored as tool IDs. */
  tools: string[];
}

export interface AutomationModelSelection {
  providerId: string;
  modelId: string;
}

export interface AutomationAgentAction {
  kind: "agent";
  instructions: string;
  skills?: string[];
  model?: AutomationModelSelection;
  session: "new";
  permissions: AutomationPermissionEnvelope;
}

export type AutomationNotify = "on-findings" | "always" | "never";

export interface AutomationDelivery {
  notify: AutomationNotify;
  outputs?: AutomationFolderGrant[];
}

export interface AutomationLimits {
  maxRunsPerDay?: number;
  maxMinutesPerRun?: number;
}

export interface AutomationSecretUse {
  name: string;
  /** Environment variable in the run's shell; defaults to PINE_SECRET_<NAME>. */
  env?: string;
}

export interface AutomationSpec {
  version: 1;
  name: string;
  description?: string;
  enabled: boolean;
  triggers: AutomationTrigger[];
  when?: CelExpression;
  payload?: Record<string, CelExpression>;
  action: AutomationAgentAction;
  delivery: AutomationDelivery;
  secrets?: AutomationSecretUse[];
  limits?: AutomationLimits;
}

export interface AutomationFileEvent {
  folderId: string;
  path: string;
  name: string;
  ext: string;
  size: number;
  mtime: string;
  change: AutomationFileChange;
}

export interface AutomationEvent {
  id: string;
  trigger: AutomationTriggerKind;
  at: string;
  file?: AutomationFileEvent;
  system?: { event: string };
  script?: { data: PineJsonValue };
}

export type AutomationPauseReason =
  | { code: "failures"; count: number }
  | { code: "script-failures"; count: number; error?: string }
  | { code: "limit"; limit: "runs-per-day" }
  | { code: "self-trigger" }
  | { code: "permission"; detail: string }
  | { code: "secret-removed"; secret: string };

export type AutomationStatus = "active" | "disabled" | "paused";

export interface AutomationSummary {
  id: string;
  projectId: string;
  projectName: string;
  name: string;
  description?: string;
  revision: number;
  status: AutomationStatus;
  pauseReason?: AutomationPauseReason;
  triggers: AutomationTriggerKind[];
  nextRunAt?: string;
  lastRun?: {
    id: string;
    status: AutomationRunStatus;
    at: string;
  };
  running: boolean;
}

export interface AutomationDetail extends AutomationSummary {
  spec: AutomationSpec;
  facts: AutomationFacts;
  createdAt: string;
  updatedAt: string;
}

export type AutomationRunStatus =
  "running" | "findings" | "nothing" | "failed" | "interrupted" | "skipped";

export interface AutomationRunReport {
  status: "findings" | "nothing";
  summary: string;
  outputs?: string[];
}

export interface AutomationRunSummary {
  id: string;
  automationId: string;
  projectId: string;
  automationName: string;
  status: AutomationRunStatus;
  trigger: AutomationTriggerKind | "batch";
  startedAt: string;
  endedAt?: string;
  summary?: string;
  error?: string;
  read: boolean;
  kept: boolean;
  sessionId?: string;
}

export interface AutomationRunDetail extends AutomationRunSummary {
  revision: number;
  events: AutomationEvent[];
  eventCount: number;
  payload: PineJsonValue;
  report?: AutomationRunReport;
  discardedEvents?: number;
  changedOutputs?: string[];
  /** Session continued into the project; it is an ordinary session now. */
  continued?: boolean;
  transcript?: AutomationTranscriptEntry[];
  scriptLogs?: AutomationPollRecord[];
}

export interface AutomationTranscriptEntry {
  role: "user" | "assistant" | "tool";
  text: string;
  toolName?: string;
  isError?: boolean;
}

export interface AutomationPollRecord {
  at: string;
  triggerKey: string;
  durationMs: number;
  requests: { url: string; status?: number; error?: string }[];
  logs: string[];
  events: number;
  error?: string;
  baseline?: boolean;
}

/** A project folder as a card shows it. */
export interface AutomationFolderLabel {
  folderId: string;
  folderName: string;
  path?: string;
  missing?: boolean;
}

export type AutomationTriggerFact =
  | {
      kind: "schedule";
      rrule: string;
      timezone?: string;
      missed: "run-once" | "skip";
    }
  | {
      kind: "folder";
      folder: AutomationFolderLabel;
      include: string[];
      exclude: string[];
      events: AutomationFileChange[];
    }
  | {
      kind: "system";
      event: AutomationSystemEvent;
      idleMinutes?: number;
      window?: AutomationTimeWindow;
      oncePer?: "day" | "week";
    }
  | {
      kind: "script";
      every: string;
      window?: AutomationTimeWindow;
      network: string[];
      read: AutomationFolderLabel[];
      source: string;
    }
  | { kind: "manual" };

/** Deterministic, authoritative facts of a definition. */
export interface AutomationFacts {
  name: string;
  triggers: AutomationTriggerFact[];
  read: AutomationFolderLabel[];
  write: AutomationFolderLabel[];
  network: string[];
  tools: string[];
  secrets: string[];
  skills: string[];
  model?: AutomationModelSelection;
  notify: AutomationNotify;
  outputs: AutomationFolderLabel[];
  limits: Required<
    Pick<AutomationLimits, "maxRunsPerDay" | "maxMinutesPerRun">
  >;
}

export type AutomationWarning =
  | { code: "script-read-and-network"; hosts: string[] }
  | { code: "secret-network"; secrets: string[]; hosts: string[] }
  | { code: "folder-overlaps-write"; folder: AutomationFolderLabel }
  | { code: "after-external-content" }
  | { code: "privileged-tools"; tools: string[] }
  | { code: "network-execution"; hosts: string[] };

export type AutomationApprovalKind = "create" | "update" | "enable" | "delete";

export interface AutomationApprovalRequest {
  requestId: string;
  sessionId?: string;
  projectId: string;
  projectName: string;
  kind: AutomationApprovalKind;
  automationId?: string;
  facts: AutomationFacts;
  previousFacts?: AutomationFacts;
  /** Generated by the approval model from the definition alone. */
  explanation?: string;
  warnings: AutomationWarning[];
  createdAt: string;
}

export interface AutomationApprovalDecision {
  requestId: string;
  approve: boolean;
}

export interface AutomationSecretSummary {
  name: string;
  description?: string;
  hasValue: boolean;
  usedBy: { id: string; name: string }[];
}

export interface ListAutomationsRequest {
  projectId?: string;
}

export interface AutomationIdentityRequest {
  projectId: string;
  automationId: string;
}

export interface ListAutomationRunsRequest {
  projectId?: string;
  automationId?: string;
  filter?: "unread" | "attention" | "all" | "default";
  limit?: number;
}

export interface AutomationRunIdentityRequest extends AutomationIdentityRequest {
  runId: string;
}

export interface SetAutomationEnabledRequest extends AutomationIdentityRequest {
  enabled: boolean;
  /** Process what is already there instead of recording it as the baseline. */
  includeExisting?: boolean;
}

export interface MarkAutomationRunsReadRequest {
  runIds?: { projectId: string; automationId: string; runId: string }[];
  all?: boolean;
}

export interface SetAutomationSecretRequest {
  projectId: string;
  name: string;
  description?: string;
  /** Omitted keeps the stored value. */
  value?: string;
}

export interface DeleteAutomationSecretRequest {
  projectId: string;
  name: string;
}

export interface AutomationsChangedEvent {
  unread: number;
  approvals: AutomationApprovalRequest[];
}

export interface ContinueAutomationRunResult {
  projectId: string;
  sessionId: string;
}

/** A tool reports its run's result; main decides what that means. */
export const AUTOMATION_REPORT_TOOL_NAME = "automation_report" as const;
export const ACTIVATE_AUTOMATION_AUTHORING_TOOL_NAME =
  "activate_automation_authoring" as const;

export const AUTOMATION_DEFAULTS = {
  missed: "run-once",
  settleSeconds: 5,
  batchSeconds: 30,
  maxRunsPerDay: 24,
  maxMinutesPerRun: 30,
  notify: "on-findings",
} as const;

/** Environment variable that carries a secret into a run's shell. */
export function automationSecretEnvName(use: AutomationSecretUse): string {
  return (
    use.env ?? `PINE_SECRET_${use.name.toUpperCase().replaceAll("-", "_")}`
  );
}

/** Host operations the authoring and report tools ask main for. */
export type AutomationHostOperation =
  | { op: "list" }
  | { op: "get"; id: string }
  | { op: "validate"; spec: PineJsonValue }
  | {
      op: "dry-run";
      spec?: PineJsonValue;
      id?: string;
      sampleEvents?: PineJsonValue;
    }
  | { op: "secrets" }
  | {
      op: "create";
      spec: PineJsonValue;
      explanation?: string;
      afterExternalContent: boolean;
      includeExisting?: boolean;
    }
  | {
      op: "update";
      id: string;
      baseRevision: number;
      spec: PineJsonValue;
      explanation?: string;
      afterExternalContent: boolean;
    }
  | {
      op: "set-enabled";
      id: string;
      enabled: boolean;
      includeExisting?: boolean;
      explanation?: string;
    }
  | { op: "run-now"; id: string }
  | { op: "delete"; id: string }
  | { op: "runs"; id: string; limit?: number; runId?: string }
  | {
      op: "report";
      runId: string;
      status: "findings" | "nothing";
      summary: string;
      outputs?: string[];
      cursor?: PineJsonValue;
    };

/** The renderer's automation API; every call goes through main. */
export interface PineAutomationsApi {
  list(request?: ListAutomationsRequest): Promise<AutomationSummary[]>;
  get(request: AutomationIdentityRequest): Promise<AutomationDetail>;
  runs(request?: ListAutomationRunsRequest): Promise<AutomationRunSummary[]>;
  run(request: AutomationRunIdentityRequest): Promise<AutomationRunDetail>;
  setEnabled(
    request: SetAutomationEnabledRequest,
  ): Promise<{ updated: boolean }>;
  runNow(request: AutomationIdentityRequest): Promise<{ started: boolean }>;
  delete(request: AutomationIdentityRequest): Promise<{ deleted: boolean }>;
  markRunsRead(
    request: MarkAutomationRunsReadRequest,
  ): Promise<{ updated: boolean }>;
  keepRun(
    request: AutomationRunIdentityRequest & { kept: boolean },
  ): Promise<{ updated: boolean }>;
  continueRun(
    request: AutomationRunIdentityRequest,
  ): Promise<ContinueAutomationRunResult>;
  approvals(): Promise<AutomationApprovalRequest[]>;
  respondApproval(
    request: AutomationApprovalDecision,
  ): Promise<{ settled: boolean }>;
  secrets(request: { projectId: string }): Promise<AutomationSecretSummary[]>;
  setSecret(
    request: SetAutomationSecretRequest,
  ): Promise<AutomationSecretSummary[]>;
  deleteSecret(
    request: DeleteAutomationSecretRequest,
  ): Promise<AutomationSecretSummary[]>;
  onChanged(listener: (event: AutomationsChangedEvent) => void): () => void;
  onReveal(listener: (event: AutomationRevealEvent) => void): () => void;
}
