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



test("a finding with no URL does not take the report down", () => {
  // affectedUrl is allowed to be empty and several analysers emit it that way.
  // buildOpportunity runs inside the public report route, so parsing it
  // unguarded meant one such finding blanked the page for the prospect.
  const lead = { score: 48, email: "a@b.test", conversionScore: 40, visibilityScore: 50, technicalScore: 60, trustScore: 55, reportViews: 0 };
  const findings = [{ category: "Conversion", severity: "High", title: "No way to make contact", evidence: "e", recommendation: "r", impact: "i", affectedUrl: "", sortOrder: 1 }];

  const opportunity = buildOpportunity(lead, findings);
  assert.match(opportunity.outreachAngle, /No way to make contact/);
  assert.doesNotThrow(() => buildOpportunity(lead, findings));

  // And a malformed one behaves the same way.
  assert.doesNotThrow(() => buildOpportunity(lead, [{ ...findings[0], affectedUrl: "not a url" }]));
});
