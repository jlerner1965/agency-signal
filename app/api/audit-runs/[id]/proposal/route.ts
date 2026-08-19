import { requireDashboardApi } from "@/app/dashboard-auth";
import { buildRunProposal, pricing, pricingIsPlaceholder, voiceSample } from "@/lib/audit/deliverables";

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  const runId = Number((await context.params).id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid audit run." }, { status: 400 });
  try {
    const proposal = await buildRunProposal(runId);
    const config = pricing();
    const voice = await voiceSample();
    return Response.json({
      proposal,
      scopeItems: JSON.parse(proposal.scopeItems || "[]"),
      retainer: proposal.retainer ? JSON.parse(proposal.retainer) : null,
      // Nothing is exportable while either input is still a placeholder, and
      // the reason is stated rather than left for the reader to discover.
      blockers: [
        pricingIsPlaceholder(config) ? "config/pricing.json still holds placeholder amounts." : "",
        voice.placeholder ? "config/voice.md has not been filled in, so no opening was written." : "",
        // An audit that found nothing specific enough to open with is a signal
        // not to send, so it blocks export the same way a placeholder does.
        proposal.openingBlocked || "",
      ].filter(Boolean),
      openingSource: proposal.openingSource,
    }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to build the proposal." }, { status: 400 });
  }
}
