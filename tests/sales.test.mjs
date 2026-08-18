import assert from "node:assert/strict";
import test from "node:test";
import { discoveryPlaybook, nextSequenceDate, offerCatalog, qualificationBreakdown, qualificationLabel, revenueMetrics } from "../lib/sales.js";

const qualified = {
  agencyName: "Northstar Dental",
  status: "Qualified",
  score: 48,
  reportViews: 3,
  email: "owner@example.com",
  phone: "",
  fitScore: 75,
  needScore: 80,
  intentScore: 75,
  urgencyScore: 75,
  reachabilityScore: 75,
  decisionMaker: "Alex Owner",
  nextCommittedStep: "Review scope Friday",
  dealValue: 4500,
};

test("qualification separates buyer readiness from audit need", () => {
  const breakdown = qualificationBreakdown(qualified);
  assert.equal(breakdown.total, 76);
  assert.equal(qualificationLabel(qualified), "Ready to propose");
});

test("discovery playbook is specific to the prospect and finding", () => {
  const playbook = discoveryPlaybook(qualified, { primaryFinding: "No clear booking action" });
  assert.match(playbook.opening, /no clear booking action/i);
  assert.match(playbook.questions[1], /Northstar Dental/);
});

test("revenue metrics report pipeline, proposals, wins, and close rate", () => {
  const metrics = revenueMetrics([
    qualified,
    { ...qualified, agencyName: "Won Co", status: "Won", dealValue: 8500 },
    { ...qualified, agencyName: "Lost Co", status: "Lost", dealValue: 2200 },
  ]);
  assert.equal(metrics.pipelineValue, 4500);
  assert.equal(metrics.revenue, 8500);
  assert.equal(metrics.closeRate, 50);
});

test("offer catalog and sequence dates are deterministic", () => {
  assert.ok(offerCatalog.length >= 5);
  assert.equal(nextSequenceDate(1, new Date("2026-08-18T12:00:00Z")), "2026-08-20T12:00:00.000Z");
});
