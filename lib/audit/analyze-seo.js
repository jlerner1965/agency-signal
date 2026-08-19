import { extractSiteServices } from "./analyze-service-lines.js";

/** On-page SEO, weighted light: these are table stakes, not the sales case. */

const SCHEMA_TYPES = /^(LocalBusiness|MedicalBusiness|MedicalClinic|Physician|Dentist|HealthAndBeautyBusiness|Service|FAQPage|Organization)$/i;
const INDEX_PATH = /\/(services?|treatments?|programs?|what-we-(do|offer))\/?$/i;

function pathOf(url) {
  try { return new URL(url).pathname.replace(/\/+$/, "").toLowerCase(); } catch { return ""; }
}

/** A schema block is valid when it declares a type and the fields that type needs. */
export function validateSchema(block) {
  const type = String(block?.["@type"] ?? "");
  if (!type) return { type: "", valid: false, reason: "no @type" };
  if (!SCHEMA_TYPES.test(type)) return { type, valid: null, reason: "not a type we assess" };
  if (/FAQPage/i.test(type)) {
    const entities = block.mainEntity ?? [];
    const list = Array.isArray(entities) ? entities : [entities];
    const answered = list.filter((item) => item?.name && (item?.acceptedAnswer?.text ?? item?.acceptedAnswer?.name));
    return { type, valid: answered.length > 0, reason: answered.length ? "" : "no answered questions" };
  }
  if (/^Service$/i.test(type)) {
    return { type, valid: Boolean(block.name), reason: block.name ? "" : "no name" };
  }
  const missing = ["name", "address"].filter((field) => !block[field]);
  return { type, valid: missing.length === 0, reason: missing.length ? `missing ${missing.join(" and ")}` : "" };
}

