function extract(html, expression) {
  return html.match(expression)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function decodeEntities(value) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function metaContent(html, key, value) {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? [];
  for (const tag of tags) {
    const name = extract(tag, new RegExp(`\\b${key}=["']([^"']+)["']`, "i"));
    if (name.toLowerCase() !== value.toLowerCase()) continue;
    const content = extract(tag, /\bcontent=["']([^"']*)["']/i);
    if (content) return decodeEntities(content);
  }
  return "";
}

export function extractBusinessMetadata(html, pageUrl = "") {
  const title = decodeEntities(extract(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = metaContent(html, "name", "description") || metaContent(html, "property", "og:description");
  const siteName = metaContent(html, "property", "og:site_name");
  const imageValue = metaContent(html, "property", "og:image");
  let image = imageValue;
  try { image = imageValue && pageUrl ? new URL(imageValue, pageUrl).toString() : imageValue; } catch { image = ""; }
  let structuredName = "";
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1]);
      const nodes = Array.isArray(parsed) ? parsed : parsed?.["@graph"] ?? [parsed];
      const business = nodes.find((node) => node && typeof node === "object" && /Organization|LocalBusiness|ProfessionalService/i.test(String(node["@type"] ?? "")));
      if (business?.name) { structuredName = String(business.name).trim(); break; }
    } catch { /* Ignore invalid structured data. */ }
  }
  return { title, description, siteName, structuredName, image };
}

function textIncludes(html, expression) {
  return expression.test(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " "));
}

export function extractInternalLinks(html, baseUrl, maximum = 4) {
  const base = new URL(baseUrl);
  const candidates = [];
  const seen = new Set([base.pathname.replace(/\/$/, "") || "/"]);
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const href = match[1].replaceAll("&amp;", "&").trim();
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const url = new URL(href, base);
      url.hash = ""; url.search = "";
      if (url.origin !== base.origin || /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?)$/i.test(url.pathname)) continue;
      const key = url.pathname.replace(/\/$/, "") || "/";
      if (seen.has(key)) continue;
      seen.add(key);
      const priority = /contact|book|schedule|quote|consult/i.test(key) ? 0
        : /service|solution|product|practice|what-we-do/i.test(key) ? 1
          : /about|team|company|story/i.test(key) ? 2
            : /privacy|case|review|testimonial/i.test(key) ? 3 : 4;
      candidates.push({ url: url.toString(), priority, depth: key.split("/").filter(Boolean).length });
    } catch { /* Ignore malformed links. */ }
  }
  return candidates.sort((a, b) => a.priority - b.priority || a.depth - b.depth).slice(0, maximum).map((item) => item.url);
}

function addFinding(findings, category, severity, title, evidence, recommendation, impact, affectedUrl) {
  findings.push({ category, severity, title, evidence, recommendation, impact, affectedUrl, sortOrder: findings.length + 1 });
}

