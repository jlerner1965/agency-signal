import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditRunModules, auditRuns, findings as findingsTable, leads, rawPayloads } from "@/db/schema";
import { auditModules, missingRequirements, moduleById } from "@/lib/audit/registry";
import { categoryWeights, clampScore, confidenceOf, minimumConfidence, orderFindings } from "@/lib/audit/scoring-config";
import { runtimeValue } from "@/lib/runtime-env";
import { collectTechnical } from "@/lib/audit/collect-technical";
import { analyzeTechnical } from "@/lib/audit/analyze-technical";

export type ModuleOutcome = {
  status: "Complete" | "Skipped" | "Failed" | "Unreachable";
  message: string;
  findings: AuditFinding[];
  checks: AuditCheck[];
  costCents: number;
  payloadIds: number[];
};

export const severities = ["High", "Medium", "Low"] as const;
export type Severity = (typeof severities)[number];

export type AuditFinding = {
  category: string;
  severity: Severity;
  title: string;
  evidence: string;
  recommendation?: string;
  impactNote?: string;
  impactScore?: number;
  effortScore?: number;
  affectedUrl?: string;
};

export type AuditCheck = {
  id: string;
  category: string;
  label: string;
  status: "passed" | "failed" | "unverified";
  weight: number;
  earned: number;
  evidence: string;
};

export type StoredPayload = {
  source: string;
  requestKey: string;
  ok: boolean;
  failureReason?: string;
  payload: unknown;
};

const collectors: Record<string, (website: string, keys: Record<string, string>) => Promise<{
  payloads: StoredPayload[];
  costCents: number;
}>> = {
  technical: collectTechnical,
};

type RawAnalysis = {
  findings: Array<Omit<AuditFinding, "severity"> & { severity: string }>;
  checks: Array<Omit<AuditCheck, "status"> & { status: string }>;
  reachable: boolean;
  message: string;
};

const analyzers: Record<string, (payloads: StoredPayload[]) => RawAnalysis> = {
  technical: analyzeTechnical,
};

function isSeverity(value: string): value is Severity {
  return (severities as readonly string[]).includes(value);
}

/** Coerce a JS analyzer's output into the checked shape the runner stores. */
function normalizeAnalysis(analysis: RawAnalysis) {
  return {
    ...analysis,
    findings: analysis.findings.map((finding) => ({
      ...finding,
      severity: isSeverity(finding.severity) ? finding.severity : ("Medium" as Severity),
    })),
    checks: analysis.checks.map((check) => ({
      ...check,
      status: (["passed", "failed", "unverified"].includes(check.status) ? check.status : "unverified") as AuditCheck["status"],
    })),
  };
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Keys a module might need, read once per tick from the worker environment. */
async function availableKeys() {
  const names = ["PAGESPEED_API_KEY", "GOOGLE_PLACES_API_KEY", "SERP_API_KEY", "SERP_PROVIDER", "OPENAI_API_KEY"];
  const values = await Promise.all(names.map((name) => runtimeValue(name)));
  return Object.fromEntries(names.map((name, index) => [name, values[index]]));
}

export async function createAuditRun(leadId: number, website: string) {
  const db = await getDb();
  const [run] = await db.insert(auditRuns).values({ leadId, website, status: "Queued" }).returning();
  await db.insert(auditRunModules).values(auditModules.map((module) => ({
    runId: run.id,
    module: module.id,
    label: module.label,
    sortOrder: module.sortOrder,
    status: "Queued",
  })));
  return run;
}

/**
 * Claim exactly one queued module. The conditional update is the guard: two
 * concurrent ticks cannot both claim the same row, because the second one
 * matches zero rows and returns nothing.
 */
async function claimNextModule(runId: number) {
  const db = await getDb();
  const [candidate] = await db
    .select()
    .from(auditRunModules)
    .where(and(eq(auditRunModules.runId, runId), eq(auditRunModules.status, "Queued")))
    .orderBy(auditRunModules.sortOrder)
    .limit(1);
  if (!candidate) return null;
  const [claimed] = await db
    .update(auditRunModules)
    .set({ status: "Running", attempts: sql`${auditRunModules.attempts} + 1`, startedAt: sql`CURRENT_TIMESTAMP` })
    .where(and(eq(auditRunModules.id, candidate.id), eq(auditRunModules.status, "Queued")))
    .returning();
  return claimed ?? null;
}

/**
 * Reuse a payload already fetched for this request key today, so the same
 * target is never hit twice in one day and a re-score never needs a re-fetch.
 */
async function cachedPayload(requestKey: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(rawPayloads)
    .where(and(eq(rawPayloads.requestKey, requestKey), eq(rawPayloads.fetchedOn, today())))
    .orderBy(desc(rawPayloads.id))
    .limit(1);
  return row ?? null;
}

async function storePayloads(runId: number, moduleId: string, payloads: StoredPayload[]) {
  const db = await getDb();
  const ids: number[] = [];
  const reused: string[] = [];
  for (const payload of payloads) {
    const existing = await cachedPayload(payload.requestKey);
    if (existing) {
      ids.push(existing.id);
      reused.push(payload.source);
      continue;
    }
    const serialized = JSON.stringify(payload.payload ?? null);
    const [row] = await db.insert(rawPayloads).values({
      runId,
      module: moduleId,
      source: payload.source,
      requestKey: payload.requestKey,
      fetchedOn: today(),
      ok: payload.ok,
      failureReason: payload.failureReason ?? "",
      payload: serialized,
      bytes: serialized.length,
    }).returning();
    ids.push(row.id);
  }
  return { ids, reused };
}

async function loadPayloads(ids: number[]): Promise<StoredPayload[]> {
  if (!ids.length) return [];
  const db = await getDb();
  const rows = await db.select().from(rawPayloads).where(inArray(rawPayloads.id, ids));
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    if (!row) return [];
    let parsed: unknown = null;
    try { parsed = JSON.parse(row.payload); } catch { parsed = null; }
    return [{ source: row.source, requestKey: row.requestKey, ok: row.ok, failureReason: row.failureReason, payload: parsed }];
  });
}

