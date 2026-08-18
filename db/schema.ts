import { sql } from "drizzle-orm";
import { index, integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const leads = sqliteTable("leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agencyName: text("agency_name").notNull(),
  contactName: text("contact_name").notNull().default(""),
  carrier: text("carrier").notNull().default("Independent"),
  city: text("city").notNull(),
  state: text("state").notNull().default("CO"),
  website: text("website").notNull(),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  status: text("status").notNull().default("Identified"),
  rating: real("rating"),
  reviewCount: integer("review_count").notNull().default(0),
  googleProfileUrl: text("google_profile_url").notNull().default(""),
  placeId: text("place_id").notNull().default(""),
  resolvedWebsiteAt: text("resolved_website_at"),
  googlePrimaryCategory: text("google_primary_category").notNull().default(""),
  googleReviewRecencyDays: integer("google_review_recency_days").notNull().default(0),
  googleResponseRate: integer("google_response_rate").notNull().default(0),
  googlePhotoCount: integer("google_photo_count").notNull().default(0),
  googlePostRecencyDays: integer("google_post_recency_days").notNull().default(0),
  googleProfileCompleteness: integer("google_profile_completeness").notNull().default(0),
  googleNapConsistent: integer("google_nap_consistent", { mode: "boolean" }).notNull().default(false),
  googleReviewedAt: text("google_reviewed_at"),
  score: integer("score").notNull().default(0),
  visibilityScore: integer("visibility_score").notNull().default(0),
  conversionScore: integer("conversion_score").notNull().default(0),
  technicalScore: integer("technical_score").notNull().default(0),
  trustScore: integer("trust_score").notNull().default(0),
  lastContactedAt: text("last_contacted_at"),
  nextFollowUpAt: text("next_follow_up_at"),
  lastAuditAt: text("last_audit_at"),
  reportViews: integer("report_views").notNull().default(0),
  reportToken: text("report_token").notNull().unique(),
  fitScore: integer("fit_score").notNull().default(0),
  needScore: integer("need_score").notNull().default(0),
  intentScore: integer("intent_score").notNull().default(0),
  urgencyScore: integer("urgency_score").notNull().default(0),
  reachabilityScore: integer("reachability_score").notNull().default(0),
  qualificationStatus: text("qualification_status").notNull().default("Unqualified"),
  businessObjective: text("business_objective").notNull().default(""),
  painPoint: text("pain_point").notNull().default(""),
  currentProvider: text("current_provider").notNull().default(""),
  decisionMaker: text("decision_maker").notNull().default(""),
  budgetRange: text("budget_range").notNull().default(""),
  desiredTimeline: text("desired_timeline").notNull().default(""),
  nextCommittedStep: text("next_committed_step").notNull().default(""),
  objection: text("objection").notNull().default(""),
  lossReason: text("loss_reason").notNull().default(""),
  dealValue: integer("deal_value").notNull().default(0),
  sequenceStatus: text("sequence_status").notNull().default("Not started"),
  sequenceStep: integer("sequence_step").notNull().default(0),
  notes: text("notes").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const audits = sqliteTable("audits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull(),
  website: text("website").notNull(),
  score: integer("score").notNull(),
  visibilityScore: integer("visibility_score").notNull(),
  conversionScore: integer("conversion_score").notNull(),
  technicalScore: integer("technical_score").notNull(),
  trustScore: integer("trust_score").notNull(),
  pagesAudited: integer("pages_audited").notNull().default(1),
  responseStatus: integer("response_status"),
  confidenceScore: integer("confidence_score").notNull().default(0),
  checksPassed: integer("checks_passed").notNull().default(0),
  checksFailed: integer("checks_failed").notNull().default(0),
  checksUnverified: integer("checks_unverified").notNull().default(0),
  checkSummary: text("check_summary").notNull().default("[]"),
  lighthouseSummary: text("lighthouse_summary").notNull().default("null"),
  screenshotKey: text("screenshot_key").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const competitorAudits = sqliteTable("competitor_audits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull(),
  name: text("name").notNull(),
  website: text("website").notNull(),
  score: integer("score").notNull(),
  visibilityScore: integer("visibility_score").notNull(),
  conversionScore: integer("conversion_score").notNull(),
  technicalScore: integer("technical_score").notNull(),
  trustScore: integer("trust_score").notNull(),
  pagesAudited: integer("pages_audited").notNull().default(1),
  confidenceScore: integer("confidence_score").notNull().default(0),
  checksPassed: integer("checks_passed").notNull().default(0),
  checksFailed: integer("checks_failed").notNull().default(0),
  checkSummary: text("check_summary").notNull().default("[]"),
  lighthouseSummary: text("lighthouse_summary").notNull().default("null"),
  screenshotKey: text("screenshot_key").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const auditFindings = sqliteTable("audit_findings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  auditId: integer("audit_id").notNull(),
  category: text("category").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  evidence: text("evidence").notNull(),
  recommendation: text("recommendation").notNull(),
  impact: text("impact").notNull(),
  affectedUrl: text("affected_url").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
});

export const reportEvents = sqliteTable("report_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull(),
  eventType: text("event_type").notNull(),
  metadata: text("metadata").notNull().default("{}"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const activities = sqliteTable("activities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull(),
  activityType: text("activity_type").notNull(),
  description: text("description").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const proposals = sqliteTable("proposals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull(),
  token: text("token").notNull().unique(),
  offerId: text("offer_id").notNull(),
  title: text("title").notNull(),
  service: text("service").notNull(),
  outcome: text("outcome").notNull(),
  scope: text("scope").notNull(),
  deliverables: text("deliverables").notNull().default("[]"),
  price: integer("price").notNull(),
  timeline: text("timeline").notNull(),
  status: text("status").notNull().default("Sent"),
  viewCount: integer("view_count").notNull().default(0),
  expiresAt: text("expires_at").notNull(),
  acceptedAt: text("accepted_at"),
  signerName: text("signer_name").notNull().default(""),
  signerEmail: text("signer_email").notNull().default(""),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const aiRuns = sqliteTable("ai_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull(),
  action: text("action").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull().default("Draft"),
  result: text("result").notNull(),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * One execution of the audit module set. Scores are nullable on purpose: a site
 * we could not read must never be storable as a site that scored badly.
 */
export const auditRuns = sqliteTable("audit_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").notNull(),
  website: text("website").notNull(),
  status: text("status").notNull().default("Queued"),
  overallScore: integer("overall_score"),
  visibilityScore: integer("visibility_score"),
  conversionScore: integer("conversion_score"),
  technicalScore: integer("technical_score"),
  trustScore: integer("trust_score"),
  reachable: integer("reachable", { mode: "boolean" }),
  confidence: integer("confidence").notNull().default(0),
  checksVerified: integer("checks_verified").notNull().default(0),
  checksTotal: integer("checks_total").notNull().default(0),
  costCents: integer("cost_cents").notNull().default(0),
  reviewStatus: text("review_status").notNull().default("Unreviewed"),
  error: text("error").notNull().default(""),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("audit_runs_lead_idx").on(table.leadId, table.createdAt)]);

/** Per-module state. This is the job-status surface the dashboard renders. */
export const auditRunModules = sqliteTable("audit_run_modules", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull(),
  module: text("module").notNull(),
  label: text("label").notNull().default(""),
  status: text("status").notNull().default("Queued"),
  attempts: integer("attempts").notNull().default(0),
  message: text("message").notNull().default(""),
  costCents: integer("cost_cents").notNull().default(0),
  findingCount: integer("finding_count").notNull().default(0),
  payloadIds: text("payload_ids").notNull().default("[]"),
  sortOrder: integer("sort_order").notNull().default(0),
  startedAt: text("started_at"),
  finishedAt: text("finished_at"),
}, (table) => [index("audit_run_modules_run_idx").on(table.runId, table.sortOrder)]);

/**
 * Every external response, stored once. Looked up by request key and fetch date
 * so the same target is never fetched twice in a day and a re-score never needs
 * a re-fetch. Failed fetches are stored too — the reason is evidence.
 */
export const rawPayloads = sqliteTable("raw_payloads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull(),
  module: text("module").notNull(),
  source: text("source").notNull(),
  requestKey: text("request_key").notNull(),
  fetchedOn: text("fetched_on").notNull(),
  ok: integer("ok", { mode: "boolean" }).notNull().default(true),
  failureReason: text("failure_reason").notNull().default(""),
  payload: text("payload").notNull().default("null"),
  bytes: integer("bytes").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [
  // The day cache: newest row for a request key on a given date wins.
  index("raw_payloads_cache_idx").on(table.requestKey, table.fetchedOn),
  index("raw_payloads_run_idx").on(table.runId),
]);

/**
 * Supersedes audit_findings for runs produced by the module engine. Impact and
 * effort are 1-5; priority is impact/effort, stored so ordering is queryable.
 */
export const findings = sqliteTable("findings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  runId: integer("run_id").notNull(),
  module: text("module").notNull(),
  category: text("category").notNull(),
  severity: text("severity").notNull(),
  title: text("title").notNull(),
  evidence: text("evidence").notNull(),
  recommendation: text("recommendation").notNull().default(""),
  impactNote: text("impact_note").notNull().default(""),
  impactScore: integer("impact_score").notNull().default(3),
  effortScore: integer("effort_score").notNull().default(3),
  priority: real("priority").notNull().default(0),
  affectedUrl: text("affected_url").notNull().default(""),
  evidenceScreenshotKey: text("evidence_screenshot_key").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
}, (table) => [index("findings_run_idx").on(table.runId, table.sortOrder)]);
