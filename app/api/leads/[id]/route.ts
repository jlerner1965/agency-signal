import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, auditFindings, audits, leads, reportEvents } from "@/db/schema";
import { requireDashboardApi } from "@/app/dashboard-auth";
import { buildOpportunity } from "@/lib/opportunity";

const allowedStatuses = new Set([
  "New",
  "Audit ready",
  "Contacted",
  "Report viewed",
  "Follow-up due",
  "Meeting booked",
  "Won",
  "Lost",
]);

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  try {
    const { id: rawId } = await context.params;
    const id = Number(rawId);
    const body = (await request.json()) as { status?: string; notes?: string; nextFollowUpAt?: string | null; outreachOpened?: boolean; contactName?: string; email?: string; phone?: string; carrier?: string };
    if (!Number.isInteger(id)) {
      return Response.json({ error: "Invalid lead" }, { status: 400 });
    }
    const values: Record<string, unknown> = { updatedAt: sql`CURRENT_TIMESTAMP` };
    if (body.status && allowedStatuses.has(body.status)) values.status = body.status;
    if (typeof body.notes === "string") values.notes = body.notes.trim();
    for (const field of ["contactName", "email", "phone", "carrier"] as const) {
      if (typeof body[field] === "string") values[field] = body[field].trim();
    }
    if (body.nextFollowUpAt === null || typeof body.nextFollowUpAt === "string") values.nextFollowUpAt = body.nextFollowUpAt || null;
    if (body.outreachOpened) {
      values.lastContactedAt = sql`CURRENT_TIMESTAMP`;
      values.status = "Contacted";
    }
    const db = await getDb();
    const [lead] = await db
      .update(leads)
      .set(values)
      .where(eq(leads.id, id))
      .returning();
    if (!lead) return Response.json({ error: "Lead not found" }, { status: 404 });
    if (body.status) {
      await db.insert(activities).values({
        leadId: id,
        activityType: "status_changed",
        description: `Pipeline status changed to ${body.status}`,
      });
    }
    if (typeof body.notes === "string") {
      await db.insert(activities).values({ leadId: id, activityType: "notes_updated", description: "Sales notes updated" });
    }
    if ([body.contactName, body.email, body.phone, body.carrier].some((value) => typeof value === "string")) {
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
    return Response.json({ activities: combined, audit: latestAudit ?? null, findings, opportunity: buildOpportunity(lead, findings) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to load activity";
    return Response.json({ error: message }, { status: 500 });
  }
}
