import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { analyzeTechnical } from "../lib/audit/analyze-technical.js";
import { scoreChecks, orderFindings, priorityOf, confidenceOf, minimumConfidence } from "../lib/audit/scoring-config.js";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "fixtures");
const load = async (name) => JSON.parse(await readFile(resolve(fixtures, name), "utf8"));

const HTML_GOOD = `<!doctype html><html lang="en"><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="icon" href="/favicon.ico">
<meta property="og:title" content="Front Range Clinic">
<meta property="og:image" content="https://clinic.test/card.png">
<meta name="twitter:card" content="summary_large_image">
</head><body><h1>Clinic</h1></body></html>`;

const HTML_BARE = `<!doctype html><html><head><title>Bare</title></head><body>hi</body></html>`;

function documentPayload(html, overrides = {}) {
  return {
    source: "document",
    requestKey: "technical:document:https://clinic.test/",
    ok: true,
    payload: { status: 200, finalUrl: "https://clinic.test/", server: "nginx", redirected: false, html, ...overrides },
  };
}

function psiPayload(strategy, body) {
  return { source: `pagespeed-${strategy}`, requestKey: `technical:psi:${strategy}:https://clinic.test/`, ok: true, payload: body };
}

test("a blocked site produces no checks and an explicit unread finding", () => {
  const result = analyzeTechnical([{
    source: "document",
    requestKey: "technical:document:https://clinic.test/",
    ok: false,
    failureReason: "The site refused the request with HTTP 403 (cloudflare). This usually means bot protection, not a site problem.",
    payload: { status: 403, finalUrl: "https://clinic.test/", server: "cloudflare" },
  }]);

  assert.equal(result.reachable, false);
  // No checks at all means nothing can be scored — the guarantee that an
  // unreadable site never looks like a site that scored badly.
  assert.equal(result.checks.length, 0);
  assert.equal(scoreChecks(result.checks), null);
  assert.equal(result.findings.length, 1);
  assert.equal(result.findings[0].title, "The website could not be audited");
  assert.match(result.findings[0].evidence, /this is not a low score/i);
});

test("a timeout is reported as unread, not as a failing site", () => {
  const result = analyzeTechnical([{
    source: "document", requestKey: "technical:document:https://slow.test/", ok: false,
    failureReason: "The site did not respond within 20 seconds.",
    payload: { status: 0, finalUrl: "https://slow.test/", server: "" },
  }]);
  assert.equal(result.reachable, false);
  assert.equal(scoreChecks(result.checks), null);
  assert.match(result.message, /did not respond/);
});

test("a healthy site with good Lighthouse scores passes its checks", async () => {
  const good = await load("pagespeed-mobile-good.json");
  const result = analyzeTechnical([
    documentPayload(HTML_GOOD),
    psiPayload("mobile", good),
    psiPayload("desktop", good),
    { source: "notfound-probe", requestKey: "technical:notfound:https://clinic.test/", ok: true, payload: { status: 404, hasBody: true, length: 500 } },
  ]);

  assert.equal(result.reachable, true);
  const failed = result.checks.filter((check) => check.status === "failed");
  assert.deepEqual(failed, [], `unexpected failures: ${failed.map((c) => c.id).join(", ")}`);
  assert.equal(result.findings.length, 0);
  assert.equal(scoreChecks(result.checks), 100);
});

test("a poor site produces findings for each Core Web Vital it misses", async () => {
  const poor = await load("pagespeed-mobile-poor.json");
  const result = analyzeTechnical([
    documentPayload(HTML_BARE),
    psiPayload("mobile", poor),
    psiPayload("desktop", poor),
    { source: "notfound-probe", requestKey: "technical:notfound:https://clinic.test/", ok: true, payload: { status: 200, hasBody: true, length: 500 } },
  ]);

  const ids = result.checks.filter((check) => check.status === "failed").map((check) => check.id);
  for (const expected of ["viewport", "favicon", "social-tags", "notfound", "lh-performance", "cwv-lcp", "cwv-cls", "cwv-tbt", "page-weight", "render-blocking"]) {
    assert.ok(ids.includes(expected), `expected ${expected} to fail`);
  }
  // HTTPS and SEO are fine on this fixture, so the score is low but not zero.
  const score = scoreChecks(result.checks);
  assert.ok(score !== null && score > 0 && score < 50, `unexpected score ${score}`);

  const lcp = result.findings.find((finding) => finding.title === "The main content takes too long to appear");
  assert.equal(lcp.severity, "High");
  assert.match(lcp.evidence, /5\.2 s/);
});

