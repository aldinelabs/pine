import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  extractChangelogSection,
  isReleaseVersion,
} from "../src/release/changelog.ts";

const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
  encoding: "utf8",
}).trim();
const packageJson = JSON.parse(
  readFileSync(join(repositoryRoot, "apps/desktop/package.json"), "utf8"),
);
const version = packageJson.version;

if (typeof version !== "string" || !isReleaseVersion(version)) {
  throw new Error(
    `apps/desktop/package.json version must be valid SemVer, received ${String(version)}`,
  );
}

const releasesPath = process.env.RELEASES_FILE;
if (!releasesPath) throw new Error("RELEASES_FILE is required");
const releasePages = JSON.parse(readFileSync(releasesPath, "utf8"));
const releases = (Array.isArray(releasePages) ? releasePages : [])
  .flat()
  .filter((release) => !release.draft);
const normalizedVersion = (tag) => tag.replace(/^v/, "");
const duplicate = releases.find(
  (release) => normalizedVersion(release.tag_name) === version,
);
if (duplicate) {
  throw new Error(
    `Version ${version} was already used by release ${duplicate.tag_name}`,
  );
}
const collidingTags = execFileSync(
  "git",
  ["tag", "--list", version, `v${version}`],
  { encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);
if (collidingTags.length > 0) {
  throw new Error(
    `Version ${version} already has a Git tag: ${collidingTags.join(", ")}`,
  );
}

const previousTag = releases[0]?.tag_name ?? "";
const changelogPath = join(repositoryRoot, "CHANGELOG.md");
const changelog = readFileSync(changelogPath, "utf8");
const section = extractChangelogSection(changelog, version);

if (previousTag) {
  try {
    const previousChangelog = execFileSync(
      "git",
      ["show", `${previousTag}:CHANGELOG.md`],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    try {
      extractChangelogSection(previousChangelog, version);
      throw new Error(
        `CHANGELOG.md section ${version} already existed at ${previousTag}`,
      );
    } catch (error) {
      if (!String(error).includes("has no release section")) throw error;
    }
  } catch (error) {
    if (String(error).includes(`already existed at ${previousTag}`))
      throw error;
  }
}

const sourceCommit = (process.env.SOURCE_COMMIT ?? "").trim();
if (sourceCommit && !/^[0-9a-fA-F]{7,40}$/.test(sourceCommit)) {
  throw new Error(
    `source_commit must be a 7-40 character commit hash, received ${sourceCommit}`,
  );
}
let sha;
try {
  sha = execFileSync(
    "git",
    [
      "rev-parse",
      "--verify",
      "--end-of-options",
      `${sourceCommit || "HEAD"}^{commit}`,
    ],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  ).trim();
} catch {
  throw new Error(
    `source_commit ${sourceCommit} does not resolve to a unique commit`,
  );
}
if (sourceCommit) {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", sha, "HEAD"], {
      stdio: "ignore",
    });
  } catch {
    throw new Error(
      `source_commit ${sha} is not part of the selected branch history`,
    );
  }
}
const shortSha = sha.slice(0, 7);
const tag = `v${version}`;
const repository = process.env.GITHUB_REPOSITORY ?? "";
const compareUrl = previousTag
  ? `https://github.com/${repository}/compare/${encodeURIComponent(previousTag)}...${encodeURIComponent(tag)}`
  : "";
const notes = [
  section.body,
  "",
  "---",
  "",
  `External version: \`${version}\``,
  `Internal build: \`${shortSha}\``,
  `Source commit: \`${sha}\``,
  compareUrl ? `Changes since ${previousTag}: ${compareUrl}` : "",
]
  .filter(Boolean)
  .join("\n");

const config = JSON.parse(
  readFileSync(join(repositoryRoot, ".pine/release.json"), "utf8"),
);
const r2 = config.r2 ?? {};
const r2Enabled = r2.enabled === true;
const accountId = r2.accountId ?? "";
const bucket = r2.bucket ?? "";
let prefix = r2.prefix ?? "";
let publicBaseUrl = r2.publicBaseUrl ?? "";

if (r2Enabled) {
  if (!/^[a-f0-9]{32}$/.test(accountId)) {
    throw new Error(
      "r2.accountId must be a 32-character Cloudflare account ID",
    );
  }
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error("r2.bucket is not a valid R2 bucket name");
  }
  if (
    typeof prefix !== "string" ||
    prefix.startsWith("/") ||
    prefix.includes("..")
  ) {
    throw new Error(
      "r2.prefix must be a relative object-key prefix without '..'",
    );
  }
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  try {
    const publicUrl = new URL(publicBaseUrl);
    if (
      publicUrl.protocol !== "https:" ||
      publicUrl.pathname !== "/" ||
      publicUrl.search ||
      publicUrl.hash
    )
      throw new Error();
    publicBaseUrl = publicUrl.href.replace(/\/$/, "");
  } catch {
    throw new Error(
      "r2.publicBaseUrl must be an HTTPS R2 custom domain origin without a path",
    );
  }
}

const runnerTemp = process.env.RUNNER_TEMP ?? join(repositoryRoot, ".tmp");
const notesFile = join(runnerTemp, "release-notes.md");
const changelogFile = join(runnerTemp, "release-changelog.md");
writeFileSync(notesFile, `${notes}\n`);
writeFileSync(changelogFile, `${section.body}\n`);

const outputPath = process.env.GITHUB_OUTPUT;
if (!outputPath) throw new Error("GITHUB_OUTPUT is required");
const outputs = {
  version,
  tag,
  short_sha: shortSha,
  source_sha: sha,
  notes_file: notesFile,
  changelog_file: changelogFile,
  r2_enabled: String(r2Enabled),
  r2_account_id: accountId,
  r2_bucket: bucket,
  r2_prefix: prefix,
  r2_public_base_url: publicBaseUrl,
};
appendFileSync(
  outputPath,
  `${Object.entries(outputs)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n")}\n`,
);

console.log(
  `release ${tag}: ${shortSha}, previous release ${previousTag || "none"}, R2 ${r2Enabled ? "enabled" : "disabled"}`,
);
