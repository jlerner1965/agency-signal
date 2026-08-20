import test from "node:test";
import assert from "node:assert/strict";
import { backoffSeconds, retryPolicy, unverifiedReasons, confidenceOf, scopedChecks, minimumConfidence } from "../lib/audit/scoring-config.js";

test("a transient failure backs off in seconds", () => {
  assert.deepEqual([1, 2, 3, 4].map((attempt) => backoffSeconds(attempt)), [4, 8, 16, 32]);
  assert.equal(backoffSeconds(10), retryPolicy.maxDelaySeconds);
});

test("a throttle waits for the quota window, not for a blip", () => {
  // The old curve spent all three deferrals inside 28 seconds, which is shorter
  // than the window it was waiting on — so every attempt hit the same closed
  // window and the run reported the checks as not measured. The attempts have
  // to land in different windows to be worth spending.
  const throttled = [1, 2, 3].map((attempt) => backoffSeconds(attempt, { throttled: true }));
  assert.deepEqual(throttled, [30, 60, 120]);

  const total = throttled.reduce((sum, wait) => sum + wait, 0);
  assert.ok(total >= 120, `three throttled deferrals only span ${total}s`);
  assert.ok(throttled.every((wait, index) => wait > backoffSeconds(index + 1)), "a throttle must wait longer than a blip");
  assert.equal(backoffSeconds(99, { throttled: true }), retryPolicy.throttleMaxDelaySeconds);
});

test("a source that names its own wait is believed over the curve", () => {
  assert.equal(backoffSeconds(1, { throttled: true, retryAfterSeconds: 45 }), 45);
  // Even on the first attempt, where the curve would have said 4.
  assert.equal(backoffSeconds(1, { retryAfterSeconds: 12 }), 12);
  // But never beyond the cap, so a hostile header cannot stall a run.
  assert.equal(backoffSeconds(1, { throttled: true, retryAfterSeconds: 86_400 }), retryPolicy.throttleMaxDelaySeconds);
  assert.equal(backoffSeconds(1, { retryAfterSeconds: 86_400 }), retryPolicy.maxDelaySeconds);
  // A missing or unparseable header falls back rather than waiting zero.
  assert.equal(backoffSeconds(2, { throttled: true, retryAfterSeconds: 0 }), 60);
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

// A withheld score must mean "not enough verified", never "a module was
// switched off". These pin that distinction.

test("a source that was never configured leaves the rubric entirely", () => {
  const checks = [
    { id: "a", weight: 10, status: "passed", earned: 10 },
    { id: "b", weight: 10, status: "failed", earned: 0 },
    { id: "gbp", weight: 20, status: "unverified", earned: 0, unverifiedReason: unverifiedReasons.SOURCE_UNAVAILABLE },
  ];
  // Without the exclusion this is 20/40 = 50% and the gate withholds a score
  // purely because a key is absent.
  assert.equal(scopedChecks(checks).length, 2);
  assert.equal(confidenceOf(checks), 100);
});

test("a check with nothing to measure does not count against coverage", () => {
  const checks = [
    { id: "a", weight: 10, status: "passed", earned: 10 },
    { id: "alt", weight: 10, status: "unverified", earned: 0, unverifiedReason: unverifiedReasons.NOT_APPLICABLE },
  ];
  assert.equal(confidenceOf(checks), 100);
});

test("a source we tried and gave up on still counts against coverage", () => {
  const checks = [
    { id: "a", weight: 10, status: "passed", earned: 10 },
    { id: "psi", weight: 10, status: "unverified", earned: 0, unverifiedReason: unverifiedReasons.RETRIES_EXHAUSTED },
  ];
  assert.equal(scopedChecks(checks).length, 2);
  assert.equal(confidenceOf(checks), 50);
});

test("the real no-Places-key shape clears the gate on covered work alone", () => {
  // Weights taken from a real run: the Google module contributes 17 weight it
  // can never verify without a key, and other modules add 23 more.
  const verified = { id: "v", weight: 80, status: "passed", earned: 80 };
  const gaveUp = { id: "psi", weight: 35, status: "unverified", earned: 0, unverifiedReason: unverifiedReasons.RETRIES_EXHAUSTED };
  const switchedOff = { id: "gbp", weight: 40, status: "unverified", earned: 0, unverifiedReason: unverifiedReasons.SOURCE_UNAVAILABLE };

  const asBuilt = Math.round((80 / 155) * 100);
  assert.ok(asBuilt < minimumConfidence, "counting switched-off sources withheld every score");
  assert.ok(confidenceOf([verified, gaveUp, switchedOff]) >= minimumConfidence, "covered work alone clears the gate");
});

test("an unreachable host still yields no rubric at all", () => {
  // Nothing is in scope, so there is nothing to be confident about.
  const checks = [{ id: "x", weight: 10, status: "unverified", earned: 0, unverifiedReason: unverifiedReasons.HOST_UNREACHABLE }];
  assert.equal(scopedChecks(checks).length, 1, "an unreachable host is a failure to measure, not an out-of-scope source");
  assert.equal(confidenceOf(checks), 0);
});
