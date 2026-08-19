import test from "node:test";
import assert from "node:assert/strict";
import {
  validateVoice, selectOpeningFindings, hasSendableHook, composeOpening,
  buildVoicePrompt, translateTerms, measuredNumbers, isMissingData, planFromFindings,
} from "../lib/audit/proposal-voice.js";

const findings = [
  { id: 1, category: "Service coverage", severity: "High", priority: 2.5,
    title: "The Google profile lists no services at all",
    evidence: "The website sells 3 distinct service lines (Hormone Therapy, Functional Medicine, Aesthetics). The Google Business Profile publishes no service list, only the category Medical clinic.",
    recommendation: "add every service line to the profile",
    impactNote: "Google flattens a multi-service business into one category, so every line the site sells is invisible to people searching for it locally" },
  { id: 2, category: "Conversion", severity: "High", priority: 2.5,
    title: "there is no booking path anywhere on the site",
    evidence: "No booking, scheduling, or consultation path was found on any crawled page.",
    recommendation: "link booking from the header", impactNote: "Every extra click loses people" },
  { id: 3, category: "Visibility", severity: "Medium", priority: 2,
    title: "structured data is absent", evidence: "No LocalBusiness schema markup was found.",
    recommendation: "publish it", impactNote: "It is how search reads the business identity" },
];

const plan = ["Add every service line to the Google profile", "Build a page for each service", "Put booking one click from the header"];

// Each of these is stated in config/voice.md as worse than no proposal.

test("a fabricated figure is rejected", () => {
  for (const draft of [
    "You're losing $4,000 a month in missed calls.",
    "You're missing around 40 calls a month.",
    "Fixing this could lift bookings 30%.",
    "Three competitors outrank you.",
  ]) {
    const result = validateVoice(draft, { findings, hasMockup: false });
    assert.equal(result.valid, false, `should reject: ${draft}`);
  }
});

test("a number the audit did measure is allowed through", () => {
  // "3" appears in the evidence, so stating it is reporting, not inventing.
  const result = validateVoice("The profile lists nothing while the site sells 3 service lines.", { findings, hasMockup: false });
  assert.equal(result.valid, true, result.violations.map((violation) => violation.message).join("; "));
  assert.ok(measuredNumbers(findings).has("3"));
});

test("plural identity, pleasantries and compliment sandwiches are rejected", () => {
  for (const [draft, id] of [
    ["We'd rebuild your service pages.", "plural-identity"],
    ["Our team can help with this.", "plural-identity"],
    ["I hope this finds you well.", "pleasantry"],
    ["Your site looks great, but booking is broken.", "compliment-sandwich"],
    ["One of my team will follow up.", "handoff"],
  ]) {
    const result = validateVoice(draft, { findings, hasMockup: false });
    assert.equal(result.valid, false, draft);
    assert.ok(result.violations.some((violation) => violation.id === id), `${draft} should trip ${id}`);
  }
});

test("implied prior contact is rejected — these are cold", () => {
  for (const draft of ["Following up on my note.", "As we discussed last week.", "Circling back on this.", "Just touching base."]) {
    assert.equal(validateVoice(draft, { findings }).valid, false, draft);
  }
});

test("a price or range in the prose is rejected", () => {
  for (const draft of ["This starts at $2,500.", "Typically around a few thousand.", "Projects like this are in the range of a month's revenue."]) {
    assert.equal(validateVoice(draft, { findings }).valid, false, draft);
  }
});

test("a visual is only mentionable when the run produced one", () => {
  const draft = "See the attached mockup for how the homepage could look.";
  assert.equal(validateVoice(draft, { findings, hasMockup: false }).valid, false);
  assert.equal(validateVoice(draft, { findings, hasMockup: true }).valid, true);
});

test("nothing specific enough to open with is a signal not to send", () => {
  assert.equal(hasSendableHook([]).sendable, false);
  // Missing data is not an observation about their site.
  assert.equal(hasSendableHook([{
    severity: "High", title: "The website could not be audited",
    evidence: "The site refused the request with HTTP 403. This usually means bot protection, not a site problem.",
  }]).sendable, false);
  assert.equal(hasSendableHook([{ severity: "High", title: "x", evidence: "short" }]).sendable, false);
  assert.equal(hasSendableHook(findings).sendable, true);
});

