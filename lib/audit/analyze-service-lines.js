import { visibleText } from "./html.js";

/**
 * The service-line diff. What the website sells versus what the Google
 * presence represents. Extraction is deterministic from the site's own
 * navigation, service pages and structured data; an LLM pass can enrich it but
 * never decides severity and never invents a service.
 */

const STOP_LINK = /^(home|about|about us|contact|contact us|blog|news|careers|privacy|terms|sitemap|book|book now|schedule|appointments?|patient portal|shop|store|cart|login|sign in|faq|reviews|testimonials|gallery|locations?|hours|team|our team|staff|providers?|pricing|insurance|new patients?|resources|products?|industr(y|ies)|applications?|solutions?|sectors?|markets?|capabilities|what we (do|offer))$/i;
// A link into an index is not a landing page, and an index's own heading is not
// a line the business sells. Both rules need the same list.
const INDEX_PATH = /\/(services?|treatments?|programs?|what-we-(do|offer)|industr(y|ies)|applications?|products?|solutions?|sectors?|markets?|capabilities)\/?$/i;
// What a business files the things it sells under. A clinic uses /services or
// /treatments; a supplier uses /industries, /products or /applications, and
// matching only the first set is why a supplier came back with one line.
const SERVICE_PATH = /(service|treatment|therapy|program|procedure|specialt|practice-area|what-we-(do|offer)|conditions?|care|industr(y|ies)|application|product|solution|sector|capabilit|market(?!ing))/i;

function normalize(name) {
  // Trailing punctuation is how a heading was punctuated, not part of the name.
  // Left in, "Water Treatment." reaches the gap table, every mockup heading and
  // the middle of proposal sentences with the full stop still attached.
  return name.replace(/\s+/g, " ").trim().replace(/[.,;:!·|–—-]+\s*$/, "").trim();
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

  const add = (name, source, url, { preferName = false, quote = "", listedOnIndex = false } = {}) => {
    if (!plausibleService(name)) return;
    const id = key(name);
    if (!id) return;
    // Lines read off an index all share the index's URL, so binding them to it
    // would fold every one of them into a single entry. They dedupe by name
    // instead, and cite the index because that is where they were read.
    const path = url && !listedOnIndex ? pathOf(url) : "";

    // An index entry that names a page already found is the same line, however
    // differently the index abbreviated it.
    if (listedOnIndex && !found.has(id)) {
      const words = id.split(" ").filter((word) => word.length > 3);
      const match = words.length
        ? [...found.entries()].find(([, entry]) => {
          const slug = pathOf(entry.url).replace(/[^a-z0-9]+/g, " ");
          return entry.url && words.every((word) => slug.includes(word));
        })
        : null;
      if (match) {
        match[1].sources.add(source);
        return;
      }
    }
    // The verbatim text the line was read from. Without it the line cannot be
    // defended in front of a prospect, so it does not reach the gap table.
    const citation = normalize(quote || name).slice(0, 200);

    const existingId = (path && byPath.get(path)) || (found.has(id) ? id : null);
    if (existingId && found.has(existingId)) {
      const existing = found.get(existingId);
      existing.sources.add(source);
      if (!existing.url && url) existing.url = url;
      // A page's own heading names the service better than a nav label does.
      if (preferName) { existing.name = normalize(name); existing.quote = citation; }
      if (!existing.quote) existing.quote = citation;
      if (path) byPath.set(path, existingId);
      return;
    }

    found.set(id, { key: id, name: normalize(name), sources: new Set([source]), url: url ?? "", quote: citation });
    if (path) byPath.set(path, id);
  };

  // 1. Navigation is the site's own account of what it sells.
  for (const link of navigation) {
    const path = (() => { try { return new URL(link.url).pathname; } catch { return ""; } })();
    if (SERVICE_PATH.test(path) || SERVICE_PATH.test(link.text)) add(link.text, "navigation", link.url, { quote: link.text });
  }

  // 2. Dedicated service pages, identified by their own URL and heading.
  // An index page lists what the business sells; its own heading ("Our
  // services", "Industries we supply") names none of it. The entries beneath it
  // are the lines, and are commonly its H2s — but an index entry can only be
  // recognised as naming a page once every page has been read, so they are held
  // back to the last pass rather than added here.
  const indexEntries = [];
  for (const page of pages) {
    if (!page.ok) continue;
    let path = "";
    try { path = new URL(page.url).pathname; } catch { continue; }
    if (!SERVICE_PATH.test(path)) continue;
    if (INDEX_PATH.test(path)) {
      for (const h2 of page.h2 ?? []) indexEntries.push({ name: h2, url: page.url });
      continue;
    }
    const heading = page.h1?.[0] || page.title;
    if (heading) add(heading, "service-page", page.url, { preferName: true, quote: heading });
  }

  // 3. Structured data, where a site publishes it.
  for (const page of pages) {
    for (const block of page.jsonLd ?? []) {
      const type = String(block?.["@type"] ?? "");
      if (/Service|MedicalProcedure|MedicalTherapy|Offer/i.test(type) && block?.name) {
        add(String(block.name), "structured-data", page.url, { quote: `${type}: ${block.name}` });
      }
      for (const offer of block?.hasOfferCatalog?.itemListElement ?? []) {
        const name = offer?.itemOffered?.name ?? offer?.name;
        if (name) add(String(name), "structured-data", page.url, { quote: `hasOfferCatalog: ${name}` });
      }
    }
  }

  // 4. What the indexes list, last, so a line already found as a page of its own
  // is recognised as the same line however the index abbreviated it.
  for (const entry of indexEntries) {
    add(entry.name, "service-page", entry.url, { quote: entry.name, listedOnIndex: true });
  }

  return [...found.values()].map((service) => ({
    key: service.key,
    name: service.name,
    url: service.url,
    quote: service.quote ?? "",
    sources: [...service.sources],
  }));
}

