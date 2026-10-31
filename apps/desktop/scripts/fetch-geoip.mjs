// Fetches DB-IP's free city database (CC BY 4.0) into resources/geoip, where
// packaging bundles it. A new database appears each month; a copy younger
// than that is kept. Pass --optional to warn instead of failing, as a
// development start does.
import { createReadStream, existsSync, mkdirSync, statSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createGunzip } from "node:zlib";

const output = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../resources/geoip/dbip-city-lite.mmdb.gz",
);
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** Every MMDB file carries this marker before its metadata. */
const METADATA_MARKER = Buffer.from("\xab\xcd\xefMaxMind.com", "binary");

function yearMonth(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

/** Decompresses the file and checks it ends like an MMDB database. */
async function isDatabase(file) {
  let tail = Buffer.alloc(0);
  for await (const chunk of createReadStream(file).pipe(createGunzip())) {
    tail = Buffer.concat([tail, chunk]).subarray(-128 * 1024);
  }
  return tail.includes(METADATA_MARKER);
}

async function fetchDatabase() {
  const now = new Date();
  const previous = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1),
  );
  const partial = `${output}.partial`;
  let lastError;
  for (const month of [yearMonth(now), yearMonth(previous)]) {
    const url = `https://download.db-ip.com/free/dbip-city-lite-${month}.mmdb.gz`;
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
      await writeFile(partial, Buffer.from(await response.arrayBuffer()));
      if (!(await isDatabase(partial)))
        throw new Error(`${url} is not an MMDB database`);
      await rename(partial, output);
      console.log(`[geoip] fetched ${path.basename(url)}`);
      return;
    } catch (error) {
      lastError = error;
      await rm(partial, { force: true });
    }
  }
  throw lastError;
}

if (existsSync(output) && Date.now() - statSync(output).mtimeMs < MAX_AGE_MS) {
  process.exit(0);
}
mkdirSync(path.dirname(output), { recursive: true });
try {
  await fetchDatabase();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  // An older database still works; only a missing one is a failed build.
  if (existsSync(output))
    console.warn(`[geoip] keeping the existing database: ${message}`);
  else if (process.argv.includes("--optional"))
    console.warn(`[geoip] approximate location stays unavailable: ${message}`);
  else throw error;
}
