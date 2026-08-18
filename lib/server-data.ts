import { desc, eq, inArray, lt, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, auditFindings, audits, leads, reportEvents } from "@/db/schema";

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
    const demoAudits = await db.select({ id: audits.id }).from(audits).where(inArray(audits.leadId, demoIds));
    const demoAuditIds = demoAudits.map((row) => row.id);
    if (demoAuditIds.length) await db.delete(auditFindings).where(inArray(auditFindings.auditId, demoAuditIds));
    await db.delete(audits).where(inArray(audits.leadId, demoIds));
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

export async function getLeadByToken(token: string) {
  await prepareLeadData();
  const db = await getDb();
  const [lead] = await db
    .select()
    .from(leads)
    .where(eq(leads.reportToken, token))
    .limit(1);
  if (!lead) return null;

  const [audit] = await db
    .select()
    .from(audits)
    .where(eq(audits.leadId, lead.id))
    .orderBy(desc(audits.createdAt), desc(audits.id))
    .limit(1);
  const findings = audit
    ? await db
        .select()
        .from(auditFindings)
        .where(eq(auditFindings.auditId, audit.id))
        .orderBy(auditFindings.sortOrder)
    : [];
  return { lead, audit, findings };
}
