import { describe, expect, it } from "vitest";
import { isReactive, reactive } from "vue";
import {
  PINE_SESSION_MUTATION_MESSAGE,
  isPineSessionMutator,
  sessionMutationToolCall,
  uniqueSessionMutators,
} from "../sessionMutators";
import { parseMessageBlocks, transcriptRole } from "../sessions";

const skill = { kind: "activate-authoring", target: "skill" } as const;
const mcp = { kind: "activate-authoring", target: "mcp" } as const;

function mutationMessage(mutator: unknown) {
  return {
    role: "custom",
    customType: PINE_SESSION_MUTATION_MESSAGE,
    content: "<mcp_authoring>…</mcp_authoring>",
    display: true,
    details: { mutator },
    timestamp: 42,
  };
}

describe("session mutators", () => {
  it("accepts only known mutators", () => {
    expect(isPineSessionMutator(skill)).toBe(true);
    expect(
      isPineSessionMutator({ kind: "activate-authoring", target: "x" }),
    ).toBe(false);
    expect(isPineSessionMutator({ kind: "other", target: "skill" })).toBe(
      false,
    );
  });

  it("drops repeats and keeps order", () => {
    expect(uniqueSessionMutators([mcp, skill, mcp])).toEqual([mcp, skill]);
  });

  it("returns plain copies of mutators held in reactive state", () => {
    const held = reactive([{ ...mcp }, { ...skill }, { ...mcp }]);
    const unique = uniqueSessionMutators(held);
    expect(unique).toEqual([mcp, skill]);
    expect(unique.some((mutator) => isReactive(mutator))).toBe(false);
    expect(() => structuredClone(unique)).not.toThrow();
  });

  it("shows a mutation as the activation tool it stands in for", () => {
    const message = mutationMessage(mcp);
    expect(sessionMutationToolCall(message, "e1")).toEqual({
      id: "mutation-e1-mcp",
      name: "activate_mcp_authoring",
      status: "complete",
      input: {},
      output: {
        content: [{ type: "text", text: "<mcp_authoring>…</mcp_authoring>" }],
        details: { preactivated: true, mutator: mcp },
      },
    });
    expect(transcriptRole(message)).toBe("assistant");
    expect(parseMessageBlocks(message)).toEqual([
      {
        type: "toolCall",
        toolCall: expect.objectContaining({
          id: "mutation-42-mcp",
          name: "activate_mcp_authoring",
        }),
      },
    ]);
  });

  it("ignores other custom messages and malformed mutations", () => {
    expect(sessionMutationToolCall(mutationMessage({}), "e1")).toBeUndefined();
    const other = { role: "custom", customType: "pine.other", content: "x" };
    expect(sessionMutationToolCall(other, "e1")).toBeUndefined();
    expect(transcriptRole(other)).toBeNull();
    expect(parseMessageBlocks(other)).toEqual([]);
  });
});
