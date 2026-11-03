import { mkdir, rename } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { projectSessionDirectory } from "../../../shared/sessionPaths";
import type { PineJsonValue } from "../../../shared/agent";
import {
  CONTINUE_AUTOMATION_RUN_CHANNEL,
  DELETE_AUTOMATION_CHANNEL,
  DELETE_AUTOMATION_SECRET_CHANNEL,
  GET_AUTOMATION_CHANNEL,
  GET_AUTOMATION_RUN_CHANNEL,
  KEEP_AUTOMATION_RUN_CHANNEL,
  LIST_AUTOMATION_APPROVALS_CHANNEL,
  LIST_AUTOMATION_RUNS_CHANNEL,
  LIST_AUTOMATION_SECRETS_CHANNEL,
  LIST_AUTOMATIONS_CHANNEL,
  MARK_AUTOMATION_RUNS_READ_CHANNEL,
  RESPOND_AUTOMATION_APPROVAL_CHANNEL,
  RUN_AUTOMATION_NOW_CHANNEL,
  SET_AUTOMATION_ENABLED_CHANNEL,
  SET_AUTOMATION_SECRET_CHANNEL,
  type AutomationHostOperation,
  type AutomationSecretSummary,
  type ContinueAutomationRunResult,
} from "../../../shared/automation";
import type { PineCore } from "../pineCore";

const projectId = z.uuid();
const automationId = z.string().regex(/^[a-z0-9-]{1,64}$/);
const runId = z.string().regex(/^[a-z0-9-]{1,64}$/);
const identity = z.object({ projectId, automationId });
const runIdentity = identity.extend({ runId });
const secretName = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

function local(source: "desktop" | "web", action: string): void {
  if (source !== "desktop")
    throw new Error(`${action} is only possible in Pine on this computer.`);
}

async function secretSummaries(
  core: PineCore,
  project: string,
): Promise<AutomationSecretSummary[]> {
  const service = core.automations;
  const secrets = await service.options.secrets.list(project);
  const automations = await Promise.all(
    (await service.list(project)).map((summary) =>
      service.get(project, summary.id),
    ),
  );
  return secrets.map((secret) => ({
    name: secret.name,
    ...(secret.description ? { description: secret.description } : {}),
    hasValue: secret.hasValue,
    usedBy: automations
      .filter((automation) =>
        (automation.spec.secrets ?? []).some((use) => use.name === secret.name),
      )
      .map((automation) => ({ id: automation.id, name: automation.name })),
  }));
}

