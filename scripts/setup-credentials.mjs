#!/usr/bin/env node
// Generates the four dashboard authentication values the app requires and
// writes them to .dev.vars so `npm run dev` has a working login. The same
// values are printed for the hosted runtime, which needs them as secrets.
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { stdin, stdout } from "node:process";

const PBKDF2_ITERATIONS = 100_000;
const DEV_VARS = resolve(import.meta.dirname, "..", ".dev.vars");
const SECRET_KEYS = [
  "AGENCYSIGNAL_LOGIN_EMAIL",
  "AGENCYSIGNAL_PASSWORD_SALT",
  "AGENCYSIGNAL_PASSWORD_HASH",
  "AGENCYSIGNAL_SESSION_SECRET",
];
// Not a secret, but it belongs beside the login it names.
const KEYS = [...SECRET_KEYS, "AGENCYSIGNAL_OWNER_NAME"];

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
  const rl = createInterface({ input: stdin, output: stdout, terminal: true });
  if (silent) {
    // Keep the typed password off the screen without dropping keypresses.
    const mute = (chunk, encoding, callback) => callback();
    const original = stdout.write.bind(stdout);
    stdout.write(question);
    rl.output.write = mute;
    const answer = await rl.question("");
    rl.output.write = original;
    stdout.write("\n");
    rl.close();
    return answer;
  }
  const answer = await rl.question(question);
  rl.close();
  return answer;
}

// Preserves unrelated lines so re-running does not discard other local vars.
async function mergeDevVars(values) {
  let existing = "";
  try {
    existing = await readFile(DEV_VARS, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const kept = existing
    .split("\n")
    .filter((line) => line.trim() && !KEYS.some((key) => line.startsWith(`${key}=`)));
  const written = KEYS.filter((key) => values[key]).map((key) => `${key}=${values[key]}`);
  await writeFile(DEV_VARS, `${[...kept, ...written].join("\n")}\n`, { mode: 0o600 });
}

const flags = readFlags(process.argv.slice(2));
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
