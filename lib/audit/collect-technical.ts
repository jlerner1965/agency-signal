import { safeAuditUrl } from "@/lib/website-inspection";
import { costOf } from "@/lib/audit/cost-config";
import type { StoredPayload } from "@/lib/audit/runner";

const USER_AGENT = "AgencySignal-Audit/4.0 (+https://agencysignal.app/crawler)";
const FETCH_TIMEOUT_MS = 20_000;

/**
 * Bot protection on small-business hosting commonly answers a datacenter
 * request with 403 or a challenge page. That is a distinct outcome from a bad
 * website, so it is recorded as a failed fetch with its reason rather than
 * being allowed to look like missing content.
 */
function describeBlock(status: number, server: string, body: string) {
  if (status === 403 || status === 401) return `The site refused the request with HTTP ${status}${server ? ` (${server})` : ""}. This usually means bot protection, not a site problem.`;
  if (status === 429) return "The site rate-limited the request (HTTP 429).";
  if (status === 503 && /cloudflare|sucuri|incapsula/i.test(`${server} ${body.slice(0, 2000)}`)) return "A bot-protection challenge was served instead of the page (HTTP 503).";
  if (status >= 500) return `The site returned a server error (HTTP ${status}).`;
  if (status >= 400) return `The site returned HTTP ${status}.`;
  return "";
}

async function fetchDocument(url: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
    const contentType = response.headers.get("content-type") ?? "";
    const server = response.headers.get("server") ?? "";
    const body = contentType.includes("text/html") ? (await response.text()).slice(0, 1_500_000) : "";
    const blocked = describeBlock(response.status, server, body);
    if (blocked) return { ok: false as const, reason: blocked, status: response.status, finalUrl: response.url || url, server, html: "" };
    if (!contentType.includes("text/html")) {
      return { ok: false as const, reason: `The URL returned ${contentType || "an unknown content type"} rather than an HTML page.`, status: response.status, finalUrl: response.url || url, server, html: "" };
    }
    return {
      ok: true as const,
      status: response.status,
      finalUrl: response.url || url,
      server,
      html: body,
      redirected: response.redirected,
      contentType,
    };
  } catch (error) {
    const reason = error instanceof Error && error.name === "AbortError"
      ? `The site did not respond within ${FETCH_TIMEOUT_MS / 1000} seconds.`
      : `The site could not be reached: ${error instanceof Error ? error.message : "unknown network error"}.`;
    return { ok: false as const, reason, status: 0, finalUrl: url, server: "", html: "" };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchPageSpeed(url: string, strategy: "mobile" | "desktop", apiKey: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS + 25_000);
  try {
    const params = new URLSearchParams({ url, strategy, locale: "en" });
    for (const category of ["performance", "accessibility", "seo", "best-practices"]) params.append("category", category);
    if (apiKey) params.set("key", apiKey);
    const response = await fetch(`https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { signal: controller.signal });
    if (!response.ok) {
      const detail = response.status === 429
        ? "PageSpeed rate-limited the request. Configure PAGESPEED_API_KEY to raise the quota."
        : `PageSpeed returned HTTP ${response.status}.`;
      return { ok: false as const, reason: detail, payload: null };
    }
    return { ok: true as const, reason: "", payload: await response.json() };
  } catch (error) {
    return { ok: false as const, reason: `PageSpeed did not respond: ${error instanceof Error ? error.message : "unknown error"}.`, payload: null };
  } finally {
    clearTimeout(timer);
  }
}

export async function collectTechnical(website: string, keys: Record<string, string>) {
  const requested = safeAuditUrl(website);
  const target = requested.toString();
  const payloads: StoredPayload[] = [];

  const document = await fetchDocument(target);
  payloads.push({
    source: "document",
    requestKey: `technical:document:${target}`,
    ok: document.ok,
    failureReason: document.ok ? "" : document.reason,
    payload: document.ok
      ? { status: document.status, finalUrl: document.finalUrl, server: document.server, redirected: document.redirected, html: document.html }
      : { status: document.status, finalUrl: document.finalUrl, server: document.server },
  });

  // A 404 probe only means anything if the site answered the homepage at all.
  if (document.ok) {
    const probeUrl = new URL(`/agencysignal-404-probe-${Date.now().toString(36)}`, document.finalUrl).toString();
    const probe = await fetchDocument(probeUrl);
    payloads.push({
      source: "notfound-probe",
      requestKey: `technical:notfound:${target}`,
      ok: true,
      payload: { status: probe.status, hasBody: Boolean(probe.html), length: probe.html.length },
    });
  }

  const apiKey = keys.PAGESPEED_API_KEY ?? "";
  let pagespeedCalls = 0;
  for (const strategy of ["mobile", "desktop"] as const) {
    // No point asking Google to render a page our own fetch could not reach.
    if (!document.ok) {
      payloads.push({
        source: `pagespeed-${strategy}`,
        requestKey: `technical:psi:${strategy}:${target}`,
        ok: false,
        failureReason: "Skipped because the page itself could not be fetched.",
        payload: null,
      });
      continue;
    }
    const result = await fetchPageSpeed(document.finalUrl, strategy, apiKey);
    pagespeedCalls += 1;
    payloads.push({
      source: `pagespeed-${strategy}`,
      requestKey: `technical:psi:${strategy}:${target}`,
      ok: result.ok,
      failureReason: result.reason,
      payload: result.payload,
    });
  }

  return { payloads, costCents: costOf("pagespeed", pagespeedCalls) };
}
