import { desc, eq, and, sql } from "drizzle-orm";
import { requireDashboardApi } from "@/app/dashboard-auth";
import { getDb } from "@/db";
import { activities, aiRuns, auditFindings, audits, leads, proposals } from "@/db/schema";
import { buildOpportunity } from "@/lib/opportunity";
import { buildCopilotEvidence, buildCopilotPrompt, copilotActions, copilotResponseSchema, extractResponseText, groundCopilotResult } from "@/lib/copilot";

const statuses = new Set(["Approved", "Discarded"]);

function jsonError(error: unknown, fallback: string, status = 500) {
  return Response.json({ error: error instanceof Error ? error.message : fallback }, { status });
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  try {
    const { id: rawId } = await context.params;
    const leadId = Number(rawId);
    if (!Number.isInteger(leadId)) return jsonError(new Error("Invalid lead"), "Invalid lead", 400);
    const body = (await request.json()) as { action?: string; additionalContext?: string };
    if (!body.action || !copilotActions.includes(body.action)) return jsonError(new Error("Choose a valid copilot action"), "Invalid action", 400);
    const additionalContext = typeof body.additionalContext === "string" ? body.additionalContext.trim().slice(0, 1200) : "";
    const db = await getDb();
    const [lead] = await db.select().from(leads).where(eq(leads.id, leadId)).limit(1);
    if (!lead) return jsonError(new Error("Lead not found"), "Lead not found", 404);
    const [audit] = await db.select().from(audits).where(eq(audits.leadId, leadId)).orderBy(desc(audits.createdAt), desc(audits.id)).limit(1);
    const findings = audit ? await db.select().from(auditFindings).where(eq(auditFindings.auditId, audit.id)).orderBy(auditFindings.sortOrder).limit(8) : [];
    const activityRows = await db.select().from(activities).where(eq(activities.leadId, leadId)).orderBy(desc(activities.createdAt), desc(activities.id)).limit(10);
    const [proposal] = await db.select().from(proposals).where(eq(proposals.leadId, leadId)).orderBy(desc(proposals.createdAt), desc(proposals.id)).limit(1);
    const evidence = buildCopilotEvidence({ lead, findings, activities: activityRows, opportunity: buildOpportunity(lead, findings), proposal: proposal ?? null });
    const { env } = await import("cloudflare:workers");
    const runtime = env as unknown as Record<string, string | undefined>;
    const apiKey = runtime.OPENAI_API_KEY;
    if (!apiKey) return Response.json({ error: "AI Copilot is installed but needs an OpenAI API key in the site's secure environment." }, { status: 503 });
    const model = runtime.OPENAI_MODEL || "gpt-5.4-nano";
    const aiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: "low" },
        max_output_tokens: 1800,
        input: [
          { role: "developer", content: "You are AgencySignal's evidence-grounded sales copilot. Return practical work for a human seller to review. Follow the schema exactly." },
          { role: "user", content: buildCopilotPrompt(body.action, evidence, additionalContext) },
        ],
        text: { format: { type: "json_schema", name: "agency_signal_copilot", strict: true, schema: copilotResponseSchema } },
      }),
    });
    const aiPayload = await aiResponse.json() as Record<string, unknown>;
    if (!aiResponse.ok) {
      const detail = (aiPayload.error as { message?: string } | undefined)?.message;
      throw new Error(detail || "OpenAI could not generate this result");
    }
    const parsed = JSON.parse(extractResponseText(aiPayload));
    const grounded = groundCopilotResult(parsed, evidence);
    const [run] = await db.insert(aiRuns).values({ leadId, action: body.action, model, status: "Draft", result: JSON.stringify(grounded) }).returning();
    await db.insert(activities).values({ leadId, activityType: "ai_copilot_generated", description: `AI Copilot generated a ${body.action.replaceAll("_", " ")} draft for human review` });
    return Response.json({ result: { ...grounded, runId: run.id, action: body.action } });
  } catch (error) {
    return jsonError(error, "Unable to generate copilot result");
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  try {
    const { id: rawId } = await context.params;
    const leadId = Number(rawId);
    const body = (await request.json()) as { runId?: number; status?: string };
    const runId = Number(body.runId);
    if (!Number.isInteger(leadId) || !Number.isInteger(runId) || !body.status || !statuses.has(body.status)) return jsonError(new Error("Invalid copilot update"), "Invalid update", 400);
    const db = await getDb();
    const [run] = await db.update(aiRuns).set({ status: body.status, updatedAt: sql`CURRENT_TIMESTAMP` }).where(and(eq(aiRuns.id, runId), eq(aiRuns.leadId, leadId))).returning();
    if (!run) return jsonError(new Error("Copilot draft not found"), "Not found", 404);
    await db.insert(activities).values({ leadId, activityType: `ai_copilot_${body.status.toLowerCase()}`, description: `Human ${body.status.toLowerCase()} the AI Copilot ${run.action.replaceAll("_", " ")} draft` });
    return Response.json({ status: run.status });
  } catch (error) {
    return jsonError(error, "Unable to update copilot draft");
  }
}