async function runModule(runId: number, moduleId: string, website: string): Promise<ModuleOutcome> {
  const definition = moduleById(moduleId);
  if (!definition) {
    return { status: "Failed", message: `Unknown module ${moduleId}.`, findings: [], checks: [], costCents: 0, payloadIds: [] };
  }
  const keys = await availableKeys();
  const missing = missingRequirements(definition, keys);
  if (missing.length) {
    return {
      status: "Skipped",
      message: `Skipped: ${missing.join(", ")} not configured.`,
      findings: [], checks: [], costCents: 0, payloadIds: [],
    };
  }

  const collect = collectors[moduleId];
  const analyze = analyzers[moduleId];
  if (!collect || !analyze) {
    return { status: "Failed", message: `Module ${moduleId} has no implementation.`, findings: [], checks: [], costCents: 0, payloadIds: [] };
  }

  let collected;
  try {
    collected = await collect(website, keys);
  } catch (error) {
    // A collector that throws is a module failure, never a run failure.
    return {
      status: "Failed",
      message: error instanceof Error ? error.message : "Collection failed.",
      findings: [], checks: [], costCents: 0, payloadIds: [],
    };
  }

  const { ids, reused } = await storePayloads(runId, moduleId, collected.payloads);
  const analysis = normalizeAnalysis(analyze(collected.payloads));
  const note = reused.length ? ` Reused today's cached ${[...new Set(reused)].join(", ")}.` : "";
  return {
    // An unreachable site is its own status. It must never read as a low score.
    status: analysis.reachable ? "Complete" : "Unreachable",
    message: `${analysis.message}${note}`,
    findings: analysis.findings,
    checks: analysis.checks,
    // Cached payloads cost nothing the second time.
    costCents: reused.length ? 0 : collected.costCents,
    payloadIds: ids,
  };
}

/**
 * Advance a run by exactly one module. Returns the run's state so the caller
 * knows whether to tick again. Everything lives in D1, so a run resumes from
 * any later tick even if the browser that started it is gone.
 */
