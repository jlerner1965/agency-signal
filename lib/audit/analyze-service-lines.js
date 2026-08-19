import { visibleText } from "./html.js";

/**
 * The service-line diff. What the website sells versus what the Google
 * presence represents. Extraction is deterministic from the site's own
 * navigation, service pages and structured data; an LLM pass can enrich it but
 * never decides severity and never invents a service.
 */

const STOP_LINK = /^(home|about|about us|contact|contact us|blog|news|careers|privacy|terms|sitemap|book|book now|schedule|appointments?|patient portal|shop|store|cart|login|sign in|faq|reviews|testimonials|gallery|locations?|hours|team|our team|staff|providers?|pricing|insurance|new patients?|resources)$/i;
const SERVICE_PATH = /(service|treatment|therapy|program|procedure|specialt|practice-area|what-we-(do|offer)|conditions?|care)/i;

function normalize(name) {
  return name.replace(/\s+/g, " ").trim().replace(/[·|–—-]\s*$/, "").trim();
}

function key(name) {
  return normalize(name).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\b(services?|treatments?|therapy|programs?|care)\b/g, "").replace(/\s+/g, " ").trim();
}

function plausibleService(name) {
  const cleaned = normalize(name);
  if (cleaned.length < 3 || cleaned.length > 60) return false;
  if (STOP_LINK.test(cleaned)) return false;
  if (/^\d+$/.test(cleaned)) return false;
  if (/(read more|learn more|click here|view all|see all|next|previous)/i.test(cleaned)) return false;
  return true;
}

/** Services the site itself names, with where each was found. */
function pathOf(url) {
  try { return new URL(url).pathname.replace(/\/+$/, "").toLowerCase(); } catch { return ""; }
}

export function extractSiteServices(pages, navigation = []) {
  const found = new Map();
  // A page is one service line however many names point at it, so entries are
  // keyed by URL where there is one. Otherwise the nav label and the page's own
  // heading become two lines for the same thing and the gap count inflates.
  const byPath = new Map();

  const add = (name, source, url, { preferName = false } = {}) => {
    if (!plausibleService(name)) return;
    const id = key(name);
    if (!id) return;
    const path = url ? pathOf(url) : "";

    const existingId = (path && byPath.get(path)) || (found.has(id) ? id : null);
    if (existingId && found.has(existingId)) {
      const existing = found.get(existingId);
      existing.sources.add(source);
      if (!existing.url && url) existing.url = url;
      // A page's own heading names the service better than a nav label does.
      if (preferName) existing.name = normalize(name);
      if (path) byPath.set(path, existingId);
      return;
    }

    found.set(id, { key: id, name: normalize(name), sources: new Set([source]), url: url ?? "" });
    if (path) byPath.set(path, id);
  };

  // 1. Navigation is the site's own account of what it sells.
  for (const link of navigation) {
    const path = (() => { try { return new URL(link.url).pathname; } catch { return ""; } })();
    if (SERVICE_PATH.test(path) || SERVICE_PATH.test(link.text)) add(link.text, "navigation", link.url);
  }

  // 2. Dedicated service pages, identified by their own URL and heading.
  for (const page of pages) {
    if (!page.ok) continue;
    let path = "";
    try { path = new URL(page.url).pathname; } catch { continue; }
    if (!SERVICE_PATH.test(path)) continue;
    const heading = page.h1?.[0] || page.title;
    if (heading) add(heading, "service-page", page.url, { preferName: true });
    // Sub-services are commonly the H2s of a services index page.
    if (/services?\/?$|what-we-(do|offer)\/?$/i.test(path)) {
      for (const h2 of page.h2 ?? []) add(h2, "service-page", page.url);
    }
  }

  // 3. Structured data, where a site publishes it.
  for (const page of pages) {
    for (const block of page.jsonLd ?? []) {
      const type = String(block?.["@type"] ?? "");
      if (/Service|MedicalProcedure|MedicalTherapy|Offer/i.test(type) && block?.name) {
        add(String(block.name), "structured-data", page.url);
      }
      for (const offer of block?.hasOfferCatalog?.itemListElement ?? []) {
        const name = offer?.itemOffered?.name ?? offer?.name;
        if (name) add(String(name), "structured-data", page.url);
      }
    }
  }

  return [...found.values()].map((service) => ({
    key: service.key,
    name: service.name,
    url: service.url,
    sources: [...service.sources],
  }));
}

