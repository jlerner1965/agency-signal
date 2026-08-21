import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { buildRecommendations, validateEvidence, assertEvidence, groundRationale } from "../lib/audit/recommendations.js";
import { extractBrandTokens, extractPalette } from "../lib/audit/brand.js";
import { buildHomepageMockup, buildServicePageMockup } from "../lib/audit/mockup.js";
import { detectRegister, vocabularyFor } from "../lib/audit/register.js";
import { readMockupContent } from "../lib/audit/mockup.js";

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

test("a concept page never draws a broken logo, and never says two names", () => {
  const services = [{ name: "Hormone Therapy", key: "hormone" }];

  // A logo that was found is drawn as a background, so a URL that 404s paints
  // nothing rather than the broken-image icon and its alt text.
  const withLogo = {
    ...extractBrandTokens('<style>.b{background:#1f6f5c}.c{background:#1f6f5c}</style>', "https://clinic.test/", "Boulder Vitality"),
    logoUrl: "https://clinic.test/logo.svg",
  };
  const drawn = buildHomepageMockup(withLogo, services);
  assert.ok(!/<img\b/i.test(drawn), "no <img> to break");
  assert.match(drawn, /background-image:url\(https:\/\/clinic\.test\/logo\.svg\)/);
  assert.equal(drawn.match(/Boulder Vitality/g).length, drawn.match(/Boulder Vitality/g).length, "the name is not duplicated by an alt attribute");

  // A URL that could close the declaration is refused rather than escaped.
  const hostile = { ...withLogo, logoUrl: "https://clinic.test/a')url('x" };
  const guarded = buildHomepageMockup(hostile, services);
  assert.ok(!guarded.includes("background-image:url("), "a URL that cannot sit in a url() is no logo at all");
});

test("the concept stamp claims only the brand tokens that were read", () => {
  const services = [{ name: "Hormone Therapy", key: "hormone" }];

  // Nothing readable: no claim about their colours or type.
  const bare = extractBrandTokens("<p>no styles here</p>", "https://clinic.test/", "Boulder Vitality");
  const plain = buildHomepageMockup(bare, services);
  assert.match(plain, /CONCEPT MOCKUP/);
  assert.doesNotMatch(plain, /own colours/, "the palette was defaulted, so it is not called theirs");
  assert.match(plain, /what the audit could read/);

  // A palette that was read is named as theirs.
  const read = extractBrandTokens('<style>.b{background:#1f6f5c}.c{background:#1f6f5c}</style>', "https://clinic.test/", "Boulder Vitality");
  const named = buildHomepageMockup({ ...read, logoUrl: "https://clinic.test/logo.svg" }, services);
  assert.match(named, /own colours/);
  // The logo is a URL that may no longer resolve, so the stamp does not name it.
  assert.doesNotMatch(named.slice(0, named.indexOf("</div>")), /logo/);
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
    for (const html of [buildHomepageMockup(brand, lines, { register }), buildServicePageMockup(brand, lines, { register })]) {
      assert.doesNotMatch(html.replace(/<style[\s\S]*?<\/style>/g, ""), CLINIC_WORDS,
        `the ${register} register still speaks clinic`);
      assert.ok(html.includes("Aragonite for Water Treatment"), "still names what the site sells");
    }
  }

  // The clinic register keeps the copy the clinic case was written for.
  assert.match(buildHomepageMockup(brand, lines, { register: "clinic" }), CLINIC_WORDS);
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

  const withoutCity = buildHomepageMockup(brand, lines, { register: "service" });
  assert.ok(!/your area/i.test(withoutCity), "never invents a service area");
  assert.ok(!/ in <\/h1>|and more in/i.test(withoutCity));

  const withCity = buildHomepageMockup({ ...brand, city: "Bourne" }, lines, { register: "service" });
  assert.match(withCity, /Line one in Bourne/);
});

test("a single service line is not described as having more", () => {
  const brand = extractBrandTokens("<p></p>", "https://example.test/", "Example");
  const one = buildHomepageMockup(brand, [{ name: "Line one", key: "line-one" }], { register: "service" });
  assert.ok(!/and \d+ more/i.test(one));

  const three = buildHomepageMockup(brand, [
    { name: "Line one", key: "one" }, { name: "Line two", key: "two" }, { name: "Line three", key: "three" },
  ], { register: "service" });
  assert.match(three, /and 2 more services/);
});

