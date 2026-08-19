#!/usr/bin/env node
// Deploys the built artifact to a Cloudflare account you own, as an alternative
// to the Sites runtime described in .openai/hosting.json.
//
// The build already emits a deployable Wrangler config at
// dist/server/wrangler.json, but it carries the local development bindings: a
// placeholder D1 id and a bucket that only exists in Miniflare. This patches
// those to the real ones and deploys, rather than keeping a second hand-written
// config that could drift from what the build actually produces.
//
// Run this directly, not through scripts/sites-env.sh. That helper redirects
// XDG_CONFIG_HOME into .sites-runtime, and Wrangler keeps its OAuth token under
// that directory — so a normal `wrangler login` would be invisible here and
// every deploy would report you as unauthenticated.
//
//   CLOUDFLARE_D1_DATABASE_ID    required. `npx wrangler d1 create <name>` prints it.
//   CLOUDFLARE_D1_DATABASE_NAME  optional, defaults to the Worker name.
//   CLOUDFLARE_WORKER_NAME       optional, defaults to agency-signal.
//   CLOUDFLARE_R2_BUCKET         optional. R2 is only used to store audit
//                                screenshots, and every call site in
//                                lib/audit-screenshots.ts is guarded, so a
//                                deploy without it works and simply stores none.
import { execFile } from "node:child_process";
import { access, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const generated = resolve(root, "dist/server/wrangler.json");
const patched = resolve(root, "dist/server/wrangler.deploy.json");

const flags = new Set(process.argv.slice(2).filter((value) => value.startsWith("--")));
const dryRun = flags.has("--dry-run");

const databaseId = (process.env.CLOUDFLARE_D1_DATABASE_ID ?? "").trim();
const workerName = (process.env.CLOUDFLARE_WORKER_NAME ?? "agency-signal").trim();
const databaseName = (process.env.CLOUDFLARE_D1_DATABASE_NAME ?? workerName).trim();
const bucket = (process.env.CLOUDFLARE_R2_BUCKET ?? "").trim();

if (!databaseId) {
  console.error(
    "CLOUDFLARE_D1_DATABASE_ID is not set.\n" +
    "Create the database first:  npx wrangler d1 create agency-signal\n" +
    "then export the id it prints. Deploying without it would ship a Worker\n" +
    "bound to a database that does not exist, and every page would 500.",
  );
  process.exit(78);
}

try {
  await access(generated);
} catch {
  console.error("dist/server/wrangler.json is missing. Run `npm run build` first.");
  process.exit(66);
}

const config = JSON.parse(await readFile(generated, "utf8"));

config.name = workerName;
config.topLevelName = workerName;
config.d1_databases = [{ binding: "DB", database_name: databaseName, database_id: databaseId }];

// worker/index.ts reads env.ASSETS for the image optimization route. The build
// emits the directory but no binding name, so name it here.
if (config.assets) config.assets.binding = "ASSETS";

// R2 is optional. Ship no binding at all rather than one naming a bucket that
// exists only in Miniflare, which would fail the upload.
config.r2_buckets = bucket ? [{ binding: "BUCKET", bucket_name: bucket }] : [];

await writeFile(patched, `${JSON.stringify(config, null, 2)}\n`);

console.log(`Worker:   ${workerName}`);
console.log(`D1:       ${databaseName} (${databaseId.slice(0, 8)}…)`);
console.log(`R2:       ${bucket || "not configured — audit screenshots will not be stored"}`);
console.log(`Config:   ${patched}`);

if (dryRun) {
  console.log("\n--dry-run: config written, nothing deployed.");
  process.exit(0);
}

console.log("\nDeploying…\n");
try {
  const { stdout, stderr } = await run(
    process.execPath,
    [resolve(root, "node_modules/wrangler/bin/wrangler.js"), "deploy", "--config", patched],
    { cwd: root, maxBuffer: 32 * 1024 * 1024 },
  );
  process.stdout.write(stdout);
  if (stderr) process.stderr.write(stderr);
} catch (error) {
  const output = `${error.stdout ?? ""}${error.stderr ?? ""}`;
  process.stdout.write(output);
  // Wrangler's own wording for this is easy to misread as a broken deploy.
  if (/not authenticated|not logged in|Authentication error/i.test(output)) {
    console.error(
      "\nWrangler is not authenticated. Run `npx wrangler login` in this same\n" +
      "directory and shell, then run `npm run deploy` again.",
    );
  }
  process.exit(error.code ?? 1);
}
