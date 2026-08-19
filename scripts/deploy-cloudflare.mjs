#!/usr/bin/env node
// Deploys AgencySignal to Cloudflare Workers. Safe to re-run: it creates what
// is missing, reuses what exists, and re-pushes secrets so a rotated password
// takes effect.
//
//   npm run deploy
//
// Deliberately not routed through scripts/sites-env.sh. That wrapper points
// HOME at a project-local sandbox, which would hide the `wrangler login`
// credentials stored under the real HOME.
import { execFile, spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

const execFileAsync = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
const cloudflarePath = resolve(root, ".cloudflare.json");
const generatedConfig = resolve(root, "dist/server/wrangler.json");

// The name is a DNS label in the workers.dev hostname, so it has to be one.
const WORKER_NAME = process.env.AGENCYSIGNAL_WORKER_NAME || "agency-signal";
const D1_NAME = process.env.AGENCYSIGNAL_D1_NAME || "agency-signal";

// Pushed from .dev.vars so the deployed Worker has the same login and keys as
// local development. The first four are required; the rest degrade gracefully.
const REQUIRED_SECRETS = [
  "AGENCYSIGNAL_LOGIN_EMAIL",
  "AGENCYSIGNAL_PASSWORD_SALT",
  "AGENCYSIGNAL_PASSWORD_HASH",
  "AGENCYSIGNAL_SESSION_SECRET",
];
const OPTIONAL_SECRETS = [
  "AGENCYSIGNAL_OWNER_NAME",
  "PAGESPEED_API_KEY",
  "GOOGLE_PLACES_API_KEY",
  "OPENAI_API_KEY",
  "OPENAI_MODEL",
];

function step(message) {
  console.log(`\n→ ${message}`);
}

function fail(message, code = 1) {
  console.error(`\n${message}`);
  process.exit(code);
}

async function wr(args, { capture = true } = {}) {
  if (capture) {
    const { stdout } = await execFileAsync(process.execPath, [wrangler, ...args], {
      cwd: root, maxBuffer: 32 * 1024 * 1024,
    });
    return stdout;
  }
  // Deploy streams progress worth watching, and prompts we must not swallow.
  return new Promise((done, reject) => {
    const child = spawn(process.execPath, [wrangler, ...args], { cwd: root, stdio: "inherit" });
    child.on("close", (status) => (status === 0 ? done("") : reject(new Error(`wrangler ${args[0]} exited ${status}`))));
  });
}

/** Wrangler prints banners before JSON, so parse from the first bracket. */
function jsonFrom(stdout, open = "[") {
  const start = stdout.indexOf(open);
  if (start === -1) return null;
  try { return JSON.parse(stdout.slice(start)); } catch { return null; }
}

async function readDevVars() {
  let text;
  try {
    text = await readFile(resolve(root, ".dev.vars"), "utf8");
  } catch {
    fail(
      "No .dev.vars found, so there is no login to deploy with.\n" +
      "Run `npm run setup` first — it generates the four sign-in values and\n" +
      "prompts for the API keys. This script pushes them to Cloudflare.",
      78,
    );
  }
  const values = {};
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) values[match[1]] = match[2];
  }
  return values;
}

// 1. Authentication ---------------------------------------------------------
step("Checking your Cloudflare login");
const NOT_SIGNED_IN =
  "Not signed in to Cloudflare. Run this first, which opens a browser:\n\n" +
  "  npx wrangler login\n\n" +
  "Then run `npm run deploy` again.";
{
  let who = "";
  try {
    who = await wr(["whoami"]);
  } catch {
    fail(NOT_SIGNED_IN, 77);
  }
  // `wrangler whoami` exits 0 whether or not you are authenticated, so the
  // exit status alone would wave a logged-out user through to a confusing
  // failure several steps later. Read what it actually said.
  if (/not authenticated/i.test(who)) fail(NOT_SIGNED_IN, 77);
  const email = who.match(/[\w.+-]+@[\w.-]+\.\w+/)?.[0];
  console.log(`  Signed in${email ? ` as ${email}` : ""}.`);
}

const vars = await readDevVars();
const missing = REQUIRED_SECRETS.filter((key) => !vars[key]);
if (missing.length) {
  fail(`.dev.vars is missing ${missing.join(", ")}. Run \`npm run auth:credentials\` to regenerate them.`, 78);
}

// 2. The database -----------------------------------------------------------
step(`Looking for a D1 database named "${D1_NAME}"`);
let databaseId = "";
const listed = jsonFrom(await wr(["d1", "list", "--json"])) ?? [];
const existing = listed.find((database) => database.name === D1_NAME);

