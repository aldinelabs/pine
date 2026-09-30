import { Type } from "typebox";
import type { Tool } from "@earendil-works/pi-ai";
import { createHash, randomUUID } from "node:crypto";
import type { PineAgentEvent, PineAutoApprovalFailure } from "../shared/agent";
import type { PineApprovalDecision } from "../shared/sessions";
import type { GateDecision } from "./protocol";
import { matchDestructive } from "./destructive";

export interface AuthorizationStatement {
  id: string;
  text: string;
}

export interface AuthorizationGrant {
  id: string;
  source: "judge" | "user";
  scope: "once" | "session";
  toolName: string;
  subject: string;
  description?: string;
  actionDigest: string;
  createdAt: string;
}

export interface ApprovalCausalEvent {
  id: string;
  kind: "assistant" | "tool-result";
  summary: string;
}

/** Compact, authority-aware context supplied to automatic reviews. */
export interface GateTurnContext {
  rootGoal?: AuthorizationStatement;
  recentUserStatements: AuthorizationStatement[];
  recentEvents: ApprovalCausalEvent[];
  grants: AuthorizationGrant[];
}

export interface JudgeRequest {
  toolCallId: string;
  toolName: string;
  trigger:
    | "sandbox-denied"
    | "authorize-denied"
    | "destructive-pattern"
    | "privileged-execution";
  /** Primary subject of the review (bash command or file path). */
  subject: string;
  /** Public action intent written for the user; never treated as authorization. */
  description?: string;
  /** Evidence for the escalation (sandbox stderr excerpt, policy error, …). */
  evidence?: string;
  signal?: AbortSignal;
  turn: GateTurnContext;
  /** Privileged execution is always reviewed per-call and cannot be cached. */
  allowSessionScope?: boolean;
}

export interface JudgeRuling {
  toolCallId: string;
  verdict: "allow" | "deny" | "needs_user";
  reason?: string;
  scope?: "once" | "session";
}

export interface UserApprovalRequest {
  trigger:
    | "pre-execution"
    | "sandbox-denied"
    | "authorize-denied"
    | "destructive-pattern"
    | "privileged-execution";
  toolCallId: string;
  toolName: string;
  subject?: string;
  /** The caller's imperative summary, shown on the approval card. */
  description?: string;
  evidence?: string;
  autoApprovalFailure?: PineAutoApprovalFailure;
  signal?: AbortSignal;
}

/**
 * Services a gate needs from the runtime: event emission, the model judge
 * (Auto Approve), and the cross-process user approval round trip (Let Me Review).
 */
export interface GateHost {
  sessionId: string;
  emit(event: PineAgentEvent): void;
  authorizationGrants(): readonly AuthorizationGrant[];
  turnContext(subjects?: readonly string[]): GateTurnContext;
  recordGrant(
    grant: Omit<AuthorizationGrant, "id" | "createdAt">,
  ): AuthorizationGrant;
  recordApprovalDecision(decision: PineApprovalDecision): void;
  judge(requests: JudgeRequest[]): Promise<JudgeRuling[]>;
  /**
   * Route a review to the renderer. Resolves with the user's decision; the
   * runtime emits both the approval-request and approval-decided events.
   */
  requestUserApproval(request: UserApprovalRequest): Promise<GateDecision>;
}

export interface BashReviewInput {
  toolCallId: string;
  toolName?: "bash" | "powershell";
  command: string;
  /** The caller's imperative summary, shown on the approval card. */
  description?: string;
  signal?: AbortSignal;
}

export interface FileReviewInput {
  toolCallId: string;
  toolName: string;
  path?: string;
  signal?: AbortSignal;
}

export interface DenialReviewInput {
  toolCallId: string;
  toolName: string;
  /** Bash command (sandbox/privileged reviews) or file path (authorize). */
  subject: string;
  /** The caller's imperative summary, shown on the approval card. */
  description?: string;
  evidence: string;
  signal?: AbortSignal;
}

/**
 * The seam between Pine's deterministic sandbox and a decision maker. Let Me Review mode
 * routes every review to the user; Auto Approve routes escalations to the
 * model judge. YOLO bypasses this gate entirely at each tool wrapper.
 */
