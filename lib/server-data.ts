import { eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, leads, reportEvents } from "@/db/schema";

const demoBusinesses = [
  "Front Range Insurance Group",
  "Boulder Valley Coverage",
  "Mile High Risk Advisors",
  "Northern Colorado Insurance",
  "Pikes Peak Protection",
  "Western Slope Benefit Partners",
];

export async function prepareLeadData() {
  const db = await getDb();
  const demoRows = await db.select({ id: leads.id }).from(leads).where(inArray(leads.agencyName, demoBusinesses));
  const demoIds = demoRows.map((row) => row.id);
  if (demoIds.length) {
    await db.delete(reportEvents).where(inArray(reportEvents.leadId, demoIds));
    await db.delete(activities).where(inArray(activities.leadId, demoIds));
    await db.delete(leads).where(inArray(leads.id, demoIds));
  }

  // Replace early human-readable demo tokens with opaque 128-bit links.
  await db
    .update(leads)
    .set({ reportToken: sql`lower(hex(randomblob(16)))` })
    .where(lt(sql`length(${leads.reportToken})`, 32));
}

/**
 * The prospect a report token names. It used to return a legacy audit and its
 * findings alongside — the tables that no longer have a writer — and the report
 * that consumed them now reads the engine run instead.
 */
export async function getLeadByToken(token: string) {
  await prepareLeadData();
  const db = await getDb();
  const [lead] = await db
    .select()
    .from(leads)
    .where(eq(leads.reportToken, token))
    .limit(1);
  return lead ? { lead } : null;
}
