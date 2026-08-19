/**
 * Turns an audit into priced line items using config/pricing.json.
 *
 * Two rules govern everything here. One band is selected per triggered
 * deliverable, keyed to what the audit actually found. And no figure is emitted
 * that is not in the file: every line carries the band it came from, and the
 * only arithmetic performed is multiplying a per-unit band by a counted
 * quantity and summing the lines — both auditable against the file.
 */

/** Which audit module a trigger name refers to. */
export const triggerSources = {
  technical_audit: ["technical", "seo", "conversion"],
  service_line_coverage: ["service-lines"],
  google_presence: ["google"],
};

function findingsFor(trigger, findings) {
  const modules = triggerSources[trigger] ?? [];
  return findings.filter((finding) => modules.includes(finding.module));
}

function band(config, deliverableId, bandKey) {
  const deliverable = config.deliverables?.[deliverableId];
  const chosen = deliverable?.bands?.[bandKey];
  if (!deliverable || !chosen) return null;
  return {
    id: deliverableId,
    label: deliverable.label,
    triggeredBy: deliverable.triggered_by,
    unit: deliverable.unit ?? "fixed",
    bandKey,
    criteria: chosen.criteria,
    min: chosen.min,
    max: chosen.max,
  };
}

/**
 * Page count drives the rebuild band, and the site's own sitemap is a better
 * count than a capped crawl. Falling back to pages reached understates a large
 * site, so the band is only claimed when there is a count to claim it from.
 */
/**
 * @param {Record<string, any>|null} diagnostics
 * @param {Record<string, any>|null} sitemap
 */
export function sitePageCount(diagnostics, sitemap) {
  const fromSitemap = Number(sitemap?.urlCount ?? 0);
  if (fromSitemap > 0) return { count: fromSitemap, source: "sitemap" };
  const reached = Number(diagnostics?.pagesReached ?? 0);
  const truncated = Boolean(diagnostics?.truncatedBy);
  return reached > 0 ? { count: reached, source: truncated ? "crawl (truncated)" : "crawl" } : { count: 0, source: "unknown" };
}

function rebuildBand(pageCount) {
  if (pageCount >= 20) return "heavy";
  if (pageCount >= 11) return "standard";
  return "light";
}

/**
 * @typedef {{ id: string, label: string, triggeredBy: string, unit: string, bandKey: string, criteria: string, min: number, max: number, quantity: number, rationale: string, findingIds: number[] }} SelectedLine
 * @typedef {SelectedLine & { lineMin: number, lineMax: number }} PricedLine
 */

/**
 * @param {Record<string, any>} config parsed config/pricing.json
 * @param {{ findings?: Array<Record<string, any>>, serviceLines?: Array<Record<string, any>>, diagnostics?: Record<string, any>|null, sitemap?: Record<string, any>|null, googleKnown?: boolean }} audit
 * @returns {SelectedLine[]}
 */
export function selectDeliverables(config, audit) {
  const { findings = [], serviceLines = [], diagnostics = null, sitemap = null, googleKnown = false } = audit;
  /** @type {SelectedLine[]} */
  const lines = [];

  const technical = findingsFor("technical_audit", findings);
  const coverage = findingsFor("service_line_coverage", findings);
  const google = findingsFor("google_presence", findings);

  const highTechnical = technical.filter((finding) => finding.severity === "High");
  const technicalCategories = new Set(technical.map((finding) => finding.category));
  const { count: pageCount, source: pageSource } = sitePageCount(diagnostics, sitemap);

  // A rebuild is justified by breadth, not by any single failure. Below that
  // threshold the same findings are a fix pass, which is a different price.
  const rebuildJustified = highTechnical.length >= 4 && technicalCategories.size >= 2;

  if (rebuildJustified) {
    const selected = band(config, "site_rebuild", rebuildBand(pageCount));
    if (selected) {
      lines.push({
        ...selected, quantity: 1,
        rationale: `${highTechnical.length} high-severity findings across ${technicalCategories.size} areas, on a site of ${pageCount || "an unknown number of"} pages (${pageSource}).`,
        findingIds: highTechnical.map((finding) => finding.id),
      });
    }
  } else if (technical.length) {
    // One root cause reads as light; failures spread across templates do not.
    const bandKey = technical.length > 2 || technicalCategories.size > 1 ? "standard" : "light";
    const selected = band(config, "technical_fix_pass", bandKey);
    if (selected) {
      lines.push({
        ...selected, quantity: 1,
        rationale: `${technical.length} finding${technical.length === 1 ? "" : "s"} across ${technicalCategories.size} area${technicalCategories.size === 1 ? "" : "s"}.`,
        findingIds: technical.map((finding) => finding.id),
      });
    }
  }

  // Service pages are per page, and the count is the services the site sells
  // without a page of their own.
  const orphans = serviceLines.filter((line) => line.hasLandingPage === false);
  if (orphans.length) {
    const selected = band(config, "service_page", "standard");
    if (selected) {
      lines.push({
        ...selected, quantity: orphans.length,
        rationale: `${orphans.length} service line${orphans.length === 1 ? "" : "s"} sold with no page of its own: ${orphans.map((line) => line.name).join(", ")}.`,
        findingIds: coverage.map((finding) => finding.id),
      });
    }
  }

  // Nothing about the profile is priced when the profile could not be read.
  if (googleKnown && google.length) {
    const selected = band(config, "gbp_optimization", "standard");
    if (selected) {
      lines.push({
        ...selected, quantity: 1,
        rationale: `${google.length} finding${google.length === 1 ? "" : "s"} on the Google Business Profile.`,
        findingIds: google.map((finding) => finding.id),
      });
    }

    // Local search setup covers tracking and structured data, so it is only
    // offered when the audit actually found those missing.
    const trackingGaps = findings.filter((finding) => /analytics|measuring|structured data|the details Google reads/i.test(finding.title));
    if (trackingGaps.length) {
      const setup = band(config, "local_search_setup", "standard");
      if (setup) {
        lines.push({
          ...setup, quantity: 1,
          rationale: `Tracking or structured-data gaps found: ${trackingGaps.map((finding) => finding.title).join("; ")}.`,
          findingIds: trackingGaps.map((finding) => finding.id),
        });
      }
    }
  }

  return lines;
}

