import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
  status: text("status").notNull().default("New"),
  rating: real("rating"),
  reviewCount: integer("review_count").notNull().default(0),
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
  responseStatus: integer("response_status"),
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
