export type LeadStatus =
  | "New"
  | "Audit ready"
  | "Contacted"
  | "Report viewed"
  | "Follow-up due"
  | "Meeting booked"
  | "Won"
  | "Lost";

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
