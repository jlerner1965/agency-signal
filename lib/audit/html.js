/**
 * HTML extraction shared by the crawler and the analysis modules. Pure and
 * regex-based: there is no DOM in a Worker, and a parser dependency is not
 * worth the bundle for the shapes we need.
 */

const SKIP_LINK = /^(#|mailto:|tel:|javascript:|sms:|data:)/i;
const ASSET_EXTENSION = /\.(?:pdf|jpe?g|png|gif|webp|svg|ico|css|js|zip|mp4|mp3|docx?|xlsx?)(?:$|\?)/i;

export function decodeEntities(value) {
  return value
    .replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;|&rsquo;/gi, "'")
    .replace(/&lt;/gi, "<").replace(/&gt;/gi, ">").replace(/&nbsp;/gi, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export function visibleText(html) {
  return decodeEntities(html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function sameOrigin(url, base) {
  try { return new URL(url, base).origin === new URL(base).origin; } catch { return false; }
}

/** Absolute, same-origin, hash-free, non-asset URLs, in document order. */
export function extractLinks(html, baseUrl) {
  const seen = new Set();
  const links = [];
  for (const match of html.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = decodeEntities(match[1].trim());
    if (!href || SKIP_LINK.test(href) || ASSET_EXTENSION.test(href)) continue;
    if (!sameOrigin(href, baseUrl)) continue;
    let resolved;
    try {
      const url = new URL(href, baseUrl);
      url.hash = "";
      resolved = url.toString();
    } catch { continue; }
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    links.push({ url: resolved, text: visibleText(match[2]).slice(0, 120) });
  }
  return links;
}

/**
 * Links inside navigation landmarks. These carry the site's own account of
 * what it sells, which is exactly what the service-line diff needs.
 */
export function extractNavigationLinks(html, baseUrl) {
  const regions = [
    ...html.matchAll(/<nav\b[^>]*>([\s\S]*?)<\/nav>/gi),
    ...html.matchAll(/<header\b[^>]*>([\s\S]*?)<\/header>/gi),
    ...html.matchAll(/<[^>]+\brole=["']navigation["'][^>]*>([\s\S]*?)<\/[a-z]+>/gi),
  ];
  const seen = new Set();
  const links = [];
  for (const region of regions) {
    for (const link of extractLinks(region[1], baseUrl)) {
      if (seen.has(link.url)) continue;
      seen.add(link.url);
      links.push(link);
    }
  }
  return links;
}

const SERVICE_HINT = /(service|treatment|therapy|program|procedure|solution|what-we-(do|offer)|our-(work|care)|specialt|practice-area|clinic|care)/i;

/**
 * Crawl order. Service and conversion pages first, because a truncated crawl
 * should still have looked at the pages the audit actually reasons about.
 */
export function prioritizeLinks(links) {
  const rank = (link) => {
    let path;
    try { path = new URL(link.url).pathname.toLowerCase(); } catch { return 9; }
    if (path === "/" || path === "") return 0;
    if (SERVICE_HINT.test(path) || SERVICE_HINT.test(link.text)) return 1;
    if (/(contact|book|appointment|schedule|consult|quote)/i.test(path)) return 2;
    if (/(about|team|staff|provider|doctor|physician|practitioner)/i.test(path)) return 3;
    if (/(location|hours|visit|directions)/i.test(path)) return 4;
    if (/(blog|news|article|post|category|tag|author|\/\d{4}\/)/i.test(path)) return 8;
    return 5;
  };
  const depth = (link) => {
    try { return new URL(link.url).pathname.split("/").filter(Boolean).length; } catch { return 9; }
  };
  return [...links].sort((a, b) => rank(a) - rank(b) || depth(a) - depth(b) || a.url.localeCompare(b.url));
}

export function extractTitle(html) {
  return decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? "").replace(/\s+/g, " ").trim();
}

export function extractHeadings(html, level) {
  return [...html.matchAll(new RegExp(`<h${level}\\b[^>]*>([\\s\\S]*?)</h${level}>`, "gi"))]
    .map((match) => visibleText(match[1]))
    .filter(Boolean);
}

export function metaContent(html, attribute, name) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(new RegExp(`\\b${attribute}=["']([^"']+)["']`, "i"))?.[1];
    if (key && key.toLowerCase() === name.toLowerCase()) {
      return decodeEntities(tag.match(/\bcontent=["']([^"']*)["']/i)?.[1] ?? "").trim();
    }
  }
  return "";
}

export function extractJsonLd(html) {
  const blocks = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].trim());
      blocks.push(...(Array.isArray(parsed) ? parsed : parsed?.["@graph"] ?? [parsed]));
    } catch { /* malformed JSON-LD is itself a finding, handled by the SEO module */ }
  }
  return blocks.filter(Boolean);
}