export function analyzeSeo(payloads) {
  const crawl = payloads.find((payload) => payload.source === "crawl");
  const sitemap = payloads.find((payload) => payload.source === "sitemap");
  const robots = payloads.find((payload) => payload.source === "robots");

  const checks = [];
  const findings = [];
  const check = (id, label, weight, passed, evidence, failure, unverifiedReason) => {
    checks.push({
      id, category: "Visibility", label, weight,
      status: passed === null ? "unverified" : passed ? "passed" : "failed",
      earned: passed ? weight : 0, evidence,
      ...(passed === null && unverifiedReason ? { unverifiedReason } : {}),
    });
    if (passed === false && failure) findings.push({ category: "Visibility", evidence, ...failure });
  };

  if (!crawl?.ok || !crawl.payload) {
    return {
      findings: [], checks: [], reachable: false,
      message: crawl?.failureReason || "The website could not be read.",
    };
  }

  const pages = (crawl.payload.pages ?? []).filter((page) => page.ok);
  const home = pages[0];

  // Titles.
  const titles = pages.map((page) => page.title ?? "").filter(Boolean);
  const uniqueTitles = new Set(titles.map((title) => title.toLowerCase()));
  const missingTitles = pages.filter((page) => !page.title);
  const badLength = pages.filter((page) => page.title && (page.title.length < 25 || page.title.length > 65));

  check("seo-titles", "Every page has a usable title", 4,
    missingTitles.length === 0 && badLength.length === 0,
    `${titles.length} of ${pages.length} pages have a title; ${badLength.length} fall outside 25–65 characters${missingTitles.length ? `; ${missingTitles.length} have none` : ""}.`,
    { severity: missingTitles.length ? "High" : "Medium", title: "Page titles are missing or poorly sized",
      recommendation: "Give every page a unique 25–65 character title naming the service and the market.",
      impactNote: "The title is the headline in every search result and the strongest on-page relevance signal.",
      impactScore: 4, effortScore: 2, url: missingTitles[0]?.url ?? badLength[0]?.url ?? home?.url });

  check("seo-title-unique", "Titles are unique across pages", 3,
    pages.length < 2 ? null : uniqueTitles.size === titles.length && titles.length === pages.length,
    pages.length < 2 ? "Only one page was crawled." : `${uniqueTitles.size} unique titles across ${pages.length} pages.`,
    { severity: "Medium", title: "Pages share duplicate titles",
      recommendation: "Give each page a title describing that page specifically.",
      impactNote: "Duplicate titles make search engines pick one page and ignore the rest.",
      impactScore: 3, effortScore: 2, url: home?.url },
    "not-applicable");

  // H1s.
  const noH1 = pages.filter((page) => (page.h1?.length ?? 0) === 0);
  const manyH1 = pages.filter((page) => (page.h1?.length ?? 0) > 1);
  check("seo-h1", "One clear H1 per page", 3, noH1.length === 0 && manyH1.length === 0,
    `${noH1.length} pages have no H1 and ${manyH1.length} have more than one, across ${pages.length} pages.`,
    { severity: "Medium", title: "Heading structure is inconsistent",
      recommendation: "Give every page exactly one H1 stating what that page is about.",
      impactNote: "A single clear heading tells both readers and search engines the page's subject.",
      impactScore: 3, effortScore: 2, url: noH1[0]?.url ?? manyH1[0]?.url ?? home?.url });

  // Heading hierarchy: H2s without an H1 above them.
  const brokenHierarchy = pages.filter((page) => (page.h2?.length ?? 0) > 0 && (page.h1?.length ?? 0) === 0);
  check("seo-hierarchy", "Headings nest correctly", 2, brokenHierarchy.length === 0,
    brokenHierarchy.length ? `${brokenHierarchy.length} pages use H2s with no H1 above them.` : "Heading levels nest correctly on every crawled page.",
    { severity: "Low", title: "Heading levels skip a level",
      recommendation: "Start each page at H1 and nest subsections beneath it in order.",
      impactNote: "Skipped heading levels make a page harder to navigate with a screen reader.",
      impactScore: 2, effortScore: 1, url: brokenHierarchy[0]?.url ?? home?.url });

  // Meta descriptions come from the distilled page's own record.
  const withMeta = pages.filter((page) => (page.metaDescription ?? "").length > 0);
  const goodMeta = pages.filter((page) => {
    const length = (page.metaDescription ?? "").length;
    return length >= 90 && length <= 165;
  });
  check("seo-meta", "Pages have useful meta descriptions", 3,
    pages.length === 0 ? null : goodMeta.length === pages.length,
    `${withMeta.length} of ${pages.length} pages have a meta description; ${goodMeta.length} fall in the 90–165 character range.`,
    { severity: "Medium", title: "Meta descriptions are missing or the wrong length",
      recommendation: "Write a 90–165 character description per page covering the offer and the next step.",
      impactNote: "The description is the sales copy under a search result; without it Google invents one.",
      impactScore: 3, effortScore: 2, url: home?.url });

  // Canonicals.
  const withCanonical = pages.filter((page) => page.canonical);
  check("seo-canonical", "Canonical URLs declared", 2, pages.length === 0 ? null : withCanonical.length === pages.length,
    `${withCanonical.length} of ${pages.length} pages declare a canonical URL.`,
    { severity: "Low", title: "Canonical URLs are missing",
      recommendation: "Add a self-referencing canonical link to every page.",
      impactNote: "Canonicals stop query strings and duplicates splitting a page's ranking signals.",
      impactScore: 2, effortScore: 1, url: home?.url });

  // Image alt coverage.
  const images = pages.reduce((sum, page) => sum + (page.imageCount ?? 0), 0);
  const withAlt = pages.reduce((sum, page) => sum + (page.imagesWithAlt ?? 0), 0);
  check("seo-alt", "Images carry alt text", 3, images === 0 ? null : withAlt / images >= 0.9,
    images ? `${withAlt} of ${images} images across the crawl declare alt text.` : "No images were found to inspect.",
    { severity: "Medium", title: "Image alt coverage is incomplete",
      recommendation: "Add descriptive alt text to meaningful images and empty alt to decorative ones.",
      impactNote: "Alt text is what a screen reader announces, and it is how image search reads the page.",
      impactScore: 3, effortScore: 2, url: home?.url },
    "not-applicable");

  // sitemap.xml and robots.txt.
  check("seo-sitemap", "sitemap.xml is present and valid", 3,
    sitemap ? Boolean(sitemap.ok && sitemap.payload?.urlCount > 0) : null,
    sitemap?.ok
      ? `sitemap.xml lists ${sitemap.payload?.urlCount ?? 0} URLs.`
      : sitemap?.failureReason || "sitemap.xml could not be checked.",
    { severity: "Medium", title: "No valid sitemap.xml",
      recommendation: "Publish a sitemap.xml listing every indexable page and reference it from robots.txt.",
      impactNote: "A sitemap is how a search engine discovers pages that are not well linked.",
      impactScore: 3, effortScore: 1, url: home?.url },
    "source-unavailable");

  check("seo-robots", "robots.txt is present and readable", 2,
    robots ? Boolean(robots.ok) : null,
    robots?.ok ? `robots.txt was read with ${robots.payload?.ruleCount ?? 0} rules.` : robots?.failureReason || "robots.txt could not be checked.",
    { severity: "Low", title: "robots.txt is missing or unreadable",
      recommendation: "Publish a robots.txt that allows crawling and points at the sitemap.",
      impactNote: "Crawlers check it first; an unreadable one is a needless obstacle.",
      impactScore: 2, effortScore: 1, url: home?.url },
    "source-unavailable");

  // Structured data.
  const blocks = pages.flatMap((page) => (page.jsonLd ?? []).map((block) => ({ ...validateSchema(block), url: page.url })));
  const assessed = blocks.filter((block) => block.valid !== null);
  const businessSchema = assessed.find((block) => /LocalBusiness|MedicalBusiness|MedicalClinic|Physician|Dentist|HealthAndBeautyBusiness/i.test(block.type));
  const invalid = assessed.filter((block) => block.valid === false);

  check("seo-schema-business", "Business structured data is published and valid", 4,
    Boolean(businessSchema?.valid),
    businessSchema
      ? `${businessSchema.type} schema found${businessSchema.valid ? " and valid" : `, but ${businessSchema.reason}`}.`
      : "No LocalBusiness or MedicalBusiness schema was found on any crawled page.",
    { severity: "Medium", title: "Business structured data is absent or incomplete",
      recommendation: "Publish valid LocalBusiness or MedicalBusiness schema with the verified name, address and phone.",
      impactNote: "Structured data is how a search engine reads the business's identity without guessing.",
      impactScore: 3, effortScore: 2, url: businessSchema?.url ?? home?.url });

  check("seo-schema-valid", "Published schema validates", 2, assessed.length === 0 ? null : invalid.length === 0,
    assessed.length ? `${assessed.length} schema blocks assessed, ${invalid.length} incomplete.` : "No assessable schema blocks were found.",
    { severity: "Low", title: "Published structured data is incomplete",
      recommendation: `Complete the incomplete blocks: ${invalid.map((block) => `${block.type} (${block.reason})`).join(", ")}.`,
      impactNote: "Incomplete schema is ignored, so the effort of publishing it is wasted.",
      impactScore: 2, effortScore: 1, url: invalid[0]?.url ?? home?.url },
    "not-applicable");

  // The check that feeds the core module: a page per service line.
  const services = extractSiteServices(pages, crawl.payload.navigation ?? []);
  const orphans = services.filter((service) => {
    const words = service.key.split(" ").filter((word) => word.length > 3);
    return !pages.some((page) => {
      const path = pathOf(page.url);
      if (!path || INDEX_PATH.test(path)) return false;
      const slug = path.replace(/[^a-z0-9]+/g, " ");
      return words.length > 0 && words.every((word) => slug.includes(word));
    });
  });
  check("seo-service-pages", "Every service line has a dedicated page", 5,
    services.length === 0 ? null : orphans.length === 0,
    services.length === 0
      ? "No service lines were identified, so page coverage could not be assessed."
      : orphans.length
        ? `${orphans.length} of ${services.length} service lines have no dedicated page: ${orphans.map((service) => service.name).join(", ")}.`
        : `All ${services.length} service lines have a dedicated page.`,
    { severity: "High", title: "Service lines have no page that can rank",
      recommendation: "Build a page per service covering the problem, the treatment, who it suits, and the next step.",
      impactNote: "A service listed only on an index page cannot rank for its own searches. A dedicated page can.",
      impactScore: 5, effortScore: 3, url: home?.url },
    "not-applicable");

  const verified = checks.filter((item) => item.status !== "unverified").length;
  return {
    findings, checks, reachable: true,
    message: `Reviewed on-page SEO across ${pages.length} pages; ${verified} of ${checks.length} checks verified.`,
  };
}
