import { costOf } from "@/lib/audit/cost-config";

/**
 * Places API (New). The field mask is pinned here rather than requested
 * wholesale, because Google bills by the SKU tier the requested fields fall in.
 */
const DETAILS_FIELDS = [
  "id", "displayName", "formattedAddress", "shortFormattedAddress", "nationalPhoneNumber",
  "internationalPhoneNumber", "websiteUri", "rating", "userRatingCount", "businessStatus",
  "primaryType", "primaryTypeDisplayName", "types", "regularOpeningHours", "editorialSummary",
].join(",");

const SEARCH_FIELDS = ["places.id", "places.displayName", "places.formattedAddress", "places.websiteUri"].join(",");

export type PlacesResult = {
  ok: boolean;
  retryable: boolean;
  reason: string;
  payload: Record<string, unknown> | null;
  costCents: number;
  calls: number;
};

function retryable(status: number) {
  return status === 429 || (status >= 500 && status < 600);
}

async function call(url: string, apiKey: string, fieldMask: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: { ...(init.headers ?? {}), "X-Goog-Api-Key": apiKey, "X-Goog-FieldMask": fieldMask },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return { ok: false as const, status: response.status, body: null, detail: detail.slice(0, 300) };
    }
    return { ok: true as const, status: response.status, body: await response.json() as Record<string, unknown>, detail: "" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolves a profile by place id where the prospect has one, otherwise by name
 * and city. Text search is the pricier SKU, so it runs only as a fallback.
 */
export async function fetchPlaceDetails(
  apiKey: string,
  { placeId, name, city, state }: { placeId?: string; name?: string; city?: string; state?: string },
): Promise<PlacesResult> {
  if (!apiKey) {
    return { ok: false, retryable: false, reason: "GOOGLE_PLACES_API_KEY is not configured.", payload: null, costCents: 0, calls: 0 };
  }
  let cost = 0;
  let calls = 0;
  let resolvedId = (placeId ?? "").trim();

  try {
    if (!resolvedId) {
      const query = [name, city, state].filter(Boolean).join(", ").trim();
      if (!query) {
        return { ok: false, retryable: false, reason: "No place id, and no business name or city to search with.", payload: null, costCents: 0, calls: 0 };
      }
      const search = await call("https://places.googleapis.com/v1/places:searchText", apiKey, SEARCH_FIELDS, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ textQuery: query, maxResultCount: 1 }),
      });
      calls += 1;
      cost += costOf("placesTextSearch");
      if (!search.ok) {
        return { ok: false, retryable: retryable(search.status), reason: `Places text search returned HTTP ${search.status}. ${search.detail}`.trim(), payload: null, costCents: cost, calls };
      }
      const places = (search.body?.places ?? []) as Array<{ id?: string }>;
      resolvedId = places[0]?.id ?? "";
      if (!resolvedId) {
        return { ok: false, retryable: false, reason: `No Google Business Profile matched “${query}”.`, payload: null, costCents: cost, calls };
      }
    }

    const details = await call(`https://places.googleapis.com/v1/places/${encodeURIComponent(resolvedId)}`, apiKey, DETAILS_FIELDS);
    calls += 1;
    cost += costOf("placesDetails");
    if (!details.ok) {
      return { ok: false, retryable: retryable(details.status), reason: `Places details returned HTTP ${details.status}. ${details.detail}`.trim(), payload: null, costCents: cost, calls };
    }
    return { ok: true, retryable: false, reason: "", payload: details.body, costCents: cost, calls };
  } catch (error) {
    return {
      ok: false,
      retryable: true,
      reason: `Places did not respond: ${error instanceof Error ? error.message : "unknown error"}.`,
      payload: null, costCents: cost, calls,
    };
  }
}