/** True when nav links exist in the served HTML rather than needing JS. */
export function navigationIsServerRendered(html, baseUrl) {
  return extractNavigationLinks(html, baseUrl).length >= 2;
}

/**
 * A crawled page reduced to what the analysers actually read. D1 caps a row at
 * 2 MB, so 25 pages of raw HTML cannot be stored; this keeps the structure and
 * a bounded text excerpt instead.
 */
export function distillPage(page, { keepMarkup = false } = {}) {
  if (!page.ok) {
    return { url: page.url, status: page.status, ok: false, reason: page.reason, title: "", h1: [], h2: [], text: "", links: [], navLinks: [], jsonLd: [], rawHead: "" };
  }
  const text = visibleText(page.html);
  const images = page.html.match(/<img\b[^>]*>/gi) ?? [];
  const forms = [...page.html.matchAll(/<form\b[\s\S]*?<\/form>/gi)].map((match) => match[0]);
  // The first viewport's worth of markup, used for above-the-fold checks.
  const aboveFold = page.html.slice(0, 12_000);
  return {
    url: page.url,
    status: page.status,
    ok: true,
    reason: "",
    title: extractTitle(page.html),
    metaDescription: metaContent(page.html, "name", "description") || metaContent(page.html, "property", "og:description"),
    canonical: page.html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1]
      ?? page.html.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*rel=["']canonical["']/i)?.[1] ?? "",
    imageCount: images.length,
    imagesWithAlt: images.filter((image) => /\balt\s*=\s*(?:["'][^"']*["']|[^\s>]+)/i.test(image)).length,
    // Conversion signals, extracted once so the analyser stays pure.
    telLinks: [...page.html.matchAll(/href=["']tel:([^"']+)["']/gi)].map((match) => match[1]).slice(0, 10),
    mailtoLinks: [...page.html.matchAll(/href=["']mailto:([^"']+)["']/gi)].map((match) => match[1]).slice(0, 10),
    telAboveFold: /href=["']tel:/i.test(aboveFold),
    ctaAboveFold: /<(?:a|button)\b[^>]*>[\s\S]{0,160}(book|schedule|appointment|consult|contact|call|get started|request)/i.test(aboveFold),
    forms: forms.map((form) => ({
      method: (form.match(/\bmethod=["']([^"']+)["']/i)?.[1] ?? "").toLowerCase(),
      action: form.match(/\baction=["']([^"']*)["']/i)?.[1] ?? null,
      fields: [...form.matchAll(/<(?:input|select|textarea)\b[^>]*>/gi)].map((match) => ({
        type: (match[0].match(/\btype=["']([^"']+)["']/i)?.[1] ?? "text").toLowerCase(),
        name: match[0].match(/\bname=["']([^"']+)["']/i)?.[1] ?? "",
        required: /\brequired\b/i.test(match[0]),
      })),
      hasSubmit: /<(?:button|input)\b[^>]*type=["']submit["']/i.test(form) || /<button\b(?![^>]*\btype=)[^>]*>/i.test(form),
    })).slice(0, 6),
    analytics: {
      ga4: /gtag\/js\?id=G-|googletagmanager\.com\/gtm\.js|gtag\(/i.test(page.html),
      plausible: /plausible\.io\/js/i.test(page.html),
      metaPixel: /connect\.facebook\.net[^"']*fbevents|fbq\(/i.test(page.html),
    },
    bookingLinks: extractLinks(page.html, page.url)
      .filter((link) => /(book|appointment|schedule|consult|request|contact)/i.test(link.url) || /(book|appointment|schedule|consult)/i.test(link.text))
      .slice(0, 8),
    trustSignals: {
      bios: /(meet (the|our) (team|providers?|doctors?)|our (team|providers?|practitioners?)|<[^>]*class=["'][^"']*(team|provider|staff|bio)[^"']*["'])/i.test(page.html),
      credentials: /\b(MD|DO|NP|PA-C|RN|DC|L\.?Ac|PhD|FNP|DNP|board[- ]certified|licensed)\b/.test(text),
      onSiteReviews: /(testimonial|what our (patients|clients|customers) say|review[s]? from|★|rated \d(\.\d)? (stars?|out of))/i.test(page.html),
    },
    h1: extractHeadings(page.html, 1).slice(0, 6),
    h2: extractHeadings(page.html, 2).slice(0, 25),
    text: text.slice(0, 12_000),
    wordCount: text.split(/\s+/).filter(Boolean).length,
    links: extractLinks(page.html, page.url).slice(0, 120),
    navLinks: extractNavigationLinks(page.html, page.url).slice(0, 60),
    jsonLd: extractJsonLd(page.html).slice(0, 12),
    // Only the homepage keeps markup, bounded, and only so brand tokens can be
    // read from its own CSS later without re-fetching the site.
    rawHead: keepMarkup ? page.html.slice(0, 60_000) : "",
  };
}
