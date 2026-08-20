import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildRecommendations, validateEvidence, assertEvidence, groundRationale } from "../lib/audit/recommendations.js";
import { extractBrandTokens, extractPalette } from "../lib/audit/brand.js";
import { buildHomepageMockup, buildServicePageMockup } from "../lib/audit/mockup.js";
import { detectRegister, vocabularyFor } from "../lib/audit/register.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const findings = [
  { id: 1, category: "Service coverage", severity: "High", title: "The Google profile lists no services at all", priority: 2.5 },
  { id: 2, category: "Service coverage", severity: "High", title: "Service lines have no page that can rank", priority: 1.67 },
  { id: 3, category: "Conversion", severity: "High", title: "There is no booking path", priority: 2.5 },
  { id: 4, category: "Conversion", severity: "Medium", title: "Nothing is measuring the site", priority: 2 },
  { id: 5, category: "Trust", severity: "High", title: "Business details differ between the site and Google", priority: 4 },
];

test("recommendations map by rule and cite the findings that justify them", () => {
  const recommendations = buildRecommendations(findings);
  const local = recommendations.find((item) => item.serviceLine === "local-seo");
  assert.ok(local.findingIds.includes(1) && local.findingIds.includes(5));
  const analytics = recommendations.find((item) => item.serviceLine === "analytics");
  assert.deepEqual(analytics.findingIds, [4]);
  // Highest impact-over-effort leads.
  assert.equal(recommendations[0].serviceLine, "local-seo");
});

test("a rebuild is proposed only when failure is broad", () => {
  assert.ok(!buildRecommendations(findings).some((item) => item.serviceLine === "site-rebuild"));
  const broad = [...findings,
    { id: 6, category: "Visibility", severity: "High", title: "Titles missing", priority: 2 },
    { id: 7, category: "Technical", severity: "High", title: "No HTTPS", priority: 2 },
  ];
  const rebuild = buildRecommendations(broad).find((item) => item.serviceLine === "site-rebuild");
  assert.ok(rebuild, "five high-severity findings across three categories justifies a rebuild");
  assert.ok(rebuild.findingIds.length >= 5);
});

test("the evidence gate refuses an unevidenced recommendation", () => {
  assert.equal(validateEvidence([{ label: "X", findingIds: [] }], findings).valid, false);
  assert.match(validateEvidence([{ label: "X", findingIds: [] }], findings).problems[0], /cites no findings/);
  assert.equal(validateEvidence([{ label: "Y", findingIds: [99] }], findings).valid, false);
  // The gate throws rather than rendering a claim nothing supports.
  assert.throws(() => assertEvidence([{ label: "Z", findingIds: [99] }], findings), /failed the evidence check/);
  assert.doesNotThrow(() => assertEvidence(buildRecommendations(findings), findings));
});

test("a citation the model invented makes the whole rationale unusable", () => {
  const grounded = groundRationale("Because F1 shows the gap and F99 confirms it.", [1, 2]);
  assert.deepEqual(grounded.invented, ["99"]);
  assert.equal(grounded.usable, false);
  assert.equal(groundRationale("F1 and F2 both show it.", [1, 2]).usable, true);
});

test("every deliverable declares a trigger this engine can act on", async () => {
  const pricing = JSON.parse(await readFile(resolve(root, "config/pricing.json"), "utf8"));
  const { triggerSources } = await import("../lib/audit/pricing.js");
  for (const [id, deliverable] of Object.entries(pricing.deliverables)) {
    assert.ok(triggerSources[deliverable.triggered_by], `${id} is triggered by "${deliverable.triggered_by}", which maps to no audit module`);
    assert.ok(Object.keys(deliverable.bands ?? {}).length > 0, `${id} has no bands`);
    for (const [key, band] of Object.entries(deliverable.bands)) {
      assert.ok(Number.isFinite(band.min) && Number.isFinite(band.max), `${id}.${key} lacks figures`);
      assert.ok(band.min <= band.max, `${id}.${key} has min above max`);
      assert.ok(band.criteria, `${id}.${key} has no criteria to select it by`);
    }
  }
  assert.ok(Number.isFinite(pricing.minimum_engagement));
  assert.ok(["starts_at", "firm", "range"].includes(pricing.display_mode));
});

