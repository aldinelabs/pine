import { describe, expect, it } from "vitest";
import { ref, type Ref } from "vue";
import type { PineTranscriptMessage } from "@/stores/session";
import {
  toolRunKeys,
  useToolActivityExpansion,
} from "../useToolActivityExpansion";

function message(
  id: string,
  blocks: PineTranscriptMessage["blocks"],
): PineTranscriptMessage {
  return {
    createdAt: "2026-08-26T00:00:00.000Z",
    id,
    role: "assistant",
    status: "complete",
    blocks,
  };
}

const single = (id: string) => ({
  type: "toolCall" as const,
  toolCall: { id, name: "bash", status: "complete" as const },
});

describe("toolRunKeys", () => {
  it("keys consecutive calls as one unit and standalone calls as their own", () => {
    const keys = toolRunKeys([
      message("m1", [
        { type: "thinking", thinking: "Think." },
        single("t1"),
        single("t2"),
      ]),
      message("m2", [{ type: "text", text: "Done" }]),
      message("m3", [single("t3")]),
    ]);
    expect(keys).toEqual(["m1:t1", "m3:t3"]);
  });
});

describe("useToolActivityExpansion", () => {
  it("keeps only the last two units expanded while the response runs", () => {
    const messages = ref([
      message("m1", [single("t1")]),
      message("m2", [single("t2")]),
      message("m3", [single("t3")]),
    ]);
    const isRunning = ref(true);
    const expanded = useToolActivityExpansion({ messages, isRunning });

    // t3 (newest) and t2 hold the window; t1 already fell out.
    messages.value = [...messages.value];
    expect(expanded.value).toEqual(new Set(["m2:t2", "m3:t3"]));
    messages.value = [
      ...messages.value,
      message("m4", [single("t4")]),
      message("m5", [single("t5")]),
    ];
    expect(expanded.value).toEqual(new Set(["m4:t4", "m5:t5"]));
  });

  it("collapses everything once the response ends", () => {
    const messages = ref([message("m1", [single("t1")])]);
    const isRunning = ref(true);
    const expanded = useToolActivityExpansion({ messages, isRunning });
    expect(expanded.value.has("m1:t1")).toBe(true);

    isRunning.value = false;
    expect(expanded.value.size).toBe(0);
  });
});

describe("useToolActivityExpansion scan", () => {
  it("does not read the transcript while no response runs", () => {
    const list = ref([message("m1", [single("t1")])]);
    let reads = 0;
    const messages = {
      get value() {
        reads += 1;
        return list.value;
      },
    } as Ref<PineTranscriptMessage[]>;
    const isRunning = ref(false);
    const expanded = useToolActivityExpansion({ messages, isRunning });

    expect(expanded.value.size).toBe(0);
    list.value = [...list.value, message("m2", [single("t2")])];
    expect(expanded.value.size).toBe(0);
    expect(reads).toBe(0);

    isRunning.value = true;
    expect(expanded.value).toEqual(new Set(["m1:t1", "m2:t2"]));
    expect(reads).toBe(1);
  });
});
