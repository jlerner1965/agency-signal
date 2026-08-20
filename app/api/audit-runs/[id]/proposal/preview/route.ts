import { requireDashboardApi } from "@/app/dashboard-auth";
import { previewRunProposal } from "@/lib/audit/deliverables";

/**
 * What a chosen set of findings would cost. Nothing is written: the operator
 * moves the selection and watches the scope follow, and only building the
 * proposal stores anything.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  const runId = Number((await context.params).id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid audit run." }, { status: 400 });

  try {
    const body = (await request.json().catch(() => ({}))) as { findingIds?: unknown };
    const findingIds = Array.isArray(body.findingIds)
      ? body.findingIds.map(Number).filter(Number.isInteger)
      : null;
    return Response.json(await previewRunProposal(runId, findingIds));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to price that selection." }, { status: 400 });
  }
}
