import { and, eq, sql } from "drizzle-orm";
import { requireDashboardApi } from "@/app/dashboard-auth";
import { getDb } from "@/db";
import { competitorAudits, leads } from "@/db/schema";
import { deleteAuditScreenshot, saveAuditScreenshot } from "@/lib/audit-screenshots";
import { inspectWebsite } from "@/lib/website-inspection";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi(); if (denied) return denied;
  try {
    const { id: rawId } = await context.params; const leadId = Number(rawId);
    const body = await request.json() as { name?: string; website?: string };
    const name = String(body.name ?? "").trim().slice(0, 120); const website = String(body.website ?? "").trim();
    if (!Number.isInteger(leadId) || !name || !website) return Response.json({ error: "Competitor name and website are required." }, { status: 400 });
    const db = await getDb();
    const [lead] = await db.select({ id: leads.id }).from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) return Response.json({ error: "Business not found." }, { status: 404 });
    const [countRow] = await db.select({ count: sql<number>`count(*)` }).from(competitorAudits).where(eq(competitorAudits.leadId, leadId));
    if (Number(countRow?.count || 0) >= 3) return Response.json({ error: "Remove a competitor before adding another. The comparison supports up to three." }, { status: 400 });
    const existing = await db.select({ id: competitorAudits.id }).from(competitorAudits).where(and(eq(competitorAudits.leadId, leadId), eq(competitorAudits.website, website))).limit(1);
    if (existing.length) return Response.json({ error: "That competitor website is already in this comparison." }, { status: 400 });
    const result = await inspectWebsite(website); const screenshotKey = await saveAuditScreenshot(result.screenshotData, "competitor");
    const [competitor] = await db.insert(competitorAudits).values({
      leadId, name, website: result.finalUrl, score: result.score, visibilityScore: result.visibility,
      conversionScore: result.conversion, technicalScore: result.technical, trustScore: result.trust,
      pagesAudited: result.pagesAudited, confidenceScore: result.confidenceScore, checksPassed: result.checksPassed,
      checksFailed: result.checksFailed, checkSummary: JSON.stringify(result.checks), lighthouseSummary: JSON.stringify(result.lighthouse), screenshotKey,
    }).returning();
    return Response.json({ competitor }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError" ? "The competitor website took too long to audit." : error instanceof Error ? error.message : "Unable to audit competitor.";
    return Response.json({ error: message }, { status: 400 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi(); if (denied) return denied;
  const { id: rawId } = await context.params; const leadId = Number(rawId); const competitorId = Number(new URL(request.url).searchParams.get("competitorId"));
  if (!Number.isInteger(leadId) || !Number.isInteger(competitorId)) return Response.json({ error: "Invalid competitor." }, { status: 400 });
  const db = await getDb();
  const [competitor] = await db.select().from(competitorAudits).where(and(eq(competitorAudits.id, competitorId), eq(competitorAudits.leadId, leadId))).limit(1);
  if (!competitor) return Response.json({ error: "Competitor not found." }, { status: 404 });
  await deleteAuditScreenshot(competitor.screenshotKey);
  await db.delete(competitorAudits).where(eq(competitorAudits.id, competitorId));
  return Response.json({ ok: true });
}
