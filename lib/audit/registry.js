/**
 * The audit modules a run executes, in order. Adding a module is one entry here
 * plus its analyze/collect pair. A module whose required keys are absent is
 * skipped with a reason — it never fails the run.
 */
export const auditModules = [
  {
    id: "technical",
    label: "Website technical",
    sortOrder: 1,
    optional: false,
    // PageSpeed works unkeyed but is throttled, so the key is recommended,
    // not required. The module records which mode it ran in.
    requires: [],
    recommends: ["PAGESPEED_API_KEY"],
  },
  {
    id: "service-lines",
    label: "Service-line coverage",
    sortOrder: 2,
    optional: false,
    // The site half of the diff works with no keys at all; the Google half
    // degrades to unverified rather than failing the module.
    requires: [],
    recommends: ["GOOGLE_PLACES_API_KEY"],
  },
  {
    id: "google",
    label: "Google presence",
    sortOrder: 3,
    optional: false,
    requires: [],
    recommends: ["GOOGLE_PLACES_API_KEY"],
  },
];

export function moduleById(id) {
  return auditModules.find((module) => module.id === id) ?? null;
}

/** Keys that are declared but absent, so the runner can explain a skip. */
export function missingRequirements(module, available) {
  return (module.requires ?? []).filter((key) => !available[key]);
}

export function missingRecommendations(module, available) {
  return (module.recommends ?? []).filter((key) => !available[key]);
}
