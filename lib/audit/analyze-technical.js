import { coreWebVitals, lighthouseThresholds } from "./scoring-config.js";

/**
 * Turns stored PageSpeed and document payloads into checks and findings.
 * Pure: it never fetches, so a re-score reads the same payloads and produces
 * the same result.
 */

function payloadFor(payloads, source) {
  return payloads.find((payload) => payload.source === source) ?? null;
}

function lighthouse(payload) {
  return payload?.payload?.lighthouseResult ?? null;
}

function categoryScore(result, key) {
  const score = result?.categories?.[key]?.score;
  return typeof score === "number" ? Math.round(score * 100) : null;
}

function numericValue(result, auditId) {
  const value = result?.audits?.[auditId]?.numericValue;
  return typeof value === "number" ? value : null;
}

function displayValue(result, auditId) {
  const value = result?.audits?.[auditId]?.displayValue;
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function metaTag(html, attribute, name) {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(new RegExp(`\\b${attribute}=["']([^"']+)["']`, "i"))?.[1];
    if (key && key.toLowerCase() === name.toLowerCase()) {
      return tag.match(/\bcontent=["']([^"']*)["']/i)?.[1]?.trim() ?? "";
    }
  }
  return "";
}

const CATEGORY_LABELS = {
  performance: "Performance",
  accessibility: "Accessibility",
  seo: "SEO",
  "best-practices": "Best practices",
};

