// @vitest-environment node
import { describe, expect, it, type Mock } from "vitest";
import type {
  AutomationApprovalRequest,
  AutomationDetail,
  AutomationFacts,
  AutomationRunSummary,
  AutomationSummary,
} from "../../../../shared/automation";
import type { WeChatSettings } from "../../../../shared/wechatRemote";
import { render } from "../../replies";
import type { ConfirmAsk, ParsedCommand } from "../../types";
import {
  createFakeHost,
  createTestContext,
  type TestContext,
} from "../../__tests__/fakes";
import type { CommandContext } from "../types";
import { automationHandlers } from "../automations";

const SECRET = "sk-live-SECRET-VALUE-123";

function command(
  name: "autos" | "auto" | "runs",
  args: string[] = [],
  project?: string,
): ParsedCommand {
  return {
    kind: "command",
    name,
    args,
    ...(project === undefined ? {} : { project }),
  };
}

function run(ctx: CommandContext, parsed: ParsedCommand) {
  const handler = automationHandlers[parsed.name];
  if (!handler) throw new Error(`no handler for ${parsed.name}`);
  return handler(ctx, parsed);
}

function automation(
  id: string,
  overrides: Partial<AutomationSummary> = {},
): AutomationSummary {
  return {
    id,
    projectId: "p1",
    projectName: "pine",
    name: `Auto ${id}`,
    revision: 1,
    status: "active",
    triggers: ["schedule"],
    running: false,
    ...overrides,
  };
}

const FACTS: AutomationFacts = {
  name: "Auto a",
  triggers: [
    { kind: "schedule", rrule: "FREQ=DAILY", missed: "skip" },
    {
      kind: "folder",
      folder: { folderId: "f1", folderName: "inbox", path: "/Users/me/inbox" },
      include: [],
      exclude: [],
      events: ["added"],
    },
  ],
  read: [{ folderId: "f1", folderName: "inbox", path: "/Users/me/inbox" }],
  write: [{ folderId: "f2", folderName: "out", path: "/Users/me/out" }],
  network: ["api.example.com"],
  tools: [],
  mcp: [],
  secrets: ["API_KEY"],
  skills: [],
  notify: "always",
  outputs: [],
  limits: { maxRunsPerDay: 5, maxMinutesPerRun: 10 },
};

function detailOf(summary: AutomationSummary): AutomationDetail {
  return {
    ...summary,
    spec: {
      version: 1,
      name: summary.name,
      enabled: summary.status === "active",
      triggers: [],
      action: { prompt: `use ${SECRET}` },
      delivery: {},
    } as unknown as AutomationDetail["spec"],
    facts: FACTS,
    createdAt: "2026-11-01T00:00:00.000Z",
    updatedAt: "2026-11-01T00:00:00.000Z",
  };
}

function setup(
  options: {
    automations?: AutomationSummary[];
    settings?: Partial<WeChatSettings>;
    localApprovals?: boolean;
  } = {},
): TestContext {
  const ctx = createTestContext({
    ...(options.settings ? { settings: options.settings } : {}),
    host: createFakeHost({
      localAutomationApprovals: options.localApprovals ?? true,
    }),
  });
  ctx.fake.core.addProject("p1", { name: "pine" });
  const list = options.automations ?? [automation("a")];
  const fake = ctx.fake.core.automations;
  (
    fake.list as Mock<(projectId?: string) => Promise<AutomationSummary[]>>
  ).mockImplementation((projectId?: string) =>
    Promise.resolve(
      list.filter((entry) => !projectId || entry.projectId === projectId),
    ),
  );
  (
    fake.get as Mock<
      (projectId: string, id: string) => Promise<AutomationDetail>
    >
  ).mockImplementation((projectId: string, id: string) => {
    const found = list.find(
      (entry) => entry.id === id && entry.projectId === projectId,
    );
    return found
      ? Promise.resolve(detailOf(found))
      : Promise.reject(new Error("Automation not found."));
  });
  return ctx;
}

function enableMock(ctx: TestContext) {
  return ctx.fake.core.automations.setEnabled as Mock<
    (
      requester: { projectId: string; source: string; via?: string },
      automationId: string,
      enabled: boolean,
    ) => Promise<void>
  >;
}

async function listed(ctx: TestContext): Promise<string> {
  const result = await run(ctx, command("autos"));
  ctx.handles.noteDelivered("automation", ctx.now);
  return result.text ?? "";
}

