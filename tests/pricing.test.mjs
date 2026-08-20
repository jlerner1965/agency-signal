import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import {
  selectDeliverables, selectRetainer, priceProposal, formatFigure,
  verifyFigures, allowedFigures, sitePageCount, triggerSources,
} from "../lib/audit/pricing.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const config = JSON.parse(await readFile(resolve(root, "config/pricing.json"), "utf8"));

const finding = (id, module, category, severity, title) => ({ id, module, category, severity, title });

const broadTechnical = [
  finding(1, "conversion", "Conversion", "High", "The phone number is not tappable"),
  finding(2, "conversion", "Conversion", "High", "There is no booking path"),
  finding(3, "seo", "Visibility", "High", "Page titles are missing"),
  finding(4, "technical", "Technical", "High", "Mobile viewport is not declared"),
];

test("no figure is emitted that is not in the pricing file", () => {
  const selected = selectDeliverables(config, {
    findings: [...broadTechnical, finding(5, "google", "Trust", "High", "The Google profile lists no services at all"), finding(6, "conversion", "Conversion", "Medium", "Nothing is measuring the site")],
    serviceLines: [{ name: "A", hasLandingPage: false }, { name: "B", hasLandingPage: false }],
    diagnostics: { pagesReached: 14 }, sitemap: { urlCount: 14 }, googleKnown: true,
  });
  const priced = priceProposal(config, selected);
  const allowed = allowedFigures(config);

  // Every band figure is straight from the file.
  for (const line of priced.lines) {
    assert.ok(allowed.has(line.min), `${line.label} min ${line.min} is not in the file`);
    assert.ok(allowed.has(line.max), `${line.label} max ${line.max} is not in the file`);
    // The only arithmetic permitted is band times counted quantity.
    assert.equal(line.lineMin, line.min * line.quantity);
  }
  // And the total is the sum of exactly those lines.
  assert.equal(priced.subtotalMin, priced.lines.reduce((sum, line) => sum + line.lineMin, 0));
  assert.equal(verifyFigures(config, priced).valid, true);
});

test("the figure check catches a tampered line", () => {
  const priced = priceProposal(config, selectDeliverables(config, {
    findings: broadTechnical, serviceLines: [], diagnostics: { pagesReached: 8 }, sitemap: null, googleKnown: false,
  }));
  const tampered = { ...priced, lines: [{ ...priced.lines[0], min: 7777, lineMin: 7777 }] };
  const result = verifyFigures(config, tampered);
  assert.equal(result.valid, false);
  assert.match(result.problems.join(" "), /not in the pricing file/);
});

test("one band is selected per deliverable, keyed to what the audit found", () => {
  const bandFor = (pageCount) => {
    const selected = selectDeliverables(config, {
      findings: broadTechnical, serviceLines: [], diagnostics: { pagesReached: pageCount },
      sitemap: { urlCount: pageCount }, googleKnown: false,
    });
    return selected.find((line) => line.id === "site_rebuild")?.bandKey;
  };
  assert.equal(bandFor(8), "light");
  assert.equal(bandFor(14), "standard");
  assert.equal(bandFor(30), "heavy");
});

test("a narrow technical problem is a fix pass, not a rebuild", () => {
  const single = selectDeliverables(config, {
    findings: [finding(1, "technical", "Technical", "High", "Mobile viewport is not declared")],
    serviceLines: [], diagnostics: { pagesReached: 8 }, sitemap: null, googleKnown: false,
  });
  assert.ok(!single.some((line) => line.id === "site_rebuild"));
  const pass = single.find((line) => line.id === "technical_fix_pass");
  assert.equal(pass.bandKey, "light", "one root cause is the light band");

  const spread = selectDeliverables(config, {
    findings: [finding(1, "technical", "Technical", "Medium", "a"), finding(2, "seo", "Visibility", "Medium", "b"), finding(3, "conversion", "Conversion", "Medium", "c")],
    serviceLines: [], diagnostics: { pagesReached: 8 }, sitemap: null, googleKnown: false,
  });
  assert.equal(spread.find((line) => line.id === "technical_fix_pass").bandKey, "standard");
});

test("service pages are priced per page, from the count of services with none", () => {
  const selected = selectDeliverables(config, {
    findings: [finding(1, "service-lines", "Service coverage", "High", "Service lines have no page that can rank")],
    serviceLines: [
      { name: "Hormone Therapy", hasLandingPage: false },
      { name: "Aesthetics", hasLandingPage: false },
      { name: "Functional Medicine", hasLandingPage: true },
    ],
    diagnostics: null, sitemap: null, googleKnown: false,
  });
  const line = selected.find((item) => item.id === "service_page");
  assert.equal(line.unit, "per_page");
  assert.equal(line.quantity, 2, "only the two without a page are counted");
  assert.match(line.rationale, /Hormone Therapy, Aesthetics/);
  const priced = priceProposal(config, [line]);
  assert.equal(priced.lines[0].lineMin, line.min * 2);
});

test("nothing about the profile is priced when the profile could not be read", () => {
  const selected = selectDeliverables(config, {
    findings: [...broadTechnical, finding(9, "google", "Trust", "Medium", "The Google Business Profile could not be read")],
    serviceLines: [], diagnostics: { pagesReached: 8 }, sitemap: null,
    googleKnown: false,
  });
  assert.ok(!selected.some((line) => line.triggeredBy === "google_presence"));
});

