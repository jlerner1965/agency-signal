#!/usr/bin/env node
// Applies drizzle/*.sql to a D1 database: the local Miniflare one that
// `npm run dev` uses, or with --remote the deployed database named in
// .cloudflare.json. The same files ship in dist/.openai/drizzle for runtimes
// that apply migrations themselves.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const persistTo = resolve(root, ".wrangler/state");
const configPath = resolve(root, ".wrangler/migrate.wrangler.json");
const TRACKING_TABLE = "_agencysignal_migrations";

// Must match vite.config.ts, or Miniflare resolves a different local database.
const PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000";

const flags = new Set(process.argv.slice(2).filter((value) => value.startsWith("--")));
const remote = flags.has("--remote");
const where = remote ? "remote" : "local";

const hosting = JSON.parse(await readFile(resolve(root, ".openai/hosting.json"), "utf8"));
const binding = hosting.d1;
if (!binding) {
  console.error('No "d1" binding is configured in .openai/hosting.json.');
  process.exit(78);
}

// The deployed database is account-specific, so its name and id live in an
// ignored file written by `npm run deploy` rather than in the repository.
let target = { database_name: "site-creator-d1", database_id: PLACEHOLDER_DATABASE_ID };
if (remote) {
  try {
    const cloudflare = JSON.parse(await readFile(resolve(root, ".cloudflare.json"), "utf8"));
    if (!cloudflare.d1_database_id) throw new Error("no d1_database_id");
    target = { database_name: cloudflare.d1_database_name, database_id: cloudflare.d1_database_id };
  } catch {
    console.error(
      "No deployed database is recorded yet. Run `npm run deploy`, which creates\n" +
      "the D1 database and writes .cloudflare.json before applying migrations.",
    );
    process.exit(78);
  }
}

await mkdir(resolve(root, ".wrangler"), { recursive: true });
await writeFile(
  configPath,
  `${JSON.stringify({
    name: "agency-signal-migrate",
    compatibility_date: "2025-01-01",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: [{ binding, ...target }],
  }, null, 2)}\n`,
);

async function d1(args) {
  const { stdout } = await run(
    process.execPath,
    [resolve(root, "node_modules/wrangler/bin/wrangler.js"), "d1", "execute", binding,
      ...(remote ? ["--remote"] : ["--local", "--persist-to", persistTo]),
      "--yes", "--json", "--config", configPath, ...args],
    { cwd: root, maxBuffer: 32 * 1024 * 1024 },
  );
  // Wrangler prints banners before the JSON payload, so start at the array.
  const start = stdout.indexOf("[");
  return start === -1 ? [] : JSON.parse(stdout.slice(start));
}

async function query(sql) {
  const [result] = await d1(["--command", sql]);
  return result?.results ?? [];
}

const journal = JSON.parse(await readFile(resolve(root, "drizzle/meta/_journal.json"), "utf8"));
const entries = [...journal.entries].sort((a, b) => a.idx - b.idx);

await query(`CREATE TABLE IF NOT EXISTS ${TRACKING_TABLE} (tag text PRIMARY KEY, applied_at text NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
const applied = new Set((await query(`SELECT tag FROM ${TRACKING_TABLE}`)).map((row) => row.tag));

if (flags.has("--baseline")) {
  for (const entry of entries) {
    await query(`INSERT OR IGNORE INTO ${TRACKING_TABLE} (tag) VALUES ('${entry.tag}')`);
  }
  console.log(`Marked ${entries.length} migrations as already applied. No SQL was run.`);
  process.exit(0);
}

// A database carrying tables from before this script existed would fail on the
// first CREATE TABLE. Say so instead of surfacing a raw SQLite error.
if (!applied.size) {
  const existing = await query("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'leads'");
  if (existing.length) {
    console.error(
      `The ${where} database already has application tables but no migration history.\n` +
      "Run `npm run db:migrate -- --baseline` if its schema is current, or delete\n" +
      ".wrangler/state/v3/d1 to rebuild it from scratch.",
    );
    process.exit(65);
  }
}

const pending = entries.filter((entry) => !applied.has(entry.tag));
if (!pending.length) {
  console.log(`The ${where} D1 database is up to date — ${entries.length} migrations already applied.`);
  process.exit(0);
}

for (const entry of pending) {
  process.stdout.write(`Applying ${entry.tag}… `);
  await d1(["--file", resolve(root, "drizzle", `${entry.tag}.sql`)]);
  await query(`INSERT INTO ${TRACKING_TABLE} (tag) VALUES ('${entry.tag}')`);
  console.log("done");
}

console.log(`Applied ${pending.length} migration${pending.length === 1 ? "" : "s"} to the ${where} D1 database.`);
