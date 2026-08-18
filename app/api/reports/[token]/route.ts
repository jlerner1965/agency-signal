import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { leads, reportEvents } from "@/db/schema";
import { getLeadByToken } from "@/lib/server-data";
import { buildOpportunity } from "@/lib/opportunity";

export async function GET(
  _request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    const report = await getLeadByToken(token);
    if (!report) return Response.json({ error: "Report not found" }, { status: 404 });
    const db = await getDb();
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
    const { lead, findings } = report;
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
      opportunity: buildOpportunity(lead, findings),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load report";
    return Response.json({ error: message }, { status: 500 });
  }
}
