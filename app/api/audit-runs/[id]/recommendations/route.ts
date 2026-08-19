import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { recommendations } from "@/db/schema";
import { requireDashboardApi } from "@/app/dashboard-auth";
import { buildRunRecommendations } from "@/lib/audit/deliverables";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  const runId = Number((await context.params).id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid audit run." }, { status: 400 });
  try {
    return Response.json({ recommendations: await buildRunRecommendations(runId) }, { status: 201 });
  } catch (error) {
    // The evidence gate failing is a refusal to render, not a server fault.
    return Response.json({ error: error instanceof Error ? error.message : "Unable to build recommendations." }, { status: 400 });
  }
}

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  const runId = Number((await context.params).id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid audit run." }, { status: 400 });
  const db = await getDb();
  const rows = await db.select().from(recommendations).where(eq(recommendations.runId, runId)).orderBy(recommendations.sortOrder);
  return Response.json({ recommendations: rows });
}
