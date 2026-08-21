#!/usr/bin/env node
// Generates the four dashboard authentication values the app requires and
// writes them to .dev.vars so `npm run dev` has a working login. The same
// values are printed for the hosted runtime, which needs them as secrets.
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { promptSecret } from "../lib/secret-prompt.js";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";

const PBKDF2_ITERATIONS = 100_000;
// Overridable so the test suite can exercise the merge without writing over a
// developer's real .dev.vars. Nothing in normal use sets it.
const DEV_VARS = process.env.AGENCYSIGNAL_DEV_VARS || resolve(import.meta.dirname, "..", ".dev.vars");
const SECRET_KEYS = [
  "AGENCYSIGNAL_LOGIN_EMAIL",
  "AGENCYSIGNAL_PASSWORD_SALT",
  "AGENCYSIGNAL_PASSWORD_HASH",
  "AGENCYSIGNAL_SESSION_SECRET",
];
// Not a secret, but it belongs beside the login it names.
const KEYS = [...SECRET_KEYS, "AGENCYSIGNAL_OWNER_NAME", "PAGESPEED_API_KEY", "GOOGLE_PLACES_API_KEY"];

function base64Url(bytes) {
  return Buffer.from(bytes).toString("base64").replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

// Mirrors app/dashboard-auth.ts exactly. If the verifier changes, change both.
async function derivePasswordHash(password, salt) {
  const material = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITERATIONS },
    material,
    256,
  );
  return base64Url(new Uint8Array(derived));
}

function readFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const match = argv[index].match(/^--([a-z-]+)(?:=(.*))?$/);
    if (!match) continue;
    if (match[2] !== undefined) {
      flags[match[1]] = match[2];
      continue;
    }
    // A following token is this flag's value only when it is not itself a flag,
    // so boolean flags like --print-only do not swallow the next option.
    const next = argv[index + 1];
    flags[match[1]] = next !== undefined && !next.startsWith("--") ? argv[++index] : "";
  }
  return flags;
}

