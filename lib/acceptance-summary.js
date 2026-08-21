/**
 * What a batch of acceptance runs says about the crawler.
 *
 * The per-prospect checks answer "could I send this one?". This answers the
 * question no single run can: how often a real small-business site refuses to
 * be read, who refuses, and whether a score comes back when it does.
 *
 * It lives here, apart from the script that prints it, because the paths worth
 * getting right are the ones a passing run never exercises — a site that was
 * blocked, one that was read only in part, one whose navigation never reached
 * the served HTML, one the rubric could not score. Those are what the five
 * runs are for, and counting them wrong would answer the question wrongly.
 */

/**
 * @typedef {object} AcceptanceResult
 * @property {{ name: string }} prospect
 * @property {Record<string, any> | null} [run] the finished audit_runs row
 * @property {Record<string, any> | null} [diagnostics] the crawl's own account
 * @property {number} [coverageFindings]
 */

const names = (list) => list.map((result) => result.prospect?.name ?? "unnamed").join(", ");

/**
 * @param {AcceptanceResult[]} results
 */
export function summarizeBatch(results = []) {
  // A prospect whose run never came back is not a site that refused to be
  // read; it is a run that did not finish, and counting it as either would be
  // a claim about a site nobody looked at.
  const finished = results.filter((result) => result.run);
  const read = finished.filter((result) => result.run.reachable !== false);
  const blocked = finished.filter((result) => result.run.reachable === false);

  const partial = read.filter((result) => {
    const reached = Number(result.diagnostics?.pagesReached ?? 0);
    const attempted = Number(result.diagnostics?.pagesAttempted ?? 0);
    return attempted > 0 && reached < attempted;
  });

  /** Who refused, and how, counted across every prospect. */
  const servers = new Map();
  for (const result of results) {
    for (const entry of result.diagnostics?.blockedResponses ?? []) {
      const label = `HTTP ${entry.status}${entry.server ? ` · ${entry.server}` : ""}${entry.cfRay ? " · Cloudflare" : ""}`;
      servers.set(label, (servers.get(label) ?? 0) + 1);
    }
  }

  // Only false counts: the field is null when the crawl could not tell, and
  // "could not tell" is not "JS-rendered".
  const jsNav = read.filter((result) => result.diagnostics?.navigationServerRendered === false);
  const scored = read.filter((result) => typeof result.run.overallScore === "number");
  const confidences = read
    .map((result) => Number(result.run.confidence ?? 0))
    .filter((value) => value > 0);
  const withCoverage = results.filter((result) => Number(result.coverageFindings ?? 0) > 0);

  return {
    total: results.length,
    unfinished: results.length - finished.length,
    read: read.length,
    readNames: names(read),
    partial: partial.length,
    partialNames: names(partial),
    blocked: blocked.length,
    blockedNames: names(blocked),
    servers: [...servers].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count })),
    jsNav: jsNav.length,
    jsNavNames: names(jsNav),
    scored: scored.length,
    scores: scored.map((result) => result.run.overallScore).sort((a, b) => a - b),
    confidenceMin: confidences.length ? Math.min(...confidences) : null,
    confidenceMax: confidences.length ? Math.max(...confidences) : null,
    withCoverage: withCoverage.length,
  };
}

/**
 * The same summary as lines to print. Separate from the counting so the
 * counting can be tested without capturing stdout.
 *
 * @param {ReturnType<typeof summarizeBatch>} summary
 * @param {number} confidenceThreshold the level below which a run is not scored
 */
export function formatBatch(summary, confidenceThreshold = 60) {
  const lines = [
    `CRAWL EVIDENCE — ${summary.total} prospect${summary.total === 1 ? "" : "s"}`,
    `  Read                  ${summary.read}/${summary.total}${summary.partial ? ` (${summary.partial} partially — ${summary.partialNames})` : ""}`,
    `  Could not be read     ${summary.blocked}${summary.blocked ? `  — ${summary.blockedNames}` : ""}`,
  ];
  if (summary.unfinished) lines.push(`  Run did not finish    ${summary.unfinished}`);
  if (summary.servers.length) {
    lines.push("  Blocking responses:");
    for (const { label, count } of summary.servers) lines.push(`    ${String(count).padStart(3)} × ${label}`);
  }
  lines.push(`  JS-rendered nav       ${summary.jsNav}/${summary.read}${summary.jsNav ? `  — ${summary.jsNavNames}` : ""}`);
  lines.push(`  Scored                ${summary.scored}/${summary.read}${summary.scores.length ? `  — ${summary.scores.join(", ")}` : ""}`);
  if (summary.confidenceMin !== null) {
    lines.push(`  Confidence            ${summary.confidenceMin}–${summary.confidenceMax}%  (below ${confidenceThreshold}% a run is not scored)`);
  }
  lines.push(`  Service coverage      ${summary.withCoverage}/${summary.total} produced findings`);
  return lines;
}
