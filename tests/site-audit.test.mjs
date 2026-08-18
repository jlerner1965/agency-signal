import test from "node:test";
import assert from "node:assert/strict";
import { analyzeWebsitePages, extractBusinessMetadata, extractInternalLinks, mergeLighthouseAudit } from "../lib/site-audit.js";

test("prioritizes conversion and service pages from the same site", () => {
  const html = '<a href="/blog/post">Blog</a><a href="/services">Services</a><a href="https://example.com/contact?x=1">Contact</a><a href="https://outside.com/about">Outside</a>';
  assert.deepEqual(extractInternalLinks(html, "https://example.com/", 2), ["https://example.com/contact", "https://example.com/services"]);
});

test("extracts useful business metadata regardless of meta attribute order", () => {
  const html = `<title>Acme Growth</title><meta content="Conversion systems for local companies" name="description"><meta property="og:site_name" content="Acme"><meta content="/share.jpg" property="og:image"><script type="application/ld+json">{"@type":"Organization","name":"Acme LLC"}</script>`;
  assert.deepEqual(extractBusinessMetadata(html, "https://acme.test/"), {
    title: "Acme Growth",
    description: "Conversion systems for local companies",
    siteName: "Acme",
    structuredName: "Acme LLC",
    image: "https://acme.test/share.jpg",
  });
});

test("merges Lighthouse mobile evidence into scores and findings", () => {
  const base = { score: 80, visibility: 80, conversion: 80, technical: 80, trust: 80, findings: [], pagesAudited: 3 };
  const result = mergeLighthouseAudit(base, { performance: 42, accessibility: 72, seo: 81, bestPractices: 65, lcp: "4.8 s", inp: "320 ms", cls: "0.18" }, "https://example.com/");
  assert.ok(result.technical < base.technical);
  assert.equal(result.lighthouse.performance, 42);
  assert.match(result.findings[0].evidence, /Lighthouse/);
  assert.ok(result.findings.some((finding) => finding.title === "Mobile performance needs attention"));
});

test("creates evidence-backed conversion findings across multiple pages", () => {
  const result = analyzeWebsitePages([
    { url: "https://example.com/", html: '<html><head><title>Example business website title</title><meta name="description" content="A sufficiently complete description that explains this example business and its services to prospective customers."><meta name="viewport" content="width=device-width"><link rel="canonical" href="https://example.com/"></head><body><h1>Example Business</h1><a href="/about">About</a></body></html>' },
    { url: "https://example.com/about", html: '<html><head><title>About Example Business</title></head><body><h1>About</h1></body></html>' },
  ]);
  assert.equal(result.pagesAudited, 2);
  assert.ok(result.findings.some((finding) => finding.title === "No direct lead form was found"));
  assert.ok(result.conversionScore === undefined);
  assert.ok(result.conversion < 100);
});
