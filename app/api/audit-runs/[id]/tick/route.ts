import { getDb } from "@/db";
import { activities } from "@/db/schema";
import { requireDashboardApi } from "@/app/dashboard-auth";
import { tickAuditRun } from "@/lib/audit/runner";

/**
 * Advances a run by one module. The caller ticks until `pending` is false.
 * Safe to call concurrently: the runner claims a module atomically, so an
 * extra tick simply finds nothing to do.
 */
export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  const { id } = await context.params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid audit run." }, { status: 400 });

  try {
    const summary = await tickAuditRun(runId);
    // Only the tick that actually finalised the run writes the activity, so
    // repeated ticks after completion do not fill the timeline.
    if (summary.justFinished) {
      const score = summary.run.overallScore;
      const db = await getDb();
      await db.insert(activities).values({
        leadId: summary.run.leadId,
        activityType: "audit_run_finished",
        description: score === null
          ? `Audit run #${runId} finished without a score — ${summary.run.error || "the site could not be read"}`
          : `Audit run #${runId} finished · score ${score} · ${summary.findings.length} findings`,
      });
    }
    return Response.json(summary);
  } catch (error) {
    // A tick that throws must not wedge the run; the next tick retries.
    return Response.json({ error: error instanceof Error ? error.message : "The audit tick failed." }, { status: 500 });
  }
}
