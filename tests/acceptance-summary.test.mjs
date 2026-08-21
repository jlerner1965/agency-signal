import test from "node:test";
import assert from "node:assert/strict";
import { formatBatch, summarizeBatch } from "../lib/acceptance-summary.js";

const prospect = (name) => ({ name });

/** A site read in full and scored. */
const clean = {
  prospect: prospect("Grove Dental"),
  run: { reachable: true, overallScore: 62, confidence: 81 },
  diagnostics: { pagesReached: 7, pagesAttempted: 7, navigationServerRendered: true, blockedResponses: [] },
  coverageFindings: 3,
};

/** Read, but not all of it, and the navigation never reached the HTML. */
const partial = {
  prospect: prospect("Halstead Roofing"),
  run: { reachable: true, overallScore: 41, confidence: 64 },
  diagnostics: {
    pagesReached: 3, pagesAttempted: 6, navigationServerRendered: false, truncatedBy: "",
    blockedResponses: [{ url: "https://halstead.example/quote", status: 403, server: "cloudflare", cfRay: "abc" }],
  },
  coverageFindings: 1,
};

/** Refused outright. */
const blocked = {
  prospect: prospect("Bridge Dental"),
  run: { reachable: false, overallScore: null, confidence: 0 },
  diagnostics: {
    pagesReached: 0, pagesAttempted: 1, navigationServerRendered: null,
    blockedResponses: [{ url: "https://bridge.example/", status: 403, server: "cloudflare", cfRay: "def" }],
  },
  coverageFindings: 0,
};

/** Read, but too little of the rubric could be verified to report a score. */
const unscored = {
  prospect: prospect("Lake Chiro"),
  run: { reachable: true, overallScore: null, confidence: 38 },
  diagnostics: { pagesReached: 2, pagesAttempted: 2, navigationServerRendered: false, blockedResponses: [] },
  coverageFindings: 2,
};

test("counts what was read, what was partial, and what refused", () => {
  const summary = summarizeBatch([clean, partial, blocked, unscored]);
  assert.equal(summary.total, 4);
  assert.equal(summary.read, 3);
  assert.equal(summary.blocked, 1);
  assert.equal(summary.blockedNames, "Bridge Dental");
  // Partial is reached-below-attempted, which is the case a pass/fail line hides.
  assert.equal(summary.partial, 1);
  assert.equal(summary.partialNames, "Halstead Roofing");
});

test("a site that was read but could not be scored is not counted as unread", () => {
  const summary = summarizeBatch([clean, unscored]);
  assert.equal(summary.read, 2);
  assert.equal(summary.scored, 1);
  assert.deepEqual(summary.scores, [62]);
  // The confidence spread is what says whether the threshold is set right, so
  // the run that fell under it has to be in the range.
  assert.equal(summary.confidenceMin, 38);
  assert.equal(summary.confidenceMax, 81);
});

test("who refused is tallied across prospects, not per site", () => {
  const summary = summarizeBatch([partial, blocked]);
  assert.deepEqual(summary.servers, [{ label: "HTTP 403 · cloudflare · Cloudflare", count: 2 }]);

  const mixed = summarizeBatch([
    partial,
    { ...blocked, diagnostics: { ...blocked.diagnostics, blockedResponses: [{ url: "https://x.example/", status: 429, server: "sucuri", cfRay: "" }] } },
  ]);
  assert.deepEqual(mixed.servers.map((entry) => entry.label).sort(), ["HTTP 403 · cloudflare · Cloudflare", "HTTP 429 · sucuri"]);
});

test("only a stated false counts as JS-rendered navigation", () => {
  // null is "the crawl could not tell", which is not the same claim.
  const summary = summarizeBatch([clean, partial, unscored, blocked]);
  assert.equal(summary.jsNav, 2);
  assert.equal(summary.jsNavNames, "Halstead Roofing, Lake Chiro");
});

test("a run that never finished is neither read nor refused", () => {
  const summary = summarizeBatch([clean, { prospect: prospect("Timed Out") }]);
  assert.equal(summary.total, 2);
  assert.equal(summary.unfinished, 1);
  assert.equal(summary.read, 1);
  assert.equal(summary.blocked, 0);
});

test("an empty batch reports nothing rather than dividing by it", () => {
  const summary = summarizeBatch([]);
  assert.equal(summary.total, 0);
  assert.equal(summary.confidenceMin, null);
  assert.deepEqual(summary.scores, []);
  assert.doesNotThrow(() => formatBatch(summary));
});

test("the printed lines carry the counts and the threshold", () => {
  const text = formatBatch(summarizeBatch([clean, partial, blocked, unscored])).join("\n");
  assert.match(text, /Read {2,}3\/4 \(1 partially — Halstead Roofing\)/);
  assert.match(text, /Could not be read {2,}1 {2}— Bridge Dental/);
  assert.match(text, /2 × HTTP 403 · cloudflare · Cloudflare/);
  assert.match(text, /Scored {2,}2\/3 {2}— 41, 62/);
  assert.match(text, /below 60% a run is not scored/);
  assert.match(text, /Service coverage {2,}3\/4/);
});
