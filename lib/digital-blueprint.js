const effortMap = { High: 3, Medium: 2, Low: 1 };

function unique(items) {
  const seen = new Set();
  return items.filter((item) => { const key = item.title.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; });
}

export function buildDigitalBlueprint(lead, websiteFindings = [], googleAudit = { reviewed: false, score: 0, findings: [] }) {
  const sourceItems = [
    ...websiteFindings.map((item) => ({ ...item, source: "Website" })),
    ...googleAudit.findings.map((item) => ({ ...item, impact: "Improves local visibility and buyer confidence.", source: "Google" })),
  ];
  const recommendations = unique(sourceItems).slice(0, 10).map((item, index) => ({
    id: `${item.source.toLowerCase()}-${index + 1}`,
    source: item.source,
    category: item.category,
    severity: item.severity,
    title: item.title,
    evidence: item.evidence,
    action: item.recommendation,
    effort: effortMap[item.severity] === 3 ? "Major" : effortMap[item.severity] === 2 ? "Moderate" : "Quick win",
    scoreLift: effortMap[item.severity] === 3 ? 6 : effortMap[item.severity] === 2 ? 4 : 2,
  }));
  const currentScore = lead.score && googleAudit.reviewed ? Math.round(lead.score * .6 + googleAudit.score * .4) : lead.score || googleAudit.score || 0;
  const projectedScore = Math.min(92, currentScore + recommendations.slice(0, 6).reduce((sum, item) => sum + item.scoreLift, 0));
  const industry = lead.carrier && lead.carrier !== "Uncategorized" ? lead.carrier : "business";
  return {
    currentScore,
    projectedScore,
    projectedLabel: "Planning estimate—not a guarantee",
    executiveSummary: `${lead.agencyName} has identifiable opportunities across website clarity, conversion, trust, technical quality, and local presence. The recommended plan prioritizes fixes that help prospective customers understand the offer, trust the business, and take action.`,
    sitemap: ["Home", "Services", "About / Proof", "Reviews or Case Studies", "Contact / Request a Quote"],
    homepage: {
      headline: `${lead.agencyName}: a clearer reason for ${industry} customers to choose and contact you`,
      sections: ["Outcome-led hero with one primary action", "Core services tied to buyer needs", "Proof: reviews, results, and credentials", "Simple process or what happens next", "FAQ that answers buying objections", "Final contact or quote action"],
    },
    roadmap: [
      { phase: "Now", label: "Fix conversion blockers", items: recommendations.filter((item) => item.severity === "High").slice(0, 3) },
      { phase: "Next", label: "Build proof and visibility", items: recommendations.filter((item) => item.severity === "Medium").slice(0, 3) },
      { phase: "Later", label: "Polish and optimize", items: recommendations.filter((item) => item.severity === "Low").slice(0, 3) },
    ],
    recommendations,
  };
}