export function analyzeWebsitePages(pages) {
  if (!pages.length) throw new Error("No website pages were available for analysis.");
  const home = pages[0];
  const findings = [];
  let visibility = 100; let conversion = 100; let technical = 100; let trust = 100;
  const title = extract(home.html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = extract(home.html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i)
    || extract(home.html, /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i);
  const h1Count = (home.html.match(/<h1\b/gi) ?? []).length;

  if (!title) {
    visibility -= 35;
    addFinding(findings, "Visibility", "High", "Homepage title is missing", "No HTML title element was detected on the homepage.", "Add a concise title naming the business, primary service, and market.", "A descriptive title helps searchers understand the page before visiting it.", home.url);
  } else if (title.length < 25 || title.length > 70) {
    visibility -= 12;
    addFinding(findings, "Visibility", "Medium", "Homepage title is poorly sized", `The detected title is ${title.length} characters: “${title.slice(0, 100)}”.`, "Use a focused title of roughly 35–65 characters with service and location context.", "A clearer title can improve search-result comprehension and message alignment.", home.url);
  }
  if (!description) {
    visibility -= 25;
    addFinding(findings, "Visibility", "High", "Meta description is missing", "No meta description was detected on the homepage.", "Write a specific description explaining the audience, offer, and next step.", "A strong description gives searchers a reason to choose this result.", home.url);
  } else if (description.length < 70) {
    visibility -= 10;
    addFinding(findings, "Visibility", "Low", "Search description is underdeveloped", `The detected homepage description is only ${description.length} characters.`, "Expand it into a complete, benefit-led summary.", "A complete summary communicates value before a prospect reaches the site.", home.url);
  }
  if (h1Count === 0) {
    visibility -= 20;
    addFinding(findings, "Visibility", "High", "Primary page heading is missing", "No H1 element was detected on the homepage.", "Add one clear H1 that states the business’s main value proposition.", "A clear heading improves page structure for visitors and search systems.", home.url);
  } else if (h1Count > 1) {
    visibility -= 8;
    addFinding(findings, "Visibility", "Low", "Heading hierarchy is ambiguous", `${h1Count} H1 elements were detected on the homepage.`, "Use one primary H1 and organize supporting sections under H2 headings.", "A predictable hierarchy makes the page easier to scan and interpret.", home.url);
  }

  const allHtml = pages.map((page) => page.html).join("\n");
  if (!/application\/ld\+json/i.test(allHtml)) {
    visibility -= 15;
    addFinding(findings, "Visibility", "Medium", "Structured business data is absent", `No JSON-LD structured data was detected across ${pages.length} audited page${pages.length === 1 ? "" : "s"}.`, "Add valid Organization or LocalBusiness structured data using verified details.", "Structured data gives search systems a clearer description of the business.", home.url);
  }
  const pageTitles = pages.map((page) => extract(page.html, /<title[^>]*>([\s\S]*?)<\/title>/i)).filter(Boolean);
  if (pages.length >= 3 && new Set(pageTitles.map((value) => value.toLowerCase())).size < pageTitles.length) {
    visibility -= 10;
    addFinding(findings, "Visibility", "Medium", "Multiple pages reuse the same title", `${pageTitles.length - new Set(pageTitles.map((value) => value.toLowerCase())).size + 1} audited pages share title text.`, "Give each important page a unique title aligned to its topic and search intent.", "Unique page titles help searchers and search systems distinguish services.", home.url);
  }

  if (!/name=["']viewport["']/i.test(home.html)) {
    technical -= 25;
    addFinding(findings, "Technical", "High", "Mobile viewport configuration is missing", "The homepage does not declare a responsive viewport.", "Add a standard responsive viewport tag and verify common mobile widths.", "Without it, mobile rendering and usability may be significantly degraded.", home.url);
  }
  if (!/rel=["'][^"']*canonical/i.test(home.html)) {
    technical -= 12;
    addFinding(findings, "Technical", "Medium", "Canonical page signal is missing", "No canonical link element was detected on the homepage.", "Add a self-referencing canonical URL using the preferred HTTPS hostname.", "Canonical signals reduce ambiguity when similar URLs are accessible.", home.url);
  }
  if (!home.url.startsWith("https://")) {
    technical -= 30;
    addFinding(findings, "Technical", "High", "Secure HTTPS delivery is inconsistent", `The homepage resolved as ${home.url}.`, "Redirect every HTTP request to one HTTPS hostname.", "Secure delivery protects submitted information and supports visitor trust.", home.url);
  }
  if (!/<html\b[^>]*\blang=["'][^"']+/i.test(home.html)) {
    technical -= 8;
    addFinding(findings, "Technical", "Low", "Page language is not declared", "The homepage HTML element has no language attribute.", "Declare the primary document language on the HTML element.", "Language metadata improves accessibility and browser interpretation.", home.url);
  }
  const images = [...allHtml.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const imagesWithAlt = images.filter((image) => /\balt=["'][^"']*["']/i.test(image)).length;
  if (images.length >= 3 && imagesWithAlt / images.length < 0.7) {
    technical -= 10;
    addFinding(findings, "Technical", "Medium", "Image alternative text coverage is weak", `${images.length - imagesWithAlt} of ${images.length} images across audited pages do not declare alt text.`, "Add concise alternative text to meaningful images and empty alt text to decorative images.", "Complete alt coverage improves accessibility and content understanding.", home.url);
  }

  const hasPhoneLink = /href=["']tel:/i.test(allHtml);
  const hasForm = /<form\b/i.test(allHtml);
  const hasStrongCta = textIncludes(home.html, /(request (a )?(quote|consultation|estimate)|get (a )?quote|call now|schedule|book|contact us|speak with|start (a )?project)/i);
  const hasContactPage = pages.some((page) => /contact|book|schedule|quote|consult/i.test(new URL(page.url).pathname));
  if (!hasPhoneLink) {
    conversion -= 18;
    addFinding(findings, "Conversion", "Medium", "No tap-to-call action was found", `No telephone link was detected across ${pages.length} audited page${pages.length === 1 ? "" : "s"}.`, "Make the primary phone number tap-to-call, especially in the mobile header.", "Reducing friction matters for high-intent mobile prospects.", home.url);
  }
  if (!hasForm) {
    conversion -= 24;
    addFinding(findings, "Conversion", "High", "No direct lead form was found", `No HTML form was detected across ${pages.length} audited page${pages.length === 1 ? "" : "s"}.`, "Provide a short quote or consultation form with only essential fields.", "A direct form captures visitors who are not ready to call immediately.", home.url);
  }
  if (!hasStrongCta) {
    conversion -= 27;
    addFinding(findings, "Conversion", "High", "Primary action is unclear", "The homepage does not contain a recognizable quote, call, contact, or scheduling action.", "Use one dominant action in the header and first viewport, then repeat it after proof sections.", "A clear action gives interested visitors an obvious next step.", home.url);
  }
  if (!hasContactPage && pages.length > 1) {
    conversion -= 12;
    addFinding(findings, "Conversion", "Medium", "No dedicated contact path was discovered", `The ${pages.length}-page crawl did not discover a contact, booking, quote, or consultation page.`, "Create a focused conversion page and link it prominently from the main navigation.", "A dedicated path makes the next step easier to find and measure.", home.url);
  }

  if (!/rel=["'][^"']*(icon|shortcut icon)/i.test(home.html)) {
    trust -= 10;
    addFinding(findings, "Trust", "Low", "Brand icon is not declared", "No favicon link was detected on the homepage.", "Add a sharp, correctly branded favicon and application icon set.", "Consistent browser branding makes the site feel maintained and intentional.", home.url);
  }
  if (!/property=["']og:image["']/i.test(home.html)) {
    trust -= 12;
    addFinding(findings, "Trust", "Low", "Shared links lack a branded preview image", "No Open Graph image was detected on the homepage.", "Add a branded social preview image with the business name and core offer.", "Professional link previews improve credibility when pages are shared.", home.url);
  }
  if (!textIncludes(allHtml, /(privacy policy|privacy notice)/i)) {
    trust -= 16;
    addFinding(findings, "Trust", "Medium", "Privacy information is not discoverable", `No visible privacy-policy reference was detected across ${pages.length} audited page${pages.length === 1 ? "" : "s"}.`, "Link a clear privacy policy from the footer and beside lead forms.", "Prospects are more likely to share information when data handling is transparent.", home.url);
  }
  if (!textIncludes(allHtml, /(testimonial|what our clients say|customer stor|case stud|reviews? from)/i)) {
    trust -= 18;
    addFinding(findings, "Trust", "Medium", "Customer proof is difficult to find", `No recognizable testimonial, review, or case-study language was detected across ${pages.length} audited page${pages.length === 1 ? "" : "s"}.`, "Add specific customer proof near key claims and conversion actions.", "Relevant proof reduces perceived risk before a prospect makes contact.", home.url);
  }

  visibility = Math.max(0, visibility); conversion = Math.max(0, conversion); technical = Math.max(0, technical); trust = Math.max(0, trust);
  const score = Math.round(visibility * 0.3 + conversion * 0.3 + technical * 0.25 + trust * 0.15);
  const severityRank = { High: 0, Medium: 1, Low: 2 };
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  findings.forEach((finding, index) => { finding.sortOrder = index + 1; });
  return { score, visibility, conversion, technical, trust, findings: findings.slice(0, 12), pagesAudited: pages.length };
}

function boundedScore(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(100, Math.round(number))) : null;
}

/** Merge Google Lighthouse mobile results into the multi-page content audit. */
export function mergeLighthouseAudit(analysis, lighthouse, affectedUrl) {
  if (!lighthouse) return { ...analysis, lighthouse: null };
  const performance = boundedScore(lighthouse.performance);
  const accessibility = boundedScore(lighthouse.accessibility);
  const seo = boundedScore(lighthouse.seo);
  const bestPractices = boundedScore(lighthouse.bestPractices);
  const average = (values, fallback) => {
    const available = values.filter((value) => value !== null);
    return available.length ? Math.round(available.reduce((sum, value) => sum + value, 0) / available.length) : fallback;
  };
  const visibility = seo === null ? analysis.visibility : Math.round(analysis.visibility * .68 + seo * .32);
  const lighthouseTechnical = average([performance, accessibility, bestPractices], analysis.technical);
  const technical = Math.round(analysis.technical * .58 + lighthouseTechnical * .42);
  const findings = [...analysis.findings];
  const metricSummary = [lighthouse.lcp && `LCP ${lighthouse.lcp}`, lighthouse.inp && `INP ${lighthouse.inp}`, lighthouse.cls && `CLS ${lighthouse.cls}`].filter(Boolean).join(" · ");

  if (performance !== null && performance < 75) addFinding(findings, "Technical", performance < 50 ? "High" : "Medium", "Mobile performance needs attention", `Google Lighthouse scored mobile performance ${performance}/100${metricSummary ? ` (${metricSummary})` : ""}.`, "Prioritize the largest render-blocking, image, and JavaScript opportunities identified by Lighthouse, then retest the homepage.", "A faster mobile experience reduces abandonment before prospects reach the primary action.", affectedUrl);
  if (accessibility !== null && accessibility < 85) addFinding(findings, "Technical", accessibility < 70 ? "High" : "Medium", "Automated accessibility checks found barriers", `Google Lighthouse scored accessibility ${accessibility}/100.`, "Correct the failed semantic, contrast, labeling, and keyboard checks, then verify the key journey manually.", "Accessible interactions help more visitors understand the offer and complete the next step.", affectedUrl);
  if (seo !== null && seo < 85) addFinding(findings, "Visibility", seo < 70 ? "High" : "Medium", "Lighthouse identified search visibility gaps", `Google Lighthouse scored SEO ${seo}/100 on mobile.`, "Resolve the failed crawlability, metadata, link, and mobile-search checks shown in Lighthouse.", "Closing technical SEO gaps improves the chance that qualified searchers discover the site.", affectedUrl);
  if (bestPractices !== null && bestPractices < 85) addFinding(findings, "Technical", bestPractices < 70 ? "High" : "Medium", "Browser best-practice checks need work", `Google Lighthouse scored best practices ${bestPractices}/100.`, "Review insecure resources, browser errors, image delivery, and deprecated APIs flagged by Lighthouse.", "Modern browser practices reduce visible errors and protect visitor confidence.", affectedUrl);

  const severityRank = { High: 0, Medium: 1, Low: 2 };
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  findings.forEach((finding, index) => { finding.sortOrder = index + 1; });
  const score = Math.round(visibility * .3 + analysis.conversion * .3 + technical * .25 + analysis.trust * .15);
  return { ...analysis, score, visibility, technical, findings: findings.slice(0, 12), lighthouse: { performance, accessibility, seo, bestPractices, lcp: lighthouse.lcp ?? "", inp: lighthouse.inp ?? "", cls: lighthouse.cls ?? "" } };
}
