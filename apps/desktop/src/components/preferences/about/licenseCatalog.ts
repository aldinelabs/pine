import type {
  ReferencedProject,
  ThirdPartyLicenseCatalog,
  ThirdPartyPackage,
} from "@/build/thirdPartyLicenses";

export type { ReferencedProject, ThirdPartyLicenseCatalog, ThirdPartyPackage };

export interface LicenseGroup {
  license: string;
  packages: ThirdPartyPackage[];
}

/** The catalog is built from node_modules and arrives as its own chunk. */
export async function loadLicenseCatalog(): Promise<ThirdPartyLicenseCatalog> {
  return (await import("virtual:pine-third-party-licenses")).default;
}

function matches(query: string, ...fields: string[]): boolean {
  return fields.some((field) => field.toLowerCase().includes(query));
}

export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/** Packages grouped by license, the most common license first. */
export function groupPackagesByLicense(
  packages: readonly ThirdPartyPackage[],
  query = "",
): LicenseGroup[] {
  const needle = normalizeQuery(query);
  const groups = new Map<string, ThirdPartyPackage[]>();
  for (const entry of packages) {
    if (needle && !matches(needle, entry.name, entry.license)) continue;
    const group = groups.get(entry.license);
    if (group) group.push(entry);
    else groups.set(entry.license, [entry]);
  }
  return [...groups]
    .map(([license, members]) => ({ license, packages: members }))
    .sort(
      (a, b) =>
        b.packages.length - a.packages.length ||
        a.license.localeCompare(b.license),
    );
}

export function filterReferencedProjects(
  projects: readonly ReferencedProject[],
  query = "",
): ReferencedProject[] {
  const needle = normalizeQuery(query);
  if (!needle) return [...projects];
  return projects.filter((project) =>
    matches(needle, project.name, project.license),
  );
}
