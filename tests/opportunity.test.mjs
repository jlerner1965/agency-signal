import test from "node:test";
import assert from "node:assert/strict";
import { buildOpportunity } from "../lib/opportunity.js";

const base = { score: 55, conversionScore: 35, visibilityScore: 62, technicalScore: 73, trustScore: 70, reportViews: 0, email: "owner@example.com", phone: "" };

test("matches the weakest audit category to a service offer", () => {
  const opportunity = buildOpportunity(base, [{ severity: "High", title: "No lead form", affectedUrl: "https://example.com/contact" }]);
  assert.equal(opportunity.primaryService, "Conversion optimization");
  assert.equal(opportunity.recommendedOffer, "Lead-generation website sprint");
  assert.match(opportunity.outreachAngle, /No lead form/);
});

test("raises priority when a prospect engages with the report", () => {
  const cold = buildOpportunity(base, []);
  const engaged = buildOpportunity({ ...base, reportViews: 3 }, []);
  assert.ok(engaged.priorityScore > cold.priorityScore);
  assert.equal(engaged.nextAction, "Follow up while interest is warm");
});

test("does not fabricate an offer before an audit", () => {
  const opportunity = buildOpportunity({ ...base, score: 0 }, []);
  assert.equal(opportunity.priorityLabel, "Needs audit");
  assert.equal(opportunity.nextAction, "Run website audit");
});

