import { DOMWrapper, flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, describe, expect, it } from "vitest";
import { createAppI18n } from "@/app/i18n";
import { HELP_ILLUSTRATIONS } from "@/components/help/illustrations";
import { defineComponent, h, ref } from "vue";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useHelpStore } from "@/stores/help";
import HelpTutorialDialog from "../HelpTutorialDialog.vue";

const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

function find(selector: string): DOMWrapper<Element> {
  return new DOMWrapper(document.querySelector(selector));
}

async function mountDialog(locale: "en-US" | "zh-CN" | "ja-JP" = "en-US") {
  const pinia = createPinia();
  setActivePinia(pinia);
  const wrapper = mount(HelpTutorialDialog, {
    attachTo: document.body,
    global: { plugins: [pinia, createAppI18n(locale)] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return useHelpStore();
}

describe("HelpTutorialDialog", () => {
  it("opens above a dialog opened after it and hands focus back", async () => {
    const help = await mountDialog();
    // Like New Project: a dialog mounted after the app's guide dialog,
    // whose question mark opens a guide.
    const isProjectOpen = ref(true);
    const project = mount(
      defineComponent({
        setup: () => () =>
          h(
            Dialog,
            {
              open: isProjectOpen.value,
              "onUpdate:open": (value: boolean) =>
                (isProjectOpen.value = value),
            },
            () =>
              h(DialogContent, { "data-testid": "project-dialog" }, () => [
                h(DialogTitle, () => "New Project"),
                h(DialogDescription, () => "Folders"),
                h(
                  Button,
                  {
                    "data-testid": "project-hint",
                    onClick: () => help.openTopic("project-folders"),
                  },
                  () => "?",
                ),
              ]),
          ),
      }),
      { attachTo: document.body },
    );
    wrappers.push(project);
    await flushPromises();

    const hint = document.querySelector<HTMLElement>(
      "[data-testid=project-hint]",
    );
    hint?.focus();
    hint?.click();
    await flushPromises();

    const projectDialog = document.querySelector(
      "[data-testid=project-dialog]",
    );
    const guide = document.querySelector("[data-testid=help-tutorial]");
    expect(guide).not.toBeNull();
    // Same z-index, so the later one in the document is the one on top.
    expect(
      (projectDialog?.compareDocumentPosition(guide as Node) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Escape closes only the guide; the project dialog stays, focused again.
    guide?.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
    );
    await flushPromises();
    expect(help.topicId).toBeNull();
    expect(isProjectOpen.value).toBe(true);
    expect(document.activeElement).toBe(hint);

    // A second opening stacks on top again.
    hint?.click();
    await flushPromises();
    const reopened = document.querySelector("[data-testid=help-tutorial]");
    expect(
      (projectDialog?.compareDocumentPosition(reopened as Node) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("stays closed until a topic is opened", async () => {
    await mountDialog();
    expect(document.querySelector("[data-testid=help-tutorial]")).toBeNull();
  });

  it("steps through a guide and closes on Done", async () => {
    const help = await mountDialog();
    help.openTopic("approval-modes");
    await flushPromises();

    const dialog = find("[data-testid=help-tutorial]");
    expect(dialog.text()).toContain("An agent acts through tools");
    expect(dialog.text()).toContain("Step 1 of 4");
    expect(document.querySelector("[data-testid=help-previous]")).toBeNull();

    await find("[data-testid=help-next]").trigger("click");
    expect(find("[data-testid=help-tutorial]").text()).toContain(
      "The four approval modes",
    );
    await find("[data-testid=help-previous]").trigger("click");
    expect(help.step).toBe(0);

    help.openTopic("approval-modes", 3);
    await flushPromises();
    expect(find("[data-testid=help-next]").text()).toBe("Done");
    await find("[data-testid=help-next]").trigger("click");
    await flushPromises();
    expect(help.topicId).toBeNull();
  });

  it("shows a one-page guide without step count or dots", async () => {
    const help = await mountDialog();
    help.openTopic("auto-approval-path");
    await flushPromises();

    const dialog = find("[data-testid=help-tutorial]");
    expect(dialog.text()).toContain("Two approval paths");
    expect(dialog.text()).not.toContain("Step 1 of 1");
    expect(document.querySelector("[data-slot=help-steps]")).toBeNull();
    expect(find("[data-testid=help-next]").text()).toBe("Done");
    await find("[data-testid=help-next]").trigger("click");
    await flushPromises();
    expect(help.topicId).toBeNull();
  });

  it("moves with the arrow keys and the step dots", async () => {
    const help = await mountDialog();
    help.openTopic("context-window");
    await flushPromises();
    await find("[data-testid=help-tutorial]").trigger("keydown", {
      key: "ArrowRight",
    });
    expect(help.step).toBe(1);
    const dots = document.querySelectorAll("[data-slot=help-steps] button");
    expect(dots).toHaveLength(4);
    await new DOMWrapper(dots[3]).trigger("click");
    expect(help.step).toBe(3);
    await find("[data-testid=help-tutorial]").trigger("keydown", {
      key: "ArrowLeft",
    });
    expect(help.step).toBe(2);
  });

  it("clamps a deep link past the last step", async () => {
    const help = await mountDialog();
    help.openTopic("context-window", 99);
    await flushPromises();
    expect(help.step).toBe(3);
  });

  it("shows the Chinese guide, and English where none is written", async () => {
    const help = await mountDialog("zh-CN");
    help.openTopic("context-window");
    await flushPromises();
    expect(find("[data-testid=help-tutorial]").text()).toContain(
      "上下文是模型的工作台",
    );
    wrappers.splice(0).forEach((wrapper) => wrapper.unmount());

    const japanese = await mountDialog("ja-JP");
    japanese.openTopic("context-window");
    await flushPromises();
    const dialog = find("[data-testid=help-tutorial]");
    expect(dialog.attributes("lang")).toBe("en-US");
    expect(dialog.text()).toContain("Context is the model's desk");
    expect(dialog.text()).toContain("ステップ 1 / 4");
  });

  it("renders every illustration", () => {
    for (const component of Object.values(HELP_ILLUSTRATIONS)) {
      const wrapper = mount(component, {
        global: { plugins: [createAppI18n("en-US")] },
      });
      expect(wrapper.html()).not.toBe("");
      wrapper.unmount();
    }
  });
});
