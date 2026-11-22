import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import type { Plugin } from "vite";

/**
 * Builds the open-source notice the About page shows: every npm package the
 * desktop app ships (its production dependencies and theirs, resolved the
 * way Node resolves them from each requiring package), plus a short,
 * hand-written list of projects Pine adapted or bundles without depending on
 * them. Nothing here is committed; the catalog is read from `node_modules`
 * each time the renderer is built or served, so it cannot go stale.
 */

export interface ThirdPartyPackage {
  name: string;
  version: string;
  /** SPDX expression from the manifest, or `UNKNOWN`. */
  license: string;
  homepage?: string;
  /** Index into `texts`; `null` when the package ships no license file. */
  text: number | null;
}

export type ReferencedProjectKind =
  "code" | "components" | "font" | "native" | "model";

export interface ReferencedProject {
  name: string;
  url: string;
  license: string;
  kind: ReferencedProjectKind;
  text: number | null;
}

export interface ThirdPartyLicenseCatalog {
  packages: ThirdPartyPackage[];
  referenced: ReferencedProject[];
  /** Distinct license texts; entries point here so repeats are stored once. */
  texts: string[];
}

/** One hand-written entry; its text comes from a file, a package, or inline. */
export interface ReferencedProjectSource {
  name: string;
  url: string;
  license: string;
  kind: ReferencedProjectKind;
  /** Relative to the referenced-projects file. */
  licenseFile?: string;
  /** An installed package whose license file holds the text. */
  licensePackage?: string;
  licenseText?: string;
}

export interface CollectOptions {
  /** The app whose manifest lists what ships, e.g. `apps/desktop`. */
  appDirectory: string;
  /**
   * Packages whose own files ship although the manifest files them under
   * dev: Electron's runtime, CSS compiled into the renderer. Their
   * dependencies are build tooling and are not followed.
   */
  standalonePackages?: readonly string[];
  referencedProjectsFile?: string;
}

interface Manifest {
  name?: string;
  version?: string;
  license?: unknown;
  licenses?: unknown;
  homepage?: unknown;
  repository?: unknown;
  dependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
}

const LICENSE_FILE = /^(licen[cs]e|copying|notice)([.\-_].*)?$/i;

function readManifest(directory: string): Manifest | null {
  try {
    return JSON.parse(
      readFileSync(path.join(directory, "package.json"), "utf8"),
    ) as Manifest;
  } catch {
    return null;
  }
}

/** Node's lookup: `node_modules/<name>` in each ancestor of `from`. */
export function resolvePackageDirectory(
  name: string,
  from: string,
): string | null {
  let directory = from;
  for (;;) {
    const candidate = path.join(directory, "node_modules", name);
    if (existsSync(path.join(candidate, "package.json"))) return candidate;
    const parent = path.dirname(directory);
    if (parent === directory) return null;
    directory = parent;
  }
}

export function normalizeLicense(manifest: Manifest): string {
  const { license, licenses } = manifest;
  if (typeof license === "string" && license.trim()) return license.trim();
  if (license && typeof license === "object" && "type" in license) {
    const type = (license as { type?: unknown }).type;
    if (typeof type === "string" && type.trim()) return type.trim();
  }
  if (Array.isArray(licenses)) {
    const types = licenses
      .map((entry) =>
        typeof entry === "string"
          ? entry
          : (entry as { type?: unknown } | null)?.type,
      )
      .filter((type): type is string => typeof type === "string");
    if (types.length === 1) return types[0];
    if (types.length > 1) return `(${types.join(" OR ")})`;
  }
  return "UNKNOWN";
}