describe(".autos", () => {
  it("lists automations with state and fills the automation table", async () => {
    const ctx = setup({
      automations: [
        automation("a"),
        automation("b", { status: "disabled" }),
        automation("c", { status: "paused" }),
      ],
    });
    const text = await listed(ctx);
    expect(text).toContain("**1** Auto a · pine · on");
    expect(text).toContain("**2** Auto b · pine · off");
    expect(text).toContain("**3** Auto c · pine · paused");
    expect(ctx.handles.resolve("automation", 2)).toMatchObject({
      id: "b",
      projectId: "p1",
    });
  });

  it("filters by @project", async () => {
    const ctx = setup();
    await run(ctx, command("autos", [], "pine"));
    expect(ctx.fake.core.automations.list).toHaveBeenCalledWith("p1");
  });

  it("says when there are none", async () => {
    const ctx = setup({ automations: [] });
    expect(await listed(ctx)).toBe(
      render("R-AUTOS", "en", { now: 0, rows: [] }),
    );
  });
});

describe(".auto N", () => {
  it("shows facts only: never the spec, a secret or an absolute path", async () => {
    const ctx = setup();
    await listed(ctx);
    const text = (await run(ctx, command("auto", ["1"]))).text ?? "";
    expect(text).toContain("**Auto a** · pine · on");
    expect(text).toContain("Reads: inbox");
    expect(text).toContain("Writes: out · Network: api.example.com");
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain("API_KEY");
    expect(text).not.toContain("/Users/me");
    expect(text).not.toContain("{");
  });

  it("answers E-REF without a delivered list and E-ARGS for an unknown action", async () => {
    const ctx = setup();
    expect((await run(ctx, command("auto", ["1"]))).text).toBe(
      render("E-REF", "en", { n: "1", list: ".au" }),
    );
    await listed(ctx);
    expect((await run(ctx, command("auto", ["1", "explode"]))).text).toContain(
      "Usage: `.auto",
    );
  });

  it("off turns it off as a web requester", async () => {
    const ctx = setup();
    await listed(ctx);
    const result = await run(ctx, command("auto", ["1", "off"]));
    expect(result.text).toBe(render("R-AUTO-OFF", "en", { name: "Auto a" }));
    expect(ctx.fake.core.automations.setEnabled).toHaveBeenCalledWith(
      { projectId: "p1", source: "web" },
      "a",
      false,
    );
  });
});

describe(".auto N on", () => {
  it("returns at once while the approval never settles, and passes via wechat", async () => {
    const ctx = setup({
      automations: [automation("a", { status: "disabled" })],
    });
    const setEnabled = enableMock(ctx);
    setEnabled.mockImplementation(() => new Promise<void>(() => undefined));
    await listed(ctx);
    const result = await run(ctx, command("auto", ["1", "on"]));
    expect(result.text).toBe(render("R-AUTO-ON", "en", { name: "Auto a" }));
    expect(setEnabled).toHaveBeenCalledTimes(1);
    expect(setEnabled).toHaveBeenCalledWith(
      { projectId: "p1", source: "agent", via: "wechat" },
      "a",
      true,
    );
    // Never a source that would enable without the local approval.
    for (const call of setEnabled.mock.calls)
      expect(call[0].source).not.toBe("desktop");
  });

  it("raises no second request while one is pending", async () => {
    const ctx = setup({
      automations: [automation("a", { status: "disabled" })],
    });
    const setEnabled = enableMock(ctx);
    setEnabled.mockImplementation(() => new Promise<void>(() => undefined));
    await listed(ctx);
    await run(ctx, command("auto", ["1", "on"]));
    const again = await run(ctx, command("auto", ["1", "on"]));
    expect(again.text).toBe(
      render("R-AUTO-ON-PENDING", "en", { name: "Auto a" }),
    );
    expect(setEnabled).toHaveBeenCalledTimes(1);
  });

  it("does not ask again when an enable request already waits on the computer", async () => {
    const ctx = setup({
      automations: [automation("a", { status: "disabled" })],
    });
    ctx.fake.core.automations.pendingApprovals.mockReturnValue([
      {
        requestId: "r1",
        projectId: "p1",
        projectName: "pine",
        kind: "enable",
        automationId: "a",
        facts: FACTS,
        warnings: [],
        createdAt: "2026-11-12T07:00:00.000Z",
      } satisfies AutomationApprovalRequest,
    ]);
    await listed(ctx);
    expect((await run(ctx, command("auto", ["1", "on"]))).text).toBe(
      render("R-AUTO-ON-PENDING", "en", { name: "Auto a" }),
    );
    expect(ctx.fake.core.automations.setEnabled).not.toHaveBeenCalled();
  });

  it("is refused on a host without local approvals", async () => {
    const ctx = setup({
      automations: [automation("a", { status: "disabled" })],
      localApprovals: false,
    });
    await listed(ctx);
    expect((await run(ctx, command("auto", ["1", "on"]))).text).toBe(
      render("E-LOCAL", "en", {}),
    );
    expect(ctx.fake.core.automations.setEnabled).not.toHaveBeenCalled();
  });

  it("says when it is already on", async () => {
    const ctx = setup();
    await listed(ctx);
    expect((await run(ctx, command("auto", ["1", "on"]))).text).toBe(
      render("R-AUTO-ALREADY", "en", { name: "Auto a" }),
    );
    expect(ctx.fake.core.automations.setEnabled).not.toHaveBeenCalled();
  });

  it("pushes the outcome when the local decision arrives", async () => {
    const ctx = setup({
      automations: [automation("a", { status: "disabled" })],
    });
    let approve: () => void = () => undefined;
    enableMock(ctx).mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          approve = resolve;
        }),
    );
    await listed(ctx);
    await run(ctx, command("auto", ["1", "on"]));
    approve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(ctx.sessions.enablePending("p1", "a")).toBe(false);
  });
});

