import { expect, it } from "vitest";
import type { ThirdPartyPackage } from "@/build/thirdPartyLicenses";
import {
  filterReferencedProjects,
  groupPackagesByLicense,
  packageUrl,
} from "../licenseCatalog";

const pkg = (name: string, license: string): ThirdPartyPackage => ({
  name,
  version: "1.0.0",
  license,
  text: null,
});

const packages = [
  pkg("a", "ISC"),
  pkg("b", "MIT"),
  pkg("c", "Apache-2.0"),
  pkg("d", "MIT"),
  pkg("e", "BSD-3-Clause"),
];

it("orders groups by size, then by license name", () => {
  expect(
    groupPackagesByLicense(packages).map(({ license, packages: members }) => [
      license,
      members.map(({ name }) => name),
    ]),
  ).toEqual([
    ["MIT", ["b", "d"]],
    ["Apache-2.0", ["c"]],
    ["BSD-3-Clause", ["e"]],
    ["ISC", ["a"]],
  ]);
});

it("matches names and licenses case-insensitively", () => {
  expect(groupPackagesByLicense(packages, "  mit ")).toHaveLength(1);
  expect(
    groupPackagesByLicense(packages, "BSD").map(({ license }) => license),
  ).toEqual(["BSD-3-Clause"]);
});

it("filters referenced projects the same way", () => {
  const projects = [
    {
      name: "Sarasa Gothic",
      url: "https://example.com",
      license: "OFL-1.1",
      kind: "font" as const,
      text: null,
    },
  ];
  expect(filterReferencedProjects(projects, "ofl")).toHaveLength(1);
  expect(filterReferencedProjects(projects, "vue")).toHaveLength(0);
  expect(filterReferencedProjects(projects)).toHaveLength(1);
});

it("opens a package at its homepage, else on npm", () => {
  expect(
    packageUrl({ ...pkg("zod", "MIT"), homepage: "https://zod.dev" }),
  ).toBe("https://zod.dev");
  expect(packageUrl(pkg("@vue/shared", "MIT"))).toBe(
    "https://www.npmjs.com/package/%40vue/shared",
  );
});
