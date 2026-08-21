import { requireDashboardApi } from "@/app/dashboard-auth";
import { buildRunProposal, pricing, pricingIsPlaceholder, voiceSample } from "@/lib/audit/deliverables";
import { carries, readSections } from "@/lib/audit/proposal-sections";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  const runId = Number((await context.params).id);
  if (!Number.isInteger(runId)) return Response.json({ error: "Invalid audit run." }, { status: 400 });
  try {
    // The operator's chosen findings, when they narrowed the selection. Absent
    // means everything the run found, which is what the button did before.
    const body = (await request.json().catch(() => ({}))) as { findingIds?: unknown; sections?: unknown };
    const findingIds = Array.isArray(body.findingIds)
      ? body.findingIds.map(Number).filter(Number.isInteger)
      : null;
    // Which parts of the document they ticked. Absent means every part this run
    // can fill; an empty array is a deliberate choice of none of the optional
    // ones, and is kept as one.
    const sections = Array.isArray(body.sections) ? body.sections.map(String) : null;
    const { proposal, conceptsBlocked } = await buildRunProposal(runId, findingIds, sections);
    const config = pricing();
    const voice = await voiceSample();
    const built = readSections(proposal.sections);
    // A document with no opening in it is not held back by an unwritten one.
    const wantsOpening = carries(built, "opening");
    return Response.json({
      proposal,
      scopeItems: JSON.parse(proposal.scopeItems || "[]"),
      sections: built,
      retainer: proposal.retainer ? JSON.parse(proposal.retainer) : null,
      // Nothing is exportable while either input is still a placeholder, and
      // the reason is stated rather than left for the reader to discover.
      blockers: [
        pricingIsPlaceholder(config) ? "config/pricing.json still holds placeholder amounts." : "",
        wantsOpening && voice.placeholder ? "config/voice.md has not been filled in, so no opening was written." : "",
        // An audit that found nothing specific enough to open with is a signal
        // not to send, so it blocks export the same way a placeholder does.
        proposal.openingBlocked || "",
        // Concept pages were asked for and could not be built. Said here rather
        // than left for the operator to notice by reading the document.
        conceptsBlocked || "",
      ].filter(Boolean),
      openingSource: proposal.openingSource,
    }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to build the proposal." }, { status: 400 });
  }
}
