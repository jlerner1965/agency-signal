import test from "node:test";
import assert from "node:assert/strict";
import {
  carries, defaultSections, normalizeSections, readSections, sectionCatalog, sectionIds, sectionOptions,
} from "../lib/audit/proposal-sections.js";

const full = {
  findings: 8,
  serviceLines: 4,
  serviceLineGaps: 3,
  scopeItems: 2,
  priceDisplay: "$8,200",
  unmeasured: 5,
  mockups: 0,
  mockupsBuildable: true,
  openingWritable: true,
};

const idsOf = (options) => options.filter((option) => option.available).map((option) => option.id);

test("a run holding everything offers every part", () => {
  const options = sectionOptions(full);
  assert.deepEqual(idsOf(options), sectionIds);
  assert.deepEqual(defaultSections(options), sectionIds);
  // The concepts option says what it would build, so the box is not ticked blind.
  const concepts = options.find((option) => option.id === "concepts");
  assert.match(concepts.note, /colours, type and logo/);
});

test("a part with nothing behind it is offered to nobody, and says why", () => {
  const options = sectionOptions({ ...full, serviceLines: 0, unmeasured: 0, scopeItems: 0 });
  assert.deepEqual(idsOf(options), ["opening", "evidence", "concepts"]);
  const coverage = options.find((option) => option.id === "coverage");
  assert.equal(coverage.available, false);
  assert.match(coverage.reason, /no coverage table/);
  // Unavailable is still listed. Dropping it reads as a part that cannot exist.
  assert.equal(options.length, sectionCatalog.length);
});

test("concepts are on offer either because they exist or because they can be built", () => {
  const buildable = sectionOptions({ ...full, mockups: 0, mockupsBuildable: true });
  assert.equal(buildable.find((option) => option.id === "concepts").available, true);

  const alreadyBuilt = sectionOptions({ ...full, mockups: 2, mockupsBuildable: false });
  const option = alreadyBuilt.find((entry) => entry.id === "concepts");
  assert.equal(option.available, true);
  assert.match(option.note, /2 concept pages already built/);

  const neither = sectionOptions({ ...full, mockups: 0, mockupsBuildable: false });
  const refused = neither.find((entry) => entry.id === "concepts");
  assert.equal(refused.available, false);
  assert.match(refused.reason, /site could not be read/);
});

test("an unwritable opening is not offered, and carries the reason it was refused", () => {
  const options = sectionOptions({
    ...full,
    openingWritable: false,
    openingReason: "config/voice.md is still a placeholder, so no opening can be written.",
  });
  const opening = options.find((option) => option.id === "opening");
  assert.equal(opening.available, false);
  assert.match(opening.reason, /voice\.md/);
});

test("a caller with its own reason replaces the assumed one", () => {
  const options = sectionOptions({
    ...full,
    serviceLines: 0,
    reasons: { coverage: "Built by the audit engine." },
  });
  assert.equal(options.find((option) => option.id === "coverage").reason, "Built by the audit engine.");
});

test("choosing nothing is a choice; choosing nothing at all is not", () => {
  const options = sectionOptions(full);
  // Absent means everything, so a caller that predates the picker is unchanged.
  assert.deepEqual(normalizeSections(null, options), sectionIds);
  assert.deepEqual(normalizeSections(undefined, options), sectionIds);
  // An empty array is a deliberate choice of none of the optional parts.
  assert.deepEqual(normalizeSections([], options), []);
});

test("a part this run cannot fill is dropped from the choice rather than refused", () => {
  const options = sectionOptions({ ...full, serviceLines: 0 });
  assert.deepEqual(normalizeSections(["coverage", "concepts"], options), ["concepts"]);
  // And an id nothing knows about cannot smuggle a section into the document.
  assert.deepEqual(normalizeSections(["evidence", "signature-block"], options), ["evidence"]);
});

test("an unstored choice reads as the document it used to be", () => {
  assert.equal(readSections(""), null);
  assert.equal(readSections(null), null);
  assert.equal(readSections("not json"), null);
  assert.deepEqual(readSections('["evidence","concepts"]'), ["evidence", "concepts"]);
  assert.deepEqual(readSections("[]"), []);

  // Null carries everything: proposals built before the picker existed showed
  // every section they had, and reading them as empty would blank them.
  assert.equal(carries(null, "concepts"), true);
  assert.equal(carries([], "concepts"), false);
  assert.equal(carries(["concepts"], "concepts"), true);
  assert.equal(carries(["evidence"], "concepts"), false);
});
