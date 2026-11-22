import { flushPromises, mount } from "@vue/test-utils";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createAppI18n } from "@/app/i18n";
import type { ThirdPartyLicenseCatalog } from "@/build/thirdPartyLicenses";
import {
  PINE_DOCS_URL,
  PINE_ISSUES_URL,
  PINE_RELEASES_URL,
  PINE_REPOSITORY_URL,
} from "@/shared/window";
import { useUpdaterStore } from "@/stores/updater";
import AboutSettings from "../AboutSettings.vue";
import { loadLicenseCatalog } from "../licenseCatalog";

vi.mock("../licenseCatalog", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../licenseCatalog")>()),
  loadLicenseCatalog: vi.fn(),
}));

const catalog: ThirdPartyLicenseCatalog = {
  packages: [
    { name: "vue", version: "3.5.42", license: "MIT", text: 0 },
    {
      name: "zod",
      version: "4.6.6",
      license: "MIT",
      homepage: "https://zod.dev",
      text: 0,
    },
    { name: "typebox", version: "1.3.30", license: "Apache-2.0", text: null },
  ],
  referenced: [
    {
      name: "Sarasa Gothic",
      url: "https://github.com/be5invis/Sarasa-Gothic",
      license: "OFL-1.1",
      kind: "font",
      text: 1,
    },
  ],
  texts: ["MIT License text", "OFL text"],
};

const checkForUpdate = vi.fn();
const wrappers: ReturnType<typeof mount>[] = [];
afterEach(() => wrappers.splice(0).forEach((wrapper) => wrapper.unmount()));

beforeEach(() => {
  setActivePinia(createPinia());
  vi.mocked(loadLicenseCatalog).mockResolvedValue(catalog);
  window.pine = {
    getAppVersion: vi.fn().mockResolvedValue("0.23.0"),
    openExternalUrl: vi.fn().mockResolvedValue(undefined),
    checkForUpdate: checkForUpdate.mockResolvedValue({
      status: "not-available",
    }),
  } as unknown as typeof window.pine;
});

async function mountAbout(locale: "en-US" | "zh-CN" = "en-US") {
  const wrapper = mount(AboutSettings, {
    attachTo: document.body,
    global: { plugins: [createAppI18n(locale)] },
  });
  wrappers.push(wrapper);
  await flushPromises();
  return wrapper;
}

it("shows Pine's version, brand and links", async () => {
  const wrapper = await mountAbout();

  expect(wrapper.get('[data-testid="pine-about-version"]').text()).toBe(
    "Version 0.23.0",
  );
  const by = wrapper.get('[data-testid="pine-about-by"]');
  expect(by.text()).toBe("By");
  expect(by.findAll("img").map((img) => img.attributes("alt"))).toEqual([
    "Aldine Labs",
    "Aldine Labs",
  ]);
  expect(wrapper.text()).toContain("© 2026 Aldine Labs");

  for (const [id, url] of [
    ["docs", PINE_DOCS_URL.en],
    ["source", PINE_REPOSITORY_URL],
    ["releases", PINE_RELEASES_URL],
    ["issues", PINE_ISSUES_URL],
  ]) {
    await wrapper.get(`[data-testid="pine-about-link-${id}"]`).trigger("click");
    expect(window.pine.openExternalUrl).toHaveBeenLastCalledWith(url);
  }
});

it("links Chinese interfaces to the Chinese guide", async () => {
  const wrapper = await mountAbout("zh-CN");

  await wrapper.get('[data-testid="pine-about-link-docs"]').trigger("click");
  expect(window.pine.openExternalUrl).toHaveBeenCalledWith(PINE_DOCS_URL.zh);
});

