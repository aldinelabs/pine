// @vitest-environment node
// WeChat in front of Pine's Orchestrator (docs/orchestrator-proposal.md P1),
// against the real bridge, ClawBot channel and mock iLink server. The
// Assistant is a stand-in that holds one conversation as its own client;
// what it decides is played by the test.
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ASSISTANT_PROJECT_ID } from "../../../shared/assistant";
import { type Harness, createHarness, sleep, waitFor } from "./e2eHarness";

const harnesses: Harness[] = [];

afterEach(async () => {
  for (const harness of harnesses.splice(0).reverse()) await harness.close();
});

async function harness(
  options: Parameters<typeof createHarness>[0] = {},
): Promise<Harness> {
  const created = await createHarness({ assistant: true, ...options });
  harnesses.push(created);
  return created;
}

function cardNumber(text: string): number {
  const match = /`\.y (\d{2})`/.exec(text);
  if (!match) throw new Error(`no approvable card in ${JSON.stringify(text)}`);
  return Number(match[1]);
}

/** Texts sent after the first `from` messages. */
function after(h: Harness, from: number): string[] {
  return h.texts().slice(from);
}

describe("WeChat and the Assistant", { timeout: 30_000 }, () => {
  it("dispatches from plain text, carries the card, takes .y and reports the result", async () => {
    const h = await harness();

    // 1. Plain text goes to the Assistant, word for word, and nowhere else.
    const before = h.texts().length;
    h.push("帮我在博客项目里修一下首页样式");
    await waitFor(() => h.assistantCalls.length === 1);
    expect(h.assistantCalls[0]).toEqual({
      message: "帮我在博客项目里修一下首页样式",
      ceiling: "auto-approve",
      steer: false,
    });
    await h.settle();
    // The reply is the Assistant's; the bridge only shows "typing…".
    expect(after(h, before)).toEqual([]);

    // 2. Its turn dispatches a session and ends with a reply, pushed as is.
    const assistant = h.assistantSession();
    h.running(assistant);
    const work = await h.dispatch("修一下首页样式");
    h.finish(assistant, "已派给「修首页样式」会话（Garden），完成后告诉你。");
    const reply = await h.sent((text) => text.includes("修首页样式"));
    expect(reply).toMatch(/^\*\*(Orchestrator|指挥)\*\*/);
    expect(reply).toContain("已派给「修首页样式」会话（Garden）");

    // 3. The dispatched session's approval reaches WeChat as a card.
    h.running(work);
    const requestId = h.approval(work, { subject: "npm run build" });
    const card = await h.sent((text) => text.includes("npm run build"));
    const number = cardNumber(card);

    // 4. `.y NN` approves it, without the Assistant.
    await h.say(`.y ${number}`);
    await waitFor(() => h.agentHost.respondApproval.mock.calls.length === 1);
    expect(h.agentHost.respondApproval.mock.calls[0]?.[0]).toBe(requestId);
    expect(h.agentHost.respondApproval.mock.calls[0]?.[1]).toMatchObject({
      kind: "allow",
    });

    // 5. Its result is pushed with the usual template; the Assistant is not woken.
    h.finish(work, "首页样式已修好，按钮间距统一为 8px。");
    const done = await h.sent((text) => text.includes("按钮间距统一为 8px"));
    expect(done).toContain("Garden");
    expect(h.assistantCalls).toHaveLength(1);
  });

  it("sends a reply's blank-line parts as separate WeChat messages", async () => {
    const h = await harness();
    h.push("现在都在跑啥");
    await waitFor(() => h.assistantCalls.length === 1);
    const assistant = h.assistantSession();
    h.running(assistant);
    const before = h.texts().length;
    h.finish(
      assistant,
      "博客的「修首页样式」还在跑\n\n别的都停了\n\n要我催一下吗？",
    );
    await waitFor(() => h.texts().length >= before + 3);
    await h.settle();
    const bubbles = after(h, before);
    expect(bubbles).toHaveLength(3);
    expect(bubbles[0]).toMatch(/^\*\*(Orchestrator|指挥)\*\*/);
    expect(bubbles[0]).toContain("还在跑");
    expect(bubbles[1]).toBe("别的都停了");
    expect(bubbles[2]).toBe("要我催一下吗？");
    // Nothing is left for .more.
    expect(await h.say(".more")).not.toContain("别的都停了");
  });

  it("takes 批准 NN as the bridge's own .y NN", async () => {
    const h = await harness();
    h.push("修首页");
    await waitFor(() => h.assistantCalls.length === 1);
    const work = await h.dispatch("修首页");
    h.running(work);
    const requestId = h.approval(work, { subject: "git push" });
    const number = cardNumber(
      await h.sent((text) => text.includes("git push")),
    );

    await h.say(`批准 ${number}`);
    await waitFor(() => h.agentHost.respondApproval.mock.calls.length === 1);
    expect(h.agentHost.respondApproval.mock.calls[0]?.[0]).toBe(requestId);
    expect(h.assistantCalls).toHaveLength(1);
  });

  it("talks to a session directly after .u and goes back with .home", async () => {
    const h = await harness();
    h.push("修首页");
    await waitFor(() => h.assistantCalls.length === 1);
    const work = await h.dispatch("修首页");
    h.running(work);
    h.finish(work, "修好了");
    await h.sent((text) => text.includes("修好了"));

    const use = await h.say(".u 9");
    expect(use).toContain(".home");
    h.push("再把标题调大一点");
    await waitFor(() =>
      h.agentHost.prompt.mock.calls.some(
        ([sessionId, message]) =>
          sessionId === work && String(message).includes("再把标题调大一点"),
      ),
    );
    expect(h.assistantCalls).toHaveLength(1);
    expect(await h.say(".")).toMatch(/current session|当前会话/);

    const home = await h.say(".home");
    expect(home).toMatch(/Orchestrator|指挥/);
    h.push("现在都在跑什么？");
    await waitFor(() => h.assistantCalls.length === 2);
    expect(h.assistantCalls[1]?.message).toBe("现在都在跑什么？");
  });

  it("hands staged files to the Assistant with the next message", async () => {
    const h = await harness();
    const item = h.mock.hostMedia("file", Buffer.from("季度数据"), "q3.csv");
    await h.say("", { item_list: [item] });
    h.push("把这份表格交给数据项目分析");
    await waitFor(() => h.assistantCalls.length === 1);

    const call = h.assistantCalls[0];
    expect(call?.message).toBe("把这份表格交给数据项目分析");
    expect(call?.attachments).toHaveLength(1);
    const [file] = call?.attachments ?? [];
    expect(file?.name).toBe("q3.csv");
    // Stored like any session's attachment, in the Assistant's own storage.
    const root = h.repository.dataPaths(ASSISTANT_PROJECT_ID).attachmentsRoot;
    expect(path.relative(root, file?.path ?? "")).not.toMatch(/^\.\./);
    expect(await readFile(file?.path ?? "", "utf8")).toBe("季度数据");
    // Taken: the next message carries none.
    h.push("还有别的吗？");
    await waitFor(() => h.assistantCalls.length === 2);
    expect(h.assistantCalls[1]?.attachments).toBeUndefined();
  });

  it("sends nothing to the Assistant where Pine has none", async () => {
    const h = await harness({ assistant: false });
    await h.say("修首页");
    await waitFor(() => h.agentHost.createSession.mock.calls.length === 1);
    expect(h.assistantCalls).toHaveLength(0);
  });
});

