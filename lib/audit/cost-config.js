/**
 * Estimated cost per external call, in cents, used to report what a run cost.
 * These are estimates for reporting, not billing. Prices were read from each
 * provider's published pricing in August 2026 — re-check before relying on them
 * for anything but a rough per-run figure.
 */
export const unitCosts = {
  // Free with a key. 25,000 queries/day, 400 per 100 seconds.
  // Unkeyed requests are throttled hard and fail silently.
  pagespeed: { cents: 0, note: "Free with an API key; 25k/day, 400 per 100s" },

  // Billed per request against a monthly credit. The SKU tier follows the
  // field mask, so the mask is pinned in code rather than requested wholesale.
  placesDetails: { cents: 1.7, note: "Per Place Details request; SKU depends on the field mask" },
  placesTextSearch: { cents: 3.2, note: "Per Text Search request; pricier SKU than Details" },

  // DataForSEO standard queue: $0.60 per 1,000 SERPs = $0.0006 each.
  // Cheapest per call, but the $50 prepaid minimum is real money up front.
  serpDataForSeo: { cents: 0.06, note: "Standard queue, $0.60/1k; $50 minimum prepaid balance" },

  // SerpApi has no pay-as-you-go, but 250 free searches a month covers a
  // 150-search campaign outright. Zero cost until a second campaign lands.
  serpSerpApi: { cents: 0, note: "Free tier: 250 searches/month, no rollover; $25/mo for 1k beyond that" },
};

/**
 * Which SERP provider the competitive module uses. SerpApi's free tier covers
 * a single campaign at no cost; DataForSEO is cheaper per call but wants $50
 * up front, which is not worth paying to save pennies on one campaign.
 * Switch when a second campaign in a month pushes past the 250 free searches.
 */
export const defaultSerpProvider = "serpapi";

export const serpProviders = {
  serpapi: { label: "SerpApi", unit: "serpSerpApi", freeSearchesPerMonth: 250, keyName: "SERP_API_KEY" },
  dataforseo: { label: "DataForSEO", unit: "serpDataForSeo", freeSearchesPerMonth: 0, keyName: "SERP_API_KEY" },
};

/** Rough token pricing for the copilot and extraction calls, per 1k tokens. */
export const modelCosts = {
  inputCentsPer1k: 0.005,
  outputCentsPer1k: 0.04,
};

export function costOf(unit, calls = 1) {
  const entry = unitCosts[unit];
  if (!entry) return 0;
  return Math.round(entry.cents * calls * 100) / 100;
}

export function formatCents(cents) {
  if (!cents) return "$0.00";
  return cents < 1 ? `$${(cents / 100).toFixed(4)}` : `$${(cents / 100).toFixed(2)}`;
}
