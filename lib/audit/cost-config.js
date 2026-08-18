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
  // Priority is 2x and Live is ~3.3x. $50 minimum prepaid, credits roll over.
  serpDataForSeo: { cents: 0.06, note: "Standard queue, $0.60/1k; $50 minimum prepaid balance" },

  // SerpApi has no pay-as-you-go: 250 free searches/month, then $25/month for
  // 1,000 with no rollover. Effective cost depends entirely on monthly volume.
  serpSerpApi: { cents: 2.5, note: "Starter tier $25/mo for 1k searches; free tier 250/mo, no rollover" },
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
