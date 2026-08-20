import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, auditRunModules, auditRuns, competitorAudits, findings as engineFindings, leads, proposals } from "@/db/schema";
import { requireDashboardApi } from "@/app/dashboard-auth";
import { buildGooglePresenceAudit } from "@/lib/google-presence";
import { serviceLinesFor } from "@/lib/audit/deliverables";
import { carries, readSections } from "@/lib/audit/proposal-sections";
import { summaryFromRun } from "@/lib/audit/run-summary";

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
    // A proposal built from the prospect rather than from a run still reports
    // the newest finished run: the legacy `audits` table it used to read has
    // had no writer since the old scoring path was removed, so those documents
    // showed a score of nothing beside evidence of nothing.
    const [latestRun] = proposal.runId ? [] : await db.select().from(auditRuns)
      .where(and(eq(auditRuns.leadId, lead.id), isNotNull(auditRuns.finishedAt)))
      .orderBy(desc(auditRuns.id)).limit(1);
    const googleAudit = buildGooglePresenceAudit(lead);
    const competitors = await db.select({ id: competitorAudits.id, name: competitorAudits.name, score: competitorAudits.score }).from(competitorAudits).where(eq(competitorAudits.leadId, lead.id)).orderBy(desc(competitorAudits.score)).limit(3);

    // A proposal built from an audit run cites that run's findings. Reading the
    // legacy audit instead showed a run-based proposal either nothing or a
    // different pass's evidence, which is the one thing this document cannot do.
    // The run behind this proposal, so the document carries the same score and
    // the same list of what could not be measured as the report does. An
    // omitted check reads as a pass, and the proposal was omitting all of them.
    const [run] = proposal.runId
      ? await db.select().from(auditRuns).where(eq(auditRuns.id, proposal.runId)).limit(1)
      : [latestRun].filter(Boolean);
    const runModules = run
      ? await db.select().from(auditRunModules).where(eq(auditRunModules.runId, run.id)).orderBy(auditRunModules.sortOrder)
      : [];
    const runSummary = summaryFromRun(run ?? null, runModules, null);
    const unmeasured = runModules
      .flatMap((module) => parseJson<Array<Record<string, unknown>>>(module.checkSummary, []))
      .filter((check) => check.status === "unverified")
      .map((check) => ({ label: String(check.label ?? ""), category: String(check.category ?? ""), evidence: String(check.evidence ?? "") }));

    const runFindings = run
      ? await db
        .select({ id: engineFindings.id, title: engineFindings.title, evidence: engineFindings.evidence, recommendation: engineFindings.recommendation, category: engineFindings.category, severity: engineFindings.severity, affectedUrl: engineFindings.affectedUrl })
        .from(engineFindings)
        .where(eq(engineFindings.runId, run.id))
        .orderBy(engineFindings.sortOrder)
      : [];
    // A run-based proposal cites its own run in full. One built from the
    // prospect leads with the strongest of each source, because it is a shorter
    // document making a smaller claim.
    const findings = proposal.runId
      ? runFindings
      : [...runFindings.slice(0, 2), ...googleAudit.findings.slice(0, 2)].slice(0, 4);
    await db.batch([
      db.update(proposals).set({ viewCount: sql`${proposals.viewCount} + 1`, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(proposals.id, proposal.id)),
      db.update(leads).set({ status: proposal.status === "Accepted" ? "Won" : "Decision pending", updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(leads.id, lead.id)),
      db.insert(activities).values({ leadId: lead.id, activityType: "proposal_viewed", description: `${proposal.title} proposal viewed` }),
    ]);
    return Response.json({
      // Named field by field rather than spread. This endpoint is public to
      // anyone holding the link, and the row also carries who signed it, their
      // email, and the internal ids — none of which the document needs.
      proposal: {
        title: proposal.title,
        service: proposal.service,
        outcome: proposal.outcome,
        scope: proposal.scope,
        price: proposal.price,
        priceDisplay: proposal.priceDisplay,
        timeline: proposal.timeline,
        status: proposal.status,
        expiresAt: proposal.expiresAt,
        acceptedAt: proposal.acceptedAt,
        openingProse: proposal.openingProse,
        openingBlocked: proposal.openingBlocked,
        minimumApplied: proposal.minimumApplied,
        pricingPlaceholder: proposal.pricingPlaceholder,
        voicePlaceholder: proposal.voicePlaceholder,
        deliverables: parseJson<string[]>(proposal.deliverables, []),
        scopeItems: parseJson<unknown[]>(proposal.scopeItems, []),
        mockupLinks: parseJson<unknown[]>(proposal.mockupLinks, []),
        retainer: parseJson<unknown>(proposal.retainer, null),
        // Which parts were ticked before it was built. Null on every proposal
        // built before the picker existed, and the view reads that as the
        // document it used to render rather than as an empty one.
        sections: readSections(proposal.sections),
      },
      // The gap between what the site sells and what Google carries is the
      // argument this document is making, so it belongs in the document rather
      // than in a separate report the reader has to be sent to.
      serviceLines: proposal.runId && carries(readSections(proposal.sections), "coverage")
        ? await serviceLinesFor(proposal.runId)
        : [],
      lead: { agencyName: lead.agencyName, contactName: lead.contactName, city: lead.city, state: lead.state },
      // The run reports the checks and the confidence for both kinds of
      // proposal now, so this older block has nothing left of its own to say.
      // Passed and failed are counted from the checks themselves: "verified"
      // means measured, which is passed plus failed, and reporting it as passed
      // would claim every measured check came back clean.
      audit: runSummary && runSummary.confidenceScore > 0 ? {
        score: runSummary.score,
        pagesAudited: runSummary.pagesAudited,
        confidenceScore: runSummary.confidenceScore,
        checksPassed: runSummary.checksPassed,
        checksFailed: runSummary.checksFailed,
        createdAt: runSummary.createdAt,
      } : null,
      googleAudit: googleAudit.reviewed ? { score: googleAudit.score, reviewedAt: lead.googleReviewedAt } : null,
      competitors,
      findings,
      // Null for a proposal that predates the engine, which the view treats as
      // "no run to report" rather than a zero.
      run: run && run.finishedAt ? {
        score: run.overallScore,
        confidence: run.confidence,
        checksVerified: run.checksVerified,
        checksTotal: run.checksTotal,
        reachable: run.reachable,
        subscores: {
          Trust: run.trustScore, Conversion: run.conversionScore,
          Visibility: run.visibilityScore, Technical: run.technicalScore,
        },
      } : null,
      unmeasured,
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

/**
 * Edit the parts of a proposal a person writes.
 *
 * The split is the point. Prose, the timeline and the title are judgment and
 * belong to whoever is selling; the evidence, its quotes, the URLs it cites and
 * every per-unit figure come from the audit and the pricing file, and are not
 * editable here at any price. A document that lets you retype the evidence is
 * no longer evidence.
 */
const EDITABLE = ["openingProse", "timeline", "title"] as const;

export async function PATCH(request: Request, context: { params: Promise<{ token: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  try {
    const { token } = await context.params;
    const body = (await request.json()) as Partial<Record<(typeof EDITABLE)[number], unknown>>;

    const patch: Record<string, string> = {};
    if (typeof body.openingProse === "string") patch.openingProse = body.openingProse.slice(0, 4_000);
    if (typeof body.timeline === "string") patch.timeline = body.timeline.replace(/\s+/g, " ").trim().slice(0, 100);
    if (typeof body.title === "string") {
      const title = body.title.replace(/\s+/g, " ").trim().slice(0, 160);
      // The title heads the document, so an empty one is a mistake, not a clear.
      if (!title) return Response.json({ error: "A proposal needs a title." }, { status: 400 });
      patch.title = title;
    }
    if (!Object.keys(patch).length) {
      return Response.json({ error: `Nothing to change. Editable fields: ${EDITABLE.join(", ")}.` }, { status: 400 });
    }

    const db = await getDb();
    const [proposal] = await db.select().from(proposals).where(eq(proposals.token, token)).limit(1);
    if (!proposal) return Response.json({ error: "Proposal not found" }, { status: 404 });
    // An accepted proposal is a record of what was agreed, not a draft.
    if (proposal.status === "Accepted") {
      return Response.json({ error: "This proposal has been accepted and can no longer be edited." }, { status: 409 });
    }

    const [updated] = await db.update(proposals)
      .set({ ...patch, updatedAt: sql`CURRENT_TIMESTAMP` })
      .where(eq(proposals.id, proposal.id))
      .returning();
    return Response.json({ proposal: { token: updated.token, title: updated.title, timeline: updated.timeline, openingProse: updated.openingProse } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to update the proposal." }, { status: 500 });
  }
}
