import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, leads, reportEvents } from "@/db/schema";
import { getLeadByToken } from "@/lib/server-data";

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await context.params;
    const report = await getLeadByToken(token);
    if (!report) return Response.json({ error: "Report not found" }, { status: 404 });

    const body = (await request.json()) as Record<string, unknown>;
    const name = String(body.name ?? "").trim().slice(0, 100);
    const email = String(body.email ?? "").trim().toLowerCase().slice(0, 180);
    const message = String(body.message ?? "").trim().slice(0, 1000);
    if (!name || !/^\S+@\S+\.\S+$/.test(email)) {
      return Response.json({ error: "Your name and a valid email are required." }, { status: 400 });
    }

    const db = await getDb();
    const note = `Review requested by ${name} (${email})${message ? `: ${message}` : ""}`;
    await db.batch([
      db.insert(reportEvents).values({
        leadId: report.lead.id,
        eventType: "review_requested",
        metadata: JSON.stringify({ name, email, message }),
      }),
      db.insert(activities).values({
        leadId: report.lead.id,
        activityType: "review_requested",
        description: note,
      }),
      db
        .update(leads)
        .set({
          email: report.lead.email || email,
          contactName: report.lead.contactName || name,
          status: "Discovery scheduled",
          notes: report.lead.notes ? `${note}\n\n${report.lead.notes}` : note,
          updatedAt: sql`CURRENT_TIMESTAMP`,
        })
        .where(eq(leads.id, report.lead.id)),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to send request";
    return Response.json({ error: message }, { status: 500 });
  }
}
