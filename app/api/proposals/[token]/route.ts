import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, auditFindings, audits, competitorAudits, findings as engineFindings, leads, proposals } from "@/db/schema";
import { buildGooglePresenceAudit } from "@/lib/google-presence";

/** Stored JSON columns are parsed once here so no reader has to guess a shape. */
function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

export async function GET(_request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const db = await getDb();
    const [proposal] = await db.select().from(proposals).where(eq(proposals.token, token)).limit(1);
    if (!proposal) return Response.json({ error: "Proposal not found" }, { status: 404 });
    const [lead] = await db.select().from(leads).where(eq(leads.id, proposal.leadId)).limit(1);
    if (!lead) return Response.json({ error: "Proposal unavailable" }, { status: 404 });
    const [audit] = await db.select().from(audits).where(eq(audits.leadId, lead.id)).orderBy(desc(audits.createdAt), desc(audits.id)).limit(1);
    const googleAudit = buildGooglePresenceAudit(lead);
    const competitors = await db.select({ id: competitorAudits.id, name: competitorAudits.name, score: competitorAudits.score }).from(competitorAudits).where(eq(competitorAudits.leadId, lead.id)).orderBy(desc(competitorAudits.score)).limit(3);

    // A proposal built from an audit run cites that run's findings. Reading the
    // legacy audit instead showed a run-based proposal either nothing or a
    // different pass's evidence, which is the one thing this document cannot do.
    const findings = proposal.runId
      ? await db
        .select({ id: engineFindings.id, title: engineFindings.title, evidence: engineFindings.evidence, recommendation: engineFindings.recommendation, category: engineFindings.category, severity: engineFindings.severity, affectedUrl: engineFindings.affectedUrl })
        .from(engineFindings)
        .where(eq(engineFindings.runId, proposal.runId))
        .orderBy(engineFindings.sortOrder)
      : [
        ...(audit ? await db.select({ title: auditFindings.title, evidence: auditFindings.evidence, recommendation: auditFindings.recommendation, category: auditFindings.category, severity: auditFindings.severity }).from(auditFindings).where(eq(auditFindings.auditId, audit.id)).orderBy(auditFindings.sortOrder).limit(2) : []),
        ...googleAudit.findings.slice(0, 2),
      ].slice(0, 4);
    await db.batch([
      db.update(proposals).set({ viewCount: sql`${proposals.viewCount} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(proposals.id, proposal.id)),
      db.update(leads).set({ status: proposal.status === "Accepted" ? "Won" : "Decision pending", updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(leads.id, lead.id)),
      db.insert(activities).values({ leadId: lead.id, activityType: "proposal_viewed", description: `${proposal.title} proposal viewed` }),
    ]);
    return Response.json({
      // Spread first, then the derived fields, or the raw row overwrites them.
      proposal: {
        ...proposal,
        viewCount: proposal.viewCount + 1,
        deliverables: parseJson<string[]>(proposal.deliverables, []),
        scopeItems: parseJson<unknown[]>(proposal.scopeItems, []),
        mockupLinks: parseJson<unknown[]>(proposal.mockupLinks, []),
        retainer: parseJson<unknown>(proposal.retainer, null),
      },
      lead: { agencyName: lead.agencyName, contactName: lead.contactName, city: lead.city, state: lead.state },
      audit: audit && audit.confidenceScore > 0 ? { score: audit.score, pagesAudited: audit.pagesAudited, confidenceScore: audit.confidenceScore, checksPassed: audit.checksPassed, checksFailed: audit.checksFailed, createdAt: audit.createdAt } : null,
      googleAudit: googleAudit.reviewed ? { score: googleAudit.score, reviewedAt: lead.googleReviewedAt } : null,
      competitors,
      findings,
    });
  } catch {
    return Response.json({ error: "Proposal unavailable" }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const body = (await request.json()) as { signerName?: string; signerEmail?: string };
    const signerName = String(body.signerName ?? "").trim().slice(0, 100);
    const signerEmail = String(body.signerEmail ?? "").trim().toLowerCase().slice(0, 180);
    if (!signerName || !/^\S+@\S+\.\S+$/.test(signerEmail)) return Response.json({ error: "Name and a valid email are required" }, { status: 400 });
    const db = await getDb();
    const [proposal] = await db.select().from(proposals).where(eq(proposals.token, token)).limit(1);
    if (!proposal) return Response.json({ error: "Proposal not found" }, { status: 404 });
    if (proposal.status === "Accepted") return Response.json({ ok: true, status: "Accepted" });
    if (new Date(proposal.expiresAt).getTime() < Date.now()) return Response.json({ error: "This proposal has expired. Please request an updated version." }, { status: 410 });
    await db.batch([
      db.update(proposals).set({ status: "Accepted", acceptedAt: sql`CURRENT_TIMESTAMP`, signerName, signerEmail, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(proposals.id, proposal.id)),
      db.update(leads).set({ status: "Won", dealValue: proposal.price, email: sql`CASE WHEN ${leads.email} = '' THEN ${signerEmail} ELSE ${leads.email} END`, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(leads.id, proposal.leadId)),
      db.insert(activities).values({ leadId: proposal.leadId, activityType: "proposal_accepted", description: `${proposal.title} accepted by ${signerName} · $${proposal.price.toLocaleString("en-US")}` }),
    ]);
    return Response.json({ ok: true, status: "Accepted" });
  } catch {
    return Response.json({ error: "Unable to accept proposal" }, { status: 500 });
  }
}