describe(
  "a WeChat remote set up before the Assistant",
  { timeout: 30_000 },
  () => {
    it("keeps plain text on the current session and says so once", async () => {
      const first = await createHarness({ assistant: true });
      // Rewrite the sealed blob as an older Pine wrote it: no plainTarget.
      await first.bridge.stop();
      first.bridge.dispose();
      await first.bridge.state.flush();
      const blobPath = path.join(first.dataDirectory, "wechat-remote-secure");
      const sealed = (await readFile(blobPath, "utf8")).trim();
      const hex = Buffer.from(sealed, "base64")
        .toString("utf8")
        .slice("sealed:".length);
      const blob = JSON.parse(Buffer.from(hex, "hex").toString("utf8")) as {
        settings: Record<string, unknown>;
      };
      delete blob.settings.plainTarget;
      await writeFile(
        blobPath,
        Buffer.from(
          `sealed:${Buffer.from(JSON.stringify(blob)).toString("hex")}`,
        ).toString("base64"),
      );
      const h = await createHarness({
        assistant: true,
        reuse: first,
        bind: false,
      });
      harnesses.push(first, h);

      expect(h.bridge.status().settings.plainTarget).toBe("session");
      await waitFor(() => h.bridge.status().connection === "online");
      // Messages queued before the first poll after a restart are backlog.
      await sleep(500);
      const reply = await h.say(".");
      expect(reply).toContain(".home");
      await h.say("修一下登录页");
      await waitFor(() => h.agentHost.createSession.mock.calls.length === 1);
      expect(h.assistantCalls).toHaveLength(0);
      // Once only.
      const next = await h.say(".");
      expect(next).not.toMatch(/New: Pine now has|新功能/);
    });
  },
);
