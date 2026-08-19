import test from "node:test";
import assert from "node:assert/strict";
import { analyzeServiceLines, extractSiteServices, extractGoogleServices } from "../lib/audit/analyze-service-lines.js";
import { analyzeGooglePresence } from "../lib/audit/analyze-google.js";

const page = (path, overrides = {}) => ({
  ok: true, status: 200, url: `https://clinic.test${path}`,
  title: "", h1: [], h2: [], text: "", links: [], navLinks: [], jsonLd: [], ...overrides,
});

// A multi-service clinic: the case the whole tool exists for.
const CLINIC_PAGES = [
  page("/", { title: "Boulder Vitality", h1: ["Whole-person care"] }),
  page("/services/hormone-therapy", { title: "Hormone Therapy", h1: ["Hormone Therapy"] }),
  page("/services/functional-medicine", { title: "Functional Medicine", h1: ["Functional Medicine"] }),
  page("/services/aesthetics", { title: "Aesthetics", h1: ["Medical Aesthetics"] }),
  page("/about", { title: "About", h1: ["About us"] }),
];
const CLINIC_NAV = [
  { url: "https://clinic.test/services/hormone-therapy", text: "Hormone Therapy" },
  { url: "https://clinic.test/services/functional-medicine", text: "Functional Medicine" },
  { url: "https://clinic.test/services/aesthetics", text: "Aesthetics" },
  { url: "https://clinic.test/about", text: "About" },
  { url: "https://clinic.test/contact", text: "Contact" },
];

const payloads = (googleProfile, extra = {}) => [
  { source: "crawl", ok: true, payload: { pages: CLINIC_PAGES, navigation: CLINIC_NAV, manual: extra.manual ?? {} } },
  { source: "places", ok: Boolean(googleProfile), failureReason: googleProfile ? "" : "no key", payload: googleProfile },
  ...(extra.enrichment ? [{ source: "service-extraction", ok: true, payload: extra.enrichment }] : []),
];

test("services come from navigation, service pages and structured data", () => {
  const services = extractSiteServices(CLINIC_PAGES, CLINIC_NAV);
  const names = services.map((service) => service.name).sort();
  // One page is one service line: the nav label "Aesthetics" and the page's own
  // heading "Medical Aesthetics" must not become two.
  assert.deepEqual(names, ["Functional Medicine", "Hormone Therapy", "Medical Aesthetics"]);
  // Navigation chrome is not a service line.
  assert.ok(!names.includes("About"));
  assert.ok(!names.includes("Contact"));
});

test("structured data contributes services a nav might miss", () => {
  const withSchema = [...CLINIC_PAGES, page("/iv-therapy", {
    jsonLd: [{ "@type": "MedicalTherapy", name: "IV Nutrient Therapy" }],
  })];
  const names = extractSiteServices(withSchema, CLINIC_NAV).map((service) => service.name);
  assert.ok(names.includes("IV Nutrient Therapy"));
});

test("every service the site sells but Google omits is a high-severity finding", () => {
  // Google flattens this clinic to one category. That is the whole premise.
  const result = analyzeServiceLines(payloads({
    primaryTypeDisplayName: { text: "Medical clinic" },
    types: ["doctor", "health"],
  }));

  const gaps = result.findings.filter((finding) => finding.title.includes("invisible on Google"));
  assert.equal(gaps.length, 3, "all three service lines are unrepresented");
  for (const gap of gaps) {
    assert.equal(gap.severity, "High");
    assert.match(gap.impactNote, /flattens a multi-service business/);
    assert.equal(gap.impactScore, 5);
  }
  assert.deepEqual(result.serviceLines.map((line) => line.googleRepresented), [false, false, false]);
});

test("a service Google does represent is not reported as a gap", () => {
  const result = analyzeServiceLines(payloads({
    primaryTypeDisplayName: { text: "Hormone therapy clinic" },
    editorialSummary: { text: "Functional medicine and aesthetics" },
  }));
  assert.deepEqual(result.findings.filter((finding) => finding.title.includes("invisible on Google")), []);
  assert.ok(result.serviceLines.every((line) => line.googleRepresented === true));
});