test("pricing carries real figures, so nothing blocks on it", async () => {
  const pricing = JSON.parse(await readFile(resolve(root, "config/pricing.json"), "utf8"));
  // The shipped stub set this true; real figures leave it absent.
  assert.notEqual(pricing.placeholder, true);
  assert.equal(pricing.version, 1);
});

test("the voice file is real, and carries the rules the code enforces", async () => {
  const voice = await readFile(resolve(root, "config/voice.md"), "utf8");
  // The detector keys on a sentinel, not the word: this file discusses
  // placeholders in its own rules and must not be read as being one.
  assert.ok(!/<!--\s*voice:placeholder\s*-->/.test(voice), "no stub sentinel");
  assert.ok(!/^PLACEHOLDER VOICE SAMPLE/m.test(voice), "not the shipped stub");
  assert.match(voice, /do not emit a\s+placeholder/i, "the word appears legitimately in the rules");
  // The hard constraints are the part enforced in code; if the file stops
  // stating one, the enforcement has drifted from its source.
  for (const rule of [/Never state a number the audit did not measure/, /Never assert a finding the run didn't verify/, /Never reference a visual the run didn't produce/, /Never name a price absent from config\/pricing\.json/, /Never imply prior contact/]) {
    assert.match(voice, rule);
  }
});

test("brand tokens come from the site, and defaults are reported as defaults", () => {
  const styled = extractBrandTokens(
    '<style>body{color:#22303a;background:#faf8f4}.btn{background:#1f6f5c}.b{background:#1f6f5c}.a{color:#d2703a}</style>',
    "https://clinic.test/", "Clinic",
  );
  assert.equal(styled.primary, "#1f6f5c");
  assert.equal(styled.accent, "#d2703a");
  assert.equal(styled.ink, "#22303a");
  assert.deepEqual(styled.defaulted, []);

  const bare = extractBrandTokens("<p>no styles here</p>", "https://clinic.test/", "Clinic");
  assert.deepEqual(bare.defaulted.sort(), ["accent", "ground", "ink", "primary"]);
  assert.deepEqual(bare.found, []);
});

test("near-white and near-black are not mistaken for brand colours", () => {
  const palette = extractPalette("<style>a{color:#ffffff}b{color:#000000}c{color:#1f6f5c}</style>");
  assert.deepEqual(palette.map((entry) => entry.hex), ["#1f6f5c"]);
});

test("mockups are single-file, use the prospect's colours, and are marked as concepts", () => {
  const brand = extractBrandTokens('<style>.btn{background:#1f6f5c}.x{background:#1f6f5c}.a{color:#d2703a}</style>', "https://clinic.test/", "Boulder Vitality");
  const services = [{ name: "Hormone Therapy", key: "hormone" }, { name: "Aesthetics", key: "aesthetics" }];

  for (const html of [buildHomepageMockup(brand, services), buildServicePageMockup(brand, services)]) {
    assert.ok(html.includes("#1f6f5c"), "uses the prospect's own colour");
    // No script tags and no external asset hosts beyond Google Fonts.
    assert.ok(!/<script/i.test(html), "single file, no scripts");
    assert.match(html, /CONCEPT MOCKUP/, "never passes as a live site");
    assert.match(html, /noindex/, "not indexable");
  }
  assert.ok(buildHomepageMockup(brand, services).includes("Hormone Therapy"));
});

test("a mockup escapes business content rather than interpolating it raw", () => {
  const brand = extractBrandTokens("<p></p>", "https://clinic.test/", '<script>alert(1)</script>');
  const html = buildHomepageMockup(brand, [{ name: '<img onerror=alert(1)>', key: "x" }]);
  assert.ok(!html.includes("<script>alert(1)</script>"));
  assert.ok(!html.includes("<img onerror"));
  assert.ok(html.includes("&lt;script&gt;"));
});

