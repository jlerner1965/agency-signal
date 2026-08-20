const serviceMap = {
  conversion: {
    service: "Conversion optimization",
    offer: "Lead-generation website sprint",
    outcome: "Make it easier for qualified visitors to call, book, or submit an inquiry.",
  },
  visibility: {
    service: "SEO & local visibility",
    offer: "Search visibility foundation",
    outcome: "Clarify services, location, and page structure so the business is easier to discover.",
  },
  technical: {
    service: "Technical website improvements",
    offer: "Website performance and technical cleanup",
    outcome: "Remove technical friction that can weaken usability, indexing, and trust.",
  },
  trust: {
    service: "Trust & content strategy",
    offer: "Credibility and content upgrade",
    outcome: "Strengthen proof, transparency, and confidence before a visitor takes action.",
  },
};

function clamp(value, minimum = 0, maximum = 100) {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

/**
 * Turn audit evidence and engagement into a transparent sales opportunity.
 * @param {import("./types").Lead} lead
 * @param {import("./types").Finding[]} [findings]
 */
/**
 * A finding's affectedUrl is allowed to be empty, and several analysers emit it
 * that way. Parsing it unguarded threw, and this runs inside the public report
 * route — so one finding without a URL took down the whole page for a prospect
 * who had been sent the link.
 */
function pathOf(url) {
  try { return new URL(url).pathname || "/"; } catch { return "/"; }
}

export function buildOpportunity(lead, findings = []) {
  if (!lead.score) {
    return {
      priorityScore: lead.email || lead.phone ? 22 : 12,
      priorityLabel: "Needs audit",
      primaryService: "Website opportunity audit",
      recommendedOffer: "Run the evidence review first",
      expectedOutcome: "Identify a specific, credible reason to begin a conversation.",
      scope: "Unqualified",
      primaryFinding: "No verified website findings yet",
      outreachAngle: "Complete the audit before contacting this prospect.",
      nextAction: "Run website audit",
    };
  }

  const categories = [
    ["conversion", lead.conversionScore],
    ["visibility", lead.visibilityScore],
    ["technical", lead.technicalScore],
    ["trust", lead.trustScore],
  ].sort((a, b) => Number(a[1]) - Number(b[1]));
  const [weakestCategory, weakestScore] = categories[0];
  const weakCategories = categories.filter(([, score]) => Number(score) < 68).length;
  const highFindings = findings.filter((finding) => finding.severity === "High");
  const primaryFinding = highFindings[0] ?? findings[0];
  const gap = 100 - lead.score;
  const engagement = Math.min(18, lead.reportViews * 6);
  const contactReadiness = lead.email ? 10 : lead.phone ? 5 : 0;
  const evidenceWeight = Math.min(18, highFindings.length * 5 + Math.max(0, findings.length - highFindings.length) * 2);
  const priorityScore = clamp(24 + gap * 0.45 + engagement + contactReadiness + evidenceWeight);
  const priorityLabel = priorityScore >= 76 ? "High priority" : priorityScore >= 56 ? "Strong opportunity" : "Develop";

  const fullRedesign = lead.score < 48 && weakCategories >= 3;
  const recommendation = fullRedesign
    ? {
        service: "Website redesign",
        offer: "Conversion-focused website redesign",
        outcome: "Rebuild the customer journey around clear positioning, trust, and lead capture.",
      }
    : serviceMap[weakestCategory];
  const scope = fullRedesign ? "Large engagement" : highFindings.length >= 2 || Number(weakestScore) < 58 ? "Focused project" : "Quick-win project";
  const findingText = primaryFinding?.title ?? `${recommendation.service} opportunity`;

  return {
    priorityScore,
    priorityLabel,
    primaryService: recommendation.service,
    recommendedOffer: recommendation.offer,
    expectedOutcome: recommendation.outcome,
    scope,
    primaryFinding: findingText,
    outreachAngle: primaryFinding
      ? `Lead with “${primaryFinding.title}” and show the evidence from ${pathOf(primaryFinding.affectedUrl)}.`
      : `Lead with the ${recommendation.service.toLowerCase()} gap shown by the audit.`,
    nextAction: lead.reportViews > 0 ? "Follow up while interest is warm" : lead.email ? "Send personalized opportunity brief" : "Find or add a decision-maker email",
  };
}