test("with no Google data the coverage check is unverified, not failed", () => {
  const result = analyzeServiceLines(payloads(null));
  const coverage = result.checks.find((check) => check.id === "google-coverage");
  assert.equal(coverage.status, "unverified");
  // An unknown profile must never read as a profile with gaps.
  assert.deepEqual(result.findings.filter((finding) => finding.title.includes("invisible on Google")), []);
});

test("a service line with no dedicated page is flagged separately", () => {
  const navOnly = [...CLINIC_NAV, { url: "https://clinic.test/services", text: "Peptide Therapy" }];
  const result = analyzeServiceLines([
    { source: "crawl", ok: true, payload: { pages: CLINIC_PAGES, navigation: navOnly, manual: {} } },
    { source: "places", ok: false, failureReason: "no key", payload: null },
  ]);
  const orphan = result.findings.find((finding) => finding.title === "Services are sold without a page that can rank");
  assert.ok(orphan, "expected an orphan-service finding");
  assert.match(orphan.evidence, /Peptide Therapy/);
});

test("LLM enrichment can add candidates but never removes or re-rates one", () => {
  const result = analyzeServiceLines(payloads(null, {
    enrichment: { services: [{ name: "Peptide Therapy" }, { name: "Read more" }, { name: "Hormone Therapy" }] },
  }));
  const names = result.serviceLines.map((line) => line.name);
  assert.ok(names.includes("Peptide Therapy"), "a genuine new candidate is added");
  assert.ok(!names.includes("Read more"), "boilerplate is rejected by the same filter");
  assert.equal(names.filter((name) => name === "Hormone Therapy").length, 1, "no duplicate of a site-named service");
});

test("an unreadable site yields no coverage verdict at all", () => {
  const result = analyzeServiceLines([
    { source: "crawl", ok: false, failureReason: "HTTP 403 from cloudflare", payload: null },
  ]);
  assert.equal(result.reachable, false);
  assert.equal(result.checks.length, 0);
  assert.match(result.findings[0].impactNote, /missing data, not evidence of poor coverage/);
});

test("google services are read from category, types and manual entry", () => {
  const services = extractGoogleServices(
    { primaryTypeDisplayName: { text: "Wellness center" }, types: ["spa"] },
    { googlePrimaryCategory: "Functional medicine" },
  );
  const names = services.map((service) => service.name);
  assert.ok(names.includes("Wellness center"));
  assert.ok(names.includes("Functional medicine"));
});

test("manual-check fields are listed as not measured until a person enters them", () => {
  const result = analyzeGooglePresence([
    { source: "crawl", ok: true, payload: { pages: [{ ok: true, text: "" }] } },
    { source: "places", ok: true, payload: { primaryTypeDisplayName: { text: "Clinic" }, userRatingCount: 50, regularOpeningHours: { weekdayDescriptions: Array(7).fill("d") }, businessStatus: "OPERATIONAL" } },
    { source: "manual-entry", ok: true, payload: { reviewed: false } },
  ]);
  const manualIds = ["gbp-posts", "gbp-responses", "gbp-photos", "gbp-completeness"];
  const manual = result.checks.filter((check) => manualIds.includes(check.id));
  assert.equal(manual.length, 4);
  for (const check of manual) {
    assert.equal(check.status, "unverified");
    assert.equal(check.unverifiedReason, "not-applicable");
    assert.match(check.evidence, /does not expose/i);
  }
  assert.equal(result.manualChecks.length, 4);
});

test("entered manual values feed the same checks as API data", () => {
  const result = analyzeGooglePresence([
    { source: "crawl", ok: true, payload: { pages: [{ ok: true, text: "" }] } },
    { source: "places", ok: true, payload: { primaryTypeDisplayName: { text: "Clinic" }, userRatingCount: 50, regularOpeningHours: { weekdayDescriptions: Array(7).fill("d") }, businessStatus: "OPERATIONAL" } },
    { source: "manual-entry", ok: true, payload: { reviewed: true, googlePhotoCount: 40, googleResponseRate: 90, googleProfileCompleteness: 95, googlePostRecencyDays: 7 } },
  ]);
  const photos = result.checks.find((check) => check.id === "gbp-photos");
  assert.equal(photos.status, "passed");
  assert.equal(result.manualChecks.length, 0);
});