// A mockup is placeholder copy in the prospect's own brand. In the wrong
// register it reads as a template with the name swapped in, which is the one
// thing it must never look like.
const CLINIC_WORDS = /\b(practitioner|patient|clinic|appointment|insurance|board[- ]certified|what we treat|book a consultation)\b/i;

test("Google's own category decides the register", () => {
  assert.equal(detectRegister({ googleCategory: "Medical clinic" }).register, "clinic");
  assert.equal(detectRegister({ googleCategory: "Mining company" }).register, "supplier");
  // A category the table does not cover is not a licence to guess.
  assert.equal(detectRegister({ googleCategory: "Roofing contractor" }).register, "service");
});

test("with no category, the site has to say it more than once", () => {
  // One stray phrase is not a register.
  assert.equal(detectRegister({ siteText: "please see our data sheet" }).register, "service");
  assert.equal(detectRegister({
    siteText: "Request bulk pricing. View technical data. Particle size ranges for supplied grades.",
  }).register, "supplier");
  // Contradictory evidence falls back rather than picking a side.
  assert.equal(detectRegister({
    siteText: "Our patients are board-certified referrals. Bulk pricing, minimum order and lead times on request. Technical data sheet available.",
  }).register, "service");
  assert.equal(detectRegister({}).register, "service");
});

test("a mockup outside the clinic register uses none of its vocabulary", () => {
  const brand = extractBrandTokens("<style>.b{background:#1f6f5c}</style>", "https://aragocor.test/", "AragoCor Minerals");
  const lines = [{ name: "Aragonite for Water Treatment", key: "aragonite for water" }];

  for (const register of ["supplier", "service"]) {
    for (const html of [buildHomepageMockup(brand, lines, register), buildServicePageMockup(brand, lines, register)]) {
      assert.doesNotMatch(html.replace(/<style[\s\S]*?<\/style>/g, ""), CLINIC_WORDS,
        `the ${register} register still speaks clinic`);
      assert.ok(html.includes("Aragonite for Water Treatment"), "still names what the site sells");
    }
  }

  // The clinic register keeps the copy the clinic case was written for.
  assert.match(buildHomepageMockup(brand, lines, "clinic"), CLINIC_WORDS);
});

test("the default register is the neutral one, never the clinic", () => {
  const brand = extractBrandTokens("<p></p>", "https://example.test/", "Example");
  const html = buildHomepageMockup(brand, [{ name: "Line one", key: "line-one" }]);
  assert.doesNotMatch(html.replace(/<style[\s\S]*?<\/style>/g, ""), CLINIC_WORDS);
  assert.equal(vocabularyFor("nonsense").offerHeading, vocabularyFor("service").offerHeading);
});

test("a mockup claims a location only when one was read", () => {
  const brand = extractBrandTokens("<p></p>", "https://example.test/", "Example");
  const lines = [{ name: "Line one", key: "line-one" }];

  const withoutCity = buildHomepageMockup(brand, lines, "service");
  assert.ok(!/your area/i.test(withoutCity), "never invents a service area");
  assert.ok(!/ in <\/h1>|and more in/i.test(withoutCity));

  const withCity = buildHomepageMockup({ ...brand, city: "Bourne" }, lines, "service");
  assert.match(withCity, /Line one in Bourne/);
});

test("a single service line is not described as having more", () => {
  const brand = extractBrandTokens("<p></p>", "https://example.test/", "Example");
  const one = buildHomepageMockup(brand, [{ name: "Line one", key: "line-one" }], "service");
  assert.ok(!/and \d+ more/i.test(one));

  const three = buildHomepageMockup(brand, [
    { name: "Line one", key: "one" }, { name: "Line two", key: "two" }, { name: "Line three", key: "three" },
  ], "service");
  assert.match(three, /and 2 more services/);
});
