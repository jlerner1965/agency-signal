import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

export async function getDb() {
  const { env } = await import("cloudflare:workers");
  if (!env.DB) {
    throw new Error(
      "Cloudflare D1 binding `DB` is unavailable. Set the `d1` field in .openai/hosting.json to `DB` or let your control plane inject the real binding values before using the database."
    );
  }

  return drizzle(env.DB, { schema });
}

/**
 * D1 reports a missing schema as a bare SQLite error. Locally that almost
 * always means the migrations in drizzle/ have not been applied yet.
 */
export function describeDbError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : "";
  if (/no such table/i.test(message)) {
    return "The database has no tables yet. Run `npm run db:migrate` locally, or redeploy so the hosted runtime applies the migrations in drizzle/.";
  }
  return message || fallback;
}
