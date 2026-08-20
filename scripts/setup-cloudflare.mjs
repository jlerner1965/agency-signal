#!/usr/bin/env node
// One command from a logged-in Cloudflare account to a running site.
//
//   npx wrangler login        (once, opens a browser — this script cannot do it)
//   npm run setup:cloudflare
//
// Everything between those two is here: find or create the database, build,
// apply migrations, generate a login if there isn't one, deploy, and upload the
// secrets with the deploy rather than prompting once per secret.
//
// Safe to re-run. The database is reused rather than recreated, migrations are
// tracked by tag, and an existing login in .dev.vars is kept — re-running does
// not silently rotate the password and sign you out.
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const wrangler = resolve(root, "node_modules/wrangler/bin/wrangler.js");
// Same override the credentials script honours; child processes inherit it.
const devVars = process.env.AGENCYSIGNAL_DEV_VARS || resolve(root, ".dev.vars");

const argv = process.argv.slice(2);
const flags = new Set(argv.filter((value) => value.startsWith("--")));
const flagValue = (name) =>
  (argv.find((value) => value.startsWith(`--${name}=`)) ?? "").split("=").slice(1).join("=");

const workerName = flagValue("name") || process.env.CLOUDFLARE_WORKER_NAME || "agency-signal";
const bucket = flagValue("r2") || process.env.CLOUDFLARE_R2_BUCKET || "";

async function wrangle(args) {
  const { stdout: out } = await run(process.execPath, [wrangler, ...args], {
    cwd: root,
    maxBuffer: 32 * 1024 * 1024,
  });
  return out;
}

// `wrangler whoami` exits 0 whether or not you are logged in, and reports the
// verdict in its output, so status alone cannot be trusted. This returns
// everything both streams said regardless of how the process exited.
async function wrangleOutput(args) {
  try {
    return await wrangle(args);
  } catch (error) {
    return `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;
  }
}

const NOT_AUTHENTICATED = /not authenticated|CLOUDFLARE_API_TOKEN|not logged in|Authentication error/i;

// Wrangler prints banners and update notices around its JSON payload, and those
// banners contain brackets of their own — "[WARNING]" being the common one. So
// try each candidate start rather than trusting the first bracket in the stream.
function parseJson(output) {
  for (let index = 0; index < output.length; index += 1) {
    if (output[index] !== "{" && output[index] !== "[") continue;
    try {
      return JSON.parse(output.slice(index));
    } catch {
      // Not the payload's opening bracket. Keep looking.
    }
  }
  throw new Error("no JSON in wrangler output");
}

// Named rather than inlined, so adding a step cannot leave the counter reading
// "[7/6]" the way a literal total does.
const TOTAL_STEPS = 7;

function step(number, text) {
  console.log(`\n[${number}/${TOTAL_STEPS}] ${text}`);
}

// ---------------------------------------------------------------- 1. account

step(1, "Checking your Cloudflare login");
const who = await wrangleOutput(["whoami"]);
if (NOT_AUTHENTICATED.test(who)) {
  console.error(
    "\nNot logged in to Cloudflare. Run this first, then re-run this command:\n\n" +
    "  npx wrangler login\n\n" +
    "It opens a browser once. The default scopes are the ones needed here.",
  );
  process.exit(77);
}
const account = (who.match(/[\w.+-]+@[\w.-]+\.\w+/) ?? [])[0] ?? "";
console.log(`      signed in${account ? ` as ${account}` : ""}`);

// --------------------------------------------------------------- 2. database

step(2, `Finding or creating the D1 database "${workerName}"`);
let databaseId = "";
try {
  databaseId = parseJson(await wrangle(["d1", "info", workerName, "--json"])).uuid ?? "";
  console.log("      reusing the existing database");
} catch {
  try {
    await wrangle(["d1", "create", workerName]);
    databaseId = parseJson(await wrangle(["d1", "info", workerName, "--json"])).uuid ?? "";
    console.log("      created it");
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}${error.message ?? ""}`;
    console.error(`\nCould not create the database "${workerName}".\n`);
    console.error(output.trim());
    process.exit(70);
  }
}
if (!databaseId) {
  console.error("Could not determine the database id. Run `npx wrangler d1 list` and check the account.");
  process.exit(70);
}
console.log(`      id ${databaseId}`);
process.env.CLOUDFLARE_D1_DATABASE_ID = databaseId;
process.env.CLOUDFLARE_D1_DATABASE_NAME = workerName;
process.env.CLOUDFLARE_WORKER_NAME = workerName;
if (bucket) process.env.CLOUDFLARE_R2_BUCKET = bucket;

// ------------------------------------------------------------------ 3. build

step(3, "Building");
if (flags.has("--skip-build")) {
  console.log("      --skip-build: reusing the existing dist/");
} else {
  await run("bash", [resolve(root, "scripts/build-verified.sh")], { cwd: root, maxBuffer: 64 * 1024 * 1024 });
  console.log("      built and validated");
}

// ------------------------------------------------------------- 4. migrations

step(4, "Applying migrations to the deployed database");
const migrate = await run(process.execPath, [resolve(root, "scripts/db-migrate.mjs"), "--remote"], {
  cwd: root,
  env: process.env,
  maxBuffer: 32 * 1024 * 1024,
});
process.stdout.write(migrate.stdout.replace(/^/gm, "      "));

