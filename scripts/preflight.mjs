#!/usr/bin/env node
// Is this ready to put in front of a prospect?
//
// The gates were four commands and a checklist spread across the README and
// docs/deploy.md, and the two things most likely to be wrong on a first
// deploy — an unset secret and an unfilled config file — were on neither.
// This answers the whole question once, and names what is missing.
//
//   node scripts/preflight.mjs             # config and secrets only, fast
//   node scripts/preflight.mjs --full      # also typecheck, build, test, lint
//
// Exits non-zero when something would stop a proposal going out, so it can
// gate a release rather than only inform one.

import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const full = process.argv.includes("--full");

let blockers = 0;
let warnings = 0;

const line = (mark, label, detail) => console.log(`  ${mark}  ${label}${detail ? ` — ${detail}` : ""}`);
const pass = (label, detail) => line("PASS", label, detail);
const block = (label, detail) => { blockers += 1; line("BLOCK", label, detail); };
const warn = (label, detail) => { warnings += 1; line("WARN ", label, detail); };

function heading(text) {
  console.log(`\n${text}\n${"─".repeat(text.length)}`);
}

/** The environment as the runtime will see it: real env first, then .dev.vars. */
async function environment() {
  const values = { ...process.env };
  try {
    const file = await readFile(resolve(root, ".dev.vars"), "utf8");
    for (const entry of file.split("\n")) {
      const at = entry.indexOf("=");
      if (at < 1 || entry.trimStart().startsWith("#")) continue;
      const key = entry.slice(0, at).trim();
      if (!values[key]) values[key] = entry.slice(at + 1).trim();
    }
  } catch { /* no local file is normal for a hosted check */ }
  return values;
}

function run(command, args) {
  return new Promise((resolveRun) => {
    const child = spawn(command, args, { cwd: root, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (chunk) => { output += chunk; });
    child.stderr.on("data", (chunk) => { output += chunk; });
    child.on("close", (code) => resolveRun({ code, output }));
  });
}

const env = await environment();

heading("Sign-in — without all four, every page returns 401");
for (const key of ["AGENCYSIGNAL_LOGIN_EMAIL", "AGENCYSIGNAL_PASSWORD_SALT", "AGENCYSIGNAL_PASSWORD_HASH", "AGENCYSIGNAL_SESSION_SECRET"]) {
  if (env[key]) pass(key);
  else block(key, "run: npm run auth:credentials");
}

heading("Audit sources");
if (env.GOOGLE_PLACES_API_KEY) pass("GOOGLE_PLACES_API_KEY");
else warn("GOOGLE_PLACES_API_KEY", "the profile cannot be read automatically; the gap table then runs only from the category typed on the Google presence tab");
if (env.PAGESPEED_API_KEY) pass("PAGESPEED_API_KEY");
else warn("PAGESPEED_API_KEY", "PageSpeed applies its unkeyed quota and 429s in a batch; those checks report as not measured. Free to obtain");
if (env.OPENAI_API_KEY) pass("OPENAI_API_KEY", "openings and rationales may be model-written, then checked against the voice rules");
else warn("OPENAI_API_KEY", "openings and rationales are composed deterministically instead — a supported outcome, not a failure");
if (env.AGENCYSIGNAL_OWNER_NAME) pass("AGENCYSIGNAL_OWNER_NAME", env.AGENCYSIGNAL_OWNER_NAME);
else warn("AGENCYSIGNAL_OWNER_NAME", "prospect-facing documents will use a name derived from the login address");

heading("Configuration — a placeholder here blocks every export");
try {
  const pricing = JSON.parse(await readFile(resolve(root, "config/pricing.json"), "utf8"));
  if (pricing.placeholder === true) block("config/pricing.json", "still carries the shipped placeholder amounts, so no proposal is exportable");
  else pass("config/pricing.json", `${Object.keys(pricing.deliverables ?? {}).length} deliverables, minimum ${pricing.minimum_engagement}, display ${pricing.display_mode}`);
} catch (reason) {
  block("config/pricing.json", reason instanceof Error ? reason.message : "unreadable");
}

try {
  const voice = await readFile(resolve(root, "config/voice.md"), "utf8");
  const placeholder = /<!--\s*voice:placeholder\s*-->/.test(voice) || /^PLACEHOLDER VOICE SAMPLE/m.test(voice);
  if (placeholder) block("config/voice.md", "still the shipped placeholder, so no proposal opening can be written");
  else pass("config/voice.md", `${voice.split("\n").length} lines`);
} catch (reason) {
  block("config/voice.md", reason instanceof Error ? reason.message : "unreadable");
}

heading("Deployable artifact");
try {
  const hosting = JSON.parse(await readFile(resolve(root, ".openai/hosting.json"), "utf8"));
  if (hosting.d1) pass(".openai/hosting.json", `d1 ${hosting.d1}${hosting.r2 ? `, r2 ${hosting.r2}` : ""}`);
  else block(".openai/hosting.json", "declares no d1 binding, so the Worker has no database");
} catch (reason) {
  block(".openai/hosting.json", reason instanceof Error ? reason.message : "unreadable");
}

if (full) {
  heading("Gates");
  // Every test file, listed rather than globbed: this spawns without a shell,
  // so `tests/*.test.mjs` would reach node as a literal path and match nothing.
  const { readdir } = await import("node:fs/promises");
  const testFiles = (await readdir(resolve(root, "tests")))
    .filter((name) => name.endsWith(".test.mjs"))
    .map((name) => `tests/${name}`)
    .sort();
  const gates = [
    { label: "typecheck", command: "npx", args: ["tsc", "--noEmit"] },
    { label: "build", command: "npm", args: ["run", "build"] },
    { label: "tests", command: "node", args: ["--test", ...testFiles] },
    { label: "lint", command: "npm", args: ["run", "lint"] },
  ];
  for (const gate of gates) {
    const result = await run(gate.command, gate.args);
    if (result.code === 0) pass(gate.label);
    else block(gate.label, (result.output.trim().split("\n").pop() ?? "").slice(0, 120));
  }
} else {
  console.log("\n  (run with --full to also gate typecheck, build, tests and lint)");
}

heading("Verdict");
if (blockers) {
  console.log(`  NOT READY — ${blockers} blocker${blockers === 1 ? "" : "s"}, ${warnings} warning${warnings === 1 ? "" : "s"}.`);
  console.log("  A blocker stops a proposal being exportable. Fix those first.");
} else {
  console.log(`  READY — 0 blockers, ${warnings} warning${warnings === 1 ? "" : "s"}.`);
  console.log("  A warning lowers what a run can cover; it never stops one.");
  console.log("  Deploy, then run `npm run audit:five` against it and treat those");
  console.log("  five audits as calibration rather than output.");
}
process.exit(blockers ? 1 : 0);
