import { afterEach, expect, it } from "vitest";
import { focusDialogContainer } from "../dialogFocus";

afterEach(() => document.body.replaceChildren());

it("focuses the dialog itself instead of its first tabbable element", () => {
  const dialog = document.createElement("div");
  dialog.tabIndex = -1;
  const tab = document.createElement("button");
  dialog.append(tab);
  document.body.append(dialog);
  const event = new CustomEvent("focusScope.autoFocusOnMount", {
    cancelable: true,
  });
  dialog.addEventListener(event.type, focusDialogContainer);

  dialog.dispatchEvent(event);

  expect(event.defaultPrevented).toBe(true);
  expect(document.activeElement).toBe(dialog);
});