export interface ToolGate {
  /**
   * Decide whether a bash command may run. Let Me Review mode prompts the user for every
   * command; Auto Approve only escalates destructive-pattern matches.
   */
  reviewBashCommand(input: BashReviewInput): Promise<GateDecision>;
  /**
   * Let Me Review pre-execution confirmation for file-mutating tools. Auto Approve
   * allows file calls through and relies on denial escalation instead.
   */
  reviewFileCall(input: FileReviewInput): Promise<GateDecision>;
  /**
   * Decide whether a call the sandbox or folder policy denied may bypass it.
   * An allowance re-runs the exact call outside the restriction.
   */
  reviewDenial(
    kind: "sandbox" | "authorize",
    input: DenialReviewInput,
  ): Promise<GateDecision>;
  /** Review an explicit native-permission shell call before it executes. */
  reviewPrivilegedCall(input: DenialReviewInput): Promise<GateDecision>;
  /** Session-scope approved bash commands skip the sandbox entirely. */
  isApprovedCommand(command: string): boolean;
  /** Reset per-turn state (escalation streaks). Called on every prompt. */
  resetTurn(): void;
}

const MAX_CONSECUTIVE_ESCALATIONS = 5;

/**
 * Let Me Review mode: every review becomes an approval request in the renderer. The
 * runtime owns the cross-process round trip, including both events.
 */
export class UserApprovalGate implements ToolGate {
  constructor(private readonly host: GateHost) {}

  async reviewBashCommand(input: BashReviewInput): Promise<GateDecision> {
    return this.host.requestUserApproval({
      trigger: "pre-execution",
      toolCallId: input.toolCallId,
      toolName: input.toolName ?? "bash",
      subject: input.command,
      description: input.description,
      signal: input.signal,
    });
  }

  async reviewFileCall(input: FileReviewInput): Promise<GateDecision> {
    // Reads stay silent in Let Me Review mode: prompting on every read makes the
    // transcript unusable. Out-of-scope reads still surface through the
    // authorize-denial review, so the folder boundary is not lost.
    if (input.toolName === "read") {
      return Promise.resolve({ kind: "allow" });
    }
    return this.host.requestUserApproval({
      trigger: "pre-execution",
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      subject: input.path,
      signal: input.signal,
    });
  }

  async reviewDenial(
    kind: "sandbox" | "authorize",
    input: DenialReviewInput,
  ): Promise<GateDecision> {
    return this.host.requestUserApproval({
      trigger: kind === "sandbox" ? "sandbox-denied" : "authorize-denied",
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      subject: input.subject,
      description: input.description,
      evidence: input.evidence,
      signal: input.signal,
    });
  }

  async reviewPrivilegedCall(input: DenialReviewInput): Promise<GateDecision> {
    return this.host.requestUserApproval({
      trigger: "privileged-execution",
      toolCallId: input.toolCallId,
      toolName: input.toolName,
      subject: input.subject,
      description: input.description,
      evidence: input.evidence,
      signal: input.signal,
    });
  }

  isApprovedCommand(): boolean {
    // User approvals are scoped to a single execution; nothing is remembered.
    return false;
  }

  resetTurn(): void {}
}

/**
 * Auto Approve mode: deterministic checks stay in the sandbox; the model judge
 * sees sandbox/authorize escalations, destructive-pattern matches, and every
 * explicit privileged shell call. Reviewer failures are handed to the user
 * for a fresh decision; explicit safety denials remain enforced.
 */
export class AutoReviewGate implements ToolGate {
  private readonly approvedCommands = new Set<string>();
  private privilegedBatch: Array<{
    input: DenialReviewInput;
    resolve: (decision: GateDecision) => void;
  }> = [];
  private isPrivilegedFlushScheduled = false;
  private consecutiveEscalations = 0;
  private sequence = 0;

  constructor(
    private readonly host: GateHost,
    private readonly autonomous = false,
  ) {}

