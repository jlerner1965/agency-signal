import test from "node:test";
import assert from "node:assert/strict";
import { analyzeWebsitePages, extractInternalLinks } from "../lib/site-audit.js";

test("prioritizes conversion and service pages from the same site", () => {
  const html = '<a href="/blog/post">Blog</a><a href="/services">Services</a><a href="https://example.com/contact?x=1">Contact</a><a href="https://outside.com/about">Outside</a>';
  assert.deepEqual(extractInternalLinks(html, "https://example.com/", 2), ["https://example.com/contact", "https://example.com/services"]);
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
