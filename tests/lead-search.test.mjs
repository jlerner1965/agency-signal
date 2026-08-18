import assert from "node:assert/strict";
import test from "node:test";
import { buildDailyQueue, filterLeadRows, matchesLeadSearch, nextLeadAction } from "../lib/lead-search.js";

const leads = [
  {
    agencyName: "Front Range Services",
    contactName: "Sarah Mitchell",
    carrier: "Home services",
    city: "Fort Collins",
    state: "CO",
    website: "https://frontrange.example.com",
    email: "sarah@frontrange.example.com",
    phone: "+1 (970) 555-0100",
    status: "Audited",
    notes: "Interested in local visibility",
    score: 58,
    reportViews: 0,
    nextFollowUpAt: null,
  },
  {
    agencyName: "Summit Dental",
    contactName: "Marcus Reed",
    carrier: "Dental",
    city: "Denver",
    state: "CO",
    website: "https://summit.example.com",
    email: "marcus@summit.example.com",
    phone: "+1 (303) 555-0199",
    status: "Discovery scheduled",
    notes: "Requested implementation quote",
    score: 74,
    reportViews: 3,
    nextFollowUpAt: "2026-08-20T15:00:00Z",
  },
];

test("searches names and locations with multiple words", () => {
  assert.equal(matchesLeadSearch(leads[0], "sarah fort"), true);
  assert.equal(matchesLeadSearch(leads[1], "sarah fort"), false);
});

test("searches contact fields, website, status, and notes", () => {
  assert.equal(matchesLeadSearch(leads[1], "303 555 0199"), true);
  assert.equal(matchesLeadSearch(leads[1], "summit.example"), true);
  assert.equal(matchesLeadSearch(leads[1], "discovery quote"), true);
});

test("global search overrides section and stage filters", () => {
  const rows = filterLeadRows(leads, {
    section: "Audits",
    statusFilter: "Lost",
    query: "Marcus",
  });
  assert.deepEqual(rows.map((lead) => lead.agencyName), ["Summit Dental"]);
});

test("daily queue prioritizes due follow-ups, engagement, and audited leads", () => {
  const queue = buildDailyQueue([
    { ...leads[0], agencyName: "Audit Ready" },
    { ...leads[1], agencyName: "Warm Report", status: "Contacted", nextFollowUpAt: null },
    { ...leads[0], agencyName: "Due Now", status: "Contacted", nextFollowUpAt: "2026-08-17T12:00:00Z" },
    { ...leads[0], agencyName: "Closed", status: "Won" },
  ], new Date("2026-08-18T12:00:00Z"));
  assert.deepEqual(queue.map((lead) => lead.agencyName), ["Due Now", "Warm Report", "Audit Ready"]);
  assert.equal(nextLeadAction(queue[0], new Date("2026-08-18T12:00:00Z")), "Follow up now");
});