  async reviewBashCommand(input: BashReviewInput): Promise<GateDecision> {
    if (this.isApprovedCommand(input.command)) return { kind: "allow" };
    const match = matchDestructive(input.command);
    if (!match) return { kind: "allow" };

    return this.judge("destructive-pattern", {
      toolCallId: input.toolCallId,
      toolName: "bash",
      subject: input.command,
      description: input.description,
      evidence: `Matched destructive-command heuristic "${match.name}": ${match.description}`,
      signal: input.signal,
    });
  }

  reviewFileCall(): Promise<GateDecision> {
    // File calls pass through; the folder policy plus denial escalation covers
    // them, per the "only sandbox-intercepted calls are reviewed" contract.
    return Promise.resolve({ kind: "allow" });
  }

  async reviewDenial(
    kind: "sandbox" | "authorize",
    input: DenialReviewInput,
  ): Promise<GateDecision> {
    if (kind === "sandbox" && this.isApprovedCommand(input.subject)) {
      return { kind: "allow" };
    }
    return this.judge(
      kind === "sandbox" ? "sandbox-denied" : "authorize-denied",
      {
        toolCallId: input.toolCallId,
        toolName: input.toolName,
        subject: input.subject,
        description: input.description,
        evidence: input.evidence,
        signal: input.signal,
      },
    );
  }

  reviewPrivilegedCall(input: DenialReviewInput): Promise<GateDecision> {
    return new Promise((resolve) => {
      this.privilegedBatch.push({ input, resolve });
      if (this.isPrivilegedFlushScheduled) return;
      this.isPrivilegedFlushScheduled = true;
      setTimeout(() => void this.flushPrivilegedBatch(), 0);
    });
  }

  isApprovedCommand(command: string): boolean {
    const normalized = normalizeCommand(command);
    return (
      this.approvedCommands.has(normalized) ||
      this.host
        .authorizationGrants()
        .some(
          (grant) =>
            grant.scope === "session" &&
            grant.toolName === "bash" &&
            normalizeCommand(grant.subject) === normalized,
        )
    );
  }

  resetTurn(): void {
    this.consecutiveEscalations = 0;
  }

  private async judge(
    trigger:
      | "sandbox-denied"
      | "authorize-denied"
      | "destructive-pattern"
      | "privileged-execution",
    input: {
      toolCallId: string;
      toolName: string;
      subject: string;
      description?: string;
      evidence: string;
      signal?: AbortSignal;
    },
    allowSessionScope = true,
  ): Promise<GateDecision> {
    const [decision] = await this.judgeBatch([
      { trigger, input, allowSessionScope },
    ]);
    return decision;
  }

  private async flushPrivilegedBatch(): Promise<void> {
    this.isPrivilegedFlushScheduled = false;
    const batch = this.privilegedBatch.splice(0);
    if (batch.length === 0) return;
    const decisions = await this.judgeBatch(
      batch.map(({ input }) => ({
        trigger: "privileged-execution" as const,
        input,
        allowSessionScope: false,
      })),
    );
    batch.forEach(({ resolve }, index) => resolve(decisions[index]));
  }

