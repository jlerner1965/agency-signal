import test from "node:test";
import assert from "node:assert/strict";
import { checksFromModules, findingsFromRun, summaryFromRun } from "../lib/audit/run-summary.js";
import { brandSourceFromCrawl, extractBrandTokens } from "../lib/audit/brand.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const run = {
  id: 7, leadId: 3, overallScore: 61, visibilityScore: 55, conversionScore: 48,
  technicalScore: 62, trustScore: 70, confidence: 84, checksVerified: 26,
  checksTotal: 31, finishedAt: "2026-08-20T22:00:00Z", createdAt: "2026-08-20T21:55:00Z",
};

const modules = [
  {
    runId: 7, checkSummary: JSON.stringify([
      { id: "seo-title", category: "Visibility", label: "Homepage title", weight: 4, status: "failed", earned: 0, evidence: "The title is the business name alone." },
      { id: "seo-desc", category: "Visibility", label: "Search description", weight: 3, status: "passed", earned: 3, evidence: "A description is present." },
    ]),
  },
  {
    runId: 7, checkSummary: JSON.stringify([
      { id: "tech-cwv", category: "Technical", label: "Core Web Vitals", weight: 5, status: "unverified", earned: 0, evidence: "PageSpeed returned no field data." },
    ]),
  },
  // A module that recorded nothing readable must not take the summary down.
  { runId: 7, checkSummary: "" },
  { runId: 7, checkSummary: "{not json" },
];

test("a run reports itself in the shape the dashboard reads", () => {
  const summary = summaryFromRun(run, modules, { pagesReached: 4, pagesAttempted: 5 });

  assert.equal(summary.id, 7);
  assert.equal(summary.score, 61);
  // All four categories, not Technical alone — the Website tab shows the
  // breakdown, and three of them used to come back as zero on a scored site.
  assert.deepEqual(
    [summary.visibilityScore, summary.conversionScore, summary.technicalScore, summary.trustScore],
    [55, 48, 62, 70],
  );
  // Reached, not attempted.
  assert.equal(summary.pagesAudited, 4);
  assert.equal(summary.confidenceScore, 84);
  // Counted from the checks themselves: verified means measured, which is
  // passed plus failed, so it cannot stand in for either.
  assert.deepEqual(
    [summary.checksPassed, summary.checksFailed, summary.checksUnverified],
    [1, 1, 1],
  );
  assert.equal(JSON.parse(summary.checkSummary).length, 3);
  assert.equal(summary.createdAt, run.finishedAt);
});

test("an unscored run reads as not audited rather than as a zero", () => {
  const summary = summaryFromRun({ ...run, overallScore: null, visibilityScore: null }, modules, null);
  assert.equal(summary.score, 0);
  assert.equal(summary.visibilityScore, 0);
  // No diagnostics is not zero pages claimed with confidence — every reader
  // gates on the score, which is falsy here.
  assert.equal(summary.pagesAudited, 0);
  assert.equal(summaryFromRun(null, [], null), null);
});

test("unreadable module checks are skipped, not thrown over", () => {
  assert.equal(checksFromModules(modules).length, 3);
  assert.deepEqual(checksFromModules([]), []);
  assert.deepEqual(checksFromModules([{ checkSummary: "null" }]), []);
});

test("findings carry their impact note across as the impact the tabs render", () => {
  const mapped = findingsFromRun([{
    id: 11, category: "Conversion", severity: "High", title: "The phone number is not tappable",
    evidence: "The homepage prints it as plain text.", recommendation: "Make it a tel: link.",
    impactNote: "A phone tap does nothing on mobile.", affectedUrl: "https://example.com/", sortOrder: 1,
  }]);
  assert.equal(mapped[0].impact, "A phone tap does nothing on mobile.");
  assert.equal(mapped[0].recommendation, "Make it a tel: link.");
  assert.deepEqual(findingsFromRun(), []);
});

// The shape the collectors actually store is not the shape the crawler
// returns: every page is distilled before storage, and only the homepage keeps
// its markup, under `rawHead`. Reading these pages for `html` — the crawler's
// own field — finds nothing and costs the logo without failing anything, since
// a mockup without a logo is a supported outcome. This fixture is a real stored
// page, trimmed, so the assertion cannot drift from the real thing.
test("brand source is read from the stored page shape, markup and stylesheets both", () => {
  const payload = {
    pages: [{
      url: "https://pypi.org/", status: 200, ok: true, reason: "",
      title: "PyPI · The Python Package Index",
      h1: ["PyPI"], h2: [], text: "Find, install and publish Python packages", links: [], navLinks: [], jsonLd: [],
      // Distilled pages carry the homepage markup here, and no `html` field.
      rawHead: `<html><head><title>PyPI</title></head><body><header>
        <a href="/"><img alt="PyPI" src="/static/images/logo-small.0e0855d0.svg"></a></header></body></html>`,
    }],
    homeCss: ":root{--brand:#006dad}body{font-family:'Source Sans Pro',sans-serif}",
  };

  const { source, url } = brandSourceFromCrawl(payload);
  assert.equal(url, "https://pypi.org/");

  const brand = extractBrandTokens(source, url, "PyPI");
  // The logo lives in the markup and nowhere else, so it is the field that
  // proves the markup half was read.
  assert.equal(brand.logoUrl, "https://pypi.org/static/images/logo-small.0e0855d0.svg");
  // And the palette proves the stylesheet half was read alongside it.
  assert.equal(brand.primary, "#006dad");

  // The field name this depends on. A stored page has no `html`, so reading one
  // for it yields the stylesheets alone — passing here and losing the logo.
  assert.equal(payload.pages[0].html, undefined);
  assert.equal(extractBrandTokens(`${payload.pages[0].html ?? ""}\n${payload.homeCss}`, url, "PyPI").logoUrl, "");
});

test("a page with no kept markup still gives the base URL, not a throw", () => {
  const { source, url } = brandSourceFromCrawl({
    // Only the homepage keeps markup, so a failed homepage means none is kept.
    pages: [
      { url: "https://grove.example/", ok: false, reason: "HTTP 403" },
      { url: "https://grove.example/services", ok: true },
    ],
    homeCss: "body{color:#1f5f4a}",
  });
  assert.equal(url, "https://grove.example/");
  assert.match(source, /#1f5f4a/);

  assert.equal(brandSourceFromCrawl(null).source.trim(), "");
  assert.equal(brandSourceFromCrawl({ pages: [] }).url, "");
});

// The fixture above is only worth its fidelity to what the collectors store, so
// this pins that: they distil every page and keep the homepage's markup.
test("collectors store distilled pages, with the homepage's markup kept", async () => {
  const collector = await readFile(resolve(root, "lib/audit/collect-onpage.ts"), "utf8");
  assert.match(collector, /distillPage\(page, \{ keepMarkup: index === 0 \}\)/);

  const html = await readFile(resolve(root, "lib/audit/html.js"), "utf8");
  // Distillation is where `rawHead` comes from, and it is the markup itself.
  assert.match(html, /rawHead: keepMarkup \? page\.html/);
});
