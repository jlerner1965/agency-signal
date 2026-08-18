import { desc, eq, sql } from "drizzle-orm";
import { requireDashboardApi } from "@/app/dashboard-auth";
import { getDb } from "@/db";
import { activities, auditFindings, audits, leads, proposals } from "@/db/schema";
import { buildOpportunity } from "@/lib/opportunity";
import { offerCatalog, offerForOpportunity } from "@/lib/sales";
import { buildGooglePresenceAudit } from "@/lib/google-presence";

function makeToken() { return crypto.randomUUID().replaceAll("-", ""); }
function cleanText(value: unknown, fallback: string, maximum: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maximum);
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  try {
    const { id: rawId } = await context.params;
    const leadId = Number(rawId);
    if (!Number.isInteger(leadId)) return Response.json({ error: "Invalid lead" }, { status: 400 });
    const body = (await request.json()) as { offerId?: string; price?: number; timeline?: string; title?: string; outcome?: string; scope?: string; deliverables?: string[] };
    const db = await getDb();
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
    const [audit] = await db.select().from(audits).where(eq(audits.leadId, leadId)).orderBy(desc(audits.createdAt), desc(audits.id)).limit(1);
    const findings = audit ? await db.select().from(auditFindings).where(eq(auditFindings.auditId, audit.id)).orderBy(auditFindings.sortOrder) : [];
    const opportunity = buildOpportunity(lead, findings);
    const googleAudit = buildGooglePresenceAudit(lead);
    const recommended = googleAudit.reviewed && googleAudit.score < 60 && lead.score < 65
      ? offerCatalog.find((item) => item.id === "digital-presence-plan")
      : googleAudit.reviewed && googleAudit.score < 60
        ? offerCatalog.find((item) => item.id === "google-presence")
        : offerForOpportunity(opportunity);
    const offer = offerCatalog.find((item) => item.id === body.offerId) ?? recommended ?? offerForOpportunity(opportunity);
    const price = Math.max(500, Math.min(250000, Math.round(Number(body.price) || offer.price)));
    const title = cleanText(body.title, offer.name, 160);
    const outcome = cleanText(body.outcome, offer.outcome, 700);
    const defaultScope = googleAudit.findings[0]
      ? `${opportunity.primaryFinding}. Google presence review: ${googleAudit.findings[0].title}.`
      : opportunity.primaryFinding;
    const scope = cleanText(body.scope, defaultScope, 1_600);
    const deliverables = (Array.isArray(body.deliverables) ? body.deliverables : offer.deliverables)
      .map((item) => cleanText(item, "", 220)).filter(Boolean).slice(0, 10);
    if (!deliverables.length) deliverables.push(...offer.deliverables);
    const expiresAt = new Date(Date.now() + 14 * 86_400_000).toISOString();
    const [proposal] = await db.insert(proposals).values({
      leadId,
      token: makeToken(),
      offerId: offer.id,
      title,
      service: offer.service,
      outcome,
      scope,
      deliverables: JSON.stringify(deliverables),
      price,
      timeline: String(body.timeline || offer.timeline).slice(0, 100),
      status: "Sent",
      expiresAt,
    }).returning();
    const [updatedLead] = await db.update(leads).set({ status: "Proposal sent", dealValue: price, nextFollowUpAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(leads.id, leadId)).returning();
    await db.insert(activities).values({ leadId, activityType: "proposal_created", description: `${title} proposal created · $${price.toLocaleString("en-US")}` });
    return Response.json({ proposal, lead: updatedLead }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create proposal" }, { status: 500 });
  }
}
