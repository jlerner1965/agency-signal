import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, auditFindings, audits, leads, proposals, reportEvents } from "@/db/schema";
import { requireDashboardApi } from "@/app/dashboard-auth";
import { buildOpportunity } from "@/lib/opportunity";
import { nextSequenceDate, qualificationLabel, salesStages } from "@/lib/sales";

const allowedStatuses = new Set(salesStages);
const textFields = ["contactName", "email", "phone", "carrier", "businessObjective", "painPoint", "currentProvider", "decisionMaker", "budgetRange", "desiredTimeline", "nextCommittedStep", "objection", "lossReason"] as const;
const scoreFields = ["fitScore", "needScore", "intentScore", "urgencyScore", "reachabilityScore"] as const;
const googleIntegerFields = ["reviewCount", "googleReviewRecencyDays", "googleResponseRate", "googlePhotoCount", "googlePostRecencyDays", "googleProfileCompleteness"] as const;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  try {
    const { id: rawId } = await context.params;
    const id = Number(rawId);
    const body = (await request.json()) as Record<string, unknown>;
    if (!Number.isInteger(id)) {
      return Response.json({ error: "Invalid lead" }, { status: 400 });
    }
    const db = await getDb();
    const [currentLead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!currentLead) return Response.json({ error: "Lead not found" }, { status: 404 });
    const requestedStatus = typeof body.status === "string" && allowedStatuses.has(body.status) ? body.status : null;
    const textValue = (field: "businessObjective" | "painPoint" | "decisionMaker" | "nextCommittedStep" | "lossReason") => typeof body[field] === "string" ? body[field].trim() : currentLead[field];
    if (requestedStatus === "Audited" && !currentLead.score) return Response.json({ error: "Run the website audit before moving this prospect to Audited." }, { status: 400 });
    if (requestedStatus === "Qualified" && ["businessObjective", "painPoint", "decisionMaker", "nextCommittedStep"].some((field) => !textValue(field as "businessObjective" | "painPoint" | "decisionMaker" | "nextCommittedStep"))) {
      return Response.json({ error: "Record the objective, pain point, decision-maker, and next committed step before qualifying this deal." }, { status: 400 });
    }
    if (requestedStatus === "Proposal sent") {
      const [existingProposal] = await db.select({ id: proposals.id }).from(proposals).where(eq(proposals.leadId, id)).limit(1);
      if (!existingProposal) return Response.json({ error: "Generate the trackable proposal before moving to Proposal sent." }, { status: 400 });
    }
    const effectiveDealValue = body.dealValue !== undefined ? Number(body.dealValue) : currentLead.dealValue;
    if (requestedStatus === "Won" && effectiveDealValue <= 0) return Response.json({ error: "Record a deal value before marking the opportunity Won." }, { status: 400 });
    const effectiveLossReason = textValue("lossReason") || (typeof body.objection === "string" ? body.objection.trim() : currentLead.objection);
    if (requestedStatus === "Lost" && !effectiveLossReason) return Response.json({ error: "Record the objection or loss reason before closing this opportunity as Lost." }, { status: 400 });
    const values: Record<string, unknown> = { updatedAt: sql`CURRENT_TIMESTAMP` };
    if (requestedStatus) values.status = requestedStatus;
    if (requestedStatus === "Lost" && effectiveLossReason) values.lossReason = effectiveLossReason;
    if (typeof body.notes === "string") values.notes = body.notes.trim();
    for (const field of textFields) {
      if (typeof body[field] === "string") values[field] = body[field].trim();
    }
    for (const field of scoreFields) {
      if (body[field] !== undefined) values[field] = Math.max(0, Math.min(100, Math.round(Number(body[field]) || 0)));
    }
    if (typeof body.googleProfileUrl === "string") values.googleProfileUrl = body.googleProfileUrl.trim();
    if (typeof body.googlePrimaryCategory === "string") values.googlePrimaryCategory = body.googlePrimaryCategory.trim();
    if (body.rating !== undefined) values.rating = Math.max(0, Math.min(5, Number(body.rating) || 0));
    for (const field of googleIntegerFields) {
      if (body[field] !== undefined) values[field] = Math.max(0, Math.round(Number(body[field]) || 0));
    }
    if (body.googleNapConsistent !== undefined) values.googleNapConsistent = Boolean(body.googleNapConsistent);
    if (body.googlePresenceReviewed) values.googleReviewedAt = sql`CURRENT_TIMESTAMP`;
    if (body.dealValue !== undefined) values.dealValue = Math.max(0, Math.round(Number(body.dealValue) || 0));
    if (body.nextFollowUpAt === null || typeof body.nextFollowUpAt === "string") values.nextFollowUpAt = body.nextFollowUpAt || null;
    if (body.outreachOpened) {
      values.lastContactedAt = sql`CURRENT_TIMESTAMP`;
      values.status = "Contacted";
    }
    if (body.googlePresenceReviewed) {
      await db.insert(activities).values({ leadId: id, activityType: "google_presence_reviewed", description: "Google presence scorecard saved" });
    }
    if (requestedStatus && ["Replied", "Discovery scheduled", "Qualified", "Proposal sent", "Decision pending"].includes(requestedStatus)) values.sequenceStatus = "Paused";
    if (requestedStatus && ["Won", "Lost", "Nurture", "Disqualified"].includes(requestedStatus)) values.sequenceStatus = "Completed";
    if (body.sequenceAction === "start") {
      values.sequenceStatus = "Active";
      values.sequenceStep = 1;
      values.nextFollowUpAt = new Date().toISOString();
    }
    if (body.sequenceAction === "advance") {
      const nextStep = Math.min(5, currentLead.sequenceStep + 1);
      values.sequenceStep = nextStep;
      values.sequenceStatus = currentLead.sequenceStep >= 5 ? "Completed" : "Active";
      values.nextFollowUpAt = nextSequenceDate(nextStep);
    }
    const [lead] = await db
      .update(leads)
      .set(values)
      .where(eq(leads.id, id))
      .returning();
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
    const scoreChanged = scoreFields.some((field) => body[field] !== undefined);
    if (scoreChanged) {
      const label = qualificationLabel(lead);
      const [scoredLead] = await db.update(leads).set({ qualificationStatus: label, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(leads.id, id)).returning();
      Object.assign(lead, scoredLead);
      await db.insert(activities).values({ leadId: id, activityType: "qualification_updated", description: `Qualification updated · ${label}` });
    }
    if (typeof body.status === "string") {
      await db.insert(activities).values({
        leadId: id,
        activityType: "status_changed",
        description: `Sales stage changed to ${body.status}`,
      });
    }
    if (typeof body.notes === "string") {
      await db.insert(activities).values({ leadId: id, activityType: "notes_updated", description: "Sales notes updated" });
    }
    if (textFields.some((field) => typeof body[field] === "string")) {
      await db.insert(activities).values({ leadId: id, activityType: "contact_updated", description: "Contact details updated" });
    }
    if (body.nextFollowUpAt !== undefined) {
      const description = body.nextFollowUpAt
        ? `Follow-up scheduled for ${new Date(body.nextFollowUpAt).toLocaleString("en-US")}`
        : "Follow-up date cleared";
      await db.insert(activities).values({ leadId: id, activityType: "followup_scheduled", description });
    }
    if (body.outreachOpened) {
      await db.insert(activities).values({ leadId: id, activityType: "outreach_opened", description: "Personalized email opened in Gmail" });
    }
    if (body.sequenceAction === "start" || body.sequenceAction === "advance") {
      await db.insert(activities).values({ leadId: id, activityType: "sequence_updated", description: body.sequenceAction === "start" ? "Human-reviewed outreach sequence started" : `Outreach sequence advanced to step ${lead.sequenceStep}` });
    }
    return Response.json({ lead });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update lead";
    return Response.json({ error: message }, { status: 500 });
  }
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  const { id: rawId } = await context.params;
  const id = Number(rawId);
  if (!Number.isInteger(id)) return Response.json({ error: "Invalid lead" }, { status: 400 });
  try {
    const db = await getDb();
    const [lead] = await db.select().from(leads).where(eq(leads.id, id)).limit(1);
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
    const [latestAudit] = await db.select().from(audits).where(eq(audits.leadId, id)).orderBy(desc(audits.createdAt), desc(audits.id)).limit(1);
    const findings = latestAudit
      ? await db.select().from(auditFindings).where(eq(auditFindings.auditId, latestAudit.id)).orderBy(auditFindings.sortOrder)
      : [];
    const activityRows = await db.select().from(activities).where(eq(activities.leadId, id)).orderBy(desc(activities.createdAt), desc(activities.id)).limit(30);
    const eventRows = await db.select().from(reportEvents).where(eq(reportEvents.leadId, id)).orderBy(desc(reportEvents.createdAt), desc(reportEvents.id)).limit(30);
    const [proposal] = await db.select().from(proposals).where(eq(proposals.leadId, id)).orderBy(desc(proposals.createdAt), desc(proposals.id)).limit(1);
    const reportActivity = eventRows.map((event) => ({
      id: `report-${event.id}`,
      activityType: event.eventType,
      description: event.eventType === "report_viewed" ? "Opportunity brief viewed" : event.eventType.replaceAll("_", " "),
      createdAt: event.createdAt,
    }));
    const combined = [
      ...activityRows.map((row) => ({ ...row, id: `activity-${row.id}` })),
      ...reportActivity,
    ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 30);
    return Response.json({ activities: combined, audit: latestAudit ?? null, findings, opportunity: buildOpportunity(lead, findings), proposal: proposal ?? null });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load activity";
    return Response.json({ error: message }, { status: 500 });
  }
}
