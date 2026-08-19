import { requireDashboardApi } from "@/app/dashboard-auth";
import { summarizeRun } from "@/lib/audit/runner";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  const { id } = await context.params;
  const runId = Number(id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid audit run." }, { status: 400 });
  try {
    return Response.json(await summarizeRun(runId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to load the audit run." }, { status: 404 });
  }
}
