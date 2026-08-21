export const salesStages = [
  "Identified",
  "Audited",
  "Contacted",
  "Replied",
  "Discovery scheduled",
  "Qualified",
  "Proposal sent",
  "Decision pending",
  "Won",
  "Lost",
  "Nurture",
  "Disqualified",
];

export const offerCatalog = [
  {
    id: "digital-presence-plan",
    service: "Website redesign + Google presence",
    name: "Digital presence growth plan",
    price: 6500,
    timeline: "5–7 weeks",
    outcome: "Create a stronger website and Google presence that help local prospects discover, trust, and contact the business.",
    idealFor: "Businesses with meaningful gaps across both their website and Google Business Profile.",
    proof: "Measured through before-and-after audit scores, implemented conversion paths, profile completeness, review activity, and tracking readiness.",
    deliverables: ["Website strategy and priority-page redesign", "Conversion paths, forms, and call tracking setup", "Google Business Profile optimization", "Review and owner-response system", "Launch QA and 30-day scorecard"],
    objections: "The work can be phased into website and Google milestones while preserving one unified strategy.",
  },
  {
    id: "google-presence",
    service: "Google presence",
    name: "Google presence accelerator",
    price: 1800,
    timeline: "2–3 weeks",
    outcome: "Strengthen the business profile, review proof, and local conversion path where customers make decisions.",
    idealFor: "Businesses with an incomplete profile, weak review activity, low response coverage, or inconsistent information.",
    proof: "Measured through profile completeness, review recency, owner responses, visual proof, and verified information consistency.",
    deliverables: ["Google Business Profile optimization", "Category, service, description, and conversion-link review", "Review request and owner-response system", "Photo and post content plan", "Before-and-after presence scorecard"],
    objections: "This is a defined setup and improvement project; ongoing management is optional.",
  },
  {
    id: "conversion-sprint",
    service: "Conversion optimization",
    name: "Lead-generation website sprint",
    price: 4500,
    timeline: "3–4 weeks",
    outcome: "Make it easier for qualified visitors to call, book, or submit an inquiry.",
    idealFor: "Businesses with traffic but unclear calls to action or weak conversion paths.",
    proof: "Measured against completed forms, calls, booking actions, and conversion-path friction.",
    deliverables: ["Conversion map and page priorities", "Homepage and key service-page improvements", "Lead form and call-to-action implementation", "Launch QA and measurement plan"],
    objections: "Can begin with the highest-impact page before expanding the scope.",
  },
  {
    id: "visibility-foundation",
    service: "SEO & local visibility",
    name: "Search visibility foundation",
    price: 2500,
    timeline: "2–3 weeks",
    outcome: "Clarify services, location, and page structure so the business is easier to discover.",
    idealFor: "Businesses whose services or geographic relevance are difficult for searchers to understand.",
    proof: "Measured through indexable service coverage, local relevance, and qualified organic inquiries.",
    deliverables: ["Search and local opportunity map", "Priority service-page structure", "On-page search improvements", "Tracking and 30-day review"],
    objections: "The foundation is a defined project; ongoing SEO is optional.",
  },
  {
    id: "technical-cleanup",
    service: "Technical website improvements",
    name: "Website performance and technical cleanup",
    price: 1800,
    timeline: "1–2 weeks",
    outcome: "Remove technical friction that weakens usability, indexing, and trust.",
    idealFor: "Sites with performance, mobile, metadata, accessibility, or crawlability problems.",
    proof: "Measured with before-and-after technical checks and documented fixes.",
    deliverables: ["Prioritized technical remediation", "Mobile and performance fixes", "Metadata and crawlability cleanup", "Before-and-after validation"],
    objections: "Work is prioritized by business impact, not an open-ended technical retainer.",
  },
  {
    id: "credibility-upgrade",
    service: "Trust & content strategy",
    name: "Credibility and content upgrade",
    price: 2200,
    timeline: "2–3 weeks",
    outcome: "Strengthen proof, transparency, and confidence before a visitor takes action.",
    idealFor: "Businesses with limited proof, vague claims, or weak decision-stage content.",
    proof: "Measured by completed proof elements, stronger decision content, and engagement with key pages.",
    deliverables: ["Trust-gap review", "Proof and credibility content", "Service messaging improvements", "Decision-stage page updates"],
    objections: "Existing customer proof and source material are reused wherever possible.",
  },
  {
    id: "website-redesign",
    service: "Website redesign",
    name: "Conversion-focused website redesign",
    price: 8500,
    timeline: "6–8 weeks",
    outcome: "Rebuild the customer journey around clear positioning, trust, and lead capture.",
    idealFor: "Businesses with several connected visibility, conversion, technical, and trust problems.",
    proof: "Measured through launch QA, conversion instrumentation, and a 30-day performance review.",
    deliverables: ["Positioning and conversion strategy", "Responsive design system", "Priority page build", "Analytics, launch, and 30-day review"],
    objections: "The scope can be phased around the pages most directly tied to revenue.",
  },
];

