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

test("a profile listing nothing is one finding, not one per service", () => {
  // Google flattens this clinic to one category. Saying that three times over
  // would overstate it: there is one listing problem, not three. The claim
  // needs somebody to have looked at the services section, which the API does
  // not return.
  const result = analyzeServiceLines(payloads(
    { primaryTypeDisplayName: { text: "Medical clinic" }, types: ["doctor", "health"] },
    { manual: { googleServicesReviewed: true, googleServices: "" } },
  ));

  const listing = result.findings.filter((finding) => finding.title === "The Google profile lists no services at all");
  assert.equal(listing.length, 1);
  assert.equal(listing[0].severity, "High");
  assert.match(listing[0].impactNote, /flattens a multi-service business/);
  assert.deepEqual(result.findings.filter((finding) => /is missing from the Google service list/.test(finding.title)), []);

  // Category fit is its own single finding about the category.
  const category = result.findings.filter((finding) => /^Categorised as/.test(finding.title));
  assert.equal(category.length, 1);
  assert.match(category[0].evidence, /Medical clinic/);

  assert.deepEqual(result.serviceLines.map((line) => line.googleRepresented), [false, false, false]);
});

test("with nobody having checked, the profile is not accused of listing nothing", () => {
  // The Places API does not return the services section for a profile we do not
  // own, so an empty list means "not read", not "empty". Asserting the latter
  // told a prospect their profile lists nothing on no evidence at all.
  const result = analyzeServiceLines(payloads({
    primaryTypeDisplayName: { text: "Medical clinic" },
    types: ["doctor", "health"],
  }));

  assert.deepEqual(result.findings.filter((finding) => finding.title === "The Google profile lists no services at all"), []);

  // The gap is listed rather than omitted, because an omitted check reads as a
  // pass and this one was reading as a finding.
  const listCheck = result.checks.find((check) => check.id === "google-service-list");
  assert.equal(listCheck.status, "unverified");
  assert.match(listCheck.evidence, /does not return the services section/);

  // The category is a fact the profile publishes, so that finding still stands.
  assert.equal(result.findings.filter((finding) => /^Categorised as/.test(finding.title)).length, 1);
  // And the coverage evidence says what it actually compared against.
  const coverage = result.checks.find((check) => check.id === "google-coverage");
  assert.match(coverage.evidence, /the profile's category/);
});

test("an entered service list is compared like an API one", () => {
  const result = analyzeServiceLines(payloads(
    { primaryTypeDisplayName: { text: "Medical clinic" } },
    { manual: { googleServicesReviewed: true, googleServices: "Hormone Therapy, Functional Medicine" } },
  ));
  const gaps = result.findings.filter((finding) => /is missing from the Google service list/.test(finding.title));
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].title, /Medical Aesthetics/);
  // Nothing is unmeasured once a person has entered what the profile lists.
  assert.equal(result.checks.find((check) => check.id === "google-service-list"), undefined);
});

