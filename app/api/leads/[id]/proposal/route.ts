import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { requireDashboardApi } from "@/app/dashboard-auth";
import { getDb } from "@/db";
import { activities, auditRuns, findings as engineFindings, leads, mockups, proposals } from "@/db/schema";
import { buildOpportunity } from "@/lib/opportunity";
import { offerCatalog, offerForOpportunity } from "@/lib/sales";
import { buildGooglePresenceAudit } from "@/lib/google-presence";
import { buildRunMockups } from "@/lib/audit/deliverables";
import { normalizeSections, sectionOptions } from "@/lib/audit/proposal-sections";
import { findingsFromRun } from "@/lib/audit/run-summary";

function makeToken() { return crypto.randomUUID().replaceAll("-", ""); }
function cleanText(value: unknown, fallback: string, maximum: number) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return (text || fallback).slice(0, maximum);
}

/**
 * The same cleaning, except line breaks survive.
 *
 * A scope written as a list was stored as one line — \s+ does not distinguish a
 * newline from a space — and the document then printed eight numbered
 * priorities as a single unreadable paragraph. Runs of spaces within a line
 * still collapse; the line breaks the writer put in are theirs.
 */
function cleanBlock(value: unknown, fallback: string, maximum: number) {
  const text = String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[^\S\n]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
  return (text || fallback).slice(0, maximum);
}

/**
 * What a proposal built from this lead — rather than from an audit run — can
 * carry.
 *
 * Three of the parts are the run's to produce: the coverage table quotes the
 * pages the crawl read, the priced lines come from the pricing pass, and the
 * unmeasured list is the run's own account of what it could not check. This
 * path has none of them, and says so rather than offering a box that would
 * produce an empty section.
 *
 * The concept pages are the exception: they belong to the prospect, not to one
 * run, so this path can show pages an earlier run built and can ask the newest
 * finished run to build them now.
 */
async function leadSectionOptions(leadId: number, findingCount: number) {
  const db = await getDb();
  const built = await db.select().from(mockups).where(eq(mockups.leadId, leadId));
  const [run] = await db.select().from(auditRuns)
    .where(and(eq(auditRuns.leadId, leadId), isNotNull(auditRuns.finishedAt)))
    .orderBy(desc(auditRuns.id)).limit(1);

  const fromEngine = "Built by the audit engine — run it from the Audit engine tab and build the proposal there.";
  return sectionOptions({
    findings: findingCount,
    mockups: built.length,
    mockupsBuildable: Boolean(run),
    openingWritable: false,
    reasons: {
      opening: fromEngine,
      coverage: fromEngine,
      scope: fromEngine,
      unmeasured: fromEngine,
      evidence: "Nothing has been audited yet — run the website audit, or complete the Google presence review.",
      concepts: "No audit run has finished for this prospect, so there is nothing to build a concept page from.",
    },
  });
}

/**
 * The findings a proposal built from this lead can show: the newest finished
 * run's, in the older shape this path's document renders.
 *
 * It used to read the legacy `audits` table, which nothing has written since
 * the old scoring path was removed — so a prospect with a complete audit run
 * behind it offered no evidence at all.
 */
async function leadAuditFindings(leadId: number) {
  const db = await getDb();
  const [run] = await db.select().from(auditRuns)
    .where(and(eq(auditRuns.leadId, leadId), isNotNull(auditRuns.finishedAt)))
    .orderBy(desc(auditRuns.id)).limit(1);
  if (!run) return [];
  return findingsFromRun(await db.select().from(engineFindings)
    .where(eq(engineFindings.runId, run.id))
    .orderBy(engineFindings.sortOrder));
}

/** How many findings a proposal built from this lead would be able to show. */
async function leadFindingCount(leadId: number) {
  const db = await getDb();
  const stored = await leadAuditFindings(leadId);
  const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
  const google = lead ? buildGooglePresenceAudit(lead).findings.length : 0;
  // The document shows the strongest of each, capped: offering the box is
  // honest only about whether there is anything to show at all.
  return Math.min(stored.length, 2) + Math.min(google, 2);
}

/** The parts on offer, so the picker can be drawn before anything is built. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  const leadId = Number((await context.params).id);
  if (!Number.isInteger(leadId)) return Response.json({ error: "Invalid lead" }, { status: 400 });
  try {
    const options = await leadSectionOptions(leadId, await leadFindingCount(leadId));
    return Response.json({ sections: options });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to read this prospect." }, { status: 500 });
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  try {
    const { id: rawId } = await context.params;
    const leadId = Number(rawId);
    if (!Number.isInteger(leadId)) return Response.json({ error: "Invalid lead" }, { status: 400 });
    const body = (await request.json()) as { offerId?: string; price?: number; timeline?: string; title?: string; outcome?: string; scope?: string; deliverables?: string[]; sections?: unknown };
    const db = await getDb();
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
    const findings = await leadAuditFindings(leadId);
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
    const scope = cleanBlock(body.scope, defaultScope, 1_600);
    const deliverables = (Array.isArray(body.deliverables) ? body.deliverables : offer.deliverables)
      .map((item) => cleanText(item, "", 220)).filter(Boolean).slice(0, 10);
    if (!deliverables.length) deliverables.push(...offer.deliverables);
    const expiresAt = new Date(Date.now() + 14 * 86_400_000).toISOString();

    // Which parts of the document were ticked before this was generated.
    const options = await leadSectionOptions(leadId, await leadFindingCount(leadId));
    const sections = normalizeSections(body.sections === undefined ? null : body.sections, options);

    // Concept pages asked for and never built are built now, from the newest
    // finished run. A prospect whose site could not be read has none to build
    // from — that is reported, not silently dropped, but it does not take the
    // rest of the proposal down with it.
    let conceptNote = "";
    let mockupLinks: Array<{ kind: string; title: string; url: string }> = [];
    if (sections.includes("concepts")) {
      let built = await db.select().from(mockups).where(eq(mockups.leadId, leadId)).orderBy(desc(mockups.id));
      if (!built.length) {
        const [run] = await db.select().from(auditRuns)
          .where(and(eq(auditRuns.leadId, leadId), isNotNull(auditRuns.finishedAt)))
          .orderBy(desc(auditRuns.id)).limit(1);
        try {
          if (run) built = await buildRunMockups(run.id);
        } catch (reason) {
          conceptNote = reason instanceof Error ? reason.message : "The concept pages could not be built.";
        }
      }
      if (built.length) {
        // Newest run only. A prospect audited twice has two sets, and a
        // document showing both shows the old concept beside the new one.
        const newest = built[0].runId;
        mockupLinks = built.filter((mockup) => mockup.runId === newest)
          .map((mockup) => ({ kind: mockup.kind, title: mockup.title, url: `/mockup/${mockup.token}` }));
      } else if (!conceptNote) {
        conceptNote = "No concept pages exist for this prospect, so the proposal was built without them.";
      }
    }
    const stored = mockupLinks.length ? sections : sections.filter((id) => id !== "concepts");

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
      sections: JSON.stringify(stored),
      mockupLinks: JSON.stringify(mockupLinks),
      expiresAt,
    }).returning();
    const [updatedLead] = await db.update(leads).set({ status: "Proposal sent", dealValue: price, nextFollowUpAt: new Date(Date.now() + 2 * 86_400_000).toISOString(), updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(leads.id, leadId)).returning();
    await db.insert(activities).values({ leadId, activityType: "proposal_created", description: `${title} proposal created · $${price.toLocaleString("en-US")}` });
    return Response.json({ proposal, lead: updatedLead, sections: stored, note: conceptNote }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to create proposal" }, { status: 500 });
  }
}
