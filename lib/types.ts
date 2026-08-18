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
  score: number;
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

export type Activity = {
  id: string;
  activityType: string;
  description: string;
  createdAt: string;
};

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