export const outreachSequence = [
  { step: 1, label: "Evidence email", waitDays: 2, purpose: "Send one verified finding and the private opportunity brief." },
  { step: 2, label: "Short follow-up", waitDays: 3, purpose: "Ask whether the finding is already being addressed." },
  { step: 3, label: "Business impact", waitDays: 4, purpose: "Connect the issue to calls, bookings, trust, or visibility." },
  { step: 4, label: "Implementation path", waitDays: 5, purpose: "Share the smallest credible service option and timeline." },
  { step: 5, label: "Close the loop", waitDays: 30, purpose: "Give the prospect an easy yes, later, or no choice." },
];

export const objections = {
  Price: "That makes sense. Is the concern the total investment, or uncertainty about the return? We can isolate the highest-impact phase and define what success must look like before expanding.",
  "Existing provider": "I’m not asking you to replace a working relationship. Would it be useful to give your provider the evidence and see whether they already have a plan to address it?",
  "No urgency": "Understood. What event would make this important—slower lead flow, a new location, a redesign, or a competitive change? I can time the follow-up around that trigger.",
  "Need approval": "Who else needs to be comfortable with the decision, and what will they need to see? I can make the proposal easy to evaluate internally.",
  "Not decision-maker": "Who owns the business outcome this affects? If you introduce us, I’ll keep the context concise and include you in the conversation.",
  Timing: "When would implementation realistically be possible? Let’s agree on a specific date to revisit it instead of leaving the conversation open-ended.",
  "No response": "Send one concise close-the-loop note, then move the lead to nurture instead of continuing indefinite follow-up.",
  "Service mismatch": "Return to the stated business objective and recommend only the smallest service that directly supports it—or disqualify the opportunity.",
};

function clamp(value) { return Math.max(0, Math.min(100, Number(value) || 0)); }

/**
 * The qualification score, field by field.
 *
 * Typed to what it reads rather than to `Lead`: a row straight out of the
 * database has `status: string`, not the `LeadStatus` union, so demanding a
 * `Lead` made every caller passing a real row a type error.
 *
 * @param {Record<string, any>} lead
 */
export function qualificationBreakdown(lead) {
  const need = lead.needScore || (lead.score ? Math.max(20, 100 - lead.score) : 0);
  const intent = lead.intentScore || Math.min(100, (lead.reportViews || 0) * 20 + (["Replied", "Discovery scheduled", "Qualified", "Proposal sent", "Decision pending"].includes(lead.status) ? 45 : 0));
  const reachability = lead.reachabilityScore || (lead.email ? 70 : lead.phone ? 45 : 10);
  const fit = clamp(lead.fitScore);
  const urgency = clamp(lead.urgencyScore);
  const total = Math.round(fit * .2 + clamp(need) * .25 + clamp(intent) * .2 + urgency * .2 + clamp(reachability) * .15);
  return { fit, need: clamp(need), intent: clamp(intent), urgency, reachability: clamp(reachability), total };
}

/** @param {import("./types").Lead} lead */
/** @param {Record<string, any>} lead */
export function qualificationLabel(lead) {
  const { total } = qualificationBreakdown(lead);
  if (lead.status === "Disqualified") return "Disqualified";
  if (total >= 70 && lead.decisionMaker && lead.nextCommittedStep) return "Ready to propose";
  if (total >= 55) return "Qualified";
  if (total >= 35) return "Nurture";
  return "Unqualified";
}

export function offerForOpportunity(opportunity) {
  return offerCatalog.find((offer) => offer.service === opportunity?.primaryService) ?? offerCatalog[0];
}

/** @param {import("./types").Lead} lead @param {import("./types").Opportunity} opportunity */
export function discoveryPlaybook(lead, opportunity) {
  const finding = opportunity?.primaryFinding || "the opportunity identified in the website review";
  return {
    opening: `I noticed ${finding.toLowerCase()}. Before recommending anything, I’d like to understand whether it is affecting a business goal you already care about.`,
    questions: [
      `What would you most like the website or marketing program to produce over the next six months?`,
      `How are new customers finding and choosing ${lead.agencyName} today?`,
      `What happens internally when a qualified visitor calls, books, or submits a form?`,
      `Is anyone already responsible for fixing ${finding.toLowerCase()}?`,
      `If there is a fit, who else should evaluate the scope, investment, and timing?`,
    ],
  };
}

/** @param {import("./types").Lead[]} leads */
export function revenueMetrics(leads) {
  const active = leads.filter((lead) => !["Won", "Lost", "Disqualified"].includes(lead.status));
  const proposals = leads.filter((lead) => ["Proposal sent", "Decision pending", "Won", "Lost"].includes(lead.status));
  const won = leads.filter((lead) => lead.status === "Won");
  const qualified = leads.filter((lead) => ["Qualified", "Proposal sent", "Decision pending", "Won"].includes(lead.status));
  const revenue = won.reduce((sum, lead) => sum + (lead.dealValue || 0), 0);
  const pipelineValue = active.reduce((sum, lead) => sum + (lead.dealValue || 0), 0);
  return {
    active: active.length,
    qualified: qualified.length,
    proposals: proposals.length,
    won: won.length,
    revenue,
    pipelineValue,
    closeRate: proposals.length ? Math.round((won.length / proposals.length) * 100) : 0,
  };
}

export function nextSequenceDate(step, now = new Date()) {
  const current = outreachSequence.find((item) => item.step === step) ?? outreachSequence[0];
  return new Date(now.getTime() + current.waitDays * 86_400_000).toISOString();
}
