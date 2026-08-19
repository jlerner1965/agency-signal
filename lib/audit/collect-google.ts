import { crawlSite } from "@/lib/audit/crawl";
import { distillPage } from "@/lib/audit/html";
import { fetchPlaceDetails } from "@/lib/audit/places";
import { crawlKey, placesKey } from "@/lib/audit/collect-service-lines";
import type { CacheLookup, CollectContext, StoredPayload } from "@/lib/audit/runner";

/**
 * Reuses the same crawl and Places payloads the service-line module fetched.
 * With both modules in one run the cache means one crawl and one Places call.
 */
export async function collectGoogle(context: CollectContext, keys: Record<string, string>, cached: CacheLookup) {
  const payloads: StoredPayload[] = [];
  let costCents = 0;
  let networkCalls = 0;
  const lead = context.lead as Record<string, string>;

  const cKey = crawlKey(context.website);
  const cachedCrawl = await cached(cKey);
  if (cachedCrawl) {
    payloads.push({ ...cachedCrawl, source: "crawl" });
  } else {
    const crawl = await crawlSite(context.website, { maxPages: 8 });
    networkCalls += crawl.diagnostics.pagesAttempted + 1;
    const home = crawl.pages[0];
    payloads.push({
      source: "crawl", requestKey: cKey, ok: Boolean(home?.ok),
      retryable: Boolean(!home?.ok && crawl.homeRetryable),
      failureReason: home?.ok ? "" : home?.reason ?? "The website could not be reached.",
      payload: { pages: crawl.pages.map((page, index) => distillPage(page, { keepMarkup: index === 0 })), navigation: crawl.navigation, homeCss: crawl.homeCss, diagnostics: crawl.diagnostics, manual: {} },
    });
  }

  const pKey = placesKey(context.website);
  const cachedPlaces = await cached(pKey);
  if (cachedPlaces) {
    payloads.push({ ...cachedPlaces, source: "places" });
  } else {
    const places = await fetchPlaceDetails(keys.GOOGLE_PLACES_API_KEY ?? "", {
      placeId: lead.placeId, name: lead.agencyName, city: lead.city, state: lead.state,
    });
    networkCalls += places.calls;
    costCents += places.costCents;
    payloads.push({ source: "places", requestKey: pKey, ok: places.ok, retryable: places.retryable, failureReason: places.reason, payload: places.payload });
  }

  // Values a person entered from the live profile, for the fields the API does
  // not expose. These feed the same checks as the API data.
  payloads.push({
    source: "manual-entry",
    requestKey: `google:manual:${context.website}:${lead.googleReviewedAt ?? "never"}`,
    ok: true,
    retryable: false,
    payload: {
      reviewed: Boolean(lead.googleReviewedAt),
      googlePostRecencyDays: Number(lead.googlePostRecencyDays ?? 0),
      googleResponseRate: Number(lead.googleResponseRate ?? 0),
      googlePhotoCount: Number(lead.googlePhotoCount ?? 0),
      googleProfileCompleteness: Number(lead.googleProfileCompleteness ?? 0),
      googleNapConsistent: Boolean(lead.googleNapConsistent),
      googleReviewRecencyDays: Number(lead.googleReviewRecencyDays ?? 0),
      phone: lead.phone ?? "",
    },
  });

  return { payloads, costCents, networkCalls };
}