it("holds the version's place while it loads", async () => {
  vi.mocked(window.pine.getAppVersion).mockReturnValue(new Promise(() => {}));
  vi.mocked(loadLicenseCatalog).mockReturnValue(new Promise(() => {}));
  const wrapper = mount(AboutSettings, {
    global: { plugins: [createAppI18n("en-US")] },
  });
  wrappers.push(wrapper);
  await flushPromises();

  expect(wrapper.find('[data-slot="skeleton"]').exists()).toBe(true);
  expect(
    wrapper.find('[data-testid="pine-about-licenses-loading"]').exists(),
  ).toBe(true);
});

it("says Pine is up to date after a check finds nothing", async () => {
  const wrapper = await mountAbout();

  await wrapper
    .get('[data-testid="pine-about-check-updates"]')
    .trigger("click");
  await flushPromises();

  expect(checkForUpdate).toHaveBeenCalled();
  expect(wrapper.get('[data-testid="pine-about-update-result"]').text()).toBe(
    "Pine is up to date.",
  );
});

it('fades "Pine is up to date." out after five seconds', async () => {
  const wrapper = await mountAbout();
  vi.useFakeTimers();
  try {
    const check = wrapper.get('[data-testid="pine-about-check-updates"]');
    const result = () =>
      wrapper.get('[data-testid="pine-about-update-result"]');

    await check.trigger("click");
    await flushPromises();
    expect(result().attributes("data-visible")).toBeDefined();
    expect(result().classes()).toContain("opacity-100");

    await vi.advanceTimersByTimeAsync(4999);
    expect(result().attributes("data-visible")).toBeDefined();
    await vi.advanceTimersByTimeAsync(1);
    // Faded out, but still in place so nothing below it moves.
    expect(result().attributes("data-visible")).toBeUndefined();
    expect(result().classes()).toEqual(
      expect.arrayContaining(["invisible", "opacity-0"]),
    );

    // Checking again shows it for another five seconds.
    await vi.advanceTimersByTimeAsync(10_000);
    await check.trigger("click");
    await flushPromises();
    expect(result().attributes("data-visible")).toBeDefined();
    await vi.advanceTimersByTimeAsync(4999);
    expect(result().attributes("data-visible")).toBeDefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(result().attributes("data-visible")).toBeUndefined();
  } finally {
    vi.useRealTimers();
  }
});