test("checks Lighthouse could not measure stay unverified rather than failing", () => {
  const result = analyzeTechnical([
    documentPayload(HTML_GOOD),
    { source: "pagespeed-mobile", requestKey: "technical:psi:mobile:https://clinic.test/", ok: false, failureReason: "PageSpeed returned HTTP 500.", payload: null },
    { source: "pagespeed-desktop", requestKey: "technical:psi:desktop:https://clinic.test/", ok: false, failureReason: "PageSpeed returned HTTP 500.", payload: null },
  ]);

  assert.equal(result.reachable, true);
  const unverified = result.checks.filter((check) => check.status === "unverified").map((check) => check.id);
  assert.ok(unverified.includes("lh-performance"));
  assert.ok(unverified.includes("cwv-lcp"));
  // The direct checks still verified, so the site is scored on what we could see.
  assert.equal(scoreChecks(result.checks), 100);
  assert.match(result.message, /Lighthouse was unavailable/);
});

test("findings order by impact over effort, so the fastest win leads", () => {
  const ordered = orderFindings([
    { severity: "High", title: "Slow", impactScore: 4, effortScore: 4 },
    { severity: "Medium", title: "Favicon", impactScore: 2, effortScore: 1 },
    { severity: "High", title: "Viewport", impactScore: 5, effortScore: 1 },
  ]);
  assert.deepEqual(ordered.map((finding) => finding.title), ["Viewport", "Favicon", "Slow"]);
  assert.deepEqual(ordered.map((finding) => finding.sortOrder), [1, 2, 3]);
  assert.equal(priorityOf({ impactScore: 5, effortScore: 2 }), 2.5);
});

test("severity defaults apply when a finding does not state impact or effort", () => {
  const [high] = orderFindings([{ severity: "High", title: "No numbers" }]);
  assert.equal(high.impactScore, 5);
  assert.equal(high.effortScore, 3);
});

test("a site measured only by the direct checks falls below the confidence gate", () => {
  // The real pypi.org run: PageSpeed answered 429 unkeyed, so only the direct
  // document checks verified. Every one of them passed, which would otherwise
  // report a confident 100.
  const result = analyzeTechnical([
    documentPayload(HTML_GOOD),
    { source: "pagespeed-mobile", requestKey: "technical:psi:mobile:https://clinic.test/", ok: false, failureReason: "PageSpeed rate-limited the request.", payload: null },
    { source: "pagespeed-desktop", requestKey: "technical:psi:desktop:https://clinic.test/", ok: false, failureReason: "PageSpeed rate-limited the request.", payload: null },
    { source: "notfound-probe", requestKey: "technical:notfound:https://clinic.test/", ok: true, payload: { status: 404, hasBody: true, length: 500 } },
  ]);

  assert.equal(scoreChecks(result.checks), 100);
  const confidence = confidenceOf(result.checks);
  assert.ok(confidence < minimumConfidence, `expected under-measured, got ${confidence}%`);
});

test("a fully measured site clears the confidence gate", async () => {
  const good = await load("pagespeed-mobile-good.json");
  const result = analyzeTechnical([
    documentPayload(HTML_GOOD),
    psiPayload("mobile", good),
    psiPayload("desktop", good),
    { source: "notfound-probe", requestKey: "technical:notfound:https://clinic.test/", ok: true, payload: { status: 404, hasBody: true, length: 500 } },
  ]);
  assert.equal(confidenceOf(result.checks), 100);
  assert.ok(confidenceOf(result.checks) >= minimumConfidence);
});

test("confidence is zero when there is nothing to measure", () => {
  assert.equal(confidenceOf([]), 0);
});

test("confidence is weighted by the rubric, so trivial checks cannot carry a run", () => {
  // Twelve cheap checks verified and every heavy one unmeasured. Counting
  // checks would clear the gate at 67%; weighting rejects it. Phase 2 roughly
  // doubles the rubric, so this stays pinned.
  const trivial = Array.from({ length: 12 }, (_, index) => ({ id: `trivial-${index}`, weight: 1, status: "passed", earned: 1 }));
  const heavy = [["lh-performance", 6], ["lh-accessibility", 5], ["lh-seo", 4], ["cwv-lcp", 4], ["https", 5], ["viewport", 4]]
    .map(([id, weight]) => ({ id, weight, status: "unverified", earned: 0 }));
  const checks = [...trivial, ...heavy];

  const byCount = Math.round((trivial.length / checks.length) * 100);
  assert.ok(byCount >= minimumConfidence, "the count-based figure would have cleared the gate");
  assert.ok(confidenceOf(checks) < minimumConfidence, "the weighted figure must reject it");
  assert.equal(confidenceOf(checks), 30);
});

test("confidence weights match the weights the score uses", () => {
  // Same checks, same weights: a half-weight run reads as half confidence.
  const checks = [
    { id: "heavy", weight: 10, status: "passed", earned: 10 },
    { id: "light", weight: 10, status: "unverified", earned: 0 },
  ];
  assert.equal(confidenceOf(checks), 50);
  assert.equal(scoreChecks(checks), 100);
});
