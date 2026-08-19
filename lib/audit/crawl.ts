import { safeAuditUrl } from "@/lib/website-inspection";
import { parseRobots, permissiveRobots } from "@/lib/audit/robots";
import { extractLinks, extractNavigationLinks, navigationIsServerRendered, prioritizeLinks } from "@/lib/audit/html";

/** Identifies the tool honestly and points at a page explaining it. */
export const CRAWLER_TOKEN = "AgencySignal-Audit";
export const USER_AGENT = `${CRAWLER_TOKEN}/4.0 (+https://agencysignal.app/crawler)`;

const PAGE_TIMEOUT_MS = 15_000;
const DEFAULT_DELAY_MS = 800;
const MAX_DELAY_MS = 10_000;
const DEFAULT_MAX_PAGES = 25;
const DEFAULT_BUDGET_MS = 45_000;

export type CrawledPage = {
  url: string;
  status: number;
  html: string;
  ok: boolean;
  reason: string;
};

/**
 * Recorded on every run so the blocking question is answered from real audits
 * rather than a separate diagnostic endpoint.
 */
export type CrawlDiagnostics = {
  finalUrl: string;
  finalStatus: number;
  robotsFetchable: boolean;
  robotsStatus: number;
  robotsRules: number;
  crawlDelaySeconds: number | null;
  navigationServerRendered: boolean | null;
  pagesAttempted: number;
  pagesReached: number;
  pagesDisallowed: number;
  truncatedBy: "" | "page-cap" | "time-budget";
  blockedResponses: Array<{ url: string; status: number; server: string; cfRay: string }>;
};

function isRetryableStatus(status: number) {
  return status === 429 || (status >= 500 && status < 600);
}

async function fetchPage(url: string): Promise<CrawledPage & { server: string; cfRay: string; retryable: boolean }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
    });
    const server = response.headers.get("server") ?? "";
    const cfRay = response.headers.get("cf-ray") ?? "";
    const contentType = response.headers.get("content-type") ?? "";
    if (!response.ok) {
      return {
        url: response.url || url, status: response.status, html: "", ok: false, server, cfRay,
        retryable: isRetryableStatus(response.status),
        reason: `HTTP ${response.status}${server ? ` from ${server}` : ""}${cfRay ? " (Cloudflare)" : ""}`,
      };
    }
    if (!contentType.includes("text/html")) {
      return { url: response.url || url, status: response.status, html: "", ok: false, server, cfRay, retryable: false, reason: `Content-Type ${contentType || "unknown"} is not HTML` };
    }
    return { url: response.url || url, status: response.status, html: (await response.text()).slice(0, 900_000), ok: true, server, cfRay, retryable: false, reason: "" };
  } catch (error) {
    const timedOut = error instanceof Error && error.name === "AbortError";
    return {
      url, status: 0, html: "", ok: false, server: "", cfRay: "", retryable: true,
      reason: timedOut ? `No response within ${PAGE_TIMEOUT_MS / 1000}s` : `Network error: ${error instanceof Error ? error.message : "unknown"}`,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Linked stylesheets from the homepage, bounded. Most real sites keep their
 * palette in an external file, so reading only inline CSS would mean brand
 * tokens are almost always defaults.
 */
async function fetchStylesheets(html: string, baseUrl: string) {
  const hrefs = [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["']/gi)]
    .concat([...html.matchAll(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']stylesheet["']/gi)])
    .map((match) => match[1])
    .filter(Boolean);

  const sameOrigin = [...new Set(hrefs)]
    .map((href) => { try { return new URL(href, baseUrl).toString(); } catch { return ""; } })
    .filter((href) => href && new URL(href).origin === new URL(baseUrl).origin)
    .slice(0, 3);

  const parts: string[] = [];
  for (const href of sameOrigin) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8_000);
    try {
      const response = await fetch(href, { signal: controller.signal, headers: { "user-agent": USER_AGENT, accept: "text/css" } });
      if (response.ok) parts.push((await response.text()).slice(0, 120_000));
    } catch { /* a stylesheet we cannot read just means fewer brand tokens */ }
    finally { clearTimeout(timer); }
  }
  return parts.join("\n").slice(0, 250_000);
}

async function fetchRobots(origin: string) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(new URL("/robots.txt", origin), {
      signal: controller.signal,
      headers: { "user-agent": USER_AGENT, accept: "text/plain" },
    });
    // A 404 is a definitive "no rules", which is different from not reaching it.
    if (response.status === 404) return { fetchable: true, status: 404, body: "" };
    if (!response.ok) return { fetchable: false, status: response.status, body: "" };
    return { fetchable: true, status: response.status, body: (await response.text()).slice(0, 200_000) };
  } catch {
    return { fetchable: false, status: 0, body: "" };
  } finally {
    clearTimeout(timer);
  }
}

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One request at a time, spaced by the site's own Crawl-delay where it states
 * one. Disallowed paths are skipped rather than fetched and discarded.
 */
