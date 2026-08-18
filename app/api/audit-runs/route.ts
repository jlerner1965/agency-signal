import { desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, auditRuns, leads } from "@/db/schema";
import { requireDashboardApi } from "@/app/dashboard-auth";
import { createAuditRun, summarizeRun } from "@/lib/audit/runner";
import { safeAuditUrl } from "@/lib/website-inspection";

export async function POST(request: Request) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { leadId?: number };
    const leadId = Number(body.leadId);
    if (!Number.isInteger(leadId)) return Response.json({ error: "A prospect is required." }, { status: 400 });

    const db = await getDb();
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) return Response.json({ error: "Prospect not found." }, { status: 404 });

    let website: string;
    try {
      website = safeAuditUrl(lead.website).toString();
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "That website cannot be audited." }, { status: 400 });
    }

    const run = await createAuditRun(leadId, website);
    await db.insert(activities).values({
      leadId,
      activityType: "audit_run_started",
      description: `Audit run #${run.id} queued for ${website}`,
    });
    return Response.json(await summarizeRun(run.id), { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to start the audit run." }, { status: 500 });
  }
}

export async function GET(request: Request) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  const leadId = Number(new URL(request.url).searchParams.get("leadId"));
  if (!Number.isInteger(leadId)) return Response.json({ error: "A prospect is required." }, { status: 400 });
  const db = await getDb();
  const runs = await db.select().from(auditRuns).where(eq(auditRuns.leadId, leadId)).orderBy(desc(auditRuns.id)).limit(10);
  return Response.json({ runs });
}