/** Automations: definitions, runs, approvals and secrets. */
export function registerAutomationRequests(core: PineCore): void {
  core.handle(LIST_AUTOMATIONS_CHANNEL, async (_context, request) => {
    const parsed = z
      .object({ projectId: projectId.optional() })
      .parse(request ?? {});
    return core.automations.list(parsed.projectId);
  });

  core.handle(GET_AUTOMATION_CHANNEL, async (_context, request) => {
    const parsed = identity.parse(request);
    return core.automations.get(parsed.projectId, parsed.automationId);
  });

  core.handle(LIST_AUTOMATION_RUNS_CHANNEL, async (_context, request) => {
    const parsed = z
      .object({
        projectId: projectId.optional(),
        automationId: automationId.optional(),
        filter: z.enum(["unread", "attention", "all", "default"]).optional(),
        limit: z.number().int().min(1).max(500).optional(),
      })
      .parse(request ?? {});
    return core.automations.listRuns(parsed);
  });

  core.handle(GET_AUTOMATION_RUN_CHANNEL, async (_context, request) => {
    const parsed = runIdentity.parse(request);
    return core.automations.getRun(
      parsed.projectId,
      parsed.automationId,
      parsed.runId,
    );
  });

  core.handle(SET_AUTOMATION_ENABLED_CHANNEL, async (context, request) => {
    const parsed = identity
      .extend({ enabled: z.boolean(), includeExisting: z.boolean().optional() })
      .parse(request);
    await core.automations.setEnabled(
      { projectId: parsed.projectId, source: context.source },
      parsed.automationId,
      parsed.enabled,
      parsed.includeExisting ? { includeExisting: true } : {},
    );
    return { updated: true };
  });

  core.handle(RUN_AUTOMATION_NOW_CHANNEL, (_context, request) => {
    const parsed = identity.parse(request);
    core.automations.runNow(parsed.projectId, parsed.automationId);
    return { started: true };
  });

  core.handle(DELETE_AUTOMATION_CHANNEL, async (context, request) => {
    const parsed = identity.parse(request);
    await core.automations.delete(
      { projectId: parsed.projectId, source: context.source },
      parsed.automationId,
    );
    return { deleted: true };
  });

  core.handle(MARK_AUTOMATION_RUNS_READ_CHANNEL, async (_context, request) => {
    const parsed = z
      .object({
        runIds: z.array(runIdentity).max(500).optional(),
        all: z.boolean().optional(),
      })
      .parse(request ?? {});
    await core.automations.markRead(parsed.all ? "all" : (parsed.runIds ?? []));
    return { updated: true };
  });

  core.handle(KEEP_AUTOMATION_RUN_CHANNEL, async (_context, request) => {
    const parsed = runIdentity.extend({ kept: z.boolean() }).parse(request);
    await core.automations.keepRun(
      parsed.projectId,
      parsed.automationId,
      parsed.runId,
      parsed.kept,
    );
    return { updated: true };
  });

  core.handle(
    CONTINUE_AUTOMATION_RUN_CHANNEL,
    async (_context, request): Promise<ContinueAutomationRunResult> => {
      const parsed = runIdentity.parse(request);
      const { run, sessionFile } = await core.automations.takeRunSession(
        parsed.projectId,
        parsed.automationId,
        parsed.runId,
      );
      // Like a teleport: the file joins the project's ordinary sessions.
      const project = await core.repository.get(parsed.projectId);
      const folder = project.folders.find(
        (candidate) => candidate.id === project.defaultFolderId,
      );
      if (!folder?.isAvailable)
        throw new Error("The project's default folder is unavailable.");
      const directory = projectSessionDirectory(
        core.repository.dataPaths(parsed.projectId).sessionsRoot,
        folder.path,
      );
      await mkdir(directory, { recursive: true });
      await rename(
        sessionFile,
        path.join(directory, path.basename(sessionFile)),
      );
      await core.automations.markContinued(run);
      core.notifyLibraryChanged("sessions");
      return { projectId: parsed.projectId, sessionId: run.sessionId! };
    },
  );

  core.handle(LIST_AUTOMATION_APPROVALS_CHANNEL, () =>
    core.automations.pendingApprovals(),
  );

  core.handle(RESPOND_AUTOMATION_APPROVAL_CHANNEL, (context, request) => {
    const parsed = z
      .object({ requestId: z.uuid(), approve: z.boolean() })
      .parse(request);
    return {
      settled: core.automations.respondApproval(
        context.source,
        parsed.requestId,
        parsed.approve,
      ),
    };
  });

  core.handle(LIST_AUTOMATION_SECRETS_CHANNEL, async (_context, request) => {
    const parsed = z.object({ projectId }).parse(request);
    return secretSummaries(core, parsed.projectId);
  });

  core.handle(SET_AUTOMATION_SECRET_CHANNEL, async (context, request) => {
    local(context.source, "Saving a secret");
    const parsed = z
      .object({
        projectId,
        name: secretName,
        description: z.string().max(500).optional(),
        value: z.string().min(1).max(16_384).optional(),
      })
      .parse(request);
    await core.repository.get(parsed.projectId);
    await core.automations.options.secrets.set(
      parsed.projectId,
      parsed.name,
      parsed.description,
      parsed.value,
    );
    return secretSummaries(core, parsed.projectId);
  });

  core.handle(DELETE_AUTOMATION_SECRET_CHANNEL, async (context, request) => {
    local(context.source, "Deleting a secret");
    const parsed = z.object({ projectId, name: secretName }).parse(request);
    await core.automations.options.secrets.delete(
      parsed.projectId,
      parsed.name,
    );
    await core.automations.secretDeleted(parsed.projectId, parsed.name);
    return secretSummaries(core, parsed.projectId);
  });
}

