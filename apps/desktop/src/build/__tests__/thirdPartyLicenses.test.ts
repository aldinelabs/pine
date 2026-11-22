import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectThirdPartyLicenses,
  normalizeHomepage,
  normalizeLicense,
  THIRD_PARTY_LICENSES_MODULE,
  thirdPartyLicensesPlugin,
} from "../thirdPartyLicenses";

let root: string;

function writePackage(
  directory: string,
  manifest: Record<string, unknown>,
  files: Record<string, string> = {},
): void {
  mkdirSync(directory, { recursive: true });
  writeFileSync(path.join(directory, "package.json"), JSON.stringify(manifest));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(directory, name), content);
  }
}

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), "pine-licenses-"));
  const modules = path.join(root, "node_modules");
  writePackage(path.join(root, "apps", "app"), {
    name: "app",
    dependencies: { a: "1.0.0", "@pine/local": "workspace:*" },
    optionalDependencies: { "missing-platform-binary": "1.0.0" },
    devDependencies: { "dev-only": "1.0.0" },
  });
  writePackage(
    path.join(modules, "a"),
    {
      name: "a",
      version: "1.0.0",
      license: "MIT",
      repository: "git+https://github.com/example/a.git",
      dependencies: { b: "2.0.0" },
    },
    { LICENSE: "MIT text\r\n" },
  );
  // `a` needs b@2 while the hoisted copy is b@1.
  writePackage(
    path.join(modules, "a", "node_modules", "b"),
    { name: "b", version: "2.0.0", license: { type: "ISC" } },
    { "LICENSE.md": "ISC text", NOTICE: "b notice" },
  );
  writePackage(path.join(modules, "b"), {
    name: "b",
    version: "1.0.0",
    licenses: [{ type: "MIT" }, { type: "Apache-2.0" }],
  });
  writePackage(
    path.join(root, "packages", "local"),
    { name: "@pine/local", dependencies: { c: "1.0.0" } },
    { LICENSE: "Pine's own" },
  );
  mkdirSync(path.join(modules, "@pine"), { recursive: true });
  symlinkSync(
    path.join(root, "packages", "local"),
    path.join(modules, "@pine", "local"),
  );
  writePackage(
    path.join(modules, "c"),
    { name: "c", version: "3.0.0", license: "MIT", homepage: "https://c.dev" },
    { LICENSE: "MIT text" },
  );
  writePackage(
    path.join(modules, "runtime"),
    {
      name: "runtime",
      version: "9.0.0",
      license: "MIT",
      dependencies: { downloader: "1.0.0" },
    },
    { LICENSE: "runtime text" },
  );
  writePackage(path.join(modules, "downloader"), {
    name: "downloader",
    version: "1.0.0",
  });
  writePackage(path.join(modules, "dev-only"), {
    name: "dev-only",
    version: "1.0.0",
  });
});

afterEach(() => {
  rmSync(root, { force: true, recursive: true });
});