export function analyzeTechnical(payloads) {
  const checks = [];
  const findings = [];
  const document = payloadFor(payloads, "document");
  const mobile = payloadFor(payloads, "pagespeed-mobile");
  const desktop = payloadFor(payloads, "pagespeed-desktop");

  const check = (id, category, label, weight, passed, evidence, failure) => {
    checks.push({
      id, category, label, weight,
      status: passed === null ? "unverified" : passed ? "passed" : "failed",
      earned: passed ? weight : 0,
      evidence,
    });
    if (passed === false && failure) {
      findings.push({ category, affectedUrl: failure.url ?? "", ...failure, evidence });
    }
  };

  // A site we could not read is reported as unread, with nothing scored.
  if (!document || !document.ok) {
    const reason = document?.failureReason || "The website could not be fetched.";
    const url = document?.payload?.finalUrl ?? "";
    findings.push({
      category: "Technical",
      severity: "High",
      title: "The website could not be audited",
      evidence: `${reason} No technical checks were run, so this prospect has no technical score — this is not a low score.`,
      recommendation: "Retry from a different network, or confirm with the prospect whether bot protection is blocking automated review.",
      impactNote: "An unreadable site cannot be assessed. Treat this as missing data, not as evidence of a poor website.",
      impactScore: 4,
      effortScore: 1,
      affectedUrl: url,
    });
    return { findings, checks, reachable: false, message: reason };
  }

  const { status, finalUrl = "", html = "", redirected = false } = document.payload ?? {};

  check("https", "Technical", "Secure HTTPS delivery", 5,
    finalUrl.startsWith("https://"),
    `The homepage resolved at ${finalUrl} with HTTP ${status}.`,
    { severity: "High", title: "The site is not served over HTTPS",
      recommendation: "Redirect all HTTP traffic to a single HTTPS hostname and renew the certificate automatically.",
      impactNote: "Browsers mark non-HTTPS pages as not secure, which costs trust before a visitor reads anything.",
      impactScore: 5, effortScore: 2, url: finalUrl });

  check("viewport", "Technical", "Responsive viewport declared", 4,
    /name=["']viewport["']/i.test(html),
    /name=["']viewport["']/i.test(html) ? "A mobile viewport declaration was found." : "No mobile viewport declaration was found.",
    { severity: "High", title: "Mobile viewport is not declared",
      recommendation: "Add a standard responsive viewport meta tag and check the layout at common phone widths.",
      impactNote: "Without it, mobile browsers render a desktop-width page that visitors have to pinch and zoom.",
      impactScore: 5, effortScore: 1, url: finalUrl });

  const hasFavicon = /<link\b[^>]*rel=["'][^"']*icon[^"']*["']/i.test(html);
  check("favicon", "Technical", "Favicon present", 1, hasFavicon,
    hasFavicon ? "A favicon link was found." : "No favicon link was found.",
    { severity: "Low", title: "No favicon is set",
      recommendation: "Add a favicon so the site is identifiable in tabs, bookmarks, and search results.",
      impactNote: "A missing favicon reads as an unfinished site in a row of browser tabs.",
      impactScore: 2, effortScore: 1, url: finalUrl });

  const ogTitle = metaTag(html, "property", "og:title") || metaTag(html, "name", "og:title");
  const ogImage = metaTag(html, "property", "og:image") || metaTag(html, "name", "og:image");
  const twitterCard = metaTag(html, "name", "twitter:card");
  const socialComplete = Boolean(ogTitle && ogImage);
  check("social-tags", "Visibility", "Link preview tags", 3, socialComplete,
    socialComplete
      ? `Open Graph title and image are present${twitterCard ? ", along with a Twitter card type" : ""}.`
      : `Open Graph tags are incomplete: ${ogTitle ? "" : "no og:title"}${!ogTitle && !ogImage ? " and " : ""}${ogImage ? "" : "no og:image"}.`,
    { severity: "Medium", title: "Shared links have no preview",
      recommendation: "Add og:title, og:description, and a 1200×630 og:image, plus twitter:card.",
      impactNote: "Without these, the site appears as a bare URL when anyone shares it in a message or post.",
      impactScore: 3, effortScore: 1, url: finalUrl });

  check("redirects", "Technical", "Direct homepage response", 2, !redirected ? true : null,
    redirected ? "The homepage was reached through at least one redirect." : "The homepage responded directly with no redirect.",
    null);

  const probe = payloadFor(payloads, "notfound-probe");
  if (probe?.payload) {
    const probeStatus = probe.payload.status;
    check("notfound", "Technical", "Missing pages return 404", 3, probeStatus === 404,
      `A deliberately invalid URL returned HTTP ${probeStatus}.`,
      { severity: "Medium", title: "Missing pages do not return a 404",
        recommendation: "Return HTTP 404 for URLs that do not exist, with a helpful page that links back to key services.",
        impactNote: "Serving 200 for missing pages lets search engines index empty URLs and hides broken links from analytics.",
        impactScore: 3, effortScore: 2, url: finalUrl });
  }

  // Lighthouse categories. Mobile is authoritative; desktop is reported when present.
  const mobileResult = lighthouse(mobile);
  const desktopResult = lighthouse(desktop);
  const psiUnavailable = mobile?.failureReason || "Lighthouse data was unavailable.";

  for (const [key, weight] of [["performance", 6], ["accessibility", 5], ["seo", 4], ["best-practices", 3]]) {
    const mobileScore = categoryScore(mobileResult, key);
    const desktopScore = categoryScore(desktopResult, key);
    const label = CATEGORY_LABELS[key];
    if (mobileScore === null) {
      check(`lh-${key}`, key === "seo" ? "Visibility" : "Technical", `Mobile ${label.toLowerCase()}`, weight, null, psiUnavailable, null);
      continue;
    }
    const threshold = lighthouseThresholds[key === "best-practices" ? "bestPractices" : key];
    const evidence = `Lighthouse mobile ${label.toLowerCase()} scored ${mobileScore}/100${desktopScore === null ? "" : `; desktop scored ${desktopScore}/100`}.`;
    check(`lh-${key}`, key === "seo" ? "Visibility" : "Technical", `Mobile ${label.toLowerCase()}`, weight,
      mobileScore >= threshold.good, evidence,
      { severity: mobileScore < threshold.poor ? "High" : "Medium",
        title: `Mobile ${label.toLowerCase()} is below Google's threshold`,
        recommendation: `Work the Lighthouse ${label.toLowerCase()} opportunities for the mobile page until the score clears ${threshold.good}.`,
        impactNote: key === "performance"
          ? "Mobile visitors abandon slow pages before they see an offer, and Google uses these signals in ranking."
          : `A low ${label.toLowerCase()} score points at defects real visitors encounter.`,
        impactScore: mobileScore < threshold.poor ? 5 : 3,
        effortScore: key === "performance" ? 4 : 3,
        url: finalUrl });
  }

  // Core Web Vitals, from the mobile run only.
  const lcpMs = numericValue(mobileResult, "largest-contentful-paint");
  const cls = numericValue(mobileResult, "cumulative-layout-shift");
  const tbtMs = numericValue(mobileResult, "total-blocking-time");

  check("cwv-lcp", "Technical", "Largest contentful paint", 4,
    lcpMs === null ? null : lcpMs / 1000 <= coreWebVitals.lcp.goodSeconds,
    lcpMs === null ? psiUnavailable : `Largest contentful paint was ${displayValue(mobileResult, "largest-contentful-paint") || `${(lcpMs / 1000).toFixed(1)} s`} on mobile.`,
    { severity: lcpMs !== null && lcpMs / 1000 > coreWebVitals.lcp.poorSeconds ? "High" : "Medium",
      title: "The main content takes too long to appear",
      recommendation: "Compress and correctly size the hero image, serve modern formats, and remove render-blocking resources.",
      impactNote: `Google treats anything over ${coreWebVitals.lcp.goodSeconds} seconds as slow, and visitors leave before the page is usable.`,
      impactScore: 4, effortScore: 3, url: finalUrl });

  check("cwv-cls", "Technical", "Layout stability", 3,
    cls === null ? null : cls <= coreWebVitals.cls.good,
    cls === null ? psiUnavailable : `Cumulative layout shift measured ${cls.toFixed(3)} on mobile.`,
    { severity: cls !== null && cls > coreWebVitals.cls.poor ? "High" : "Medium",
      title: "The page shifts around while it loads",
      recommendation: "Set explicit width and height on images and reserve space for embeds and late-loading banners.",
      impactNote: "Content that jumps causes mis-taps on phones, most damagingly on buttons and forms.",
      impactScore: 3, effortScore: 2, url: finalUrl });

  check("cwv-tbt", "Technical", "Main-thread responsiveness", 3,
    tbtMs === null ? null : tbtMs <= coreWebVitals.tbt.goodMs,
    tbtMs === null ? psiUnavailable : `Total blocking time was ${Math.round(tbtMs)} ms on mobile.`,
    { severity: tbtMs !== null && tbtMs > coreWebVitals.tbt.poorMs ? "High" : "Medium",
      title: "Scripts block the page from responding",
      recommendation: "Defer non-essential third-party scripts and split large bundles so taps register immediately.",
      impactNote: "A blocked main thread makes taps feel ignored, which reads to a visitor as a broken site.",
      impactScore: 3, effortScore: 4, url: finalUrl });

  // Weight and format opportunities, reported only when Lighthouse measured them.
  const totalBytes = numericValue(mobileResult, "total-byte-weight");
  check("page-weight", "Technical", "Page transfer size", 3,
    totalBytes === null ? null : totalBytes <= 2_500_000,
    totalBytes === null ? psiUnavailable : `The mobile page transferred ${(totalBytes / 1_048_576).toFixed(1)} MB.`,
    { severity: "Medium", title: "The page is heavy for a mobile connection",
      recommendation: "Compress images, drop unused scripts and fonts, and lazy-load anything below the fold.",
      impactNote: "Heavy pages cost real money and patience on mobile data.",
      impactScore: 3, effortScore: 3, url: finalUrl });

  const modernFormats = numericValue(mobileResult, "modern-image-formats");
  check("image-formats", "Technical", "Modern image formats", 2,
    modernFormats === null ? null : modernFormats < 100,
    modernFormats === null ? psiUnavailable : `Modern image formats could save about ${Math.round(modernFormats / 1024)} KB.`,
    { severity: "Low", title: "Images are not served in modern formats",
      recommendation: "Serve WebP or AVIF with a fallback, and size images to their display dimensions.",
      impactNote: "Image weight is usually the cheapest performance win available.",
      impactScore: 2, effortScore: 2, url: finalUrl });

  const renderBlocking = numericValue(mobileResult, "render-blocking-resources");
  check("render-blocking", "Technical", "Render-blocking resources", 2,
    renderBlocking === null ? null : renderBlocking < 100,
    renderBlocking === null ? psiUnavailable : `Render-blocking resources delay first paint by about ${Math.round(renderBlocking)} ms.`,
    { severity: "Medium", title: "Stylesheets and scripts delay first paint",
      recommendation: "Inline critical CSS, defer the rest, and load third-party tags asynchronously.",
      impactNote: "Every blocked millisecond is time the visitor spends looking at a blank screen.",
      impactScore: 3, effortScore: 3, url: finalUrl });

  const verified = checks.filter((item) => item.status !== "unverified").length;
  const message = mobileResult
    ? `Fetched the homepage and both Lighthouse runs; ${verified} of ${checks.length} checks verified.`
    : `Fetched the homepage but Lighthouse was unavailable; ${verified} of ${checks.length} checks verified.`;

  return { findings, checks, reachable: true, message };
}
