#!/usr/bin/env node
// Applies drizzle/*.sql to the local Miniflare D1 database that `npm run dev`
// uses. The hosted runtime applies the same files from dist/.openai/drizzle, so
// this script exists purely to give local development the same schema.
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

const hosting = JSON.parse(await readFile(resolve(root, ".openai/hosting.json"), "utf8"));
const binding = hosting.d1;
if (!binding) {
  console.error('No "d1" binding is configured in .openai/hosting.json.');
  process.exit(78);
}

await mkdir(resolve(root, ".wrangler"), { recursive: true });
await writeFile(
  configPath,
  `${JSON.stringify({
    name: "agency-signal-migrate",
    compatibility_date: "2025-01-01",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: [{ binding, database_name: "site-creator-d1", database_id: PLACEHOLDER_DATABASE_ID }],
  }, null, 2)}\n`,
);

async function d1(args) {
  const { stdout } = await run(
    process.execPath,
    [resolve(root, "node_modules/wrangler/bin/wrangler.js"), "d1", "execute", binding,
      "--local", "--yes", "--json", "--config", configPath, "--persist-to", persistTo, ...args],
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
      "The local database already has application tables but no migration history.\n" +
      "Run `npm run db:migrate -- --baseline` if its schema is current, or delete\n" +
      ".wrangler/state/v3/d1 to rebuild it from scratch.",
    );
    process.exit(65);
  }
}

const pending = entries.filter((entry) => !applied.has(entry.tag));
if (!pending.length) {
  console.log(`Local D1 is up to date — ${entries.length} migrations already applied.`);
  process.exit(0);
}

for (const entry of pending) {
  process.stdout.write(`Applying ${entry.tag}… `);
  await d1(["--file", resolve(root, "drizzle", `${entry.tag}.sql`)]);
  await query(`INSERT INTO ${TRACKING_TABLE} (tag) VALUES ('${entry.tag}')`);
  console.log("done");
}

console.log(`Applied ${pending.length} migration${pending.length === 1 ? "" : "s"} to the local D1 database.`);
