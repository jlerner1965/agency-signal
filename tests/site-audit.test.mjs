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
  const base = analyzeWebsitePages([
    { url: "https://example.com/", html: '<html lang="en"><head><title>Example Company Services in Denver Colorado</title><meta name="description" content="Example Company provides trusted local services for homeowners and businesses in Denver. Request a consultation from our experienced team today."><meta name="viewport" content="width=device-width"></head><body><h1>Trusted services for Denver customers</h1><a href="/services">Services</a><a href="/contact">Contact us</a></body></html>' },
    { url: "https://example.com/contact", html: '<title>Contact Example Company</title><form><label>Name<input id="name"></label></form>' },
    { url: "https://example.com/services", html: '<title>Services from Example Company</title><h1>Services</h1>' },
  ]);
  const result = mergeLighthouseAudit(base, { performance: 42, accessibility: 72, seo: 81, bestPractices: 65, lcp: "4.8 s", inp: "320 ms", cls: "0.18" }, "https://example.com/");
  assert.ok(result.technical < 80);
  assert.equal(result.lighthouse.performance, 42);
  assert.ok(result.findings.some((finding) => /Lighthouse/.test(finding.evidence)));
  assert.ok(result.findings.some((finding) => finding.title === "Mobile performance needs attention"));
});

test("does not award a near-perfect score for a generic template shell", () => {
  const result = analyzeWebsitePages([{ url: "https://example.com/", html: '<html lang="en"><head><title>Example Company</title><meta name="viewport" content="width=device-width"></head><body><h1>Welcome</h1><p>We provide services.</p></body></html>' }]);
  assert.ok(result.score < 60);
  assert.ok(result.confidenceScore < 80);
  assert.ok(result.checksFailed > 5);
  assert.ok(result.checksUnverified > 0);
});

test("reports earned evidence and distinguishes unverified checks", () => {
  const result = analyzeWebsitePages([{ url: "https://example.com/", html: '<html><head><title>A short title</title></head><body><h1>Welcome</h1></body></html>' }]);
  assert.equal(result.checks.length, result.checksPassed + result.checksFailed + result.checksUnverified);
  assert.ok(result.checks.some((item) => item.id === "mobile-performance" && item.status === "unverified"));
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