test("only the strongest two or three findings are used, one per category", () => {
  const selected = selectOpeningFindings(findings);
  assert.ok(selected.length >= 2 && selected.length <= 3);
  assert.equal(new Set(selected.map((finding) => finding.category)).size, selected.length);
  assert.equal(selected[0].id, 1);
});

test("technical terms are translated into consequences", () => {
  assert.match(translateTerms("Add schema markup"), /hours and service area/);
  assert.match(translateTerms("Improve Core Web Vitals"), /load on a phone/);
  assert.match(translateTerms("You are missing from the local pack"), /map results/);
  assert.ok(!/schema markup|core web vitals|local pack/i.test(
    translateTerms("schema markup, Core Web Vitals and the local pack"),
  ));
});

test("the composed opening obeys every hard constraint by construction", () => {
  const selected = selectOpeningFindings(findings);
  for (const hasMockup of [true, false]) {
    const opening = composeOpening({
      businessName: "Boulder Vitality", findings: selected, hasMockup,
      mockupLabel: hasMockup ? "homepage concept" : "", planSteps: plan,
    });
    const result = validateVoice(opening, { findings: selected, hasMockup });
    assert.equal(result.valid, true, result.violations.map((violation) => violation.message).join("; "));
    // Exactly three plan steps, and exactly one closing question.
    assert.equal((opening.match(/^(First, I'd|Then I'd)/gm) ?? []).length, 3);
    assert.equal((opening.match(/\?/g) ?? []).length, 1);
    assert.match(opening, /^I ran an audit/);
    if (!hasMockup) assert.ok(!/mockup|concept/i.test(opening), "no visual is mentioned when none exists");
  }
});

test("the model prompt carries the rules and drops the visual section when there is none", () => {
  const withVisual = buildVoicePrompt({ businessName: "X", findings, hasMockup: true, planSteps: plan });
  assert.match(withVisual, /3\. Visual/);
  const without = buildVoicePrompt({ businessName: "X", findings, hasMockup: false, planSteps: plan });
  assert.match(without, /SKIP — no visual exists/);
  for (const rule of [/Never state a number/, /Never name a price/, /Never imply prior contact/, /First person singular/, /untrusted data/]) {
    assert.match(without, rule);
  }
});

test("absence of data is never asserted as a finding", () => {
  const unread = {
    id: 9, category: "Trust", severity: "Medium", priority: 3,
    title: "The Google Business Profile could not be read",
    evidence: "GOOGLE_PLACES_API_KEY is not configured. Nothing about the profile was measured.",
    recommendation: "Configure the key", impactNote: "x",
  };
  assert.equal(isMissingData(unread), true);
  assert.equal(isMissingData(findings[0]), false);

  // It must not reach the opening, even when it ranks highly.
  const selected = selectOpeningFindings([unread, ...findings]);
  assert.ok(!selected.some((finding) => isMissingData(finding)));

  // And a run whose only strong finding is missing data is not sendable.
  assert.equal(hasSendableHook([unread]).sendable, false);
});

test("plan steps are actions, not service names", () => {
  const steps = planFromFindings(findings, ["Conversion optimisation"]);
  assert.equal(steps.length, 3);
  // "I'd start by conversion optimisation" is not a sentence; each step has to
  // read as something a person does.
  for (const step of steps) {
    assert.ok(!/^(conversion optimisation|local seo|analytics setup|website rebuild)$/i.test(step), `"${step}" is a service name`);
    assert.ok(step.split(" ").length >= 3, `"${step}" is too terse to be an action`);
  }
  const opening = composeOpening({ businessName: "X", findings: selectOpeningFindings(findings), hasMockup: false, planSteps: steps });
  assert.ok(!/I'd conversion|I'd local seo|I'd analytics/i.test(opening));
});

test("translation does not mangle the sentence it edits", () => {
  // A bare "tel: link" rule applied here yields "in a tappable phone number".
  assert.equal(translateTerms("Wrap the phone number in a tel: link everywhere"), "Wrap the phone number so it can be tapped everywhere");
  assert.equal(translateTerms("No tel: link was found on any crawled page."), "the phone number is not tappable on any of the pages I looked at.");
  assert.ok(!/\bthe the\b|\bany the\b|\ba a\b/.test(translateTerms("No tel: link was found on any crawled pages and no schema markup")));
});