test("when Google does list services, a missing one is its own finding", () => {
  const result = analyzeServiceLines(payloads({
    primaryTypeDisplayName: { text: "Medical clinic" },
    editorialSummary: { text: "Hormone Therapy, Functional Medicine" },
  }));
  const gaps = result.findings.filter((finding) => /is missing from the Google service list/.test(finding.title));
  assert.equal(gaps.length, 1);
  assert.match(gaps[0].title, /Medical Aesthetics/);
  // The finding quotes the site verbatim and names what Google does list.
  assert.match(gaps[0].evidence, /Medical Aesthetics/);
  assert.deepEqual(result.findings.filter((finding) => finding.title === "The Google profile lists no services at all"), []);
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

test("LLM enrichment can add candidates but must cite on the same terms", () => {
  const result = analyzeServiceLines(payloads(null, {
    enrichment: { services: [
      { name: "Peptide Therapy", url: "https://clinic.test/services/peptides", quote: "Peptide Therapy for recovery" },
      { name: "IV Drips" },
      { name: "Read more", url: "https://clinic.test/x", quote: "Read more" },
      { name: "Hormone Therapy", url: "https://clinic.test/services/hormone-therapy", quote: "Hormone Therapy" },
    ] },
  }));
  const names = result.serviceLines.map((line) => line.name);
  assert.ok(names.includes("Peptide Therapy"), "a candidate that cites a page and its text is added");
  assert.ok(!names.includes("IV Drips"), "a candidate with no citation is dropped, not trusted");
  assert.ok(!names.includes("Read more"), "boilerplate is rejected by the same filter");
  assert.equal(names.filter((name) => name === "Hormone Therapy").length, 1, "no duplicate of a site-named service");
  // Everything that survives can point at where it came from.
  for (const line of result.serviceLines) {
    assert.ok(line.quote && line.siteUrl, `${line.name} must cite a source`);
  }
});

test("an unreadable site yields no coverage verdict at all", () => {
  const result = analyzeServiceLines([
    { source: "crawl", ok: false, failureReason: "HTTP 403 from cloudflare", payload: null },
  ]);
  assert.equal(result.reachable, false);
  assert.equal(result.checks.length, 0);
  assert.match(result.findings[0].impactNote, /missing data, not evidence of poor coverage/);
});

test("the profile's category is kept separate from its service list", () => {
  const google = extractGoogleServices(
    { primaryTypeDisplayName: { text: "Wellness center" }, types: ["spa", "wellness_center"] },
    { googleServices: "Massage, Cryotherapy" },
  );
  // A category is not a service list, and conflating them is what produced the
  // false per-service gaps.
  assert.equal(google.category, "Wellness center");
  const listed = google.listed.map((entry) => entry.name);
  assert.ok(listed.includes("Massage"));
  assert.ok(listed.includes("Cryotherapy"));
  assert.ok(!listed.includes("Wellness center"));
  assert.ok(google.all.some((entry) => entry.name === "Wellness center"));
});

test("a profile with no services listed reports an empty list", () => {
  const google = extractGoogleServices({ primaryTypeDisplayName: { text: "Medical clinic" } }, {});
  assert.equal(google.category, "Medical clinic");
  assert.deepEqual(google.listed, []);
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

// A supplier files what it sells under /industries or /products, not /services.
// Matching only the clinic vocabulary is why one of these came back as the
// whole product range.
const SUPPLIER_PAGES = [
  page("/", { title: "AragoCor Minerals", h1: ["Oolitic Aragonite Sized to Your Process"] }),
  page("/industries", { title: "Industries", h1: ["Industries we supply"], h2: ["Glass", "Agriculture", "Polymers"] }),
  page("/industries/water-treatment", { title: "Water Treatment", h1: ["Aragonite for Water Treatment."] }),
  page("/industries/glass", { title: "Glass", h1: ["Aragonite for Glass"] }),
  page("/products/oolitic-aragonite", { title: "Oolitic Aragonite", h1: ["Oolitic Aragonite"] }),
  page("/about", { title: "About", h1: ["About"] }),
];
const SUPPLIER_NAV = [
  { url: "https://clinic.test/industries/water-treatment", text: "Water Treatment" },
  { url: "https://clinic.test/industries/glass", text: "Glass" },
  { url: "https://clinic.test/about", text: "About" },
];

test("what a supplier sells is read from /industries and /products", () => {
  const names = extractSiteServices(SUPPLIER_PAGES, SUPPLIER_NAV).map((service) => service.name);
  assert.ok(names.includes("Aragonite for Glass"), "an industry page is a line the site sells");
  assert.ok(names.includes("Oolitic Aragonite"), "so is a product page");
  // The H2s of whichever index the site publishes are sub-lines of it.
  assert.ok(names.includes("Agriculture"), "index headings count on an /industries page too");
  assert.ok(!names.includes("About"));
});

test("a heading's punctuation is not part of the service name", () => {
  // "Aragonite for Water Treatment." reached the gap table, every mockup
  // heading, and the middle of proposal sentences with the full stop attached.
  const names = extractSiteServices(SUPPLIER_PAGES, SUPPLIER_NAV).map((service) => service.name);
  assert.ok(names.includes("Aragonite for Water Treatment"));
  assert.ok(!names.some((name) => /[.,;:!]$/.test(name)), `a name still ends in punctuation: ${names.join(", ")}`);
});

test("an industries index is not a landing page for the lines it lists", () => {
  const result = analyzeServiceLines([
    { source: "crawl", ok: true, payload: { pages: SUPPLIER_PAGES, navigation: SUPPLIER_NAV, manual: {} } },
    { source: "places", ok: false, failureReason: "no key", payload: null },
  ]);
  const agriculture = result.serviceLines.find((line) => line.name === "Agriculture");
  assert.ok(agriculture, "the line was identified");
  assert.equal(agriculture.hasLandingPage, false, "listed on the index, but it has no page of its own");

  const glass = result.serviceLines.find((line) => line.name === "Aragonite for Glass");
  assert.equal(glass.hasLandingPage, true, "this one does have its own page");
});

test("a line listed on an index and given its own page is one line, not two", () => {
  // The index names it "Glass" and the page calls itself "Aragonite for Glass".
  // Whichever the crawl reaches first, that is one thing the business sells.
  const pages = [
    page("/", { h1: ["Home"] }),
    page("/industries", { h1: ["Industries we supply"], h2: ["Glass", "Agriculture"] }),
    page("/industries/glass", { h1: ["Aragonite for Glass"] }),
  ];
  const names = extractSiteServices(pages, []).map((service) => service.name);
  assert.deepEqual(names.sort(), ["Agriculture", "Aragonite for Glass"]);

  // And in the other crawl order.
  const reversed = [pages[0], pages[2], pages[1]];
  assert.deepEqual(extractSiteServices(reversed, []).map((service) => service.name).sort(), ["Agriculture", "Aragonite for Glass"]);
});

test("an index page's own heading is not a thing the business sells", () => {
  const pages = [
    page("/", { h1: ["Home"] }),
    page("/services", { h1: ["Our Services"], h2: ["Roof Repair", "Gutter Cleaning"] }),
  ];
  const names = extractSiteServices(pages, []).map((service) => service.name);
  assert.deepEqual(names.sort(), ["Gutter Cleaning", "Roof Repair"]);
  assert.ok(!names.includes("Our Services"));
});

test("an index's own label is navigation chrome, not a line", () => {
  const nav = [
    { url: "https://clinic.test/industries", text: "Industries" },
    { url: "https://clinic.test/products", text: "Products" },
    { url: "https://clinic.test/industries/glass", text: "Glass" },
  ];
  const pages = [page("/", { h1: ["Home"] }), page("/industries/glass", { h1: ["Aragonite for Glass"] })];
  const names = extractSiteServices(pages, nav).map((service) => service.name);
  assert.deepEqual(names, ["Aragonite for Glass"]);
});

test("a profile read by a person is a source, not a profile that could not be read", () => {
  const withoutKey = [
    { source: "crawl", ok: true, payload: { pages: [{ ok: true, text: "" }] } },
    { source: "places", ok: false, failureReason: "GOOGLE_PLACES_API_KEY is not configured.", payload: null },
  ];

  // Nobody looked: nothing is measured, and the audit says so.
  const unread = analyzeGooglePresence([...withoutKey, { source: "manual-entry", ok: true, payload: { reviewed: false } }]);
  assert.match(unread.findings[0].title, /could not be assessed/);
  // The reader of a proposal is not told to configure an environment variable.
  assert.doesNotMatch(unread.findings[0].recommendation, /API_KEY|GOOGLE_PLACES/);
  assert.ok(unread.checks.every((check) => check.status === "unverified"));

  // A person looked and recorded what the profile shows. That is measured.
  const read = analyzeGooglePresence([...withoutKey, {
    source: "manual-entry", ok: true,
    payload: {
      reviewed: true, googlePrimaryCategory: "HVAC contractor", googleNapConsistent: true,
      rating: 4.6, reviewCount: 8, googlePhotoCount: 40, googleResponseRate: 90,
      googleProfileCompleteness: 95, googlePostRecencyDays: 7,
    },
  }]);
  assert.ok(!read.findings.some((finding) => /could not be assessed/.test(finding.title)), "the profile was read");
  assert.equal(read.checks.find((check) => check.id === "gbp-category").status, "passed");
  assert.equal(read.checks.find((check) => check.id === "gbp-nap").status, "passed");
  // Eight reviews is thin, and that is a finding rather than an unmeasured check.
  assert.equal(read.checks.find((check) => check.id === "gbp-reviews").status, "failed");
  assert.ok(read.findings.some((finding) => /Review volume is thin/.test(finding.title)));
  // Nobody was asked for opening hours, so it stays unverified rather than passing.
  assert.equal(read.checks.find((check) => check.id === "gbp-hours").status, "unverified");
  assert.match(read.message, /manual review/);
});

