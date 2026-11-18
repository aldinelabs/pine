import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import IntelligentUiBlock from "../../IntelligentUiBlock.vue";
import { intelligentUiHostKey } from "../../context";

let mounted = 0;

/** Mounts a block with a fresh store and its own message id. */
export async function mountBlock(code: string, send = vi.fn()) {
  setActivePinia(createPinia());
  const wrapper = mount(IntelligentUiBlock, {
    props: { code, streaming: false, messageId: `fixture-${++mounted}` },
    attachTo: document.body,
    global: {
      plugins: [createAppI18n("en-US")],
      provide: { [intelligentUiHostKey as symbol]: { send } },
    },
  });
  await flushPromises();
  return wrapper;
}

export type BlockWrapper = Awaited<ReturnType<typeof mountBlock>>;

export function buttonNamed(wrapper: BlockWrapper, name: string) {
  const button = wrapper
    .findAll("button")
    .find((candidate) => candidate.text() === name);
  if (!button) throw new Error(`No button named ${name}`);
  return button;
}
