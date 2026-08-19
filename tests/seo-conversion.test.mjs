import test from "node:test";
import assert from "node:assert/strict";
import { analyzeSeo, validateSchema } from "../lib/audit/analyze-seo.js";
import { analyzeConversion, describeForm } from "../lib/audit/analyze-conversion.js";
import { categoryWeights, differentiatingCategories, maximumCategoryWeight } from "../lib/audit/scoring-config.js";

const page = (path, overrides = {}) => ({
  ok: true, status: 200, url: `https://clinic.test${path}`,
  title: "", metaDescription: "", canonical: "", h1: [], h2: [], text: "",
  imageCount: 0, imagesWithAlt: 0, links: [], navLinks: [], jsonLd: [],
  telLinks: [], mailtoLinks: [], telAboveFold: false, ctaAboveFold: false,
  forms: [], analytics: {}, bookingLinks: [], trustSignals: {}, ...overrides,
});

const crawl = (pages, navigation = []) => ({ source: "crawl", ok: true, payload: { pages, navigation, manual: {} } });

test("table-stakes categories are weighted below the ones that make the case", () => {
  const differentiating = differentiatingCategories.map((category) => categoryWeights[category]);
  const tableStakes = Object.entries(categoryWeights)
    .filter(([category]) => !differentiatingCategories.includes(category))
    .map(([, weight]) => weight);
  assert.ok(Math.min(...differentiating) > Math.max(...tableStakes));
  assert.equal(Math.round(Object.values(categoryWeights).reduce((a, b) => a + b, 0) * 100), 100);
  for (const weight of Object.values(categoryWeights)) assert.ok(weight <= maximumCategoryWeight);
});

test("schema validity distinguishes complete, incomplete and unassessed types", () => {
  assert.equal(validateSchema({ "@type": "MedicalBusiness", name: "X", address: "Y" }).valid, true);
  assert.equal(validateSchema({ "@type": "LocalBusiness", name: "X" }).valid, false);
  assert.equal(validateSchema({ "@type": "FAQPage", mainEntity: [{ name: "Q", acceptedAnswer: { text: "A" } }] }).valid, true);
  assert.equal(validateSchema({ "@type": "FAQPage", mainEntity: [] }).valid, false);
  // A type we do not assess is not a failure.
  assert.equal(validateSchema({ "@type": "BreadcrumbList" }).valid, null);
});

test("SEO flags missing titles, duplicates and absent schema", () => {
  const result = analyzeSeo([crawl([
    page("/", { title: "Home", h1: ["Home"] }),
    page("/services/a", { title: "Home", h1: ["A"] }),
    page("/services/b", { h1: ["B"] }),
  ])]);
  const failed = result.checks.filter((check) => check.status === "failed").map((check) => check.id);
  assert.ok(failed.includes("seo-titles"));
  assert.ok(failed.includes("seo-title-unique"));
  assert.ok(failed.includes("seo-schema-business"));
  assert.ok(result.checks.every((check) => check.category === "Visibility"));
});

test("SEO passes a well-formed site", () => {
  const good = (path, name) => page(path, {
    title: `${name} at Boulder Vitality Clinic`,
    metaDescription: "A clear description of the service that sits comfortably inside the recommended range for a search snippet.",
    canonical: `https://clinic.test${path}`,
    h1: [name], imageCount: 4, imagesWithAlt: 4,
    jsonLd: [{ "@type": "MedicalBusiness", name: "Boulder Vitality", address: "1 Pearl St" }],
  });
  const result = analyzeSeo([
    crawl([good("/", "Whole-person care"), good("/services/hormone-therapy", "Hormone Therapy")],
      [{ url: "https://clinic.test/services/hormone-therapy", text: "Hormone Therapy" }]),
    { source: "sitemap", ok: true, payload: { urlCount: 12 } },
    { source: "robots", ok: true, payload: { ruleCount: 3 } },
  ]);
  assert.deepEqual(result.checks.filter((check) => check.status === "failed").map((check) => check.id), []);
});

test("an unreadable site produces no SEO verdict", () => {
  const result = analyzeSeo([{ source: "crawl", ok: false, failureReason: "HTTP 403", payload: null }]);
  assert.equal(result.reachable, false);
  assert.equal(result.checks.length, 0);
});

test("form assessment is static and says so, and never posts", () => {
  const result = analyzeConversion([crawl([page("/", {
    forms: [{ method: "post", action: "/enquiry", fields: [{ type: "text", name: "n", required: true }], hasSubmit: true }],
    telLinks: ["+13035550142"], telAboveFold: true, ctaAboveFold: true,
    bookingLinks: [{ url: "https://clinic.test/book", text: "Book" }],
    analytics: { ga4: true }, trustSignals: { bios: true, credentials: true },
  })])]);
  const form = result.checks.find((check) => check.id === "cv-form");
  assert.match(form.evidence, /Form structure inspected; submission not tested\./);
  assert.match(result.message, /Form structure inspected; submission not tested\./);
});

test("a mailto: form is its own high-severity finding", () => {
  const result = analyzeConversion([crawl([page("/", {
    forms: [{ method: "post", action: "mailto:hello@clinic.test", fields: [{ type: "text", name: "n" }], hasSubmit: true }],
  })])]);
  const finding = result.findings.find((item) => item.title === "A form submits to a mailto: address");
  assert.equal(finding.severity, "High");
  assert.match(finding.evidence, /submission not tested/);
  assert.match(finding.impactNote, /fails silently/);
});

test("known form providers are recognised rather than flagged", () => {
  assert.equal(describeForm({ method: "post", action: "https://forms.hsforms.com/x", fields: [{ type: "email", name: "e" }], hasSubmit: true }, "https://c.test/").target, "HubSpot");
  assert.equal(describeForm({ method: "post", action: "https://form.jotform.com/1", fields: [{ type: "text", name: "n" }], hasSubmit: true }, "https://c.test/").problems.length, 0);
});

test("conversion flags a site with no contact path at all", () => {
  const result = analyzeConversion([crawl([page("/", { h1: ["Home"] })])]);
  const failed = result.checks.filter((check) => check.status === "failed").map((check) => check.id);
  for (const id of ["cv-tel", "cv-cta-fold", "cv-booking", "cv-form", "cv-contact-path", "cv-analytics"]) {
    assert.ok(failed.includes(id), `expected ${id} to fail`);
  }
  assert.ok(result.checks.every((check) => check.category === "Conversion"));
});

test("booking depth distinguishes one step from two", () => {
  const oneStep = analyzeConversion([crawl([
    page("/", { bookingLinks: [{ url: "https://clinic.test/book", text: "Book" }] }),
  ])]);
  assert.equal(oneStep.checks.find((check) => check.id === "cv-booking").status, "passed");

  const twoStep = analyzeConversion([crawl([page("/"), page("/contact/book")])]);
  const check = twoStep.checks.find((item) => item.id === "cv-booking");
  assert.equal(check.status, "failed");
  assert.match(check.evidence, /reachable in 2 steps/);
});