/**
 * The retainer is an offer alongside the work, never folded into its total.
 * @param {Record<string, any>} config
 * @param {{ googleKnown: boolean, googleFindings?: Array<Record<string, any>>, serviceLineGaps?: number }} audit
 */
export function selectRetainer(config, { googleKnown, googleFindings = [], serviceLineGaps = 0 }) {
  if (!config.retainer || config.retainer.offer_when !== "google_presence_gaps_present") return null;
  if (!googleKnown || !googleFindings.length) return null;
  // Content and landing pages each month only make sense when there are
  // services still needing them.
  const bandKey = serviceLineGaps > 0 ? "standard" : "light";
  const chosen = config.retainer.bands?.[bandKey];
  if (!chosen) return null;
  return { label: config.retainer.label, bandKey, criteria: chosen.criteria, min: chosen.min, max: chosen.max };
}

/**
 * Formats one figure per the file's display_mode.
 * @param {Record<string, any>} config
 * @param {{ min: number, max: number }} figure
 */
export function formatFigure(config, { min, max }) {
  const money = (value) => `$${Number(value).toLocaleString("en-US")}`;
  switch (config.display_mode) {
    case "firm": return money(min);
    case "range": return min === max ? money(min) : `${money(min)}–${money(max)}`;
    case "starts_at":
    default: return `starts at ${money(min)}`;
  }
}

/**
 * Totals the selected lines. The only arithmetic is quantity times a band
 * figure, then a sum — both checkable against the file.
 */
/**
 * @param {Record<string, any>} config
 * @param {SelectedLine[]} lines
 */
export function priceProposal(config, lines) {
  const priced = lines.map((line) => ({
    ...line,
    lineMin: line.min * line.quantity,
    lineMax: line.max * line.quantity,
  }));
  const subtotalMin = priced.reduce((sum, line) => sum + line.lineMin, 0);
  const subtotalMax = priced.reduce((sum, line) => sum + line.lineMax, 0);
  const minimum = Number(config.minimum_engagement ?? 0);
  const belowMinimum = subtotalMin > 0 && subtotalMin < minimum;

  return {
    lines: priced,
    subtotalMin,
    subtotalMax,
    minimumEngagement: minimum,
    belowMinimum,
    // The minimum is itself a figure from the file, so applying it invents nothing.
    totalMin: belowMinimum ? minimum : subtotalMin,
    totalMax: belowMinimum ? Math.max(minimum, subtotalMax) : subtotalMax,
    currency: config.currency ?? "USD",
    displayMode: config.display_mode ?? "starts_at",
  };
}

/**
 * Every figure a proposal may print, so a rendered document can be checked
 * against the file it came from.
 */
/** @param {Record<string, any>} config */
export function allowedFigures(config) {
  const figures = new Set();
  const add = (value) => { if (Number.isFinite(value)) figures.add(Number(value)); };
  add(config.minimum_engagement);
  add(config.hourly?.min);
  add(config.hourly?.max);
  for (const deliverable of Object.values(config.deliverables ?? {})) {
    for (const chosen of Object.values(deliverable.bands ?? {})) { add(chosen.min); add(chosen.max); }
  }
  for (const chosen of Object.values(config.retainer?.bands ?? {})) { add(chosen.min); add(chosen.max); }
  return figures;
}

/**
 * Confirms every figure in a priced proposal traces to the file: a band value,
 * a band value times a counted quantity, or the sum of the lines shown.
 */
/**
 * @param {Record<string, any>} config
 * @param {{ lines: PricedLine[], subtotalMin: number, totalMin: number, minimumEngagement: number }} priced
 */
export function verifyFigures(config, priced) {
  const allowed = allowedFigures(config);
  const problems = [];
  for (const line of priced.lines) {
    if (!allowed.has(line.min) || !allowed.has(line.max)) {
      problems.push(`${line.label} uses a band figure that is not in the pricing file.`);
    }
    if (line.lineMin !== line.min * line.quantity || line.lineMax !== line.max * line.quantity) {
      problems.push(`${line.label} line total is not its band figure times its quantity.`);
    }
  }
  const summedMin = priced.lines.reduce((sum, line) => sum + line.lineMin, 0);
  if (priced.subtotalMin !== summedMin) problems.push("The subtotal is not the sum of the lines shown.");
  if (priced.totalMin !== summedMin && priced.totalMin !== priced.minimumEngagement) {
    problems.push("The total is neither the sum of the lines nor the minimum engagement from the file.");
  }
  return { valid: problems.length === 0, problems };
}
