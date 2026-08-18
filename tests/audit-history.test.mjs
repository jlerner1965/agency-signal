import test from "node:test";
import assert from "node:assert/strict";
import { compareAudits } from "../lib/audit-history.js";

test("identifies resolved and regressed audit checks", () => {
  const previous = { id: 1, score: 50, visibilityScore: 50, conversionScore: 45, technicalScore: 55, trustScore: 50, confidenceScore: 80, createdAt: "2026-08-01", checkSummary: JSON.stringify([{ id: "cta", label: "Clear CTA", status: "failed" }, { id: "proof", label: "Customer proof", status: "passed" }]) };
  const current = { id: 2, score: 60, visibilityScore: 53, conversionScore: 61, technicalScore: 60, trustScore: 57, confidenceScore: 85, createdAt: "2026-08-18", checkSummary: JSON.stringify([{ id: "cta", label: "Clear CTA", status: "passed" }, { id: "proof", label: "Customer proof", status: "failed" }]) };
  const comparison = compareAudits(current, previous);
  assert.equal(comparison.scoreDelta, 10);
  assert.deepEqual(comparison.resolved, ["Clear CTA"]);
  assert.deepEqual(comparison.regressed, ["Customer proof"]);
});

test("does not compare legacy audits from the old scoring model", () => {
  assert.equal(compareAudits({ confidenceScore: 80 }, { confidenceScore: 0 }), null);
});