  private async judgeBatch(
    reviews: Array<{
      trigger: JudgeRequest["trigger"];
      input: DenialReviewInput;
      allowSessionScope: boolean;
    }>,
  ): Promise<GateDecision[]> {
    const decisions: Array<GateDecision | undefined> = reviews.map(
      () => undefined,
    );
    let allowed = false;
    const reviewId = randomUUID();
    const userFallbacks: Promise<void>[] = [];
    const pending: Array<{
      index: number;
      sequence: number;
      request: JudgeRequest;
      input: DenialReviewInput;
      allowSessionScope: boolean;
    }> = [];
    const sharedTurn = this.host.turnContext(
      reviews.map((review) => review.input.subject),
    );

    reviews.forEach((review, index) => {
      const sequence = ++this.sequence;
      if (this.consecutiveEscalations >= MAX_CONSECUTIVE_ESCALATIONS) {
        const reason =
          "Too many escalations in this turn; revise the requested action and its rationale before retrying.";
        if (this.autonomous) {
          this.emitDecided(sequence, review.input.toolCallId, "denied", reason);
          decisions[index] = { kind: "deny", reason };
          return;
        }
        userFallbacks.push(
          this.host
            .requestUserApproval({
              trigger: review.trigger,
              toolCallId: review.input.toolCallId,
              toolName: review.input.toolName,
              subject: review.input.subject,
              description: review.input.description,
              evidence: [review.input.evidence, reason]
                .filter(Boolean)
                .join("\n\n"),
              signal: review.input.signal,
            })
            .then((decision) => {
              decisions[index] = decision;
              if (decision.kind === "allow") allowed = true;
            }),
        );
        return;
      }

      this.consecutiveEscalations += 1;
      this.host.emit({
        type: "tool-review",
        sessionId: this.host.sessionId,
        toolCallId: review.input.toolCallId,
        toolName: review.input.toolName,
        state: "reviewing",
      });
      pending.push({
        index,
        sequence,
        input: review.input,
        allowSessionScope: review.allowSessionScope,
        request: {
          toolCallId: review.input.toolCallId,
          toolName: review.input.toolName,
          trigger: review.trigger,
          subject: review.input.subject,
          description: review.input.description,
          evidence: review.input.evidence,
          signal: review.input.signal,
          turn: sharedTurn,
          allowSessionScope: review.allowSessionScope,
        },
      });
    });

    if (pending.length === 0) {
      await Promise.all(userFallbacks);
      if (allowed) this.consecutiveEscalations = 0;
      return decisions as GateDecision[];
    }

    let rulings: JudgeRuling[];
    try {
      rulings = await this.host.judge(pending.map(({ request }) => request));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const reason = `Auto-review unavailable: ${message}`;
      if (this.autonomous) {
        for (const { index, input, sequence } of pending) {
          this.emitDecided(sequence, input.toolCallId, "denied", reason);
          decisions[index] = { kind: "deny", reason };
        }
        return decisions as GateDecision[];
      }
      await Promise.all(
        pending.map(async ({ index, input, request }) => {
          const decision = await this.host.requestUserApproval({
            trigger: request.trigger,
            toolCallId: input.toolCallId,
            toolName: input.toolName,
            subject: input.subject,
            description: input.description,
            evidence: [input.evidence, reason].filter(Boolean).join("\n\n"),
            autoApprovalFailure: { id: reviewId, message },
            signal: input.signal,
          });
          decisions[index] = decision;
          if (decision.kind === "allow") allowed = true;
        }),
      );
      await Promise.all(userFallbacks);
      if (allowed) this.consecutiveEscalations = 0;
      return decisions as GateDecision[];
    }

    const rulingsById = new Map(
      rulings.map((ruling) => [ruling.toolCallId, ruling]),
    );
    for (const {
      index,
      input,
      sequence,
      allowSessionScope,
      request,
    } of pending) {
      const ruling = rulingsById.get(input.toolCallId);
      if (!ruling) {
        const reason =
          "Auto-review unavailable: The reviewer omitted this tool call from its rulings.";
        if (this.autonomous) {
          this.emitDecided(sequence, input.toolCallId, "denied", reason);
          decisions[index] = { kind: "deny", reason };
          continue;
        }
        const decision = await this.host.requestUserApproval({
          trigger: request.trigger,
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          subject: input.subject,
          description: input.description,
          evidence: [input.evidence, reason].filter(Boolean).join("\n\n"),
          autoApprovalFailure: {
            id: reviewId,
            message: "The reviewer omitted this tool call from its rulings.",
          },
          signal: input.signal,
        });
        decisions[index] = decision;
        if (decision.kind === "allow") allowed = true;
        continue;
      }
      if (ruling.verdict === "allow") {
        allowed = true;
        if (allowSessionScope && ruling.scope === "session") {
          this.approvedCommands.add(normalizeCommand(input.subject));
          this.host.recordGrant({
            source: "judge",
            scope: "session",
            toolName: input.toolName,
            subject: input.subject,
            description: input.description,
            actionDigest: approvalActionDigest(input),
          });
        }
        this.emitDecided(sequence, input.toolCallId, "approved", ruling.reason);
        decisions[index] = {
          kind: "allow",
          scope: allowSessionScope ? ruling.scope : "once",
        };
        continue;
      }
      if (ruling.verdict === "needs_user") {
        if (this.autonomous) {
          const reason =
            ruling.reason ??
            "The rationale does not yet establish authorization for this call. Explain the exact need and scope before retrying.";
          this.emitDecided(sequence, input.toolCallId, "denied", reason);
          decisions[index] = { kind: "deny", reason };
          continue;
        }
        const decision = await this.host.requestUserApproval({
          trigger: request.trigger,
          toolCallId: input.toolCallId,
          toolName: input.toolName,
          subject: input.subject,
          description: input.description,
          evidence: [input.evidence, ruling.reason]
            .filter(Boolean)
            .join("\n\n"),
          signal: input.signal,
        });
        decisions[index] = decision;
        if (decision.kind === "allow") allowed = true;
        continue;
      }
      const reason = ruling.reason ?? "The auto-reviewer denied this call.";
      this.emitDecided(sequence, input.toolCallId, "denied", reason);
      decisions[index] = { kind: "deny", reason };
    }
    if (allowed) this.consecutiveEscalations = 0;
    return decisions as GateDecision[];
  }

