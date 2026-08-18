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

function actionRank(lead, now) {
  if (["Won", "Lost", "Disqualified"].includes(lead.status)) return 99;
  if (lead.nextFollowUpAt && new Date(lead.nextFollowUpAt).getTime() <= now.getTime()) return 0;
  if (lead.reportViews > 0 && !["Discovery scheduled", "Proposal sent", "Decision pending"].includes(lead.status)) return 1;
  if (["Proposal sent", "Decision pending"].includes(lead.status)) return 2;
  if (lead.status === "Audited") return 3;
  if (!lead.score) return 3;
  if (lead.status === "Contacted") return 4;
  return 5;
}

/**
 * Build a finite daily work queue, ordered by the action most likely to move a
 * prospect forward. Closed records are intentionally excluded.
 * @param {import("./types").Lead[]} leads
 * @param {Date} [now]
 */
export function buildDailyQueue(leads, now = new Date()) {
  return [...leads]
    .filter((lead) => actionRank(lead, now) < 99)
    .sort((a, b) => {
      const actionDifference = actionRank(a, now) - actionRank(b, now);
      if (actionDifference) return actionDifference;
      if (a.nextFollowUpAt && b.nextFollowUpAt) return new Date(a.nextFollowUpAt).getTime() - new Date(b.nextFollowUpAt).getTime();
      const engagementDifference = (b.reportViews ?? 0) - (a.reportViews ?? 0);
      if (engagementDifference) return engagementDifference;
      return (a.score || 101) - (b.score || 101);
    })
    .slice(0, 25);
}

/** @param {import("./types").Lead} lead @param {Date} [now] */
export function nextLeadAction(lead, now = new Date()) {
  const rank = actionRank(lead, now);
  if (rank === 0) return "Follow up now";
  if (rank === 1) return "Respond to report interest";
  if (rank === 2) return "Advance the decision";
  if (rank === 3) return lead.score ? (lead.email ? "Send opportunity brief" : "Add decision-maker email") : "Run website audit";
  if (rank === 4) return "Schedule next follow-up";
  if (rank === 99) return "Closed";
  return "Review prospect";
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
  if (section === "Today") rows = buildDailyQueue(rows);
  if (section === "Audits") rows = rows.filter((lead) => lead.status === "Audited" || lead.score === 0);
  if (section === "Engagement") rows = [...rows].filter((lead) => lead.reportViews > 0).sort((a, b) => b.reportViews - a.reportViews);
  if (section === "Followups") rows = rows.filter((lead) => lead.nextFollowUpAt || ["Contacted", "Replied", "Decision pending"].includes(lead.status));
  if (statusFilter !== "All stages") rows = rows.filter((lead) => lead.status === statusFilter);
  return rows;
}
