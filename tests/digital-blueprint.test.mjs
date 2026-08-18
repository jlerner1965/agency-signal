import test from "node:test";
import assert from "node:assert/strict";
import { buildDigitalBlueprint } from "../lib/digital-blueprint.js";

test("turns audit findings into a scoped implementation blueprint", () => {
  const lead = { agencyName: "Acme", carrier: "HVAC", score: 48 };
  const findings = [{ category: "Conversion", severity: "High", title: "No direct lead form was found", evidence: "No form", recommendation: "Add a short quote form.", impact: "Capture demand" }];
  const result = buildDigitalBlueprint(lead, findings, { reviewed: false, score: 0, findings: [] });
  assert.equal(result.recommendations.length, 1);
  assert.equal(result.sitemap[0], "Home");
  assert.ok(result.projectedScore > result.currentScore);
  assert.match(result.recommendations[0].action, /quote form/i);
});
