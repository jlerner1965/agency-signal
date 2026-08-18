import { analyzeWebsitePages, extractBusinessMetadata, extractInternalLinks, mergeLighthouseAudit } from "@/lib/site-audit";

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (/^(127|10|0)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

export function safeAuditUrl(input: string) {
  const value = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || isPrivateHostname(url.hostname)) throw new Error("Please enter a public http or https website.");
  if (url.port && !["80", "443"].includes(url.port)) throw new Error("Custom website ports are not supported.");
  url.hash = "";
  return url;
}

async function fetchPage(input: string, signal: AbortSignal) {
  const requested = safeAuditUrl(input);
  const response = await fetch(requested, { redirect: "follow", signal, headers: { "User-Agent": "AgencySignal-Audit/3.0 (+public website opportunity review)" } });
  if (!response.ok) throw new Error(`The website returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) throw new Error("The URL did not return an HTML webpage.");
  const finalUrl = safeAuditUrl(response.url || requested.toString()).toString();
  return { url: finalUrl, html: (await response.text()).slice(0, 1_500_000), status: response.status };
}

function categoryScore(categories: Record<string, { score?: number }> | undefined, key: string) {
  const score = categories?.[key]?.score;
  return typeof score === "number" ? Math.round(score * 100) : null;
}

async function fetchLighthouseSnapshot(input: string, signal: AbortSignal) {
  try {
    const params = new URLSearchParams({ url: input, strategy: "mobile", locale: "en" });
    for (const category of ["performance", "accessibility", "seo", "best-practices"]) params.append("category", category);
    const apiKey = process.env.PAGESPEED_API_KEY;
    if (apiKey) params.set("key", apiKey);
    const response = await fetch(`https://pagespeedonline.googleapis.com/pagespeedonline/v5/runPagespeed?${params}`, { signal });
    if (!response.ok) return null;
    const payload = await response.json() as {
      lighthouseResult?: {
        categories?: Record<string, { score?: number }>;
        audits?: Record<string, { displayValue?: string; details?: { data?: string } }>;
      };
    };
    const categories = payload.lighthouseResult?.categories;
    const audits = payload.lighthouseResult?.audits;
    if (!categories) return null;
    const screenshot = audits?.["final-screenshot"]?.details?.data ?? "";
    return {
      performance: categoryScore(categories, "performance"), accessibility: categoryScore(categories, "accessibility"),
      seo: categoryScore(categories, "seo"), bestPractices: categoryScore(categories, "best-practices"),
      lcp: audits?.["largest-contentful-paint"]?.displayValue ?? "",
      inp: audits?.["interaction-to-next-paint"]?.displayValue ?? audits?.["total-blocking-time"]?.displayValue ?? "",
      cls: audits?.["cumulative-layout-shift"]?.displayValue ?? "",
      screenshotData: /^data:image\/(?:jpeg|png|webp);base64,/i.test(screenshot) && screenshot.length < 1_500_000 ? screenshot : "",
    };
  } catch { return null; }
}

export async function inspectWebsite(input: string) {
  const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 35_000);
  try {
    const home = await fetchPage(input, controller.signal);
    const lighthousePromise = fetchLighthouseSnapshot(home.url, controller.signal);
    const links = extractInternalLinks(home.html, home.url, 4);
    const secondary = await Promise.allSettled(links.map((url: string) => fetchPage(url, controller.signal)));
    const pages = [home, ...secondary.filter((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof fetchPage>>> => result.status === "fulfilled").map((result) => result.value)];
    const lighthouse = await lighthousePromise;
    const analysis = mergeLighthouseAudit(analyzeWebsitePages(pages), lighthouse, home.url);
    return { ...analysis, metadata: extractBusinessMetadata(home.html, home.url), finalUrl: home.url, status: home.status, screenshotData: lighthouse?.screenshotData ?? "" };
  } finally { clearTimeout(timeout); }
}