it("clears the fade timer when the page closes", async () => {
  const wrapper = await mountAbout();
  vi.useFakeTimers();
  try {
    await wrapper
      .get('[data-testid="pine-about-check-updates"]')
      .trigger("click");
    await flushPromises();
    expect(vi.getTimerCount()).toBe(1);
    wrapper.unmount();
    wrappers.splice(wrappers.indexOf(wrapper), 1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    vi.useRealTimers();
  }
});

it("keeps a failed check's message until the next check", async () => {
  checkForUpdate.mockRejectedValue(new Error("offline"));
  const wrapper = await mountAbout();
  vi.useFakeTimers();
  try {
    await wrapper
      .get('[data-testid="pine-about-check-updates"]')
      .trigger("click");
    await flushPromises();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(
      wrapper
        .get('[data-testid="pine-about-update-result"]')
        .attributes("data-visible"),
    ).toBeDefined();
  } finally {
    vi.useRealTimers();
  }
});

it("opens the update dialog when a release is available", async () => {
  checkForUpdate.mockResolvedValue({
    status: "available",
    update: { version: "0.24.0" },
  });
  const wrapper = await mountAbout();

  await wrapper
    .get('[data-testid="pine-about-check-updates"]')
    .trigger("click");
  await flushPromises();

  expect(useUpdaterStore().isDialogOpen).toBe(true);
  expect(
    wrapper.find('[data-testid="pine-about-update-result"]').exists(),
  ).toBe(false);
});

it("does not claim Pine is current when the check fails", async () => {
  checkForUpdate.mockRejectedValue(new Error("offline"));
  const wrapper = await mountAbout();

  await wrapper
    .get('[data-testid="pine-about-check-updates"]')
    .trigger("click");
  await flushPromises();

  expect(wrapper.get('[data-testid="pine-about-update-result"]').text()).toBe(
    "Couldn't check for updates. Try again later.",
  );
});

it("hides the update check where Pine cannot update itself", async () => {
  delete (window.pine as { checkForUpdate?: unknown }).checkForUpdate;
  const wrapper = await mountAbout();

  expect(
    wrapper.find('[data-testid="pine-about-check-updates"]').exists(),
  ).toBe(false);
});

it("folds license groups and opens packages in the browser", async () => {
  const wrapper = await mountAbout();

  const groups = wrapper.findAll('[data-slot="pine-about-license-group"]');
  expect(groups.map((group) => group.text())).toEqual(["MIT2", "Apache-2.01"]);
  // Groups start closed.
  expect(wrapper.findAll('[data-slot="pine-about-package-row"]')).toHaveLength(
    0,
  );

  await groups[0].trigger("click");
  expect(groups[0].attributes("aria-expanded")).toBe("true");
  // One folding container per group, not one animation per package.
  expect(
    wrapper.findAll(".license-group-content[data-state=open]"),
  ).toHaveLength(1);
  const rows = wrapper.findAll('[data-slot="pine-about-package-row"]');
  expect(rows.map((row) => row.text())).toEqual(["vue3.5.42", "zod4.6.6"]);

  await rows[1].trigger("click");
  expect(window.pine.openExternalUrl).toHaveBeenLastCalledWith(
    "https://zod.dev",
  );
  // Without a homepage, a package opens on npm.
  await rows[0].trigger("click");
  expect(window.pine.openExternalUrl).toHaveBeenLastCalledWith(
    "https://www.npmjs.com/package/vue",
  );
  expect(
    wrapper.find('[data-testid="pine-about-license-detail"]').exists(),
  ).toBe(false);

  await groups[0].trigger("click");
  await flushPromises();
  expect(groups[0].attributes("aria-expanded")).toBe("false");
  expect(wrapper.findAll('[data-slot="pine-about-package-row"]')).toHaveLength(
    0,
  );
});

it("opens referenced projects at their homepage", async () => {
  const wrapper = await mountAbout();

  await wrapper.get('[data-slot="pine-about-referenced-row"]').trigger("click");
  expect(window.pine.openExternalUrl).toHaveBeenLastCalledWith(
    "https://github.com/be5invis/Sarasa-Gothic",
  );
});

it("searches by name or license and opens matching groups", async () => {
  const wrapper = await mountAbout();
  const search = wrapper.get('[data-testid="pine-about-license-search"]');

  await search.setValue("apache");
  // Search opens groups at once, without folding.
  expect(
    wrapper.get(".license-group-content").attributes("data-instant"),
  ).toBeDefined();
  expect(
    wrapper
      .findAll('[data-slot="pine-about-package-row"]')
      .map((row) => row.text()),
  ).toEqual(["typebox1.3.30"]);
  expect(
    wrapper.findAll('[data-slot="pine-about-referenced-row"]'),
  ).toHaveLength(0);

  await search.setValue("sarasa");
  expect(
    wrapper.findAll('[data-slot="pine-about-referenced-row"]'),
  ).toHaveLength(1);
  expect(
    wrapper.findAll('[data-slot="pine-about-license-group"]'),
  ).toHaveLength(0);

  await search.setValue("no such package");
  expect(
    wrapper.find('[data-testid="pine-about-license-empty"]').exists(),
  ).toBe(true);
});

it("links Pine's license to the repository", async () => {
  const wrapper = await mountAbout();

  await wrapper.get('[data-testid="pine-about-pine-license"]').trigger("click");
  expect(window.pine.openExternalUrl).toHaveBeenLastCalledWith(
    `${PINE_REPOSITORY_URL}/blob/main/LICENSE`,
  );
});

it("reports a catalog that fails to load", async () => {
  vi.mocked(loadLicenseCatalog).mockRejectedValue(new Error("chunk"));
  const wrapper = await mountAbout();

  expect(
    wrapper.find('[data-testid="pine-about-licenses-failed"]').exists(),
  ).toBe(true);
});
