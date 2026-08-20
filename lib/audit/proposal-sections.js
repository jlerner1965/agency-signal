/**
 * Which parts a proposal carries.
 *
 * The document used to carry everything the run happened to produce, which is
 * why it read as a pile rather than an argument: the same eight actions
 * appeared as prose, again as evidence, and again as a deliverables grid, and
 * the concept pages were built whether or not anyone meant to show them.
 *
 * The choice is made before the package is built, not trimmed afterwards, for
 * one reason: a part that is not going in should not be produced at all.
 * Unchecking the concepts skips building them, which is the slowest step and
 * the one that reads the prospect's site hardest.
 *
 * A part is only offerable when the run actually holds what it needs. Nothing
 * here decides that on its own — it is told, by whoever counted the findings,
 * the service lines and the priced lines, and it says plainly why a part it
 * cannot offer is not on the list.
 */

/** Every part a proposal can carry, in the order the document reads. */
export const sectionCatalog = [
  {
    id: "opening",
    label: "Opening",
    detail: "A short letter in your voice, written from the findings this proposal cites.",
  },
  {
    id: "evidence",
    label: "Audit evidence",
    detail: "Each finding with the sentence it was read from and the change it calls for.",
  },
  {
    id: "coverage",
    label: "Service-line coverage",
    detail: "What the site sells, quoted, against what the Google profile carries.",
  },
  {
    id: "concepts",
    label: "Website mockups",
    detail: "Concept pages in the prospect's own colours, type and logo — live pages, not pictures.",
  },
  {
    id: "scope",
    label: "Scope and price",
    detail: "The priced lines, each traced back to the findings that triggered it.",
  },
  {
    id: "unmeasured",
    label: "What could not be checked",
    detail: "Checks the run could not verify, listed rather than left out.",
  },
];

export const sectionIds = sectionCatalog.map((section) => section.id);

const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * @typedef {object} ProposalInventory
 * @property {number} [findings] findings this proposal would cite
 * @property {number} [serviceLines] service lines read from the site
 * @property {number} [serviceLineGaps] of those, the ones Google does not carry
 * @property {number} [scopeItems] priced lines the selection triggers
 * @property {string} [priceDisplay] what those lines come to, as the file frames it
 * @property {number} [unmeasured] checks that could not be verified
 * @property {number} [mockups] concept pages already built
 * @property {boolean} [mockupsBuildable] whether a fresh pair can be built now
 * @property {boolean} [openingWritable] whether an opening can be written at all
 * @property {string} [openingReason] why not, when it cannot
 * @property {Record<string, string>} [reasons] per-part replacement for the
 *   default explanation, for callers whose reason for not offering a part is
 *   not the one this module would assume
 */

/**
 * The parts on offer for one proposal, each with what it would carry and, when
 * it cannot be offered, the reason. An unavailable part is still listed: a
 * missing option reads as a part that does not exist, which is a different
 * claim from one this run has nothing to fill.
 *
 * @param {ProposalInventory} inventory
 */
export function sectionOptions(inventory = {}) {
  const findings = Number(inventory.findings ?? 0);
  const serviceLines = Number(inventory.serviceLines ?? 0);
  const gaps = Number(inventory.serviceLineGaps ?? 0);
  const scopeItems = Number(inventory.scopeItems ?? 0);
  const unmeasured = Number(inventory.unmeasured ?? 0);
  const built = Number(inventory.mockups ?? 0);
  const buildable = Boolean(inventory.mockupsBuildable);
  const openingWritable = inventory.openingWritable !== false;

  /** @type {Record<string, { available: boolean, note: string, reason: string }>} */
  const state = {
    opening: {
      available: openingWritable,
      note: "Written from the findings, then yours to edit.",
      reason: String(inventory.openingReason || "No opening can be written for this proposal."),
    },
    evidence: {
      available: findings > 0,
      note: `${plural(findings, "finding")}, each quoting what it was read from.`,
      reason: "This run recorded no findings, so there is nothing to show as evidence.",
    },
    coverage: {
      available: serviceLines > 0,
      note: gaps > 0
        ? `${plural(serviceLines, "service line")} read from the site, ${gaps} not carried by Google.`
        : `${plural(serviceLines, "service line")} read from the site.`,
      reason: "No service line could cite the page it was read from, so there is no coverage table.",
    },
    concepts: {
      available: buildable || built > 0,
      note: built > 0 && !buildable
        ? `${plural(built, "concept page")} already built for this prospect.`
        : "Two concept pages, built from their own colours, type and logo.",
      reason: "The site could not be read, so there are no brand tokens to build a concept from.",
    },
    scope: {
      available: scopeItems > 0,
      note: inventory.priceDisplay
        ? `${plural(scopeItems, "priced line")} · ${inventory.priceDisplay}.`
        : `${plural(scopeItems, "priced line")}.`,
      reason: "Nothing in this selection triggers a priced deliverable.",
    },
    unmeasured: {
      available: unmeasured > 0,
      note: `${plural(unmeasured, "check")} the run could not verify.`,
      reason: "Every check in scope was measured, so there is nothing to declare.",
    },
  };

  const reasons = inventory.reasons ?? {};
  return sectionCatalog.map((section) => {
    const resolved = { ...section, ...state[section.id] };
    // Why a part is not on offer depends on who is asking. A lead-based
    // proposal has no coverage table because it was not built from a run, not
    // because the service lines could not cite their source.
    return reasons[section.id] ? { ...resolved, reason: String(reasons[section.id]) } : resolved;
  });
}

/**
 * Everything on offer. What the build does when nobody has narrowed it, and
 * what an older proposal — stored before any of this existed — is read as.
 *
 * @param {ReturnType<typeof sectionOptions>} options
 */
export function defaultSections(options) {
  return options.filter((option) => option.available).map((option) => option.id);
}

/**
 * The chosen parts, reduced to the ones this proposal can actually carry.
 *
 * A request for a part the run cannot fill is dropped rather than refused: the
 * operator ticked a box against a run that had the evidence and built against
 * one that does not, and a proposal missing a section it could never have had
 * is a better outcome than no proposal.
 *
 * `null` — the field absent altogether — means everything, so a caller that
 * predates the picker keeps the document it used to get. An empty array is a
 * deliberate choice of nothing, and is kept as one.
 *
 * @param {unknown} requested
 * @param {ReturnType<typeof sectionOptions>} options
 */
export function normalizeSections(requested, options) {
  if (requested === null || requested === undefined) return defaultSections(options);
  const asked = new Set((Array.isArray(requested) ? requested : []).map((value) => String(value)));
  return options.filter((option) => option.available && asked.has(option.id)).map((option) => option.id);
}

/**
 * How a stored choice reads back. The column is empty on every proposal built
 * before the picker shipped, and those documents carried every part, so an
 * empty column is read as exactly that rather than as a document with nothing
 * in it.
 *
 * @param {string | null | undefined} stored
 * @returns {string[] | null} the chosen ids, or null for "whatever it has"
 */
export function readSections(stored) {
  if (!stored) return null;
  try {
    const parsed = JSON.parse(stored);
    return Array.isArray(parsed) ? parsed.map((value) => String(value)) : null;
  } catch {
    return null;
  }
}

/**
 * Whether a stored proposal carries one part. Unchosen means left out; an
 * unstored choice means the document predates the picker and carries what it
 * has.
 *
 * @param {string[] | null} sections
 * @param {string} id
 */
export function carries(sections, id) {
  return sections === null ? true : sections.includes(id);
}