if (existing) {
  databaseId = existing.uuid ?? existing.database_id ?? "";
  console.log(`  Found it (${databaseId}). Reusing it.`);
} else {
  console.log("  Not found. Creating it.");
  await wr(["d1", "create", D1_NAME]);
  // `d1 create` prints the id, but its output shape moves between versions.
  // Listing again is boring and stable.
  const relisted = jsonFrom(await wr(["d1", "list", "--json"])) ?? [];
  databaseId = relisted.find((database) => database.name === D1_NAME)?.uuid ?? "";
  if (!databaseId) fail("Created the database but could not read its id back. Run `npx wrangler d1 list` and check.");
  console.log(`  Created (${databaseId}).`);
}

await writeFile(
  cloudflarePath,
  `${JSON.stringify({ worker_name: WORKER_NAME, d1_database_name: D1_NAME, d1_database_id: databaseId }, null, 2)}\n`,
);
console.log("  Recorded in .cloudflare.json (git-ignored).");

// 3. Secrets ----------------------------------------------------------------
step("Pushing secrets to the Worker");
async function putSecret(key, value) {
  await new Promise((done, reject) => {
    const child = spawn(process.execPath, [wrangler, "secret", "put", key, "--name", WORKER_NAME], {
      cwd: root, stdio: ["pipe", "ignore", "inherit"],
    });
    child.stdin.end(value);
    child.on("close", (status) => (status === 0 ? done() : reject(new Error(`could not set ${key}`))));
  });
  console.log(`  ${key}`);
}

// A Worker must exist before it can hold secrets. On the very first deploy it
// does not yet, so secrets are pushed after the first upload instead.
let workerExists = true;
try {
  await wr(["secret", "list", "--name", WORKER_NAME]);
} catch {
  workerExists = false;
  console.log("  The Worker does not exist yet — secrets go on after the first upload.");
}

async function pushAllSecrets() {
  for (const key of REQUIRED_SECRETS) await putSecret(key, vars[key]);
  for (const key of OPTIONAL_SECRETS) {
    if (vars[key]) await putSecret(key, vars[key]);
  }
  const skipped = OPTIONAL_SECRETS.filter((key) => !vars[key]);
  if (skipped.length) console.log(`  Not set (the app degrades rather than fails): ${skipped.join(", ")}`);
}

if (workerExists) await pushAllSecrets();

// 4. Build ------------------------------------------------------------------
step("Building");
await new Promise((done, reject) => {
  const child = spawn("npm", ["run", "build"], { cwd: root, stdio: "inherit" });
  child.on("close", (status) => (status === 0 ? done() : reject(new Error(`build exited ${status}`))));
});

// 5. Point the built config at the real resources ----------------------------
step("Pointing the build at your database");
const config = JSON.parse(await readFile(generatedConfig, "utf8"));
config.name = WORKER_NAME;
config.d1_databases = [{ binding: "DB", database_name: D1_NAME, database_id: databaseId }];
// R2 only backs the legacy competitor screenshots, and every entry point in
// lib/audit-screenshots.ts returns empty when no bucket is bound. Shipping the
// placeholder bucket would fail the upload for a feature nothing reaches.
delete config.r2_buckets;
// worker/index.ts declares env.ASSETS and uses it on /_vinext/image. Without a
// name the static-asset binding is not injected, so that route would throw.
if (config.assets) config.assets.binding = "ASSETS";
await writeFile(generatedConfig, `${JSON.stringify(config, null, 2)}\n`);
console.log(`  ${D1_NAME} (${databaseId})`);

// 6. Schema -----------------------------------------------------------------
step("Applying migrations to the deployed database");
await new Promise((done, reject) => {
  const child = spawn(process.execPath, [resolve(root, "scripts/db-migrate.mjs"), "--remote"], {
    cwd: root, stdio: "inherit",
  });
  child.on("close", (status) => (status === 0 ? done() : reject(new Error(`migrations exited ${status}`))));
});

// 7. Deploy -----------------------------------------------------------------
step("Uploading");
await wr(["deploy", "-c", generatedConfig], { capture: false });

if (!workerExists) {
  step("Pushing secrets now that the Worker exists");
  await pushAllSecrets();
  step("Re-uploading so the Worker starts with its secrets");
  await wr(["deploy", "-c", generatedConfig], { capture: false });
}

console.log(
  `\nDeployed. Your app is at https://${WORKER_NAME}.<your-subdomain>.workers.dev — the exact\n` +
  "URL is printed above. Open it, sign in with the email and password from\n" +
  "`npm run setup`, and the report and proposal links you send prospects will\n" +
  "work from that address.\n\n" +
  "Re-run `npm run deploy` any time to ship changes.",
);
