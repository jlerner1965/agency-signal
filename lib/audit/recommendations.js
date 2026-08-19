/**
 * Findings map to a service menu by rule. The LLM writes only the rationale
 * prose and must cite finding IDs; nothing renders that cannot point at a
 * stored finding.
 */

export const serviceMenu = [
  {
    id: "site-rebuild",
    label: "Website rebuild",
    // A rebuild is justified by breadth of failure, not by any single finding.
    matches: () => false,
    threshold: { categories: 3, highSeverity: 5 },
  },
  {
    id: "local-seo",
    label: "Local SEO and profile optimisation",
    matches: (finding) => finding.category === "Service coverage" || finding.category === "Trust",
  },
  {
    id: "service-pages",
    label: "Service-page content build",
    matches: (finding) => /service line|dedicated page|service list|categorised as/i.test(finding.title),
  },
  {
    id: "conversion",
    label: "Conversion optimisation",
    matches: (finding) => finding.category === "Conversion" && !/analytics|measuring/i.test(finding.title),
  },
  {
    id: "analytics",
    label: "Analytics setup",
    matches: (finding) => /analytics|measuring|tracking/i.test(finding.title),
  },
];

/**
 * Deterministic mapping. Every recommendation carries the ids of the findings
 * that justify it; a service with no matching finding is not recommended.
 */
export function buildRecommendations(findings) {
  const recommendations = [];

  for (const service of serviceMenu) {
    if (service.threshold) continue;
    const matched = findings.filter((finding) => service.matches(finding));
    if (!matched.length) continue;
    recommendations.push({
      serviceLine: service.id,
      label: service.label,
      findingIds: matched.map((finding) => finding.id),
      priority: Math.max(...matched.map((finding) => finding.priority ?? 0)),
      highSeverityCount: matched.filter((finding) => finding.severity === "High").length,
      rationale: "",
    });
  }

  // A rebuild is proposed only when failure is broad, and it cites the findings
  // that make it broad rather than claiming the whole audit.
  const rebuild = serviceMenu.find((service) => service.id === "site-rebuild");
  const categories = new Set(findings.map((finding) => finding.category));
  const highs = findings.filter((finding) => finding.severity === "High");
  if (categories.size >= rebuild.threshold.categories && highs.length >= rebuild.threshold.highSeverity) {
    recommendations.push({
      serviceLine: rebuild.id,
      label: rebuild.label,
      findingIds: highs.map((finding) => finding.id),
      priority: Math.max(...highs.map((finding) => finding.priority ?? 0)),
      highSeverityCount: highs.length,
      rationale: "",
    });
  }

  return recommendations.sort((a, b) => b.priority - a.priority || b.highSeverityCount - a.highSeverityCount);
}

/**
 * The gate. A recommendation citing no stored finding, or an id absent from
 * this run, fails the render and names the offender.
 */
export function validateEvidence(recommendations, findings) {
  const known = new Set(findings.map((finding) => finding.id));
  const problems = [];
  for (const recommendation of recommendations) {
    const ids = recommendation.findingIds ?? [];
    if (!ids.length) {
      problems.push(`“${recommendation.label}” cites no findings.`);
      continue;
    }
    const unknown = ids.filter((id) => !known.has(id));
    if (unknown.length) problems.push(`“${recommendation.label}” cites findings not in this run: ${unknown.join(", ")}.`);
  }
  return { valid: problems.length === 0, problems };
}

/** Throws rather than rendering an unevidenced claim. */
export function assertEvidence(recommendations, findings) {
  const { valid, problems } = validateEvidence(recommendations, findings);
  if (!valid) throw new Error(`Recommendations failed the evidence check: ${problems.join(" ")}`);
  return recommendations;
}

/** Strips any citation the model invented before the rationale is stored. */
export function groundRationale(rationale, allowedIds) {
  const allowed = new Set(allowedIds.map(String));
  const cited = [...String(rationale).matchAll(/\bF(\d+)\b/g)].map((match) => match[1]);
  const invented = cited.filter((id) => !allowed.has(id));
  return {
    rationale: String(rationale).replace(/\s+/g, " ").trim().slice(0, 1200),
    cited: cited.filter((id) => allowed.has(id)),
    invented,
    usable: invented.length === 0,
  };
}
