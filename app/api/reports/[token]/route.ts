import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { leads, reportEvents } from "@/db/schema";
import { getLeadByToken } from "@/lib/server-data";
import { reportPayload } from "@/lib/audit/deliverables";

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
    // The engine run is the report. It used to be the authoritative half of a
    // pair, with the legacy `audits` tables as the fallback — but nothing has
    // written those since the old scoring path was removed, so the fallback
    // could only ever produce a prospect-facing page with no evidence in it.
    const engine = await reportPayload(report.lead.id);
    const { lead } = report;
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
        scoreConfidence: lead.scoreConfidence,
        lastAuditAt: lead.lastAuditAt,
      },
      engine,
    });
  } catch {
    // Public endpoint: the reason stays in the logs, not in the response.
    return Response.json({ error: "Unable to load report" }, { status: 500 });
  }
}