  private emitDecided(
    sequence: number,
    toolCallId: string,
    verdict: "approved" | "denied",
    reason?: string,
  ): void {
    const requestId = `judge-${sequence}`;
    this.host.recordApprovalDecision({
      requestId,
      toolCallId,
      verdict,
      decidedBy: "judge",
      ...(reason ? { reason } : {}),
    });
    this.host.emit({
      type: "approval-decided",
      sessionId: this.host.sessionId,
      requestId,
      toolCallId,
      verdict,
      decidedBy: "judge",
      reason,
    });
  }
}

/** Structured-output contract for the model judge. */
export const RULING_TOOL: Tool = {
  name: "submit_ruling",
  description:
    "Submit one verdict for every reviewed tool call. Call this exactly once and do not answer in plain text.",
  parameters: Type.Object({
    rulings: Type.Array(
      Type.Object({
        toolCallId: Type.String({
          description: "The exact toolCallId from the review request.",
        }),
        verdict: Type.Union(
          [
            Type.Literal("allow"),
            Type.Literal("deny"),
            Type.Literal("needs_user"),
          ],
          {
            description:
              "allow when current authority covers the action; deny when it must not run; needs_user when the action may be reasonable but requires a fresh, exact user decision.",
          },
        ),
        reason: Type.String({
          description:
            "Short explanation of this verdict. For deny, name a safer alternative. For needs_user, state the exact missing authorization or concrete risk Pine should show on the approval card; do not tell the agent to ask in prose. Write it in the same language as the user's messages.",
        }),
        scope: Type.Optional(
          Type.Union([Type.Literal("once"), Type.Literal("session")], {
            description:
              "once (default): the allowance applies to this single execution. session: identical commands are allowed without re-review for the rest of the session.",
          }),
        ),
      }),
      {
        description:
          "One ruling per reviewed tool call. Do not omit, duplicate, or invent toolCallIds.",
        minItems: 1,
      },
    ),
  }),
};

/** Autonomous reviews cannot delegate a decision to the user. */
export const AUTONOMOUS_RULING_TOOL: Tool = {
  ...RULING_TOOL,
  parameters: Type.Object({
    rulings: Type.Array(
      Type.Object({
        toolCallId: Type.String(),
        verdict: Type.Union([Type.Literal("allow"), Type.Literal("deny")]),
        reason: Type.String({
          description:
            "For denial, identify the specific doubt in the agent's rationale and what facts a revised rationale must establish. Do not propose an alternate operation.",
        }),
        scope: Type.Optional(
          Type.Union([Type.Literal("once"), Type.Literal("session")]),
        ),
      }),
      { minItems: 1 },
    ),
  }),
};

export function normalizeCommand(command: string): string {
  // Shell whitespace is syntax and may also be quoted data or heredoc content.
  return command;
}

function approvalActionDigest(input: {
  toolName: string;
  subject: string;
  description?: string;
}): string {
  // This stable in-memory key is only for matching an already reviewed action.
  // The runtime persists a cryptographic digest for user-facing approval grants.
  return createHash("sha256")
    .update(
      JSON.stringify([input.toolName, input.subject, input.description ?? ""]),
    )
    .digest("hex");
}
