import { crawlSite } from "@/lib/audit/crawl";
import { distillPage } from "@/lib/audit/html";
import { fetchPlaceDetails } from "@/lib/audit/places";
import type { CacheLookup, CollectContext, StoredPayload } from "@/lib/audit/runner";

/**
 * The crawl and the Places lookup are shared with the Google module through the
 * day cache, so keys are deliberately module-agnostic.
 */
export const crawlKey = (website: string) => `shared:crawl:${website}`;
export const placesKey = (website: string) => `shared:places:${website}`;

export async function collectServiceLines(context: CollectContext, keys: Record<string, string>, cached: CacheLookup) {
  const payloads: StoredPayload[] = [];
  let costCents = 0;
  let networkCalls = 0;
  const lead = context.lead as Record<string, string>;

  const cKey = crawlKey(context.website);
  const cachedCrawl = await cached(cKey);
  if (cachedCrawl) {
    payloads.push({ ...cachedCrawl, source: "crawl" });
  } else {
    const crawl = await crawlSite(context.website);
    networkCalls += crawl.diagnostics.pagesAttempted + 1;
    const home = crawl.pages[0];
    payloads.push({
      source: "crawl",
      requestKey: cKey,
      ok: Boolean(home?.ok),
      retryable: Boolean(!home?.ok && crawl.homeRetryable),
      throttled: home?.status === 429,
      failureReason: home?.ok ? "" : home?.reason ?? "The website could not be reached.",
      payload: {
        // Distilled, not raw: D1 caps a row at 2 MB.
        pages: crawl.pages.map((page, index) => distillPage(page, { keepMarkup: index === 0 })),
        navigation: crawl.navigation,
        homeCss: crawl.homeCss,
        diagnostics: crawl.diagnostics,
        manual: {
          googlePrimaryCategory: lead.googlePrimaryCategory ?? "",
          googleServices: lead.googleServices ?? "",
          // Whether a person has actually looked at the live profile. Without
          // it an empty service list means "nobody checked", not "there are
          // none", and those are very different things to tell a prospect.
          googleServicesReviewed: Boolean(lead.googleReviewedAt),
        },
      },
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
    payloads.push({
      source: "places",
      requestKey: pKey,
      ok: places.ok,
      retryable: places.retryable,
      throttled: places.throttled,
      failureReason: places.reason,
      payload: places.payload,
    });
  }

  return { payloads, costCents, networkCalls };
}
