import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, leads } from "@/db/schema";

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
  try {
    const { id: rawId } = await context.params;
    const id = Number(rawId);
    const body = (await request.json()) as { status?: string; notes?: string };
    if (!Number.isInteger(id)) {
      return Response.json({ error: "Invalid lead" }, { status: 400 });
    }
    const values: Record<string, unknown> = { updatedAt: sql`CURRENT_TIMESTAMP` };
    if (body.status && allowedStatuses.has(body.status)) values.status = body.status;
    if (typeof body.notes === "string") values.notes = body.notes.trim();
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
    return Response.json({ lead });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to update lead";
    return Response.json({ error: message }, { status: 500 });
  }
}
