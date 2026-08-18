import { count, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { auditFindings, audits, leads } from "@/db/schema";
import { sampleFindings, sampleLeads } from "@/lib/sample-data";

export async function ensureSeedData() {
  const db = await getDb();
  const [result] = await db.select({ value: count() }).from(leads);
  if ((result?.value ?? 0) > 0) return;

  for (const sample of sampleLeads) {
    const record = Object.fromEntries(
      Object.entries(sample).filter(([key]) => key !== "id"),
    ) as Omit<typeof sample, "id">;
    const [lead] = await db.insert(leads).values(record).returning();
    if (lead.score > 0) {
      const [audit] = await db
        .insert(audits)
        .values({
          leadId: lead.id,
          website: lead.website,
          score: lead.score,
          visibilityScore: lead.visibilityScore,
          conversionScore: lead.conversionScore,
          technicalScore: lead.technicalScore,
          trustScore: lead.trustScore,
          responseStatus: 200,
        })
        .returning();
      await db.insert(auditFindings).values(
        sampleFindings.map((finding) => ({
          ...finding,
          auditId: audit.id,
          affectedUrl: lead.website,
        })),
      );
    }
  }
}

export async function getLeadByToken(token: string) {
  await ensureSeedData();
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
