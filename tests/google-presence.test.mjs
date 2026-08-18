import test from "node:test";
import assert from "node:assert/strict";
import { buildGooglePresenceAudit } from "../lib/google-presence.js";

test("does not invent a Google score before a profile is reviewed", () => {
  assert.deepEqual(buildGooglePresenceAudit({ googleReviewedAt: null, googleProfileUrl: "", rating: null, reviewCount: 0 }), { reviewed: false, score: 0, findings: [] });
});

test("scores a complete and active Google presence transparently", () => {
  const result = buildGooglePresenceAudit({ googleReviewedAt: "2026-08-18", googleProfileUrl: "https://g.page/example", rating: 4.8, reviewCount: 140, googleReviewRecencyDays: 7, googleResponseRate: 90, googlePhotoCount: 30, googlePostRecencyDays: 14, googleProfileCompleteness: 95, googleNapConsistent: true });
  assert.equal(result.reviewed, true);
  assert.ok(result.score >= 90);
  assert.equal(result.findings.length, 0);
});

test("explains weak Google presence with actionable findings", () => {
  const result = buildGooglePresenceAudit({ googleReviewedAt: "2026-08-18", googleProfileUrl: "", rating: 3.6, reviewCount: 4, googleReviewRecencyDays: 180, googleResponseRate: 10, googlePhotoCount: 2, googlePostRecencyDays: 180, googleProfileCompleteness: 45, googleNapConsistent: false });
  assert.ok(result.score < 40);
  assert.ok(result.findings.some((item) => item.title.includes("Review volume")));
  assert.ok(result.findings.some((item) => item.title.includes("incomplete")));
});