export async function tickAuditRun(runId: number) {
  const db = await getDb();
  const [run] = await db.select().from(auditRuns).where(eq(auditRuns.id, runId)).limit(1);
  if (!run) throw new Error("Audit run not found.");
  if (run.status === "Complete" || run.status === "Complete with gaps" || run.status === "Failed") {
    return summarizeRun(runId);
  }

  if (run.status === "Queued") {
    await db.update(auditRuns).set({ status: "Running", startedAt: sql`CURRENT_TIMESTAMP`, updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(auditRuns.id, runId));
  }

  const claimed = await claimNextModule(runId);
  if (!claimed) return finalizeRun(runId);

  const outcome = await runModule(runId, claimed.module, run.website);
  const ordered = orderFindings(outcome.findings);

  if (ordered.length) {
    await db.insert(findingsTable).values(ordered.map((finding) => ({
      runId,
      module: claimed.module,
      category: finding.category,
      severity: finding.severity,
      title: finding.title,
      evidence: finding.evidence,
      recommendation: finding.recommendation ?? "",
      impactNote: finding.impactNote ?? "",
      impactScore: finding.impactScore,
      effortScore: finding.effortScore,
      priority: finding.priority,
      affectedUrl: finding.affectedUrl ?? "",
      sortOrder: finding.sortOrder,
    })));
  }

  await db.update(auditRunModules).set({
    status: outcome.status,
    message: outcome.message.slice(0, 500),
    costCents: outcome.costCents,
    findingCount: ordered.length,
    payloadIds: JSON.stringify(outcome.payloadIds),
    finishedAt: sql`CURRENT_TIMESTAMP`,
  }).where(eq(auditRunModules.id, claimed.id));

  const [remaining] = await db
    .select({ count: sql<number>`count(*)` })
    .from(auditRunModules)
    .where(and(eq(auditRunModules.runId, runId), eq(auditRunModules.status, "Queued")));

  if (Number(remaining?.count ?? 0) > 0) {
    await db.update(auditRuns).set({ updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(auditRuns.id, runId));
    return summarizeRun(runId);
  }
  return finalizeRun(runId);
}

/**
 * Score the run from its stored checks. A run where nothing could be verified
 * finishes with a null score and an explicit reason — never a zero.
 */
async function finalizeRun(runId: number) {
  const db = await getDb();
  const moduleRows = await db.select().from(auditRunModules).where(eq(auditRunModules.runId, runId)).orderBy(auditRunModules.sortOrder);
  const payloadIds = moduleRows.flatMap((row) => {
    try { return JSON.parse(row.payloadIds) as number[]; } catch { return []; }
  });
  const payloads = await loadPayloads(payloadIds);

  const checks: AuditCheck[] = [];
  for (const row of moduleRows) {
    const analyze = analyzers[row.module];
    if (!analyze || row.status === "Skipped" || row.status === "Failed") continue;
    const modulePayloads = payloads.filter((payload) => payload.requestKey.startsWith(`${row.module}:`));
    try { checks.push(...normalizeAnalysis(analyze(modulePayloads)).checks); } catch { /* a module that cannot re-analyze contributes nothing */ }
  }

  const byCategory = new Map<string, AuditCheck[]>();
  for (const check of checks) {
    byCategory.set(check.category, [...(byCategory.get(check.category) ?? []), check]);
  }

  const subscores: Record<string, number | null> = {};
  for (const category of Object.keys(categoryWeights)) {
    const group = (byCategory.get(category) ?? []).filter((check) => check.status !== "unverified");
    const available = group.reduce((sum, check) => sum + check.weight, 0);
    subscores[category] = available ? clampScore((group.reduce((sum, check) => sum + check.earned, 0) / available) * 100) : null;
  }

  const scored = Object.entries(categoryWeights).filter(([category]) => subscores[category] !== null);
  const weightUsed = scored.reduce((sum, [, weight]) => sum + weight, 0);
  const weighted = weightUsed
    ? clampScore(scored.reduce((sum, [category, weight]) => sum + (subscores[category] as number) * weight, 0) / weightUsed)
    : null;

  // Too little of the rubric verified is its own kind of "no result". Reporting
  // 100 from six of sixteen checks would be worse than reporting nothing.
  const confidence = confidenceOf(checks);
  const checksVerified = checks.filter((check) => check.status !== "unverified").length;
  const underMeasured = weighted !== null && confidence < minimumConfidence;
  const overall = underMeasured ? null : weighted;

  const unreachable = moduleRows.some((row) => row.status === "Unreachable");
  const incomplete = moduleRows.some((row) => ["Skipped", "Failed", "Unreachable"].includes(row.status));
  const allFailed = moduleRows.every((row) => ["Failed", "Unreachable"].includes(row.status));

  const underMeasuredNote = `Only ${confidence}% of the audit rubric could be verified (${checksVerified} of ${checks.length} checks), below the ${minimumConfidence}% needed to report a score. Configure PAGESPEED_API_KEY, or re-run when the unavailable sources respond.`;

  const [run] = await db.update(auditRuns).set({
    status: allFailed ? "Failed" : incomplete || underMeasured ? "Complete with gaps" : "Complete",
    overallScore: overall,
    visibilityScore: underMeasured ? null : subscores.Visibility,
    conversionScore: underMeasured ? null : subscores.Conversion,
    technicalScore: underMeasured ? null : subscores.Technical,
    trustScore: underMeasured ? null : subscores.Trust,
    reachable: !unreachable,
    confidence,
    checksVerified,
    checksTotal: checks.length,
    costCents: moduleRows.reduce((sum, row) => sum + row.costCents, 0),
    error: allFailed
      ? moduleRows.find((row) => row.message)?.message ?? "No module produced a result."
      : underMeasured ? underMeasuredNote : "",
    finishedAt: sql`CURRENT_TIMESTAMP`,
    updatedAt: sql`CURRENT_TIMESTAMP`,
  }).where(eq(auditRuns.id, runId)).returning();

  // Only a genuinely scored run may touch the prospect's headline numbers.
  if (overall !== null) {
    await db.update(leads).set({
      score: overall,
      technicalScore: subscores.Technical ?? sql`${leads.technicalScore}`,
      lastAuditAt: sql`CURRENT_TIMESTAMP`,
      updatedAt: sql`CURRENT_TIMESTAMP`,
    }).where(eq(leads.id, run.leadId));
  }

  return { ...(await summarizeRun(runId)), justFinished: true };
}

export async function summarizeRun(runId: number) {
  const db = await getDb();
  const [run] = await db.select().from(auditRuns).where(eq(auditRuns.id, runId)).limit(1);
  if (!run) throw new Error("Audit run not found.");
  const modules = await db.select().from(auditRunModules).where(eq(auditRunModules.runId, runId)).orderBy(auditRunModules.sortOrder);
  const runFindings = await db.select().from(findingsTable).where(eq(findingsTable.runId, runId)).orderBy(findingsTable.sortOrder);
  const pending = modules.some((module) => module.status === "Queued" || module.status === "Running");
  return { run, modules, findings: runFindings, pending, justFinished: false };
}
