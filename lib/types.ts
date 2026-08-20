export type LeadStatus =
  | "Identified"
  | "Audited"
  | "Contacted"
  | "Replied"
  | "Discovery scheduled"
  | "Qualified"
  | "Proposal sent"
  | "Decision pending"
  | "Won"
  | "Lost"
  | "Nurture"
  | "Disqualified";

export type Lead = {
  id: number;
  agencyName: string;
  contactName: string;
  carrier: string;
  city: string;
  state: string;
  website: string;
  email: string;
  phone: string;
  status: LeadStatus;
  rating: number | null;
  reviewCount: number;
  googleProfileUrl: string;
  googlePrimaryCategory: string;
  googleServices: string;
  placeId: string;
  googleReviewRecencyDays: number;
  googleResponseRate: number;
  googlePhotoCount: number;
  googlePostRecencyDays: number;
  googleProfileCompleteness: number;
  googleNapConsistent: boolean;
  googleReviewedAt: string | null;
  score: number;
  scoreSource: string;
  scoreConfidence: number;
  visibilityScore: number;
  conversionScore: number;
  technicalScore: number;
  trustScore: number;
  lastContactedAt: string | null;
  nextFollowUpAt: string | null;
  lastAuditAt: string | null;
  reportViews: number;
  reportToken: string;
  fitScore: number;
  needScore: number;
  intentScore: number;
  urgencyScore: number;
  reachabilityScore: number;
  qualificationStatus: string;
  businessObjective: string;
  painPoint: string;
  currentProvider: string;
  decisionMaker: string;
  budgetRange: string;
  desiredTimeline: string;
  nextCommittedStep: string;
  objection: string;
  lossReason: string;
  dealValue: number;
  sequenceStatus: string;
  sequenceStep: number;
  notes: string;
};

export type Finding = {
  id?: number;
  category: "Visibility" | "Conversion" | "Technical" | "Trust";
  severity: "High" | "Medium" | "Low";
  title: string;
  evidence: string;
  recommendation: string;
  impact: string;
  affectedUrl: string;
  sortOrder: number;
};

export type AuditCheck = {
  id: string;
  category: "Visibility" | "Conversion" | "Technical" | "Trust";
  label: string;
  status: "passed" | "failed" | "unverified";
  weight: number;
  earned: number;
  evidence: string;
};

export type AuditSummary = {
  id: number;
  score: number;
  pagesAudited: number;
  confidenceScore: number;
  checksPassed: number;
  checksFailed: number;
  checksUnverified: number;
  checkSummary: string;
  lighthouseSummary: string;
  screenshotKey: string;
  createdAt: string;
};

export type CompetitorAudit = {
  id: number;
  leadId: number;
  name: string;
  website: string;
  score: number;
  visibilityScore: number;
  conversionScore: number;
  technicalScore: number;
  trustScore: number;
  pagesAudited: number;
  confidenceScore: number;
  checksPassed: number;
  checksFailed: number;
  checkSummary: string;
  lighthouseSummary: string;
  screenshotKey: string;
  createdAt: string;
};

export type AuditComparison = {
  previousAuditId: number;
  currentAuditId: number;
  scoreDelta: number;
  visibilityDelta: number;
  conversionDelta: number;
  technicalDelta: number;
  trustDelta: number;
  confidenceDelta: number;
  resolved: string[];
  regressed: string[];
  previousDate: string;
  currentDate: string;
};

export type Activity = {
  id: string;
  activityType: string;
  description: string;
  createdAt: string;
};

/**
 * The part of an opportunity a prospect may see. Everything omitted here is
 * internal sales reasoning — how the lead was ranked, the angle to lead with,
 * what to do next — and the report route sends this shape rather than the whole
 * object, which is how "Find or add a decision-maker email" reached a document
 * addressed to the decision-maker.
 */
export type PublicOpportunity = Pick<
  Opportunity,
  "primaryService" | "recommendedOffer" | "expectedOutcome" | "scope" | "primaryFinding"
>;

export type Opportunity = {
  priorityScore: number;
  priorityLabel: string;
  primaryService: string;
  recommendedOffer: string;
  expectedOutcome: string;
  scope: string;
  primaryFinding: string;
  outreachAngle: string;
  nextAction: string;
};

export type Proposal = {
  id: number;
  leadId: number;
  token: string;
  offerId: string;
  title: string;
  service: string;
  outcome: string;
  scope: string;
  deliverables: string;
  price: number;
  timeline: string;
  status: string;
  viewCount: number;
  expiresAt: string;
  acceptedAt: string | null;
  signerName: string;
  signerEmail: string;
  createdAt: string;
  updatedAt: string;
};

export type CopilotAction = "brief" | "next_action" | "message" | "discovery" | "proposal";

export type CopilotEvidence = {
  id: string;
  source: string;
  label: string;
  value: string;
};

export type CopilotResult = {
  runId: number;
  action: CopilotAction;
  title: string;
  summary: string;
  recommendedAction: string;
  rationale: string;
  subject: string;
  content: string;
  confidence: "High" | "Medium" | "Low";
  evidence: CopilotEvidence[];
  missingInformation: string[];
  suggestedFields: Pick<Lead, "businessObjective" | "painPoint" | "currentProvider" | "decisionMaker" | "budgetRange" | "desiredTimeline" | "nextCommittedStep" | "objection">;
};

export type PublicReportLead = Pick<
  Lead,
  | "agencyName"
  | "contactName"
  | "city"
  | "state"
  | "website"
  | "score"
  | "visibilityScore"
  | "conversionScore"
  | "technicalScore"
  | "trustScore"
  | "lastAuditAt"
>;