test("the retainer is offered only on real Google gaps, and never folded into the total", () => {
  assert.equal(selectRetainer(config, { googleKnown: false, googleFindings: [] }), null);
  assert.equal(selectRetainer(config, { googleKnown: true, googleFindings: [] }), null);

  const light = selectRetainer(config, { googleKnown: true, googleFindings: [finding(1, "google", "Trust", "High", "x")], serviceLineGaps: 0 });
  assert.equal(light.bandKey, "light");
  const standard = selectRetainer(config, { googleKnown: true, googleFindings: [finding(1, "google", "Trust", "High", "x")], serviceLineGaps: 2 });
  assert.equal(standard.bandKey, "standard");

  // The one-off total does not include it.
  const priced = priceProposal(config, selectDeliverables(config, {
    findings: [finding(1, "google", "Trust", "High", "The Google profile lists no services at all")],
    serviceLines: [], diagnostics: null, sitemap: null, googleKnown: true,
  }));
  assert.ok(!priced.lines.some((line) => line.label === config.retainer.label));
});

test("the minimum engagement lifts a small total, using the file's own figure", () => {
  const small = priceProposal(config, [{
    id: "x", label: "Small", triggeredBy: "technical_audit", unit: "fixed", bandKey: "standard",
    criteria: "c", min: 500, max: 800, quantity: 1, rationale: "r", findingIds: [],
  }]);
  assert.equal(small.belowMinimum, true);
  assert.equal(small.totalMin, config.minimum_engagement);
  assert.equal(small.subtotalMin, 500, "the subtotal still reports what the lines actually came to");
});

test("display_mode decides how a figure prints", () => {
  assert.equal(formatFigure({ display_mode: "starts_at" }, { min: 9000, max: 15000 }), "starts at $9,000");
  assert.equal(formatFigure({ display_mode: "firm" }, { min: 9000, max: 15000 }), "$9,000");
  assert.equal(formatFigure({ display_mode: "range" }, { min: 9000, max: 15000 }), "$9,000–$15,000");
  // The shipped file asks for the band minimum only.
  assert.match(formatFigure(config, { min: 4500, max: 6500 }), /^starts at \$4,500$/);
});

test("page count prefers the sitemap over a capped crawl", () => {
  assert.deepEqual(sitePageCount({ pagesReached: 25, truncatedBy: "page-cap" }, { urlCount: 60 }), { count: 60, source: "sitemap" });
  assert.deepEqual(sitePageCount({ pagesReached: 25, truncatedBy: "page-cap" }, null), { count: 25, source: "crawl (truncated)" });
  assert.deepEqual(sitePageCount(null, null), { count: 0, source: "unknown" });
});

test("every trigger in the file maps to modules that exist", () => {
  for (const modules of Object.values(triggerSources)) {
    assert.ok(Array.isArray(modules) && modules.length > 0);
  }
  assert.deepEqual(Object.keys(triggerSources).sort(), ["google_presence", "service_line_coverage", "technical_audit"]);
});

// The operator chooses which findings the proposal makes its case from, so
// selectDeliverables has to behave correctly on a narrowed set — including
// sets that leave a deliverable's own justification out.

test("dropping every coverage finding drops the service-page line", () => {
  const serviceLines = [{ name: "A", hasLandingPage: false }, { name: "B", hasLandingPage: false }];
  const coverage = finding(10, "service-lines", "Service coverage", "High", "Services are sold without a page that can rank");

  const withCoverage = selectDeliverables(config, {
    findings: [...broadTechnical, coverage], serviceLines,
    diagnostics: { pagesReached: 14 }, sitemap: { urlCount: 14 }, googleKnown: false,
  });
  assert.ok(withCoverage.some((line) => line.id === "service_page"), "priced while the finding is in play");

  // Same orphaned service lines, but the finding that justifies the work is no
  // longer being raised. A priced line citing nothing is the one thing the
  // evidence rule exists to prevent.
  const without = selectDeliverables(config, {
    findings: broadTechnical, serviceLines,
    diagnostics: { pagesReached: 14 }, sitemap: { urlCount: 14 }, googleKnown: false,
  });
  assert.ok(!without.some((line) => line.id === "service_page"));
});

test("every priced line cites at least one of the chosen findings", () => {
  const chosen = [...broadTechnical, finding(11, "google", "Trust", "High", "The Google profile lists no services at all")];
  const chosenIds = new Set(chosen.map((entry) => entry.id));
  const selected = selectDeliverables(config, {
    findings: chosen,
    serviceLines: [{ name: "A", hasLandingPage: false }],
    diagnostics: { pagesReached: 9 }, sitemap: { urlCount: 9 }, googleKnown: true,
  });

  assert.ok(selected.length > 0);
  for (const line of selected) {
    assert.ok(line.findingIds.length > 0, `${line.label} cites nothing`);
    for (const id of line.findingIds) {
      assert.ok(chosenIds.has(id), `${line.label} cites ${id}, which was not chosen`);
    }
  }
});

test("an empty selection prices nothing rather than falling back to everything", () => {
  const selected = selectDeliverables(config, {
    findings: [],
    serviceLines: [{ name: "A", hasLandingPage: false }],
    diagnostics: { pagesReached: 9 }, sitemap: { urlCount: 9 }, googleKnown: true,
  });
  assert.deepEqual(selected, []);
});
