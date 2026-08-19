import test from "node:test";
import assert from "node:assert/strict";
import { backoffSeconds, retryPolicy, unverifiedReasons, confidenceOf } from "../lib/audit/scoring-config.js";

test("backoff grows exponentially and is capped", () => {
  assert.deepEqual([1, 2, 3, 4].map(backoffSeconds), [4, 8, 16, 32]);
  assert.equal(backoffSeconds(10), retryPolicy.maxDelaySeconds);
  // Four attempts spread over roughly a minute, which clears a PageSpeed
  // 100-second rate window without hammering it.
  const total = [1, 2, 3].reduce((sum, attempt) => sum + backoffSeconds(attempt), 0);
  assert.ok(total >= 28 && total <= 120, `unexpected total backoff ${total}s`);
});

test("the three unmeasured outcomes are distinct values", () => {
  const values = Object.values(unverifiedReasons);
  assert.equal(new Set(values).size, values.length);
  assert.ok(values.includes("retries-exhausted"));
  assert.ok(values.includes("host-unreachable"));
  assert.ok(values.includes("source-unavailable"));
});

test("retries-exhausted checks still count against confidence", () => {
  // Giving up on a source must lower confidence, not quietly shrink the rubric.
  const checks = [
    { id: "a", weight: 10, status: "passed", earned: 10 },
    { id: "b", weight: 10, status: "unverified", earned: 0, unverifiedReason: unverifiedReasons.RETRIES_EXHAUSTED },
  ];
  assert.equal(confidenceOf(checks), 50);
});

test("category weights sum to one and no category can carry the score", async () => {
  const { categoryWeights, maximumCategoryWeight } = await import("../lib/audit/scoring-config.js");
  const weights = Object.values(categoryWeights);
  assert.equal(Math.round(weights.reduce((sum, weight) => sum + weight, 0) * 100), 100);
  for (const [category, weight] of Object.entries(categoryWeights)) {
    assert.ok(weight <= maximumCategoryWeight, `${category} at ${weight} exceeds the cap`);
  }
});

test("technical is weighted below the categories that actually discriminate", async () => {
  const { categoryWeights } = await import("../lib/audit/scoring-config.js");
  // A site-builder template passes most of the technical rubric for free, so a
  // technical score says little about whether a prospect is worth pitching.
  assert.ok(categoryWeights.Technical < categoryWeights.Conversion);
  assert.ok(categoryWeights.Technical < categoryWeights.Visibility);
});

test("the SERP provider defaults to the one that costs nothing to start", async () => {
  const { defaultSerpProvider, serpProviders, unitCosts } = await import("../lib/audit/cost-config.js");
  assert.equal(defaultSerpProvider, "serpapi");
  const provider = serpProviders[defaultSerpProvider];
  // 3 queries across a 50-prospect campaign fits inside the free allowance.
  assert.ok(provider.freeSearchesPerMonth >= 150);
  assert.equal(unitCosts[provider.unit].cents, 0);
  // The cheaper-per-call alternative stays costed and selectable.
  assert.ok(unitCosts[serpProviders.dataforseo.unit].cents > 0);
});
