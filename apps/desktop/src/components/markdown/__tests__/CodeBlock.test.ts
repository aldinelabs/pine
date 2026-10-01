import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { codeToHtml } from "@/lib/codeHighlight";
import { useAppearanceStore } from "@/stores/appearance";
import CodeBlock from "../CodeBlock.vue";

vi.mock("@/lib/codeHighlight", () => ({ codeToHtml: vi.fn() }));

const source =
  'RESULT=$?\nif [ $RESULT -eq 0 ]; then\n  echo "<done> & ready"\n\nfi';
const node = { type: "code_block" as const, language: "bash", code: source };

function deferred() {
  let resolve!: (html: string) => void;
  const promise = new Promise<string>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("CodeBlock", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.mocked(codeToHtml).mockReset();
    vi.stubGlobal("IntersectionObserver", undefined);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shows escaped, preformatted source while highlighting is pending", () => {
    vi.mocked(codeToHtml).mockReturnValue(new Promise(() => {}));
    const wrapper = mount(CodeBlock, { props: { node } });

    expect(wrapper.get("pre code").element.textContent).toBe(source);
    expect(wrapper.find("done").exists()).toBe(false);
    wrapper.unmount();
  });

  it("shows fixed line numbers in file preview layout", () => {
    vi.mocked(codeToHtml).mockReturnValue(new Promise(() => {}));
    const wrapper = mount(CodeBlock, {
      props: {
        layout: "preview",
        node: { ...node, code: "first\n\nthird" },
      },
    });

    expect(
      wrapper.findAll(".code-preview-line-number").map((line) => line.text()),
    ).toEqual(["1", "2", "3"]);
    expect(wrapper.get(".code-preview-gutter").attributes("aria-hidden")).toBe(
      "true",
    );
    wrapper.unmount();
  });

  it("preserves indentation and blank lines when highlighting fails", async () => {
    vi.mocked(codeToHtml).mockRejectedValue(new Error("Unknown language"));
    const wrapper = mount(CodeBlock, { props: { node } });
    await flushPromises();

    expect(wrapper.get("pre code").element.textContent).toBe(source);
    expect(wrapper.find("done").exists()).toBe(false);
    wrapper.unmount();
  });

  it("serializes stable highlights and only processes the latest queued source", async () => {
    const first = deferred();
    const second = deferred();
    vi.mocked(codeToHtml)
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const wrapper = mount(CodeBlock, { props: { node } });
    await wrapper.setProps({ node: { ...node, code: "echo intermediate" } });
    await wrapper.setProps({ node: { ...node, code: "echo latest" } });
    expect(wrapper.get("pre code").element.textContent).toBe("echo latest");
    expect(codeToHtml).toHaveBeenCalledTimes(1);

    first.resolve('<pre class="shiki"><code>old result</code></pre>');
    await flushPromises();
    expect(codeToHtml).toHaveBeenCalledTimes(2);
    expect(codeToHtml).toHaveBeenLastCalledWith("echo latest", {
      lang: "bash",
      themes: { light: "vitesse-light", dark: "vitesse-dark" },
      defaultColor: false,
    });

    second.resolve('<pre class="shiki"><code>echo latest</code></pre>');
    await flushPromises();
    expect(wrapper.get("pre.shiki code").text()).toBe("echo latest");
    wrapper.unmount();
  });

  it("skips Shiki while a code fence streams and highlights its final source once", async () => {
    vi.mocked(codeToHtml).mockResolvedValue(
      '<pre class="shiki"><code>final source</code></pre>',
    );
    const wrapper = mount(CodeBlock, {
      props: { node: { ...node, code: "first", loading: true } },
    });

    await wrapper.setProps({
      node: { ...node, code: "first\nsecond", loading: true },
    });
    await wrapper.setProps({
      node: { ...node, code: "final source", loading: false },
    });
    await flushPromises();

    expect(codeToHtml).toHaveBeenCalledTimes(1);
    expect(codeToHtml).toHaveBeenCalledWith("final source", {
      lang: "bash",
      themes: { light: "vitesse-light", dark: "vitesse-dark" },
      defaultColor: false,
    });
    expect(wrapper.get("pre.shiki code").text()).toBe("final source");
    wrapper.unmount();
  });

  it("defers highlighting until an offscreen block approaches the viewport", async () => {
    let reveal: (() => void) | undefined;
    class TestIntersectionObserver {
      constructor(callback: IntersectionObserverCallback) {
        reveal = () =>
          callback(
            [{ isIntersecting: true } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver,
          );
      }
      disconnect() {}
      observe() {}
    }
    vi.stubGlobal("IntersectionObserver", TestIntersectionObserver);
    vi.mocked(codeToHtml).mockResolvedValue(
      '<pre class="shiki"><code>visible</code></pre>',
    );

    const wrapper = mount(CodeBlock, { props: { node } });
    await flushPromises();
    expect(codeToHtml).not.toHaveBeenCalled();

    reveal?.();
    await flushPromises();
    expect(codeToHtml).toHaveBeenCalledOnce();
    wrapper.unmount();
  });

  it("switches palettes without clearing or rehighlighting the code", async () => {
    vi.mocked(codeToHtml).mockResolvedValue(
      '<pre class="shiki"><code /></pre>',
    );
    const wrapper = mount(CodeBlock, { props: { node } });
    await flushPromises();
    expect(codeToHtml).toHaveBeenLastCalledWith(source, {
      lang: "bash",
      themes: { light: "vitesse-light", dark: "vitesse-dark" },
      defaultColor: false,
    });

    const pre = wrapper.get("pre.shiki").element;
    for (const scheme of ["dark", "light"] as const) {
      useAppearanceStore().colorScheme = scheme;
      await flushPromises();
      expect(
        wrapper.get(".code-highlight").attributes("data-color-scheme"),
      ).toBe(scheme);
      expect(wrapper.get("pre.shiki").element).toBe(pre);
    }
    expect(codeToHtml).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it("copies the exact source even when highlighting fails", async () => {
    vi.mocked(codeToHtml).mockRejectedValue(new Error("Unavailable"));
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    const wrapper = mount(CodeBlock, { props: { node } });
    await flushPromises();
    await wrapper.get('button[aria-label="复制代码"]').trigger("click");
    expect(writeText).toHaveBeenCalledWith(source);
    wrapper.unmount();
  });
});
