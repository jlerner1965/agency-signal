import { requireDashboardApi } from "@/app/dashboard-auth";
import { readRunPackage } from "@/lib/audit/deliverables";

/**
 * What a run has already been packaged into. Nothing is built here.
 *
 * Opening a past run fetched its summary alone, so a run that had already been
 * packaged came back with no proposal link, no recommendations and no concept
 * pages — indistinguishable from one that had never been built. The obvious
 * next move was to press Build again, which wrote a new proposal version and,
 * before the concepts were rebuilt in place, reissued the links inside the
 * document that had already been sent.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  const runId = Number((await context.params).id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid audit run." }, { status: 400 });
  try {
    return Response.json(await readRunPackage(runId));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to read this run's package." }, { status: 400 });
  }
}