/** What the Google profile represents, from Places plus any manual entry. */
/**
 * What the profile represents, kept split by kind. A category is not a service
 * list: a profile categorised "Medical clinic" that lists nothing is a single
 * problem with the listing, not one problem per service the site sells.
 */
export function extractGoogleServices(places, manual = {}) {
  const category = normalize(String(places?.primaryTypeDisplayName?.text ?? places?.primaryType ?? manual.googlePrimaryCategory ?? "")).replace(/_/g, " ");
  const listed = new Set();
  const add = (value) => {
    const cleaned = normalize(String(value ?? "")).replace(/_/g, " ");
    if (cleaned && plausibleService(cleaned)) listed.add(cleaned);
  };
  // Places `types` are Google's own taxonomy ("doctor", "health"), not services
  // the business published. Counting them as a service list is what made a
  // category-only profile look like it listed something.
  const taxonomy = new Set();
  for (const type of places?.types ?? []) {
    const cleaned = normalize(String(type)).replace(/_/g, " ");
    if (cleaned && cleaned !== category) taxonomy.add(cleaned);
  }
  // A published service list is the editorial summary or what a person entered
  // from the live profile. The API exposes nothing else for a profile we do not
  // own, which is why the manual-check list exists.
  for (const entry of places?.editorialSummary?.text?.split(/[,.]/) ?? []) add(entry);
  for (const entry of String(manual.googleServices ?? "").split(/[,;\n]/)) add(entry);

  return {
    category,
    categoryKey: category ? key(category) : "",
    // An empty list is only a fact once somebody has looked. The Places API
    // does not return the services section for a profile we do not own, so
    // without a person's entry this is unknown, not empty.
    listedKnown: Boolean(manual.googleServicesReviewed) || listed.size > 0,
    listed: [...listed].map((name) => ({ key: key(name), name })),
    taxonomy: [...taxonomy].map((name) => ({ key: key(name), name })),
    // Everything the profile represents, for matching a site service against.
    all: [...(category ? [category] : []), ...taxonomy, ...listed].map((name) => ({ key: key(name), name })),
  };
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
    // A model candidate has to cite a page and the text it read, on the same
    // terms as everything else, or the fail-closed filter drops it below.
    siteServices.push({
      key: id, name,
      url: String(candidate?.url ?? ""),
      quote: normalize(String(candidate?.quote ?? "")).slice(0, 200),
      sources: ["page-copy"],
    });
  }

  const placesPayload = places?.ok ? places.payload : null;
  const google = extractGoogleServices(placesPayload, crawl.payload.manual ?? {});
  const googleText = visibleText(JSON.stringify(placesPayload ?? {})).toLowerCase();
  const googleKnown = Boolean(placesPayload) || google.all.length > 0;

  // A link into the services index is not a landing page. That is exactly the
  // "sold but cannot rank" case, so a URL alone is not enough evidence.
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

  const allServiceLines = siteServices.map((service) => ({
    name: service.name,
    key: service.key,
    siteUrl: service.url,
    quote: service.quote,
    sources: service.sources,
    hasLandingPage: hasLandingPage(service),
    googleRepresented: googleKnown ? coveredByGoogle(service, google.all, googleText) : null,
  }));

  // Fail closed: a line that cannot cite where it came from is not defensible
  // in front of a prospect, so it never reaches the gap table.
  const serviceLines = allServiceLines.filter((line) => line.quote && line.siteUrl);
  const uncited = allServiceLines.length - serviceLines.length;

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
    const names = serviceLines.map((line) => line.name);

    // Named precisely: without the services section, this compares against the
    // category and the profile's own text, which is what it always did — the
    // evidence just stops implying it saw a service list it never read.
    const against = google.listedKnown ? "the Google profile" : `the profile's category${google.category ? ` “${google.category}”` : ""}`;
    check("google-coverage", "Services represented on Google", 8, gaps.length === 0,
      gaps.length
        ? `${gaps.length} of ${serviceLines.length} service lines the website sells are not represented by ${against}: ${gaps.map((line) => line.name).join(", ")}.`
        : `All ${serviceLines.length} identified service lines are represented by ${against}.`,
      null);

    // What the services section lists cannot be read from the API, so it is
    // listed as unmeasured rather than omitted — an omitted check reads as a
    // pass, and this one was reading as "the profile lists nothing".
    if (!google.listedKnown) {
      checks.push({
        id: "google-service-list", category: "Service coverage", label: "Services listed on the profile",
        weight: 3, status: "unverified", earned: 0,
        evidence: "The Places API does not return the services section for a profile we do not own. Enter what the profile lists to include it.",
        unverifiedReason: "not-applicable",
      });
    }

    if (gaps.length && google.listedKnown && !google.listed.length) {
      // The profile lists nothing at all. That is one problem with the listing,
      // not one problem per service, and saying it once is what is true.
      findings.push({
        category: "Service coverage",
        severity: "High",
        title: "The Google profile lists no services at all",
        evidence: `The website sells ${names.length} distinct service line${names.length === 1 ? "" : "s"} (${names.join(", ")}). The Google Business Profile publishes no service list${google.category ? `, only the category “${google.category}”` : ""}, so none of them are represented.`,
        recommendation: "Add every service line to the profile's services section, then reference the highest-value ones in the description.",
        impactNote: "Google flattens a multi-service business into one category. With no service list, every line the site sells is invisible to local searchers regardless of how well the website covers it.",
        impactScore: 5, effortScore: 2,
        affectedUrl: serviceLines[0]?.siteUrl ?? "",
      });
    }

    // Category fit is its own finding, and the category is a fact the profile
    // publishes, so it stands whether or not the services section was read.
    if (gaps.length && google.category && names.length > 1) {
      findings.push({
        category: "Service coverage",
        severity: "Medium",
        title: `Categorised as “${google.category}” while selling ${names.length} service lines`,
        evidence: `The profile's only categorisation is “${google.category}”, while the website sells ${names.join(", ")}.`,
        recommendation: "Set the primary category to the highest-value service line and add secondary categories for the rest.",
        impactNote: "One category decides which searches the profile is eligible for. The other service lines are not competing at all.",
        impactScore: 4, effortScore: 1,
        affectedUrl: serviceLines[0]?.siteUrl ?? "",
      });
    }

    if (gaps.length && google.listed.length) {
      // The profile does list services, so a missing one is a specific gap.
      for (const gap of gaps) {
        findings.push({
          category: "Service coverage",
          severity: "High",
          title: `“${gap.name}” is missing from the Google service list`,
          evidence: `The website sells ${gap.name} at ${gap.siteUrl} (“${gap.quote}”), but the Google Business Profile lists ${google.listed.map((entry) => entry.name).join(", ")} and does not include it.`,
          recommendation: `Add ${gap.name} to the profile's services, and reference it in the business description and a post.`,
          impactNote: "Every service the profile omits is a service local searchers cannot find, no matter how well the website covers it.",
          impactScore: 5, effortScore: 2,
          affectedUrl: gap.siteUrl,
        });
      }
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
    message: `Identified ${serviceLines.length} service lines across ${pages.filter((page) => page.ok).length} pages${uncited ? `, excluding ${uncited} that could not cite a source` : ""}; ${verified} of ${checks.length} checks verified.`,
  };
}