// ------------------------------------------------------------ 5. credentials

step(5, "Preparing the dashboard login");
const REQUIRED = [
  "AGENCYSIGNAL_LOGIN_EMAIL",
  "AGENCYSIGNAL_PASSWORD_SALT",
  "AGENCYSIGNAL_PASSWORD_HASH",
  "AGENCYSIGNAL_SESSION_SECRET",
];
let generatedPassword = "";
const existing = await readFile(devVars, "utf8").catch(() => "");
const complete = REQUIRED.every((key) => new RegExp(`^${key}=.+`, "m").test(existing));

if (complete) {
  const email = (existing.match(/^AGENCYSIGNAL_LOGIN_EMAIL=(.*)$/m) ?? [])[1] ?? "";
  console.log(`      reusing the login already in .dev.vars (${email.trim()})`);
  console.log("      run `npm run auth:credentials` to change it");
} else {
  const words = ["harbor", "lantern", "quartz", "meadow", "cobalt", "thicket", "ember", "sparrow", "granite", "willow", "cinder", "marlin"];
  const { randomInt } = await import("node:crypto");
  const pick = () => words[randomInt(words.length)];
  generatedPassword = [pick(), pick(), pick(), randomInt(1000, 9999)].join("-");

  let email = flagValue("email");
  if (!email && stdin.isTTY) {
    const rl = createInterface({ input: stdin, output: stdout });
    email = (await rl.question("      Login email: ")).trim();
    rl.close();
  }
  if (!email) {
    console.error("\nNo login email. Pass --email=you@example.com and run this again.");
    process.exit(64);
  }

  await run(process.execPath, [resolve(root, "scripts/setup-credentials.mjs"),
    "--email", email, "--password", generatedPassword], { cwd: root });
  console.log("      generated a login and wrote it to .dev.vars");
}

// -------------------------------------------------------------- 6. audit keys

step(6, "Audit API keys");

// These ride along in the same --secrets-file as the login, so the moment to
// ask for them is before the deploy — not in a hint printed after it. Printing
// the hint instead is how a deployed run ends up rate-limited on the unkeyed
// PageSpeed quota and reports a dozen checks as not measured.
const AUDIT_KEYS = [
  { name: "PAGESPEED_API_KEY", flag: "pagespeed-key", ask: "      PageSpeed key (free, no billing; blank to skip): " },
  { name: "GOOGLE_PLACES_API_KEY", flag: "places-key", ask: "      Google Places key (billed per request; blank to skip): " },
];

const afterLogin = await readFile(devVars, "utf8").catch(() => "");
const keyIsSet = (name) => new RegExp(`^${name}=.+`, "m").test(afterLogin);
const supplied = {};
for (const key of AUDIT_KEYS) {
  const provided = flagValue(key.flag).trim();
  if (provided) { supplied[key.flag] = provided; continue; }
  if (keyIsSet(key.name)) { console.log(`      ${key.name} already in .dev.vars`); continue; }
  if (!stdin.isTTY) continue;
  const rl = createInterface({ input: stdin, output: stdout });
  const entered = (await rl.question(key.ask)).trim();
  rl.close();
  if (entered) supplied[key.flag] = entered;
}

if (Object.keys(supplied).length) {
  // Key flags alone, so scripts/setup-credentials.mjs leaves the login be.
  await run(process.execPath, [resolve(root, "scripts/setup-credentials.mjs"),
    ...Object.entries(supplied).flatMap(([flag, value]) => [`--${flag}`, value])], { cwd: root });
  console.log("      written to .dev.vars — they upload with the deploy below");
}

const stillMissing = AUDIT_KEYS.filter((key) => !supplied[key.flag] && !keyIsSet(key.name));
for (const key of stillMissing) console.log(`      ${key.name} not set — the checks it feeds will report as not measured`);

// ----------------------------------------------------------------- 7. deploy

step(7, "Deploying, with the secrets");
const deploy = await run(process.execPath, [resolve(root, "scripts/deploy-cloudflare.mjs"),
  `--secrets-file=${devVars}`], { cwd: root, env: process.env, maxBuffer: 32 * 1024 * 1024 })
  .catch((error) => {
    process.stdout.write(`${error.stdout ?? ""}${error.stderr ?? ""}`);
    process.exit(error.code ?? 1);
  });
process.stdout.write(deploy.stdout);

const url = (deploy.stdout.match(/https:\/\/[\w.-]*workers\.dev\S*/) ?? [])[0] ?? "";

console.log("\n──────────────────────────────────────────────");
console.log("Done.");
if (url) console.log(`\n  ${url}`);
if (generatedPassword) {
  console.log(`\n  Password: ${generatedPassword}`);
  console.log("  Shown once. It is not stored anywhere — only its hash is.");
}
if (stillMissing.length) {
  console.log("\nThe audit keys still missing, whenever you have them:");
  for (const key of stillMissing) console.log(`  npx wrangler secret put ${key.name} --name ${workerName}`);
} else {
  console.log("\nBoth audit keys were uploaded with the deploy.");
}