async function prompt(question, { silent = false } = {}) {
  if (!stdin.isTTY) {
    console.error("No terminal is attached. Pass --email and --password instead.");
    process.exit(64);
  }
  if (silent) return promptSecret(question);
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

// Preserves every line this run is not writing, so adding one key never
// discards another. Rewriting only the keys actually supplied is the whole
// point: filtering on the full managed list dropped a key that was already set
// but not passed again, which is a silent way to lose an API key.
async function mergeDevVars(values) {
  let existing = "";
  try {
    existing = await readFile(DEV_VARS, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const writing = KEYS.filter((key) => values[key]);
  const kept = existing
    .split("\n")
    .filter((line) => line.trim() && !writing.some((key) => line.startsWith(`${key}=`)));
  const written = writing.map((key) => `${key}=${values[key]}`);
  await writeFile(DEV_VARS, `${[...kept, ...written].join("\n")}\n`, { mode: 0o600 });
}

const flags = readFlags(process.argv.slice(2));

const API_KEY_FLAGS = { "pagespeed-key": "PAGESPEED_API_KEY", "places-key": "GOOGLE_PLACES_API_KEY" };
const currentVars = await readFile(DEV_VARS, "utf8").catch(() => "");
const isSet = (key) => new RegExp(`^${key}=.+`, "m").test(currentVars);

// Adding an API key is not a request to rotate the sign-in. Doing both would
// regenerate the session secret and sign every existing session out, which is
// not what `--pagespeed-key KEY` looks like it does — and it is the command the
// README gives for adding a key later.
const keysOnly = Object.keys(API_KEY_FLAGS).some((flag) => (flags[flag] ?? "").trim())
  && flags.email === undefined
  && flags.password === undefined;

if (keysOnly && SECRET_KEYS.every(isSet)) {
  const added = {};
  for (const [flag, name] of Object.entries(API_KEY_FLAGS)) {
    const provided = (flags[flag] ?? "").trim();
    if (provided) added[name] = provided;
  }
  if (flags["print-only"] === undefined) await mergeDevVars(added);
  console.log(`Added ${Object.keys(added).join(", ")} to ${DEV_VARS}. The existing login is unchanged.`);
  console.log("\nSet the same names in the hosted runtime:\n");
  for (const name of Object.keys(added)) console.log(`  npx wrangler secret put ${name} --name agency-signal`);
  process.exit(0);
}

const email = (flags.email ?? (await prompt("Login email: "))).trim().toLowerCase();
const password = flags.password ?? (await prompt("Password (min 12 characters): ", { silent: true }));

if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error("A valid login email address is required.");
  process.exit(64);
}
if (password.length < 12) {
  console.error("Choose a password of at least 12 characters.");
  process.exit(64);
}

const salt = crypto.getRandomValues(new Uint8Array(16));
const values = {
  AGENCYSIGNAL_LOGIN_EMAIL: email,
  AGENCYSIGNAL_PASSWORD_SALT: base64Url(salt),
  AGENCYSIGNAL_PASSWORD_HASH: await derivePasswordHash(password, salt),
  AGENCYSIGNAL_SESSION_SECRET: base64Url(crypto.getRandomValues(new Uint8Array(32))),
  AGENCYSIGNAL_OWNER_NAME: (flags.owner ?? "").trim().slice(0, 80),
};

// Both API keys are prompted for rather than left to be discovered later: one
// is free and its absence silently degrades every run, and the other is what
// makes the service-line gap analysis possible at all.
const API_KEYS = [
  {
    name: "PAGESPEED_API_KEY",
    flag: "pagespeed-key",
    prompt: "PageSpeed API key (free, no billing; blank to skip): ",
    warning:
      "\u26a0  PAGESPEED_API_KEY is not set.\n" +
      "   Runs still work, but PageSpeed applies its unkeyed quota and starts returning\n" +
      "   429 in a batch, which leaves prospects unscored for no good reason.\n" +
      "   Free, no billing details: https://developers.google.com/speed/docs/insights/v5/get-started",
  },
  {
    name: "GOOGLE_PLACES_API_KEY",
    flag: "places-key",
    prompt: "Google Places API key (billed per request; blank to skip): ",
    warning:
      "\u26a0  GOOGLE_PLACES_API_KEY is not set.\n" +
      "   Without it the Google presence module cannot read a profile, so the\n" +
      "   service-line gap table \u2014 the point of the tool \u2014 stays empty.\n" +
      "   Enable Places API (New): https://console.cloud.google.com/apis/library/places.googleapis.com",
  },
];

for (const key of API_KEYS) {
  const provided = (flags[key.flag] ?? "").trim();
  if (provided) { values[key.name] = provided; continue; }
  if (isSet(key.name)) continue;
  const entered = stdin.isTTY && flags.email === undefined ? (await prompt(key.prompt)).trim() : "";
  if (entered) { values[key.name] = entered; continue; }
  console.warn(`\n${key.warning}\n   Add it later with: npm run auth:credentials -- --${key.flag} YOUR_KEY\n`);
}

if (flags["print-only"] === undefined) {
  await mergeDevVars(values);
  console.log(`Wrote ${DEV_VARS} — \`npm run dev\` can now sign in as ${email}.`);
}

console.log("\nSet these as secrets in the hosted runtime (never commit them):\n");
for (const key of SECRET_KEYS) console.log(`${key}=${values[key]}`);
if (values.AGENCYSIGNAL_OWNER_NAME) {
  console.log(`\nAlso set AGENCYSIGNAL_OWNER_NAME=${values.AGENCYSIGNAL_OWNER_NAME} (plain variable, shown on prospect reports).`);
} else {
  console.log("\nOptionally set AGENCYSIGNAL_OWNER_NAME to control the name shown on prospect reports.");
}
console.log("\nThe password itself is not stored anywhere. Re-run this script to rotate it.");
