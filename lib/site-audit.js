function extract(html, expression) {
  return html.match(expression)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function decodeEntities(value) {
  return value.replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/&lt;/gi, "<").replace(/&gt;/gi, ">");
}

function metaContent(html, key, value) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = extract(tag, new RegExp(`\\b${key}=["']([^"']+)["']`, "i"));
    if (name.toLowerCase() === value.toLowerCase()) {
      const content = extract(tag, /\bcontent=["']([^"']*)["']/i);
      if (content) return decodeEntities(content);
    }
  }
  return "";
}

function visibleText(html) {
  return decodeEntities(html.replace(/<script[\s\S]*?<\/script>/gi, " ").replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<svg[\s\S]*?<\/svg>/gi, " ").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function wordCount(html) { return visibleText(html).split(/\s+/).filter(Boolean).length; }
function clamp(value) { return Math.max(0, Math.min(100, Math.round(value))); }

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
    } catch { /* Treat invalid JSON-LD as absent. */ }
  }
  return { title, description, siteName, structuredName, image };
}

export function extractInternalLinks(html, baseUrl, maximum = 4) {
  const base = new URL(baseUrl); const candidates = []; const seen = new Set([base.pathname.replace(/\/$/, "") || "/"]);
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/gi)) {
    const href = match[1].replaceAll("&amp;", "&").trim();
    if (!href || /^(#|mailto:|tel:|javascript:)/i.test(href)) continue;
    try {
      const url = new URL(href, base); url.hash = ""; url.search = "";
      if (url.origin !== base.origin || /\.(pdf|jpe?g|png|gif|webp|svg|zip|docx?)$/i.test(url.pathname)) continue;
      const key = url.pathname.replace(/\/$/, "") || "/"; if (seen.has(key)) continue; seen.add(key);
      const priority = /contact|book|schedule|quote|consult/i.test(key) ? 0 : /service|solution|product|practice|what-we-do/i.test(key) ? 1 : /about|team|company|story/i.test(key) ? 2 : /case|review|testimonial/i.test(key) ? 3 : /privacy|terms|blog/i.test(key) ? 5 : 4;
      candidates.push({ url: url.toString(), priority, depth: key.split("/").filter(Boolean).length });
    } catch { /* Ignore malformed links. */ }
  }
  return candidates.sort((a, b) => a.priority - b.priority || a.depth - b.depth).slice(0, maximum).map((item) => item.url);
}

function finding(category, severity, title, evidence, recommendation, impact, affectedUrl) {
  return { category, severity, title, evidence, recommendation, impact, affectedUrl, sortOrder: 0 };
}

function finalize(checks, findings, pagesAudited, lighthouse) {
  const categories = ["Visibility", "Conversion", "Technical", "Trust"];
  const scores = Object.fromEntries(categories.map((category) => {
    const group = checks.filter((item) => item.category === category);
    const maximum = group.reduce((sum, item) => sum + item.weight, 0);
    return [category, clamp(group.reduce((sum, item) => sum + item.earned, 0) / maximum * 100)];
  }));
  const score = clamp(scores.Visibility * .25 + scores.Conversion * .30 + scores.Technical * .25 + scores.Trust * .20);
  const verifiedWeight = checks.filter((item) => item.status !== "unverified").reduce((sum, item) => sum + item.weight, 0);
  const totalWeight = checks.reduce((sum, item) => sum + item.weight, 0);
  const confidenceScore = clamp(verifiedWeight / totalWeight * 70 + Math.min(pagesAudited, 5) / 5 * 30);
  const rank = { High: 0, Medium: 1, Low: 2 };
  findings.sort((a, b) => rank[a.severity] - rank[b.severity]); findings.forEach((item, index) => { item.sortOrder = index + 1; });
  return { score, visibility: scores.Visibility, conversion: scores.Conversion, technical: scores.Technical, trust: scores.Trust, findings: findings.slice(0, 20), checks, confidenceScore, checksPassed: checks.filter((item) => item.status === "passed").length, checksFailed: checks.filter((item) => item.status === "failed").length, checksUnverified: checks.filter((item) => item.status === "unverified").length, pagesAudited, lighthouse };
}

/** A site earns points for observable evidence; it never starts at 100. */
export function analyzeWebsitePages(pages) {
  if (!pages.length) throw new Error("No website pages were available for analysis.");
  const home = pages[0]; const allHtml = pages.map((page) => page.html).join("\n"); const homeText = visibleText(home.html);
  const checks = []; const findings = [];
  const check = (id, category, label, weight, passed, evidence, failure) => {
    checks.push({ id, category, label, status: passed === null ? "unverified" : passed ? "passed" : "failed", weight, earned: passed ? weight : 0, evidence });
    if (passed === false && failure) findings.push(finding(category, failure.severity, failure.title, evidence, failure.recommendation, failure.impact, failure.url || home.url));
  };
  const fail = (severity, title, recommendation, impact) => ({ severity, title, recommendation, impact });
  const title = decodeEntities(extract(home.html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = metaContent(home.html, "name", "description") || metaContent(home.html, "property", "og:description");
  const h1s = home.html.match(/<h1\b[^>]*>[\s\S]*?<\/h1>/gi) ?? [];
  const pageTitles = pages.map((page) => decodeEntities(extract(page.html, /<title[^>]*>([\s\S]*?)<\/title>/i))).filter(Boolean);
  const uniqueTitles = new Set(pageTitles.map((value) => value.toLowerCase())).size;
  const hasStructured = /application\/ld\+json/i.test(allHtml) && /Organization|LocalBusiness|ProfessionalService/i.test(allHtml);
  const noIndex = /<meta\b[^>]*(?:name=["']robots["'][^>]*content=["'][^"']*noindex|content=["'][^"']*noindex[^"']*["'][^>]*name=["']robots["'])/i.test(home.html);
  check("title", "Visibility", "Descriptive page title", 4, title.length >= 25 && title.length <= 70, title ? `Homepage title is ${title.length} characters: “${title.slice(0, 100)}”.` : "No homepage title was detected.", fail(title ? "Medium" : "High", title ? "Homepage title needs sharper search intent" : "Homepage title is missing", "Use a unique 35–65 character title naming the primary service and market.", "The title is a primary search-result and relevance signal."));
  check("description", "Visibility", "Useful search description", 4, description.length >= 90 && description.length <= 180, description ? `Meta description is ${description.length} characters.` : "No homepage meta description was detected.", fail(description ? "Medium" : "High", description ? "Search description is underdeveloped" : "Meta description is missing", "Write a specific 100–160 character description covering audience, offer, proof, and next step.", "A useful snippet helps qualified searchers choose this result."));
  check("h1", "Visibility", "One clear primary heading", 3, h1s.length === 1 && visibleText(h1s[0]).length >= 12, `${h1s.length} H1 heading${h1s.length === 1 ? " was" : "s were"} detected.`, fail(h1s.length ? "Medium" : "High", h1s.length ? "Heading hierarchy is ambiguous" : "Primary page heading is missing", "Use one descriptive H1 that states the main customer value proposition.", "A clear heading identifies the page purpose."));
  check("unique-titles", "Visibility", "Unique titles on key pages", 3, pages.length < 2 ? null : pageTitles.length === pages.length && uniqueTitles === pages.length, pages.length < 2 ? "Only one page could be inspected." : `${uniqueTitles} unique titles were found across ${pages.length} pages.`, pages.length < 2 ? null : fail("Medium", "Key pages do not have unique titles", "Give each important page a unique topic-aligned title.", "Unique titles help searchers distinguish services."));
  check("structured-data", "Visibility", "Business structured data", 3, hasStructured, hasStructured ? "Organization or LocalBusiness JSON-LD was detected." : "Verified business JSON-LD was not detected.", fail("Medium", "Structured business data is absent", "Add valid Organization or LocalBusiness schema using verified details.", "Structured data clarifies the business for search systems."));
  check("indexable", "Visibility", "Homepage indexability", 3, !noIndex, noIndex ? "A robots noindex directive was detected." : "No robots noindex directive was detected.", fail("High", "Homepage may be excluded from search", "Remove noindex if the public homepage should appear in search.", "Noindex can prevent organic discovery."));
  check("service-language", "Visibility", "Clear service topic", 3, /(services?|solutions?|what we do|how we help|practice areas?|products?)/i.test(homeText), "Homepage copy was checked for clear service or solution language.", fail("Medium", "Service relevance is difficult to verify", "Name the primary services and customer problems in crawlable homepage copy.", "Specific service language improves relevance."));
  const hasLocation = /(serving|located in|visit us|areas? served|directions|our office)/i.test(homeText) || /\b[A-Z]{2}\s+\d{5}(?:-\d{4})?\b/.test(homeText);
  check("local-context", "Visibility", "Market or service-area context", 2, hasLocation, hasLocation ? "Location or service-area context was detected." : "No clear location or service-area statement was detected.", fail("Low", "Local market context is weak", "State the principal market or service area naturally on the homepage.", "Market context helps local prospects confirm relevance."));

  const ctaPattern = /(request (a )?(quote|consultation|estimate)|get (a )?quote|call now|schedule|book|contact us|speak with|start (a )?project|get started|free consultation)/i;
  const hasCta = ctaPattern.test(homeText);
  const hasCtaControl = /<(?:a|button)\b[^>]*>[\s\S]{0,160}(quote|consult|contact|book|schedule|get started|call)/i.test(home.html);
  const hasForm = /<form\b/i.test(allHtml); const hasPhone = /href=["']tel:/i.test(allHtml); const hasEmail = /href=["']mailto:/i.test(allHtml);
  const hasContactPage = pages.some((page) => /contact|book|schedule|quote|consult/i.test(new URL(page.url).pathname));
  const hasServicePage = pages.some((page) => /service|solution|product|practice|what-we-do/i.test(new URL(page.url).pathname));
  const ctaCount = (homeText.match(/quote|consult|contact|book|schedule|get started|call now/gi) ?? []).length;
  check("primary-cta", "Conversion", "Clear primary action", 7, hasCta, hasCta ? "Recognizable conversion language was detected." : "No recognizable quote, consultation, booking, contact, or call action was detected.", fail("High", "Primary action is unclear", "Use one dominant action in the first viewport and repeat it after proof sections.", "A clear action gives interested visitors an obvious next step."));
  check("action-control", "Conversion", "Working action control", 4, hasCtaControl, hasCtaControl ? "A conversion-oriented link or button was detected." : "No link or button with clear conversion language was detected.", fail("High", "The next step is not tied to an obvious control", "Connect the primary action to a prominent button or link.", "Visitors should not have to search for how to respond."));
  check("lead-form", "Conversion", "Direct lead form", 7, hasForm, hasForm ? "A form was detected on an audited page." : `No HTML form was detected across ${pages.length} audited page${pages.length === 1 ? "" : "s"}.`, fail("High", "No direct lead form was found", "Provide a short consultation or quote form with only essential fields.", "A direct form captures visitors who are not ready to call."));
  check("direct-contact", "Conversion", "Tap-to-call or email", 3, hasPhone || hasEmail, hasPhone || hasEmail ? `${hasPhone ? "Telephone" : "Email"} link detected.` : "No tap-to-call or email link was detected.", fail("Medium", "Direct contact actions are missing", "Make the phone number tap-to-call and provide a clear email/contact action.", "Low-friction contact matters for high-intent visitors."));
  check("contact-path", "Conversion", "Dedicated contact path", 3, pages.length < 2 ? null : hasContactPage, pages.length < 2 ? "Contact-path discovery was incomplete." : hasContactPage ? "A contact, booking, quote, or consultation page was inspected." : "No dedicated contact path was found.", pages.length < 2 ? null : fail("Medium", "No dedicated contact path was discovered", "Create a focused conversion page and link it prominently.", "A dedicated path makes the next step easier to find and measure."));
  check("service-path", "Conversion", "Dedicated service path", 3, pages.length < 2 ? null : hasServicePage, pages.length < 2 ? "Service-page discovery was incomplete." : hasServicePage ? "A service or solution page was inspected." : "No dedicated service path was found.", pages.length < 2 ? null : fail("Medium", "Service detail is difficult to discover", "Create focused pages for priority services.", "Service pages help prospects evaluate fit."));
  check("cta-repetition", "Conversion", "Repeated conversion opportunity", 3, ctaCount >= 2, `${ctaCount} conversion-oriented phrase${ctaCount === 1 ? " was" : "s were"} detected.`, fail("Low", "The primary action is not reinforced", "Repeat the primary action after key service and proof sections.", "Repetition gives convinced visitors a next step."));
  check("content-depth", "Conversion", "Substantive homepage content", 3, wordCount(home.html) >= 250, `${wordCount(home.html)} visible words were detected on the homepage.`, fail(wordCount(home.html) < 120 ? "High" : "Medium", "Homepage content is too thin for confident evaluation", "Add specific audience, service, proof, process, and next-step content.", "Thin content limits persuasion and lowers audit confidence."));

  const images = [...allHtml.matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]); const imagesWithAlt = images.filter((image) => /\balt=["'][^"']*["']/i.test(image)).length;
  const forms = [...allHtml.matchAll(/<form\b[\s\S]*?<\/form>/gi)].map((match) => match[0]);
  const controls = forms.flatMap((form) => [...form.matchAll(/<(?:input|select|textarea)\b[^>]*>/gi)].map((match) => match[0])).filter((control) => !/type=["'](?:hidden|submit|button)["']/i.test(control));
  const labeled = controls.filter((control) => /aria-label=|aria-labelledby=|\bid=["'][^"']+["']/i.test(control)).length;
  check("https", "Technical", "Secure HTTPS delivery", 4, home.url.startsWith("https://"), `Homepage resolved at ${home.url}.`, fail("High", "Secure HTTPS delivery is inconsistent", "Redirect all HTTP requests to one HTTPS hostname.", "Secure delivery protects information and trust."));
  check("viewport", "Technical", "Responsive viewport", 4, /name=["']viewport["']/i.test(home.html), /name=["']viewport["']/i.test(home.html) ? "A mobile viewport declaration was detected." : "No mobile viewport declaration was detected.", fail("High", "Mobile viewport configuration is missing", "Add a standard responsive viewport and test common widths.", "Without it, mobile rendering may be degraded."));
  check("language", "Technical", "Document language", 2, /<html\b[^>]*\blang=["'][^"']+/i.test(home.html), "The HTML language attribute was inspected.", fail("Low", "Page language is not declared", "Declare the primary document language.", "Language metadata supports accessibility."));
  check("image-alt", "Technical", "Image alt-text coverage", 3, images.length === 0 ? null : imagesWithAlt / images.length >= .9, images.length ? `${imagesWithAlt} of ${images.length} images declare alt attributes.` : "No HTML images were available to inspect.", images.length === 0 ? null : fail("Medium", "Image alternative-text coverage is incomplete", "Add concise alt text to meaningful images and empty alt attributes to decorative ones.", "Alt coverage improves accessibility."));
  check("form-labels", "Technical", "Form control labeling", 2, controls.length === 0 ? null : labeled / controls.length >= .9, controls.length ? `${labeled} of ${controls.length} form controls expose an ID or accessible label.` : "No form controls were available to inspect.", controls.length === 0 ? null : fail("Medium", "Form labeling needs accessibility review", "Associate every field with a visible label and accessible name.", "Clear labels improve form completion."));
  check("crawl-coverage", "Technical", "Multi-page audit coverage", 3, pages.length >= 3, `${pages.length} page${pages.length === 1 ? " was" : "s were"} successfully fetched.`, fail(pages.length === 1 ? "High" : "Medium", "Audit crawl coverage is limited", "Confirm navigation and allow at least three key pages to be inspected.", "Limited coverage can hide page-specific issues."));
  check("html-content", "Technical", "Server-visible content", 2, wordCount(home.html) >= 120, `${wordCount(home.html)} visible words were delivered in homepage HTML.`, fail("High", "Delivered HTML provides limited inspectable content", "Ensure essential headings, services, proof, and actions are server-visible.", "Search and audit systems may receive an incomplete experience."));
  check("mobile-performance", "Technical", "Mobile performance", 3, null, "Google Lighthouse performance was unavailable.", null);
  check("mobile-accessibility", "Technical", "Automated accessibility", 2, null, "Google Lighthouse accessibility was unavailable.", null);
  check("browser-practices", "Technical", "Browser best practices", 2, null, "Google Lighthouse best practices were unavailable.", null);

  const allText = visibleText(allHtml); const hasProof = /(testimonial|what our (clients|customers) say|customer stor|case stud|reviews? from|rated [45](?:\.\d)? stars)/i.test(allText);
  const hasPrivacy = /(privacy policy|privacy notice)/i.test(allText); const hasAbout = pages.some((page) => /about|team|company|story/i.test(new URL(page.url).pathname)) || /(our team|meet the team|our story|about us)/i.test(homeText);
  const hasAddress = /\d{1,6}\s+[A-Za-z0-9.' -]{2,40}\s+(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|drive|dr\.?|lane|ln\.?|way|suite|ste\.?)/i.test(allText);
  const hasFavicon = /rel=["'][^"']*(icon|shortcut icon)/i.test(home.html); const hasOg = /property=["']og:image["']/i.test(home.html); const hasOrganization = /Organization|LocalBusiness|ProfessionalService/i.test(allHtml) || /©|copyright/i.test(homeText);
  check("customer-proof", "Trust", "Customer proof", 5, hasProof, hasProof ? "Testimonial, rating, review, or case-study language was detected." : "No recognizable customer-proof language was detected.", fail("High", "Customer proof is difficult to find", "Add specific testimonials, review evidence, or case outcomes near key claims.", "Relevant proof reduces perceived risk."));
  check("privacy", "Trust", "Privacy information", 3, hasPrivacy, hasPrivacy ? "A privacy-policy reference was detected." : "No visible privacy-policy reference was detected.", fail("Medium", "Privacy information is not discoverable", "Link a clear privacy policy from the footer and forms.", "Transparent data handling builds confidence."));
  check("about", "Trust", "Business identity or team story", 3, hasAbout, hasAbout ? "An about, team, company, or story signal was detected." : "No about, team, company, or story signal was detected.", fail("Medium", "Business identity is underdeveloped", "Add a credible company or team story with relevant experience.", "Human context helps prospects trust the business."));
  check("address", "Trust", "Physical location evidence", 3, hasAddress, hasAddress ? "A street-address pattern was detected." : "No physical address was detected in visible content.", fail("Low", "Physical location is not evident", "Show the verified address or service area when applicable.", "Location evidence supports local credibility."));
  check("favicon", "Trust", "Browser brand icon", 1, hasFavicon, hasFavicon ? "A favicon was detected." : "No favicon was detected.", fail("Low", "Brand icon is not declared", "Add a branded favicon.", "Browser branding makes the site feel maintained."));
  check("social-preview", "Trust", "Branded social preview", 1, hasOg, hasOg ? "An Open Graph image was detected." : "No Open Graph image was detected.", fail("Low", "Shared links lack a branded preview image", "Add a branded Open Graph image.", "Professional previews improve credibility."));
  check("contact-identity", "Trust", "Visible contact identity", 2, hasPhone || hasEmail || hasAddress, hasPhone || hasEmail || hasAddress ? "At least one direct contact or location signal was detected." : "No linked phone, linked email, or address was detected.", fail("Medium", "Contact identity is difficult to verify", "Show verified phone, email/contact path, and location details consistently.", "Complete contact details reduce uncertainty."));
  check("organization-identity", "Trust", "Organization identity signal", 2, hasOrganization, hasOrganization ? "Organization schema or visible ownership language was detected." : "No clear organization or ownership marker was detected.", fail("Low", "Organization identity signals are weak", "Use consistent naming in the footer and organization schema.", "Consistent identity supports credibility."));
  return finalize(checks, findings, pages.length, null);
}

function boundedScore(value) { const number = Number(value); return Number.isFinite(number) ? clamp(number) : null; }

export function mergeLighthouseAudit(analysis, lighthouse, affectedUrl) {
  if (!lighthouse) return analysis;
  const performance = boundedScore(lighthouse.performance); const accessibility = boundedScore(lighthouse.accessibility); const seo = boundedScore(lighthouse.seo); const bestPractices = boundedScore(lighthouse.bestPractices);
  const checks = analysis.checks.map((item) => ({ ...item })); const findings = [...analysis.findings];
  const replace = (id, score, threshold, evidence) => { const target = checks.find((item) => item.id === id); if (!target || score === null) return; target.status = score >= threshold ? "passed" : "failed"; target.earned = score >= threshold ? target.weight : Math.round(target.weight * Math.max(0, score - 40) / Math.max(1, threshold - 40) * 100) / 100; target.evidence = evidence; };
  const metrics = [lighthouse.lcp && `LCP ${lighthouse.lcp}`, lighthouse.inp && `INP ${lighthouse.inp}`, lighthouse.cls && `CLS ${lighthouse.cls}`].filter(Boolean).join(" · ");
  replace("mobile-performance", performance, 80, performance === null ? "Performance unavailable." : `Lighthouse mobile performance: ${performance}/100${metrics ? ` · ${metrics}` : ""}.`);
  replace("mobile-accessibility", accessibility, 90, accessibility === null ? "Accessibility unavailable." : `Lighthouse accessibility: ${accessibility}/100.`);
  replace("browser-practices", bestPractices, 90, bestPractices === null ? "Best practices unavailable." : `Lighthouse best practices: ${bestPractices}/100.`);
  if (performance !== null && performance < 80) findings.push(finding("Technical", performance < 50 ? "High" : "Medium", "Mobile performance needs attention", `Google Lighthouse scored mobile performance ${performance}/100${metrics ? ` (${metrics})` : ""}.`, "Prioritize render-blocking resources, images, fonts, and excess JavaScript, then retest.", "Faster mobile experiences reduce abandonment.", affectedUrl));
  if (accessibility !== null && accessibility < 90) findings.push(finding("Technical", accessibility < 70 ? "High" : "Medium", "Automated accessibility checks found barriers", `Google Lighthouse scored accessibility ${accessibility}/100.`, "Correct semantic, contrast, labeling, and keyboard failures, then verify manually.", "Accessible interactions help more visitors convert.", affectedUrl));
  if (seo !== null && seo < 90) findings.push(finding("Visibility", seo < 70 ? "High" : "Medium", "Lighthouse identified search visibility gaps", `Google Lighthouse scored SEO ${seo}/100 on mobile.`, "Resolve the crawlability, metadata, link, and mobile-search checks identified.", "Technical SEO helps qualified searchers discover the site.", affectedUrl));
  if (bestPractices !== null && bestPractices < 90) findings.push(finding("Technical", bestPractices < 70 ? "High" : "Medium", "Browser best-practice checks need work", `Google Lighthouse scored best practices ${bestPractices}/100.`, "Review insecure resources, browser errors, images, and deprecated APIs.", "Modern browser practices reduce errors and protect confidence.", affectedUrl));
  return finalize(checks, findings, analysis.pagesAudited, { performance, accessibility, seo, bestPractices, lcp: lighthouse.lcp ?? "", inp: lighthouse.inp ?? "", cls: lighthouse.cls ?? "" });
}