/** What the Google profile represents, from Places plus any manual entry. */
export function extractGoogleServices(places, manual = {}) {
  const names = new Set();
  const add = (value) => {
    const cleaned = normalize(String(value ?? "")).replace(/_/g, " ");
    if (cleaned && plausibleService(cleaned)) names.add(cleaned);
  };
  add(places?.primaryTypeDisplayName?.text ?? places?.primaryType);
  for (const type of places?.types ?? []) add(type);
  for (const entry of places?.editorialSummary?.text?.split(/[,.]/) ?? []) add(entry);
  add(manual.googlePrimaryCategory);
  for (const entry of String(manual.googleServices ?? "").split(/[,;\n]/)) add(entry);
  return [...names].map((name) => ({ key: key(name), name }));
}

function coveredByGoogle(service, googleServices, googleText) {
  const overlaps = (a, b) => a.length > 4 && b.length > 4 && (a.includes(b) || b.includes(a));
  if (googleServices.some((entry) => entry.key && (entry.key === service.key || overlaps(entry.key, service.key)))) return true;
  // A review or summary naming the service counts as representation too.
  return service.key.length > 4 && googleText.includes(service.key);
}

/**
 * @param payloads stored payloads for this module
 */
export function analyzeServiceLines(payloads) {
  const crawl = payloads.find((payload) => payload.source === "crawl");
  const places = payloads.find((payload) => payload.source === "places");
  const enrichment = payloads.find((payload) => payload.source === "service-extraction");

  const checks = [];
  const findings = [];
  const check = (id, label, weight, passed, evidence, failure) => {
    checks.push({ id, category: "Service coverage", label, weight, status: passed === null ? "unverified" : passed ? "passed" : "failed", earned: passed ? weight : 0, evidence });
    if (passed === false && failure) findings.push({ category: "Service coverage", evidence, ...failure });
  };

  if (!crawl?.ok || !crawl.payload) {
    return {
      findings: [{
        category: "Service coverage",
        severity: "High",
        title: "Service coverage could not be assessed",
        evidence: `The website could not be read, so nothing was compared against the Google presence. ${crawl?.failureReason ?? ""}`.trim(),
        recommendation: "Retry the audit, or confirm whether bot protection is blocking automated review.",
        impactNote: "This is missing data, not evidence of poor coverage.",
        impactScore: 4, effortScore: 1, affectedUrl: "",
      }],
      checks: [],
      reachable: false,
      message: crawl?.failureReason || "The website could not be read.",
      serviceLines: [],
    };
  }

  const { pages = [], navigation = [] } = crawl.payload;
  const siteServices = extractSiteServices(pages, navigation);
  const llmServices = Array.isArray(enrichment?.payload?.services) ? enrichment.payload.services : [];

  // LLM output is merged as additional candidates only; it cannot remove a
  // service the site itself named, and it never sets severity.
  for (const candidate of llmServices) {
    const name = normalize(String(candidate?.name ?? ""));
    if (!plausibleService(name)) continue;
    const id = key(name);
    if (!id || siteServices.some((service) => service.key === id)) continue;
    siteServices.push({ key: id, name, url: String(candidate?.url ?? ""), sources: ["page-copy"] });
  }

  const placesPayload = places?.ok ? places.payload : null;
  const googleServices = extractGoogleServices(placesPayload, crawl.payload.manual ?? {});
  const googleText = visibleText(JSON.stringify(placesPayload ?? {})).toLowerCase();
  const googleKnown = Boolean(placesPayload) || googleServices.length > 0;

  // A link into the services index is not a landing page. That is exactly the
  // "sold but cannot rank" case, so a URL alone is not enough evidence.
  const INDEX_PATH = /\/(services?|treatments?|programs?|what-we-(do|offer))\/?$/i;
  const crawledPages = pages.filter((page) => page.ok);
  const hasLandingPage = (service) => {
    const words = service.key.split(" ").filter((word) => word.length > 3);
    return crawledPages.some((page) => {
      let path;
      try { path = new URL(page.url).pathname.toLowerCase(); } catch { return false; }
      if (path === "/" || INDEX_PATH.test(path)) return false;
      const heading = key(page.h1?.[0] || page.title || "");
      if (heading && heading === service.key) return true;
      const slug = path.replace(/[^a-z0-9]+/g, " ");
      return words.length > 0 && words.every((word) => slug.includes(word));
    });
  };

  const serviceLines = siteServices.map((service) => ({
    name: service.name,
    key: service.key,
    siteUrl: service.url,
    sources: service.sources,
    hasLandingPage: hasLandingPage(service),
    googleRepresented: googleKnown ? coveredByGoogle(service, googleServices, googleText) : null,
  }));

  check("services-found", "Services identified on the site", 4, serviceLines.length > 0,
    serviceLines.length
      ? `${serviceLines.length} service line${serviceLines.length === 1 ? "" : "s"} named by the site: ${serviceLines.slice(0, 8).map((line) => line.name).join(", ")}${serviceLines.length > 8 ? "…" : ""}.`
      : "No distinct service lines could be identified from navigation, service pages, or structured data.",
    { severity: "Medium", title: "The site does not name its services in a machine-readable way",
      recommendation: "Give each service a navigation entry and a dedicated page, and publish Service structured data.",
      impactNote: "Services that search engines cannot enumerate cannot rank for the searches that matter.",
      impactScore: 4, effortScore: 3 });

  if (!googleKnown) {
    checks.push({ id: "google-coverage", category: "Service coverage", label: "Services represented on Google", weight: 8, status: "unverified", earned: 0,
      evidence: places?.failureReason || "No Google profile data was available, so site services could not be compared against it." });
  } else {
    const gaps = serviceLines.filter((line) => line.googleRepresented === false);
    check("google-coverage", "Services represented on Google", 8, gaps.length === 0,
      gaps.length
        ? `${gaps.length} of ${serviceLines.length} service lines the website sells are not represented on the Google profile: ${gaps.map((line) => line.name).join(", ")}.`
        : `All ${serviceLines.length} identified service lines are represented on the Google profile.`,
      null);

    // Each gap is its own finding: they are sold separately and fixed separately.
    for (const gap of gaps) {
      findings.push({
        category: "Service coverage",
        severity: "High",
        title: `“${gap.name}” is invisible on Google`,
        evidence: `The website sells ${gap.name}${gap.siteUrl ? ` at ${gap.siteUrl}` : ""}, but the Google Business Profile does not represent it in its category, listed services, or description.`,
        recommendation: `Add ${gap.name} to the profile's services, and reference it in the business description and a post.`,
        impactNote: "Google flattens a multi-service business into one category. Every service the profile omits is a service local searchers cannot find, no matter how well the website covers it.",
        impactScore: 5, effortScore: 2,
        affectedUrl: gap.siteUrl,
      });
    }
  }

  const orphans = serviceLines.filter((line) => !line.hasLandingPage);
  check("service-pages", "Every service has a page", 5, serviceLines.length === 0 ? null : orphans.length === 0,
    serviceLines.length === 0
      ? "No service lines were identified, so page coverage could not be assessed."
      : orphans.length
        ? `${orphans.length} service line${orphans.length === 1 ? " has" : "s have"} no dedicated page: ${orphans.map((line) => line.name).join(", ")}.`
        : `All ${serviceLines.length} service lines have a dedicated page.`,
    { severity: "High", title: "Services are sold without a page that can rank",
      recommendation: "Give each service its own page covering the problem, the treatment, who it suits, and the next step.",
      impactNote: "A service mentioned only in a list cannot rank for its own searches. A page can.",
      impactScore: 5, effortScore: 3 });

  const verified = checks.filter((check) => check.status !== "unverified").length;
  return {
    findings, checks, reachable: true, serviceLines,
    message: `Identified ${serviceLines.length} service lines across ${pages.filter((page) => page.ok).length} pages; ${verified} of ${checks.length} checks verified.`,
  };
}
