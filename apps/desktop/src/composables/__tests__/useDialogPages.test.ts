import { afterEach, expect, it, vi } from "vitest";
import { useDialogPages } from "../useDialogPages";

function stubPhone(matches: boolean, reduceMotion = false): void {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: query.includes("reduced-motion") ? reduceMotion : matches,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    })),
  );
}

function stubViewTransition() {
  let finish!: () => void;
  const finished = new Promise<void>((resolve) => (finish = resolve));
  const startViewTransition = vi.fn((update: () => Promise<void>) => {
    void update();
    return { finished } as unknown as ViewTransition;
  });
  Object.defineProperty(document, "startViewTransition", {
    configurable: true,
    value: startViewTransition,
  });
  return { finish, startViewTransition };
}

afterEach(() => {
  vi.unstubAllGlobals();
  Reflect.deleteProperty(document, "startViewTransition");
  delete document.documentElement.dataset.dialogPage;
});

it("slides between pages on a phone and clears the direction after", async () => {
  stubPhone(true);
  const { finish, startViewTransition } = stubViewTransition();
  const update = vi.fn();

  useDialogPages()("forward", update);
  expect(startViewTransition).toHaveBeenCalledOnce();
  expect(update).toHaveBeenCalledOnce();
  expect(document.documentElement.dataset.dialogPage).toBe("forward");

  finish();
  await Promise.resolve();
  await Promise.resolve();
  expect(document.documentElement.dataset.dialogPage).toBeUndefined();
});

it.each([
  ["away from a phone", false, false],
  ["with reduced motion", true, true],
])("changes the page at once %s", (_, phone, reduceMotion) => {
  stubPhone(phone, reduceMotion);
  const { startViewTransition } = stubViewTransition();
  const update = vi.fn();

  useDialogPages()("back", update);
  expect(update).toHaveBeenCalledOnce();
  expect(startViewTransition).not.toHaveBeenCalled();
  expect(document.documentElement.dataset.dialogPage).toBeUndefined();
});