/**
 * Answers the automation tools of a session in `projectId`. Runs may only
 * report; authoring sessions may do everything else, with the user's
 * approval on this computer for anything that grants authority.
 */
export async function answerAutomationOperation(
  core: PineCore,
  requester: { sessionId: string; projectId: string },
  operation: AutomationHostOperation,
  isRun: boolean,
): Promise<PineJsonValue> {
  const service = core.automations;
  if (isRun !== (operation.op === "report"))
    throw new Error(
      isRun
        ? "Automation runs cannot change automations."
        : "automation_report is only available inside an automation run.",
    );
  const agent = { ...requester, source: "agent" as const };
  const json = (value: unknown) =>
    JSON.parse(JSON.stringify(value ?? null)) as PineJsonValue;
  switch (operation.op) {
    case "report":
      return service.report(requester.sessionId, operation);
    case "list": {
      const project = await core.repository.get(requester.projectId);
      return json({
        automations: await service.list(requester.projectId),
        folders: project.folders.map((folder) => ({
          folderId: folder.id,
          name: folder.name,
          access: folder.access,
          available: folder.isAvailable,
          path: folder.path,
        })),
      });
    }
    case "get":
      return json(await service.get(requester.projectId, operation.id));
    case "validate": {
      const result = await service.validate(
        requester.projectId,
        operation.spec,
      );
      return json({
        errors: result.errors,
        warnings: result.warnings,
        ...(result.facts ? { facts: result.facts } : {}),
      });
    }
    case "dry-run":
      return json(
        await service.dryRun(requester.projectId, {
          ...(operation.spec !== undefined ? { spec: operation.spec } : {}),
          ...(operation.id ? { id: operation.id } : {}),
          ...(operation.sampleEvents !== undefined
            ? { sampleEvents: operation.sampleEvents }
            : {}),
        }),
      );
    case "secrets":
      return json(
        (await secretSummaries(core, requester.projectId)).map((secret) => ({
          name: secret.name,
          ...(secret.description ? { description: secret.description } : {}),
          hasValue: secret.hasValue,
        })),
      );
    case "create":
      return json(
        await service.create(requester, operation.spec, {
          afterExternalContent: operation.afterExternalContent,
          ...(operation.explanation
            ? { explanation: operation.explanation }
            : {}),
          ...(operation.includeExisting ? { includeExisting: true } : {}),
        }),
      );
    case "update":
      return json(
        await service.update(
          requester,
          operation.id,
          operation.baseRevision,
          operation.spec,
          {
            afterExternalContent: operation.afterExternalContent,
            ...(operation.explanation
              ? { explanation: operation.explanation }
              : {}),
          },
        ),
      );
    case "set-enabled":
      await service.setEnabled(agent, operation.id, operation.enabled, {
        ...(operation.includeExisting ? { includeExisting: true } : {}),
        ...(operation.explanation
          ? { explanation: operation.explanation }
          : {}),
      });
      return json({ id: operation.id, enabled: operation.enabled });
    case "run-now":
      service.runNow(requester.projectId, operation.id);
      return json({ started: true });
    case "delete":
      await service.delete(agent, operation.id);
      return json({ deleted: true });
    case "runs":
      if (operation.runId)
        return json(
          await service.getRun(
            requester.projectId,
            operation.id,
            operation.runId,
          ),
        );
      return json(
        await service.listRuns({
          projectId: requester.projectId,
          automationId: operation.id,
          filter: "all",
          limit: operation.limit ?? 10,
        }),
      );
  }
}