describe(".auto N run", () => {
  it("is refused below an Autonomous ceiling", async () => {
    const ctx = setup({ settings: { ceilingMode: "auto-approve" } });
    await listed(ctx);
    expect((await run(ctx, command("auto", ["1", "run"]))).text).toBe(
      render("E-CEIL", "en", { ceiling: "auto-approve" }),
    );
    expect(ctx.fake.core.automations.runNow).not.toHaveBeenCalled();
  });

  it("is refused for a disabled automation", async () => {
    const ctx = setup({
      automations: [automation("a", { status: "disabled" })],
      settings: { ceilingMode: "autonomous" },
    });
    await listed(ctx);
    expect((await run(ctx, command("auto", ["1", "run"]))).text).toBe(
      render("E-AUTOOFF", "en", { name: "Auto a" }),
    );
  });

  it("is refused when already running", async () => {
    const ctx = setup({
      automations: [automation("a", { running: true })],
      settings: { ceilingMode: "autonomous" },
    });
    await listed(ctx);
    expect((await run(ctx, command("auto", ["1", "run"]))).text).toBe(
      render("E-BUSY", "en", { variant: "running", title: "Auto a" }),
    );
  });

  it("asks for a confirmation, then runs when it is approved", async () => {
    const ctx = setup({ settings: { ceilingMode: "autonomous" } });
    await listed(ctx);
    const parsed = command("auto", ["1", "run"]);
    const asked = await run(ctx, parsed);
    const ask = ctx.asks.list().find((entry) => entry.kind === "confirm");
    expect(ask).toBeDefined();
    expect(asked.text).toBe(
      render("R-AUTO-RUN-ASK", "en", { name: "Auto a", ask: ask?.number ?? 0 }),
    );
    expect(ctx.fake.core.automations.runNow).not.toHaveBeenCalled();

    const confirmed = { ...ctx, confirmed: ask as ConfirmAsk };
    const ran = await run(confirmed, parsed);
    expect(ran.text).toBe(render("R-AUTO-RUN", "en", { name: "Auto a" }));
    expect(ctx.fake.core.automations.runNow).toHaveBeenCalledWith("p1", "a");
    expect(ctx.fake.host.notifications.map((n) => n.kind)).toEqual([
      "automation-run",
    ]);
  });

  it("re-checks at execution: queued in the meantime is refused", async () => {
    const ctx = setup({ settings: { ceilingMode: "autonomous" } });
    await listed(ctx);
    const parsed = command("auto", ["1", "run"]);
    await run(ctx, parsed);
    const ask = ctx.asks.list().find((entry) => entry.kind === "confirm");
    ctx.fake.core.automations.runNow.mockImplementation(() => {
      throw new Error("This automation is already running or about to run.");
    });
    const ran = await run({ ...ctx, confirmed: ask }, parsed);
    expect(ran.text).toBe(
      render("E-BUSY", "en", { variant: "running", title: "Auto a" }),
    );
    expect(ctx.fake.host.notifications).toEqual([]);
  });
});

describe(".runs", () => {
  const runs: AutomationRunSummary[] = [
    {
      id: "run-1",
      automationId: "a",
      projectId: "p1",
      automationName: "Auto a",
      status: "findings",
      trigger: "schedule",
      startedAt: "2026-11-12T07:00:00.000Z",
      summary: "Found **two** new invoices.",
      read: false,
      kept: false,
    },
  ];

  it("lists runs and shows one run's summary labelled as model-written", async () => {
    const ctx = setup();
    ctx.fake.core.automations.listRuns.mockResolvedValue(runs);
    const list = await run(ctx, command("runs"));
    expect(list.numbered).toEqual({ kind: "run" });
    expect(list.text).toContain("**1** Auto a · findings");
    expect(list.text).toContain("unread");
    ctx.handles.noteDelivered("run", ctx.now);
    const one = (await run(ctx, command("runs", ["1"]))).text ?? "";
    expect(one).toContain("> Summary written by the automation");
    expect(one).toContain("Found **two** new invoices.");
  });

  it("answers E-REF without a delivered list", async () => {
    const ctx = setup();
    expect((await run(ctx, command("runs", ["1"]))).text).toBe(
      render("E-REF", "en", { n: "1", list: ".ar" }),
    );
  });
});