describe("collectThirdPartyLicenses", () => {
  it("lists the shipped closure with nested versions and shared texts", () => {
    const catalog = collectThirdPartyLicenses({
      appDirectory: path.join(root, "apps", "app"),
      standalonePackages: ["runtime"],
    });

    expect(
      catalog.packages.map(({ name, version, license }) => [
        name,
        version,
        license,
      ]),
    ).toEqual([
      ["a", "1.0.0", "MIT"],
      ["b", "2.0.0", "ISC"],
      ["c", "3.0.0", "MIT"],
      ["runtime", "9.0.0", "MIT"],
    ]);
    const [a, b, c] = catalog.packages;
    expect(a.homepage).toBe("https://github.com/example/a");
    expect(c.homepage).toBe("https://c.dev");
    // Line endings are normalized, so a's and c's MIT texts are one entry.
    expect(a.text).toBe(c.text);
    expect(catalog.texts[a.text ?? -1]).toBe("MIT text");
    // LICENSE comes before NOTICE.
    expect(catalog.texts[b.text ?? -1]).toBe("ISC text\n\nb notice");
    expect(catalog.texts).toHaveLength(3);
  });

  it("reads hand-written references from files, packages and inline text", () => {
    const listFile = path.join(root, "apps", "app", "referenced.json");
    writeFileSync(path.join(root, "apps", "app", "OFL.txt"), "OFL text\n");
    writeFileSync(
      listFile,
      JSON.stringify([
        {
          name: "Font",
          url: "https://font.example",
          license: "OFL-1.1",
          kind: "font",
          licenseFile: "OFL.txt",
        },
        {
          name: "Components",
          url: "https://components.example",
          license: "MIT",
          kind: "components",
          licensePackage: "c",
        },
        {
          name: "Snippet",
          url: "https://snippet.example",
          license: "MIT",
          kind: "code",
          licenseText: "inline",
        },
      ]),
    );

    const catalog = collectThirdPartyLicenses({
      appDirectory: path.join(root, "apps", "app"),
      referencedProjectsFile: listFile,
    });

    expect(
      catalog.referenced.map(({ name, text }) => [
        name,
        text === null ? null : catalog.texts[text],
      ]),
    ).toEqual([
      ["Font", "OFL text"],
      ["Components", "MIT text"],
      ["Snippet", "inline"],
    ]);
  });

  it("fails the build when a referenced license file is missing", () => {
    const listFile = path.join(root, "apps", "app", "referenced.json");
    writeFileSync(
      listFile,
      JSON.stringify([
        {
          name: "Gone",
          url: "https://gone.example",
          license: "MIT",
          kind: "code",
          licenseFile: "nope.txt",
        },
      ]),
    );

    expect(() =>
      collectThirdPartyLicenses({
        appDirectory: path.join(root, "apps", "app"),
        referencedProjectsFile: listFile,
      }),
    ).toThrow(/nope\.txt/);
  });

  it("serves the catalog as a virtual module", () => {
    const plugin = thirdPartyLicensesPlugin({
      appDirectory: path.join(root, "apps", "app"),
    });
    const resolveId = plugin.resolveId as (id: string) => string | null;
    const load = plugin.load as (this: unknown, id: string) => string | null;
    const id = resolveId(THIRD_PARTY_LICENSES_MODULE);

    expect(id).toBe(`\0${THIRD_PARTY_LICENSES_MODULE}`);
    expect(resolveId("other")).toBeNull();
    const code = load.call({ addWatchFile: () => undefined }, id ?? "");
    expect(code).toMatch(/^export default JSON\.parse\(/);
    expect(code).toContain('\\"name\\":\\"a\\"');
  });
});

describe("normalizeLicense", () => {
  it("reads strings, objects and legacy arrays", () => {
    expect(normalizeLicense({ license: " MIT " })).toBe("MIT");
    expect(normalizeLicense({ license: { type: "ISC" } })).toBe("ISC");
    expect(normalizeLicense({ licenses: ["BSD-2-Clause"] })).toBe(
      "BSD-2-Clause",
    );
    expect(normalizeLicense({})).toBe("UNKNOWN");
  });
});

describe("normalizeHomepage", () => {
  it.each([
    ["github:owner/repo", "https://github.com/owner/repo"],
    ["owner/repo", "https://github.com/owner/repo"],
    ["git://github.com/owner/repo.git", "https://github.com/owner/repo"],
    ["git@github.com:owner/repo.git", "https://github.com/owner/repo"],
    [
      "git+ssh://git@github.com/owner/repo.git",
      "https://github.com/owner/repo",
    ],
    ["file:../local", undefined],
  ])("turns %s into %s", (repository, expected) => {
    expect(normalizeHomepage({ repository })).toBe(expected);
  });

  it("prefers an http homepage and accepts repository objects", () => {
    expect(
      normalizeHomepage({
        homepage: "https://home.example",
        repository: "owner/repo",
      }),
    ).toBe("https://home.example");
    expect(
      normalizeHomepage({
        repository: { url: "https://gitlab.com/owner/repo.git" },
      }),
    ).toBe("https://gitlab.com/owner/repo");
  });
});
