/**
 * Every weight and threshold the audit scores against. Nothing in this file may
 * be derived from model output — the LLM extracts and explains, it never scores.
 */

/** Category weights for the overall score. Must sum to 1. */
export const categoryWeights = {
  Visibility: 0.25,
  Conversion: 0.30,
  Technical: 0.25,
  Trust: 0.20,
};

/**
 * Default impact and effort (1-5) per severity, used when a check does not
 * state its own. Priority is impact/effort, so the top of a report is always
 * the fastest meaningful win.
 */
export const severityDefaults = {
  High: { impactScore: 5, effortScore: 3 },
  Medium: { impactScore: 3, effortScore: 2 },
  Low: { impactScore: 2, effortScore: 2 },
};

/** Lighthouse category thresholds, matching Google's own good/needs-work bands. */
export const lighthouseThresholds = {
  performance: { good: 90, poor: 50 },
  accessibility: { good: 90, poor: 50 },
  seo: { good: 90, poor: 50 },
  bestPractices: { good: 90, poor: 50 },
};

/** Core Web Vitals pass marks, in the units Lighthouse reports. */
export const coreWebVitals = {
  lcp: { goodSeconds: 2.5, poorSeconds: 4.0 },
  cls: { good: 0.1, poor: 0.25 },
  tbt: { goodMs: 200, poorMs: 600 },
};

/**
 * A score is only reported when enough of the rubric could actually be
 * verified. Below this, the run reports "not scored" and says why: a site we
 * barely measured must never read as a site that scored well, exactly as a
 * site we could not read must never read as one that scored badly.
 */
export const minimumConfidence = 60;

/** Share of total check weight that was actually verified, 0-100. */
export function confidenceOf(checks) {
  const total = checks.reduce((sum, check) => sum + check.weight, 0);
  if (!total) return 0;
  const verified = checks.filter((check) => check.status !== "unverified").reduce((sum, check) => sum + check.weight, 0);
  return clampScore((verified / total) * 100);
}

export function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** Priority ranking: impact/effort desc, then severity, then title for stability. */
const severityRank = { High: 0, Medium: 1, Low: 2 };

export function priorityOf(finding) {
  const impact = finding.impactScore ?? severityDefaults[finding.severity]?.impactScore ?? 3;
  const effort = finding.effortScore ?? severityDefaults[finding.severity]?.effortScore ?? 3;
  return Math.round((impact / Math.max(1, effort)) * 100) / 100;
}

export function orderFindings(findings) {
  return [...findings]
    .map((finding) => ({
      ...finding,
      impactScore: finding.impactScore ?? severityDefaults[finding.severity]?.impactScore ?? 3,
      effortScore: finding.effortScore ?? severityDefaults[finding.severity]?.effortScore ?? 3,
      priority: priorityOf(finding),
    }))
    .sort((a, b) =>
      b.priority - a.priority ||
      severityRank[a.severity] - severityRank[b.severity] ||
      a.title.localeCompare(b.title))
    .map((finding, index) => ({ ...finding, sortOrder: index + 1 }));
}

/**
 * Weighted score from earned checks. Unverified checks are excluded from both
 * sides rather than counted as failures, so a check we could not run never
 * looks like a check the site failed.
 */
export function scoreChecks(checks) {
  const verified = checks.filter((check) => check.status !== "unverified");
  if (!verified.length) return null;
  const earned = verified.reduce((sum, check) => sum + check.earned, 0);
  const available = verified.reduce((sum, check) => sum + check.weight, 0);
  return available ? clampScore((earned / available) * 100) : null;
}
