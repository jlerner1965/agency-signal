import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { audits, competitorAudits, leads, reportEvents } from "@/db/schema";
import { getLeadByToken } from "@/lib/server-data";
import { buildOpportunity } from "@/lib/opportunity";
import { compareAudits } from "@/lib/audit-history";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    const report = await getLeadByToken(token);
    if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
    const db = await getDb();
    const auditHistory = await db.select().from(audits).where(eq(audits.leadId, report.lead.id)).orderBy(desc(audits.createdAt), desc(audits.id)).limit(2);
    const competitors = await db.select().from(competitorAudits).where(eq(competitorAudits.leadId, report.lead.id)).orderBy(desc(competitorAudits.createdAt), desc(competitorAudits.id));
    await db.batch([
      db.insert(reportEvents).values({ leadId: report.lead.id, eventType: "report_viewed" }),
      db
        .update(leads)
        .set({
          reportViews: sql`${leads.reportViews} + 1`,
          status: report.lead.status === "Audited" ? "Contacted" : report.lead.status,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(leads.id, report.lead.id)),
    ]);
    const { lead, audit } = report;
    const findings = audit && audit.confidenceScore > 0 ? report.findings : [];
    return Response.json({
      lead: {
        agencyName: lead.agencyName,
        contactName: lead.contactName,
        city: lead.city,
        state: lead.state,
        website: lead.website,
        score: lead.score,
        visibilityScore: lead.visibilityScore,
        conversionScore: lead.conversionScore,
        technicalScore: lead.technicalScore,
        trustScore: lead.trustScore,
        lastAuditAt: lead.lastAuditAt,
      },
      findings,
      audit: audit && audit.confidenceScore > 0 ? {
        pagesAudited: audit.pagesAudited,
        confidenceScore: audit.confidenceScore,
        checksPassed: audit.checksPassed,
        checksFailed: audit.checksFailed,
        checksUnverified: audit.checksUnverified,
        screenshotKey: audit.screenshotKey,
        createdAt: audit.createdAt,
      } : null,
      auditComparison: compareAudits(auditHistory[0], auditHistory[1]),
      competitors: competitors.map((item) => ({ id: item.id, name: item.name, website: item.website, score: item.score, visibilityScore: item.visibilityScore, conversionScore: item.conversionScore, technicalScore: item.technicalScore, trustScore: item.trustScore, confidenceScore: item.confidenceScore, pagesAudited: item.pagesAudited, screenshotKey: item.screenshotKey })),
      opportunity: buildOpportunity(lead, findings),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load report";
    return Response.json({ error: message }, { status: 500 });
  }
}