/** A browsable https URL from `homepage` or `repository`, if there is one. */
export function normalizeHomepage(manifest: Manifest): string | undefined {
  if (
    typeof manifest.homepage === "string" &&
    /^https?:\/\//.test(manifest.homepage)
  ) {
    return manifest.homepage;
  }
  const repository = manifest.repository;
  const raw =
    typeof repository === "string"
      ? repository
      : repository && typeof repository === "object"
        ? (repository as { url?: unknown }).url
        : undefined;
  if (typeof raw !== "string" || !raw.trim()) return undefined;
  let url = raw.trim();
  const shorthand = /^(github|gitlab|bitbucket):(.+)$/.exec(url);
  if (shorthand) {
    const host =
      shorthand[1] === "bitbucket" ? "bitbucket.org" : `${shorthand[1]}.com`;
    url = `https://${host}/${shorthand[2]}`;
  } else if (/^[\w.-]+\/[\w.-]+$/.test(url)) {
    url = `https://github.com/${url}`;
  }
  url = url
    .replace(/^git\+/, "")
    .replace(/^git:\/\//, "https://")
    .replace(/^ssh:\/\/git@/, "https://")
    .replace(/^git@([^:]+):/, "https://$1/")
    .replace(/\.git(#.*)?$/, "")
    .replace(/#.*$/, "");
  return /^https?:\/\//.test(url) ? url : undefined;
}

/** The package's license files, LICENSE before NOTICE, joined. */
export function readLicenseText(directory: string): string | null {
  let names: string[];
  try {
    names = readdirSync(directory);
  } catch {
    return null;
  }
  const files = names
    .filter((name) => LICENSE_FILE.test(name))
    .filter((name) => {
      try {
        return statSync(path.join(directory, name)).isFile();
      } catch {
        return false;
      }
    })
    .sort((a, b) => {
      const rank = (name: string) => (/^notice/i.test(name) ? 1 : 0);
      return rank(a) - rank(b) || a.localeCompare(b);
    });
  const parts = files
    .map((name) => readFileSync(path.join(directory, name), "utf8").trim())
    .filter(Boolean);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

class TextTable {
  readonly texts: string[] = [];
  private readonly indexByHash = new Map<string, number>();

  add(text: string | null): number | null {
    if (text === null) return null;
    const normalized = text.replace(/\r\n?/g, "\n");
    const hash = createHash("sha1").update(normalized).digest("hex");
    const known = this.indexByHash.get(hash);
    if (known !== undefined) return known;
    this.texts.push(normalized);
    this.indexByHash.set(hash, this.texts.length - 1);
    return this.texts.length - 1;
  }
}

export function collectThirdPartyLicenses(
  options: CollectOptions,
): ThirdPartyLicenseCatalog {
  const appDirectory = path.resolve(options.appDirectory);
  const appManifest = readManifest(appDirectory);
  if (!appManifest) {
    throw new Error(`Missing package.json in ${appDirectory}`);
  }
  const table = new TextTable();
  const packages = new Map<string, ThirdPartyPackage>();
  const visited = new Set<string>();
  const queue: { name: string; from: string; standalone?: boolean }[] = [];

  const enqueueDependencies = (manifest: Manifest, from: string) => {
    for (const name of [
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.optionalDependencies ?? {}),
    ]) {
      queue.push({ name, from });
    }
  };

  enqueueDependencies(appManifest, appDirectory);
  for (const name of options.standalonePackages ?? []) {
    queue.push({ name, from: appDirectory, standalone: true });
  }

  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) continue;
    const directory = resolvePackageDirectory(next.name, next.from);
    // Optional packages for other platforms are simply not installed.
    if (!directory) continue;
    let real: string;
    try {
      // Workspace packages are symlinked into node_modules.
      real = realpathSync(directory);
    } catch {
      continue;
    }
    if (visited.has(real)) continue;
    visited.add(real);
    const manifest = readManifest(directory);
    if (!manifest) continue;
    if (!next.standalone) enqueueDependencies(manifest, real);
    // Workspace packages are Pine itself; their dependencies still ship.
    if (isWorkspaceDirectory(real)) continue;
    const name = manifest.name ?? next.name;
    const version = manifest.version ?? "0.0.0";
    const key = `${name}@${version}`;
    if (packages.has(key)) continue;
    packages.set(key, {
      name,
      version,
      license: normalizeLicense(manifest),
      homepage: normalizeHomepage(manifest),
      text: table.add(readLicenseText(directory)),
    });
  }

  const referenced = options.referencedProjectsFile
    ? readReferencedProjects(
        options.referencedProjectsFile,
        appDirectory,
        table,
      )
    : [];

  return {
    packages: [...packages.values()].sort(
      (a, b) =>
        a.name.localeCompare(b.name) || a.version.localeCompare(b.version),
    ),
    referenced,
    texts: table.texts,
  };
}

function isWorkspaceDirectory(directory: string): boolean {
  return !directory.split(path.sep).includes("node_modules");
}

function readReferencedProjects(
  file: string,
  appDirectory: string,
  table: TextTable,
): ReferencedProject[] {
  const sources = JSON.parse(
    readFileSync(file, "utf8"),
  ) as ReferencedProjectSource[];
  return sources.map((source) => {
    let text: string | null = source.licenseText ?? null;
    if (source.licenseFile) {
      const licensePath = path.resolve(path.dirname(file), source.licenseFile);
      if (!existsSync(licensePath)) {
        throw new Error(
          `${source.name}: license file ${source.licenseFile} is missing`,
        );
      }
      text = readFileSync(licensePath, "utf8").trim();
    } else if (source.licensePackage) {
      const directory = resolvePackageDirectory(
        source.licensePackage,
        appDirectory,
      );
      text = directory ? readLicenseText(directory) : null;
    }
    return {
      name: source.name,
      url: source.url,
      license: source.license,
      kind: source.kind,
      text: table.add(text),
    };
  });
}

export const THIRD_PARTY_LICENSES_MODULE = "virtual:pine-third-party-licenses";

/**
 * Serves the catalog as a virtual module. The About page imports it
 * dynamically, so the texts form their own chunk and load only when opened.
 */
export function thirdPartyLicensesPlugin(options: CollectOptions): Plugin {
  const resolvedId = `\0${THIRD_PARTY_LICENSES_MODULE}`;
  return {
    name: "pine-third-party-licenses",
    resolveId: (id) => (id === THIRD_PARTY_LICENSES_MODULE ? resolvedId : null),
    load(id) {
      if (id !== resolvedId) return null;
      if (options.referencedProjectsFile) {
        this.addWatchFile(options.referencedProjectsFile);
      }
      const catalog = collectThirdPartyLicenses(options);
      // A JSON string parses faster than the same object as a literal.
      return `export default JSON.parse(${JSON.stringify(JSON.stringify(catalog))});`;
    },
  };
}
