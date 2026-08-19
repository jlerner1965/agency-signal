import { requireDashboardApi } from "@/app/dashboard-auth";
import { buildRunMockups } from "@/lib/audit/deliverables";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  const runId = Number((await context.params).id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid audit run." }, { status: 400 });
  try {
    const built = await buildRunMockups(runId);
    return Response.json({
      mockups: built.map((mockup) => ({
        id: mockup.id, kind: mockup.kind, title: mockup.title, token: mockup.token,
        url: `/mockup/${mockup.token}`, brandTokens: JSON.parse(mockup.brandTokens),
      })),
    }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to build mockups." }, { status: 400 });
  }
}
