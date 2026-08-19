import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { auditRunModules, auditRuns, findings as findingsTable, leads, rawPayloads } from "@/db/schema";
import { auditModules, missingRequirements, moduleById } from "@/lib/audit/registry";
import { backoffSeconds, categoryWeights, clampScore, confidenceOf, minimumConfidence, orderFindings, scopedChecks, unverifiedReasons } from "@/lib/audit/scoring-config";
import { runtimeValue } from "@/lib/runtime-env";
import { collectTechnical } from "@/lib/audit/collect-technical";
import { analyzeTechnical } from "@/lib/audit/analyze-technical";
import { collectServiceLines } from "@/lib/audit/collect-service-lines";
import { analyzeServiceLines } from "@/lib/audit/analyze-service-lines";
import { collectGoogle } from "@/lib/audit/collect-google";
import { analyzeGooglePresence } from "@/lib/audit/analyze-google";
import { collectOnPage } from "@/lib/audit/collect-onpage";
import { analyzeSeo } from "@/lib/audit/analyze-seo";
import { analyzeConversion } from "@/lib/audit/analyze-conversion";

export type ModuleOutcome = {
  status: "Complete" | "Skipped" | "Failed" | "Unreachable" | "Retrying";
  message: string;
  findings: AuditFinding[];
  checks: AuditCheck[];
  costCents: number;
  payloadIds: number[];
  /** Set when the outcome is Retrying: seconds to wait before the next attempt. */
  retryInSeconds?: number;
  retryReason?: string;
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
  /** Why an unverified check could not be measured. Clients read these differently. */
  unverifiedReason?: string;
};

export type StoredPayload = {
  source: string;
  requestKey: string;
  ok: boolean;
  /** A throttle or transport error worth another attempt, not a verdict. */
  retryable?: boolean;
  failureReason?: string;
  payload: unknown;
};

/** Returns today's stored payload for a request key, or null to go fetch it. */
export type CacheLookup = (requestKey: string) => Promise<StoredPayload | null>;

/** What a collector is given: the target plus the prospect record behind it. */
export type CollectContext = {
  website: string;
  lead: Record<string, unknown>;
};

export type CollectResult = {
  payloads: StoredPayload[];
  costCents: number;
  networkCalls: number;
  keyed?: boolean;
};

const collectors: Record<string, (context: CollectContext, keys: Record<string, string>, cached: CacheLookup) => Promise<CollectResult>> = {
  technical: collectTechnical,
  "service-lines": collectServiceLines,
  google: collectGoogle,
  seo: collectOnPage,
  conversion: collectOnPage,
};

type RawAnalysis = {
  findings: Array<Omit<AuditFinding, "severity"> & { severity: string }>;
  checks: Array<Omit<AuditCheck, "status"> & { status: string }>;
  reachable: boolean;
  message: string;
};

/**
 * Analyzers are untyped JS modules and may return module-specific extras the
 * runner does not read. The cast is safe because normalizeAnalysis validates
 * severity and status at runtime before anything is stored.
 */
type Analyzer = (payloads: StoredPayload[]) => RawAnalysis;