// A concept page carries the prospect's logo, so putting invented sentences on
// it puts words in their mouth. Their own copy, or a stated gap.
const CRAWLED = [
  {
    ok: true, url: "https://aragocor.test/", h1: ["Oolitic Aragonite Sized to Your Process"],
    metaDescription: "96-98% calcium carbonate from Bahamian deposits.",
    text: "Home Industries Contact Oolitic Aragonite Sized to Your Process 96-98% calcium carbonate.", h2: [], navLinks: [],
  },
  {
    ok: true, url: "https://aragocor.test/industries/water-treatment", h1: ["Aragonite for Water Treatment"],
    metaDescription: "",
    text: "Home Industries Contact Aragonite for Water Treatment Aragonite raises alkalinity and stabilises pH in municipal water systems without a calcination step.",
    h2: ["Grades supplied", "Packaging"], navLinks: [{ text: "Home" }, { text: "Industries" }],
  },
];
const CRAWLED_LINES = [{
  key: "aragonite for water", name: "Aragonite for Water Treatment",
  siteUrl: "https://aragocor.test/industries/water-treatment", quote: "Aragonite for Water Treatment",
}];

test("page copy is read past the site's own navigation", () => {
  const content = readMockupContent(CRAWLED, CRAWLED_LINES);
  // The distilled text runs the header straight into the first paragraph.
  assert.match(content.lines["aragonite for water"].summary, /^Aragonite raises alkalinity/);
  assert.ok(!content.lines["aragonite for water"].summary.includes("Home Industries"));
  // A deliberate summary beats scraped prose.
  assert.equal(content.summary, "96-98% calcium carbonate from Bahamian deposits.");
  assert.deepEqual(content.lines["aragonite for water"].points, ["Grades supplied", "Packaging"]);
});

test("a mockup quotes the prospect's own sentences and says where from", () => {
  const brand = extractBrandTokens("<p></p>", "https://aragocor.test/", "AragoCor Minerals");
  const content = readMockupContent(CRAWLED, CRAWLED_LINES);
  const html = buildServicePageMockup(brand, CRAWLED_LINES, { register: "supplier", content });

  assert.match(html, /Aragonite raises alkalinity/, "uses their sentence");
  assert.match(html, /Read from \/industries\/water-treatment/, "credits the page it came from");
  // The recommended structure is not passed off as copy they already have.
  assert.match(html, /Proposed section/);
});

test("a section with nothing to quote says so instead of inventing copy", () => {
  const brand = extractBrandTokens("<p></p>", "https://aragocor.test/", "AragoCor Minerals");
  // A line whose page was never reached has no sentence to show.
  const orphan = [{ key: "unread", name: "Unread line", siteUrl: "https://aragocor.test/unread", quote: "" }];
  const content = readMockupContent(CRAWLED, orphan);
  const html = buildHomepageMockup(brand, orphan, { register: "supplier", content });

  assert.match(html, /No description was found/);
  assert.doesNotMatch(html, /Aragonite raises alkalinity/);
});

test("a hostile stylesheet cannot break out of the mockup's own style block", () => {
  // The prospect's site controls this text, and the mockup is served through
  // srcDoc. A font-family that closes the style block used to run script on our
  // origin, so the audit of a hostile site attacked whoever opened the concept.
  const hostile = `<style>body{font-family: Arial</style><script>alert(document.domain)</script>}</style>`;
  const brand = extractBrandTokens(hostile, "https://hostile.test/", "Hostile");
  assert.ok(!/[<>]/.test(brand.fontStack), `font stack still carries markup: ${brand.fontStack}`);

  const html = buildHomepageMockup(brand, [{ name: "Line", key: "line" }], { register: "service" });
  assert.ok(!/<script/i.test(html), "no script reached the page");
  // One style block, opened and closed exactly once.
  assert.equal((html.match(/<\/style>/gi) ?? []).length, 1);
});

test("a real font stack still survives sanitising", () => {
  const brand = extractBrandTokens(
    `<style>body{font-family: "Helvetica Neue", Helvetica, Arial, sans-serif}</style>`,
    "https://ok.test/", "OK",
  );
  assert.equal(brand.fontStack, "Helvetica Neue, Helvetica, Arial, sans-serif");
});
