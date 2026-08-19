#!/usr/bin/env node
// Applies drizzle/*.sql to a D1 database, tracked by tag so it is safe to
// re-run. Two targets:
//
//   (default)  the local Miniflare database `npm run dev` uses.
//   --remote   the deployed Cloudflare D1 named by CLOUDFLARE_D1_DATABASE_ID.
//
// The Sites runtime applies the same files from dist/.openai/drizzle by itself.
// A direct `wrangler deploy` does not, so a Cloudflare deploy must run this
// with --remote before the new Worker serves traffic.
//
// --remote must not run through scripts/sites-env.sh: that helper redirects
// XDG_CONFIG_HOME into .sites-runtime, where Wrangler keeps its OAuth token, so
// a normal `wrangler login` would be invisible and every remote call would fail
// as unauthenticated. The local target still uses it, for the Miniflare paths.
import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { resolve } from "node:path";

const run = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const persistTo = resolve(root, ".wrangler/state");
const TRACKING_TABLE = "_agencysignal_migrations";

// Must match vite.config.ts, or Miniflare resolves a different local database.
const PLACEHOLDER_DATABASE_ID = "00000000-0000-4000-8000-000000000000";

const flags = new Set(process.argv.slice(2).filter((value) => value.startsWith("--")));
const remote = flags.has("--remote");
// Separate files, so a local run can never reuse a config naming the real database.
const configPath = resolve(root, `.wrangler/migrate${remote ? ".remote" : ""}.wrangler.json`);

const hosting = JSON.parse(await readFile(resolve(root, ".openai/hosting.json"), "utf8"));
const binding = hosting.d1;
if (!binding) {
  console.error('No "d1" binding is configured in .openai/hosting.json.');
  process.exit(78);
}

// The remote database is addressed by its real id. Nothing derives it, because
// guessing wrong would migrate someone else's database.
const databaseId = remote ? (process.env.CLOUDFLARE_D1_DATABASE_ID ?? "").trim() : PLACEHOLDER_DATABASE_ID;
const databaseName = remote
  ? (process.env.CLOUDFLARE_D1_DATABASE_NAME ?? "agency-signal").trim()
  : "site-creator-d1";

if (remote && !databaseId) {
  console.error(
    "CLOUDFLARE_D1_DATABASE_ID is not set, so there is no remote database to migrate.\n" +
    "Create one with `npx wrangler d1 create agency-signal` and export the id it prints.",
  );
  process.exit(78);
}

await mkdir(resolve(root, ".wrangler"), { recursive: true });
await writeFile(
  configPath,
  `${JSON.stringify({
    name: "agency-signal-migrate",
    compatibility_date: "2025-01-01",
    compatibility_flags: ["nodejs_compat"],
    d1_databases: [{ binding, database_name: databaseName, database_id: databaseId }],
  }, null, 2)}\n`,
);

// --remote talks to Cloudflare and must not be pointed at local state.
const targetArgs = remote ? ["--remote"] : ["--local", "--persist-to", persistTo];
const label = remote ? "remote" : "local";
const command = remote ? "db:migrate:remote" : "db:migrate";

async function d1(args) {
  const { stdout } = await run(
    process.execPath,
    [resolve(root, "node_modules/wrangler/bin/wrangler.js"), "d1", "execute", binding,
      "--yes", "--json", "--config", configPath, ...targetArgs, ...args],
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
      `The ${label} database already has application tables but no migration history.\n` +
      `Run \`npm run ${command} -- --baseline\` if its schema is current` +
      (remote ? "." : ", or delete\n.wrangler/state/v3/d1 to rebuild it from scratch."),
    );
    process.exit(65);
  }
}

const pending = entries.filter((entry) => !applied.has(entry.tag));
if (!pending.length) {
  console.log(`${remote ? "Remote" : "Local"} D1 is up to date — ${entries.length} migrations already applied.`);
  process.exit(0);
}

for (const entry of pending) {
  process.stdout.write(`Applying ${entry.tag}… `);
  await d1(["--file", resolve(root, "drizzle", `${entry.tag}.sql`)]);
  await query(`INSERT INTO ${TRACKING_TABLE} (tag) VALUES ('${entry.tag}')`);
  console.log("done");
}

console.log(`Applied ${pending.length} migration${pending.length === 1 ? "" : "s"} to the ${label} D1 database.`);
