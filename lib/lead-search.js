/**
 * Normalize search values so punctuation, URL prefixes, phone formatting, and
 * capitalization do not prevent a match.
 * @param {unknown} value
 */
function normalize(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim();
}

/**
 * @param {import("./types").Lead} lead
 * @param {string} query
 */
export function matchesLeadSearch(lead, query) {
  const tokens = normalize(query).split(/\s+/).filter(Boolean);
  if (!tokens.length) return true;

  const searchable = normalize([
    lead.agencyName,
    lead.contactName,
    lead.carrier,
    lead.city,
    lead.state,
    lead.website,
    lead.email,
    lead.phone,
    lead.status,
    lead.notes,
    lead.score,
  ].join(" "));

  return tokens.every((token) => searchable.includes(token));
}

/**
 * A populated global query intentionally searches all leads, regardless of
 * the currently selected workspace section or pipeline-stage filter.
 * @param {import("./types").Lead[]} leads
 * @param {{ section: string; statusFilter: string; query: string }} options
 */
export function filterLeadRows(leads, { section, statusFilter, query }) {
  if (query.trim()) return leads.filter((lead) => matchesLeadSearch(lead, query));

  let rows = leads;
  if (section === "Audits") rows = rows.filter((lead) => lead.status === "Audit ready" || lead.score === 0);
  if (section === "Engagement") rows = [...rows].filter((lead) => lead.reportViews > 0).sort((a, b) => b.reportViews - a.reportViews);
  if (section === "Followups") rows = rows.filter((lead) => lead.nextFollowUpAt || lead.status === "Follow-up due");
  if (statusFilter !== "All stages") rows = rows.filter((lead) => lead.status === statusFilter);
  return rows;
}
