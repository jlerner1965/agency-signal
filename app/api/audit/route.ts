import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, auditFindings, audits, leads } from "@/db/schema";
import { requireDashboardApi } from "@/app/dashboard-auth";
import { buildOpportunity } from "@/lib/opportunity";
import { inspectWebsite } from "@/lib/website-inspection";
import { saveAuditScreenshot } from "@/lib/audit-screenshots";
import { minimumConfidence } from "@/lib/audit/scoring-config";

export async function POST(request: Request) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { leadId?: number; website?: string };
    const leadId = Number(body.leadId);
    const website = String(body.website ?? "").trim();
    if (!Number.isInteger(leadId) || !website) return Response.json({ error: "Lead and website are required." }, { status: 400 });

    const db = await getDb();
    const [existingLead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!existingLead) return Response.json({ error: "Lead not found." }, { status: 404 });
    const result = await inspectWebsite(website);
    const screenshotKey = await saveAuditScreenshot(result.screenshotData, "audit");
    const [audit] = await db.insert(audits).values({
      leadId,
      website: result.finalUrl,
      score: result.score,
      visibilityScore: result.visibility,
      conversionScore: result.conversion,
      technicalScore: result.technical,
      trustScore: result.trust,
      pagesAudited: result.pagesAudited,
      responseStatus: result.status,
      confidenceScore: result.confidenceScore,
      checksPassed: result.checksPassed,
      checksFailed: result.checksFailed,
      checksUnverified: result.checksUnverified,
      checkSummary: JSON.stringify(result.checks),
      lighthouseSummary: JSON.stringify(result.lighthouse),
      screenshotKey,
    }).returning();
    if (result.findings.length) {
      await db.insert(auditFindings).values(result.findings.map((finding: Record<string, unknown>) => ({ ...finding, auditId: audit.id })) as typeof auditFindings.$inferInsert[]);
    }
    // One guarantee governs every stored score, whichever rubric produced it:
    // a run that could not verify enough of its own rubric records the audit
    // but does not write a headline number. The audit row is always kept.
    const confident = result.confidenceScore >= minimumConfidence;
    const [lead] = await db.update(leads).set({
      website: result.finalUrl,
      ...(confident ? {
        score: result.score,
        visibilityScore: result.visibility,
        conversionScore: result.conversion,
        technicalScore: result.technical,
        trustScore: result.trust,
        scoreSource: "legacy",
        scoreConfidence: result.confidenceScore,
        lastAuditAt: sql`CURRENT_TIMESTAMP`,
      } : {}),
      status: "Audited",
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(leads.id, leadId)).returning();
    const opportunity = buildOpportunity(lead, result.findings);
    await db.insert(activities).values({
      leadId,
      activityType: "audit_completed",
      description: confident
        ? `${result.pagesAudited}-page website audit completed · ${opportunity.primaryService} opportunity · score ${result.score}`
        : `${result.pagesAudited}-page website audit completed without a score · only ${result.confidenceScore}% of the rubric could be verified`,
    });
    return Response.json({
      lead, audit, findings: result.findings, pagesAudited: result.pagesAudited, opportunity,
      lighthouse: result.lighthouse, metadata: result.metadata,
      scored: confident,
      confidence: result.confidenceScore,
      unscoredReason: confident ? "" : `Only ${result.confidenceScore}% of the audit rubric could be verified, below the ${minimumConfidence}% needed to report a score.`,
    });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "The website took too long to complete a multi-page review."
      : error instanceof Error ? error.message : "Unable to complete the audit.";
    return Response.json({ error: message }, { status: 400 });
  }
}
