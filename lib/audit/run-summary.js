/**
 * An audit run, in the shape the dashboard was written against.
 *
 * The dashboard predates the engine. Its Summary, Website and Blueprint tabs
 * read the `audits` and `audit_findings` tables, and the engine writes neither
 * — it writes `audit_runs` and `findings`, and back-fills only the prospect's
 * headline score. So a finished run left every one of those tabs saying the
 * site had never been audited, while the Audit engine tab beside them showed
 * the findings it had just produced.
 *
 * These map a run into the older shape rather than rewriting four tabs against
 * the newer one. That is a bridge, and it is deliberate: the legacy shape is
 * what four components already consume, and the alternative is a UI rewrite
 * with far more surface to get wrong. Nothing here invents a value. A field the
 * run has no equivalent for comes back empty, and the components that read it
 * already treat empty as "nothing to show".
 */

/** Checks as the modules recorded them, flattened across the whole run. */
export function checksFromModules(modules = []) {
  return modules.flatMap((module) => {
    try {
      const parsed = JSON.parse(module.checkSummary || "[]");
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
}

/**
 * One run as an audit summary.
 *
 * @param {Record<string, any> | null | undefined} run the audit_runs row
 * @param {Array<Record<string, any>>} modules its audit_run_modules rows
 * @param {Record<string, any> | null} diagnostics the crawl's own diagnostics
 */
export function summaryFromRun(run, modules = [], diagnostics = null) {
  if (!run) return null;
  const checks = checksFromModules(modules);
  const count = (status) => checks.filter((check) => check.status === status).length;

  return {
    id: run.id,
    // A run that could not be scored reports 0 here, and every component that
    // reads it gates on the score being truthy, so an unscored run reads as
    // "not audited" rather than as a site that scored zero.
    score: run.overallScore ?? 0,
    visibilityScore: run.visibilityScore ?? 0,
    conversionScore: run.conversionScore ?? 0,
    technicalScore: run.technicalScore ?? 0,
    trustScore: run.trustScore ?? 0,
    // What the crawl actually reached, not what it attempted.
    pagesAudited: Number(diagnostics?.pagesReached ?? 0),
    confidenceScore: run.confidence ?? 0,
    checksPassed: count("passed"),
    checksFailed: count("failed"),
    checksUnverified: count("unverified"),
    checkSummary: JSON.stringify(checks),
    // The engine captures neither, and says so by leaving them empty rather
    // than by omitting the field and making every reader guard for undefined.
    lighthouseSummary: "null",
    screenshotKey: "",
    createdAt: run.finishedAt || run.createdAt,
  };
}

/**
 * A run's findings in the older shape. `impactNote` and `impact` are the same
 * sentence under two names — every analyzer writes one.
 *
 * @param {Array<Record<string, any>>} rows the findings rows for one run
 */
export function findingsFromRun(rows = []) {
  return rows.map((row) => ({
    id: row.id,
    category: row.category,
    severity: row.severity,
    title: row.title,
    evidence: row.evidence,
    recommendation: row.recommendation ?? "",
    impact: row.impactNote ?? "",
    affectedUrl: row.affectedUrl ?? "",
    sortOrder: row.sortOrder ?? 0,
  }));
}
