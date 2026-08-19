import { crawlSite, USER_AGENT } from "@/lib/audit/crawl";
import { distillPage } from "@/lib/audit/html";
import { crawlKey } from "@/lib/audit/collect-service-lines";
import type { CacheLookup, CollectContext, StoredPayload } from "@/lib/audit/runner";

async function fetchText(url: string, accept: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { "user-agent": USER_AGENT, accept } });
    if (!response.ok) return { ok: false as const, status: response.status, body: "" };
    return { ok: true as const, status: response.status, body: (await response.text()).slice(0, 400_000) };
  } catch {
    return { ok: false as const, status: 0, body: "" };
  } finally {
    clearTimeout(timer);
  }
}

/** Shared by the SEO and conversion modules; the crawl comes from the day cache. */
export async function collectOnPage(context: CollectContext, _keys: Record<string, string>, cached: CacheLookup) {
  const payloads: StoredPayload[] = [];
  let networkCalls = 0;

  const cKey = crawlKey(context.website);
  const cachedCrawl = await cached(cKey);
  if (cachedCrawl) {
    payloads.push({ ...cachedCrawl, source: "crawl" });
  } else {
    const crawl = await crawlSite(context.website);
    networkCalls += crawl.diagnostics.pagesAttempted + 1;
    const home = crawl.pages[0];
    payloads.push({
      source: "crawl", requestKey: cKey, ok: Boolean(home?.ok),
      retryable: Boolean(!home?.ok && crawl.homeRetryable),
      failureReason: home?.ok ? "" : home?.reason ?? "The website could not be reached.",
      payload: { pages: crawl.pages.map((page, index) => distillPage(page, { keepMarkup: index === 0 })), navigation: crawl.navigation, homeCss: crawl.homeCss, diagnostics: crawl.diagnostics, manual: {} },
    });
  }

  const origin = new URL(context.website).origin;

  const sitemapKey = `shared:sitemap:${origin}`;
  const cachedSitemap = await cached(sitemapKey);
  if (cachedSitemap) {
    payloads.push({ ...cachedSitemap, source: "sitemap" });
  } else {
    const sitemap = await fetchText(`${origin}/sitemap.xml`, "application/xml,text/xml");
    networkCalls += 1;
    const urlCount = (sitemap.body.match(/<loc>/gi) ?? []).length;
    const isIndex = /<sitemapindex/i.test(sitemap.body);
    payloads.push({
      source: "sitemap", requestKey: sitemapKey,
      ok: sitemap.ok && (urlCount > 0 || isIndex),
      retryable: false,
      failureReason: sitemap.ok
        ? (urlCount > 0 || isIndex ? "" : "sitemap.xml responded but contained no URLs.")
        : `sitemap.xml returned HTTP ${sitemap.status || "no response"}.`,
      payload: { status: sitemap.status, urlCount, isIndex },
    });
  }

  const robotsKey = `shared:robotsfile:${origin}`;
  const cachedRobots = await cached(robotsKey);
  if (cachedRobots) {
    payloads.push({ ...cachedRobots, source: "robots" });
  } else {
    const robots = await fetchText(`${origin}/robots.txt`, "text/plain");
    networkCalls += 1;
    const ruleCount = (robots.body.match(/^\s*(disallow|allow)\s*:/gim) ?? []).length;
    payloads.push({
      source: "robots", requestKey: robotsKey,
      ok: robots.ok, retryable: false,
      failureReason: robots.ok ? "" : `robots.txt returned HTTP ${robots.status || "no response"}.`,
      payload: { status: robots.status, ruleCount, referencesSitemap: /^\s*sitemap\s*:/im.test(robots.body) },
    });
  }

  return { payloads, costCents: 0, networkCalls };
}