export async function crawlSite(website: string, options: { maxPages?: number; budgetMs?: number } = {}) {
  const maxPages = options.maxPages ?? DEFAULT_MAX_PAGES;
  const budgetMs = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const startedAt = Date.now();
  const target = safeAuditUrl(website).toString();
  const origin = new URL(target).origin;

  const robotsResponse = await fetchRobots(origin);
  const robots = robotsResponse.fetchable && robotsResponse.body
    ? parseRobots(robotsResponse.body, CRAWLER_TOKEN)
    : permissiveRobots();
  const delayMs = robots.crawlDelay === null
    ? DEFAULT_DELAY_MS
    : Math.min(MAX_DELAY_MS, Math.max(DEFAULT_DELAY_MS, robots.crawlDelay * 1000));

  const diagnostics: CrawlDiagnostics = {
    finalUrl: target, finalStatus: 0,
    robotsFetchable: robotsResponse.fetchable, robotsStatus: robotsResponse.status,
    robotsRules: robots.ruleCount, crawlDelaySeconds: robots.crawlDelay,
    navigationServerRendered: null,
    pagesAttempted: 0, pagesReached: 0, pagesDisallowed: 0,
    truncatedBy: "", blockedResponses: [],
  };

  const pages: CrawledPage[] = [];
  const visited = new Set<string>();
  const queue: string[] = [target];
  let homeRetryable = false;

  const recordBlock = (page: { url: string; status: number; server: string; cfRay: string }) => {
    if (diagnostics.blockedResponses.length < 8) {
      diagnostics.blockedResponses.push({ url: page.url, status: page.status, server: page.server, cfRay: page.cfRay });
    }
  };

  while (queue.length && pages.length < maxPages) {
    if (Date.now() - startedAt > budgetMs) { diagnostics.truncatedBy = "time-budget"; break; }
    const next = queue.shift() as string;
    if (visited.has(next)) continue;
    visited.add(next);

    let pathname: string;
    try { pathname = new URL(next).pathname; } catch { continue; }
    if (!robots.isAllowed(pathname)) { diagnostics.pagesDisallowed += 1; continue; }

    if (diagnostics.pagesAttempted > 0) await wait(delayMs);
    diagnostics.pagesAttempted += 1;
    const page = await fetchPage(next);

    if (pages.length === 0) {
      diagnostics.finalUrl = page.url;
      diagnostics.finalStatus = page.status;
      homeRetryable = page.retryable;
    }
    if (!page.ok) {
      recordBlock(page);
      pages.push({ url: page.url, status: page.status, html: "", ok: false, reason: page.reason });
      // A homepage we cannot read means there is nothing to crawl from.
      if (pages.length === 1) break;
      continue;
    }

    diagnostics.pagesReached += 1;
    pages.push({ url: page.url, status: page.status, html: page.html, ok: true, reason: "" });

    if (pages.length === 1) {
      diagnostics.navigationServerRendered = navigationIsServerRendered(page.html, page.url);
      const navLinks = extractNavigationLinks(page.html, page.url);
      const allLinks = extractLinks(page.html, page.url);
      for (const link of prioritizeLinks([...navLinks, ...allLinks])) {
        if (!visited.has(link.url) && !queue.includes(link.url)) queue.push(link.url);
      }
    }
  }

  if (!diagnostics.truncatedBy && queue.length && pages.length >= maxPages) diagnostics.truncatedBy = "page-cap";

  const navigation = pages[0]?.ok ? extractNavigationLinks(pages[0].html, pages[0].url) : [];
  const homeCss = pages[0]?.ok ? await fetchStylesheets(pages[0].html, pages[0].url) : "";
  return { pages, diagnostics, navigation, homeCss, homeRetryable, robotsBody: robotsResponse.body };
}
