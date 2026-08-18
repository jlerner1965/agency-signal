import assert from "node:assert/strict";
import test from "node:test";
import { filterLeadRows, matchesLeadSearch } from "../lib/lead-search.js";

const leads = [
  {
    agencyName: "Front Range Insurance",
    contactName: "Sarah Mitchell",
    carrier: "State Farm",
    city: "Fort Collins",
    state: "CO",
    website: "https://frontrange.example.com",
    email: "sarah@frontrange.example.com",
    phone: "+1 (970) 555-0100",
    status: "Audit ready",
    notes: "Interested in local visibility",
    score: 58,
    reportViews: 0,
    nextFollowUpAt: null,
  },
  {
    agencyName: "Summit Coverage",
    contactName: "Marcus Reed",
    carrier: "Independent",
    city: "Denver",
    state: "CO",
    website: "https://summit.example.com",
    email: "marcus@summit.example.com",
    phone: "+1 (303) 555-0199",
    status: "Meeting booked",
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
  assert.equal(matchesLeadSearch(leads[1], "meeting quote"), true);
});

test("global search overrides section and stage filters", () => {
  const rows = filterLeadRows(leads, {
    section: "Audits",
    statusFilter: "Lost",
    query: "Marcus",
  });
  assert.deepEqual(rows.map((lead) => lead.agencyName), ["Summit Coverage"]);
});