const analyzers: Record<string, Analyzer> = {
  technical: analyzeTechnical as Analyzer,
  "service-lines": analyzeServiceLines as Analyzer,
  google: analyzeGooglePresence as Analyzer,
  seo: analyzeSeo as Analyzer,
  conversion: analyzeConversion as Analyzer,
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

/**
 * SQLite writes timestamps as "YYYY-MM-DD HH:MM:SS" in UTC. JavaScript parses
 * that shape as local time, so it is made explicit before it reaches a client.
 */
function toIso(value: string | null | undefined) {
  if (!value) return null;
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? `${value.replace(" ", "T")}Z` : value;
}

/** Keys a module might need, read once per tick from the worker environment. */
async function availableKeys() {
  const names = ["PAGESPEED_API_KEY", "GOOGLE_PLACES_API_KEY", "OPENAI_API_KEY"];
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
    .where(and(
      eq(auditRunModules.runId, runId),
      eq(auditRunModules.status, "Queued"),
      // A module inside its backoff window is not claimable yet.
      sql`(${auditRunModules.retryAfter} IS NULL OR ${auditRunModules.retryAfter} <= datetime('now'))`,
    ))
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

function cacheLookupFor(): CacheLookup {
  return async (requestKey: string) => {
    const row = await cachedPayload(requestKey);
    // A cached failure is not reused: a throttled source deserves a real retry.
    if (!row || !row.ok) return null;
    let parsed: unknown = null;
    try { parsed = JSON.parse(row.payload); } catch { return null; }
    return { source: row.source, requestKey: row.requestKey, ok: true, retryable: false, failureReason: "", payload: parsed };
  };
}

async function storePayloads(runId: number, moduleId: string, payloads: StoredPayload[]) {
  const db = await getDb();
  const ids: number[] = [];
  const reused: string[] = [];
  for (const payload of payloads) {
    // Only a successful payload is deduplicated. Each failed attempt is stored
    // on its own so the retry history stays readable, and so a stale failure
    // reason never stands in for a fresh one.
    const existing = payload.ok ? await cachedPayload(payload.requestKey) : null;
    if (existing && existing.ok) {
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

async function runModule(runId: number, moduleId: string, context: CollectContext, attempts: number, maxAttempts: number): Promise<ModuleOutcome> {
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
    collected = await collect(context, keys, cacheLookupFor());
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

  // A throttled or flaky source is worth another attempt before it is written
  // off as unmeasurable. The site refusing us outright is not.
  const retryable = collected.payloads.filter((payload) => !payload.ok && payload.retryable);
  if (retryable.length && attempts < maxAttempts) {
    const reason = retryable[0].failureReason ?? "A source failed transiently.";
    return {
      status: "Retrying",
      message: `Attempt ${attempts} of ${maxAttempts} deferred: ${reason}`,
      findings: [], checks: [],
      costCents: collected.costCents,
      payloadIds: ids,
      retryInSeconds: backoffSeconds(attempts),
      retryReason: reason,
    };
  }

  const exhausted = retryable.length > 0;
  const exhaustedNote = exhausted
    ? ` Gave up on ${[...new Set(retryable.map((payload) => payload.source))].join(", ")} after ${maxAttempts} attempts; the checks they feed are reported as not measured.`
    : "";

  const reason = exhausted ? unverifiedReasons.RETRIES_EXHAUSTED : unverifiedReasons.SOURCE_UNAVAILABLE;
  const checks = analysis.checks.map((check) => {
    if (check.status !== "unverified") return check;
    if (!analysis.reachable) return { ...check, unverifiedReason: unverifiedReasons.HOST_UNREACHABLE };
    // An analyser that already said why keeps its reason. Overwriting it turned
    // "nothing on the page to measure" into "the source was unavailable", which
    // is a different thing to tell a client and now also scores differently.
    return { ...check, unverifiedReason: check.unverifiedReason ?? reason };
  });

  return {
    // An unreachable site is its own status. It must never read as a low score.
    status: analysis.reachable ? "Complete" : "Unreachable",
    message: `${analysis.message}${note}${exhaustedNote}`,
    findings: analysis.findings,
    checks,
    costCents: collected.costCents,
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
  if (!claimed) {
    // Nothing claimable is not the same as nothing left: a module inside its
    // backoff window still has work to do.
    const [waiting] = await db
      .select()
      .from(auditRunModules)
      .where(and(eq(auditRunModules.runId, runId), eq(auditRunModules.status, "Queued")))
      .orderBy(auditRunModules.retryAfter)
      .limit(1);
    if (waiting) return { ...(await summarizeRun(runId)), waitingFor: toIso(waiting.retryAfter), waitingReason: waiting.retryReason };
    return finalizeRun(runId);
  }

  const [leadRow] = await db.select().from(leads).where(eq(leads.id, run.leadId)).limit(1);
  const outcome = await runModule(runId, claimed.module, { website: run.website, lead: leadRow ?? {} }, claimed.attempts, claimed.maxAttempts);

  // A retryable failure goes back on the queue rather than ending the module.
  if (outcome.status === "Retrying") {
    const delay = Math.max(1, Math.round(outcome.retryInSeconds ?? 5));
    const [requeued] = await db.update(auditRunModules).set({
      status: "Queued",
      message: outcome.message.slice(0, 500),
      costCents: sql`${auditRunModules.costCents} + ${outcome.costCents}`,
      payloadIds: JSON.stringify(outcome.payloadIds),
      retryAfter: sql`datetime('now', ${`+${delay} seconds`})`,
      retryReason: (outcome.retryReason ?? "").slice(0, 300),
    }).where(eq(auditRunModules.id, claimed.id)).returning();
    await db.update(auditRuns).set({ updatedAt: sql`CURRENT_TIMESTAMP` }).where(eq(auditRuns.id, runId));
    return {
      ...(await summarizeRun(runId)),
      waitingFor: toIso(requeued?.retryAfter),
      waitingReason: outcome.retryReason ?? "",
    };
  }

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
    costCents: sql`${auditRunModules.costCents} + ${outcome.costCents}`,
    findingCount: ordered.length,
    payloadIds: JSON.stringify(outcome.payloadIds),
    // Stored, not recomputed, so an unmeasured check can be shown as a gap.
    checkSummary: JSON.stringify(outcome.checks),
    retryAfter: null,
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

  // Checks were stored when each module ran, so scoring reads exactly what was
  // measured rather than re-deriving it from payloads.
  const checks: AuditCheck[] = moduleRows.flatMap((row) => {
    try { return JSON.parse(row.checkSummary) as AuditCheck[]; } catch { return []; }
  });

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
  // The counts shown beside the percentage describe the same rubric it is a
  // share of. Checks whose source was never in scope for this run are still
  // listed and still say why, but counting them in the denominator would
  // report a fraction the percentage is not derived from.
  const scoped = scopedChecks(checks);
  const checksVerified = scoped.filter((check) => check.status !== "unverified").length;
  const underMeasured = weighted !== null && confidence < minimumConfidence;
  const overall = underMeasured ? null : weighted;

  const unreachable = moduleRows.some((row) => row.status === "Unreachable");
  const incomplete = moduleRows.some((row) => ["Skipped", "Failed", "Unreachable"].includes(row.status));
  const allFailed = moduleRows.every((row) => ["Failed", "Unreachable"].includes(row.status));

  // Each module numbers its own findings, so the run-level list has to be
  // re-ranked or the top of a report is whatever the first module found.
  const runFindings = await db.select().from(findingsTable).where(eq(findingsTable.runId, runId));
  const ranked = orderFindings(runFindings.map((finding) => ({
    ...finding,
    severity: finding.severity as "High" | "Medium" | "Low",
  })));
  for (const finding of ranked) {
    await db.update(findingsTable).set({ sortOrder: finding.sortOrder, priority: finding.priority })
      .where(eq(findingsTable.id, finding.id));
  }

  const outOfScope = checks.length - scoped.length;
  const underMeasuredNote = `Only ${confidence}% of the audit rubric could be verified (${checksVerified} of ${scoped.length} checks in scope${outOfScope ? `, with ${outOfScope} more needing a source this run did not have` : ""}), below the ${minimumConfidence}% needed to report a score. Configure PAGESPEED_API_KEY, or re-run when the unavailable sources respond.`;

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
    checksTotal: scoped.length,
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
      scoreSource: "engine",
      scoreConfidence: confidence,
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

  // Crawl diagnostics ride along on every run, which is how the blocking-rate
  // question gets answered from real audits instead of a separate endpoint.
  const payloadIds = modules.flatMap((module) => {
    try { return JSON.parse(module.payloadIds) as number[]; } catch { return []; }
  });
  let diagnostics: unknown = null;
  if (payloadIds.length) {
    const [crawlRow] = await db.select().from(rawPayloads)
      .where(and(inArray(rawPayloads.id, payloadIds), eq(rawPayloads.source, "crawl")))
      .orderBy(desc(rawPayloads.id)).limit(1);
    if (crawlRow) {
      try { diagnostics = (JSON.parse(crawlRow.payload) as { diagnostics?: unknown }).diagnostics ?? null; } catch { diagnostics = null; }
    }
  }
  const pending = modules.some((module) => module.status === "Queued" || module.status === "Running");
  return { run, modules, findings: runFindings, diagnostics, pending, justFinished: false, waitingFor: null as string | null, waitingReason: "" };
}
