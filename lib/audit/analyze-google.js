import { visibleText } from "./html.js";

/**
 * Google presence. Fields the Places API exposes are measured; fields it does
 * not expose for profiles we do not own become an explicit manual-check list
 * that feeds the same scoring path once a person enters what they see.
 */

/** Fields no API returns for a profile we do not own. */
export const manualCheckList = [
  { id: "posts", label: "Recent posts", prompt: "Days since the most recent Google post", field: "googlePostRecencyDays" },
  { id: "responses", label: "Owner responses to reviews", prompt: "Percentage of reviews with an owner response", field: "googleResponseRate" },
  { id: "photos", label: "Photo count", prompt: "Number of photos on the profile", field: "googlePhotoCount" },
  { id: "completeness", label: "Profile completeness", prompt: "Percentage of profile sections filled in", field: "googleProfileCompleteness" },
];

function digitsOnly(value) {
  return String(value ?? "").replace(/\D/g, "");
}

function normalizeAddress(value) {
  return String(value ?? "").toLowerCase()
    .replace(/\b(suite|ste|unit|apt|#)\s*[\w-]+/g, " ")
    .replace(/\b(street|st|avenue|ave|road|rd|boulevard|blvd|drive|dr|lane|ln|court|ct|place|pl|suite)\b/g, (match) => match[0])
    .replace(/[^a-z0-9]/g, "");
}

export function analyzeGooglePresence(payloads) {
  const crawl = payloads.find((payload) => payload.source === "crawl");
  const places = payloads.find((payload) => payload.source === "places");
  const manual = payloads.find((payload) => payload.source === "manual-entry")?.payload ?? {};

  const checks = [];
  const findings = [];
  const check = (id, label, weight, passed, evidence, failure, unverifiedReason) => {
    checks.push({
      id, category: "Trust", label, weight,
      status: passed === null ? "unverified" : passed ? "passed" : "failed",
      earned: passed ? weight : 0, evidence,
      ...(passed === null && unverifiedReason ? { unverifiedReason } : {}),
    });
    if (passed === false && failure) findings.push({ category: "Trust", evidence, ...failure });
  };

  const profile = places?.ok ? places.payload : null;

  if (!profile) {
    const reason = places?.failureReason || "No Google Business Profile data was available.";
    for (const [id, label, weight] of [["gbp-category", "Primary category fit", 5], ["gbp-nap", "Name, address and phone match the site", 5], ["gbp-reviews", "Review volume", 4], ["gbp-hours", "Opening hours published", 3]]) {
      checks.push({ id, category: "Trust", label, weight, status: "unverified", earned: 0, evidence: reason, unverifiedReason: "source-unavailable" });
    }
    findings.push({
      category: "Trust",
      severity: "Medium",
      title: "The Google Business Profile could not be read",
      evidence: `${reason} Nothing about the profile was measured, so this is missing data rather than a weak profile.`,
      recommendation: "Configure GOOGLE_PLACES_API_KEY, or record the profile URL and place id on the prospect so it can be looked up.",
      impactNote: "The service-line gap analysis depends on knowing what the profile represents.",
      impactScore: 3, effortScore: 1, affectedUrl: "",
    });
    return { findings, checks, reachable: true, message: reason, manualChecks: manualCheckList };
  }

  const siteText = (crawl?.payload?.pages ?? []).filter((page) => page.ok).map((page) => page.text).join(" ");
  const siteVisible = visibleText(siteText);

  // Category fit against what the site actually sells.
  const category = profile.primaryTypeDisplayName?.text || profile.primaryType || "";
  check("gbp-category", "Primary category is set", 5, Boolean(category),
    category ? `The profile's primary category is “${category}”.` : "The profile has no primary category.",
    { severity: "High", title: "The profile has no primary category",
      recommendation: "Set the primary category to the highest-value service, then add secondary categories for the rest.",
      impactNote: "Category is the strongest signal Google uses to decide which searches a profile appears in.",
      impactScore: 5, effortScore: 1 });

  // NAP consistency: phone and address as published on the site.
  const profilePhone = digitsOnly(profile.nationalPhoneNumber || profile.internationalPhoneNumber);
  // Bounded to a phone-shaped run: a looser class runs past the sentence and
  // swallows the street number that follows it.
  const PHONE = /(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/g;
  const sitePhones = new Set((siteVisible.match(PHONE) ?? []).map(digitsOnly).filter((value) => value.length >= 10));
  const phoneMatches = profilePhone ? [...sitePhones].some((phone) => phone.endsWith(profilePhone.slice(-10))) : null;

  const profileAddress = normalizeAddress(profile.shortFormattedAddress || profile.formattedAddress);
  const addressMatches = profileAddress ? normalizeAddress(siteVisible).includes(profileAddress.slice(0, 18)) : null;
  const napKnown = phoneMatches !== null || addressMatches !== null;

  check("gbp-nap", "Name, address and phone match the site", 5,
    napKnown ? Boolean(phoneMatches) && addressMatches !== false : null,
    napKnown
      ? `Profile phone ${profilePhone ? (phoneMatches ? "matches" : "does not match") : "is absent"}; profile address ${profileAddress ? (addressMatches ? "appears" : "does not appear") : "is absent"} on the audited pages.`
      : "The profile publishes neither a phone number nor an address to compare.",
    { severity: "High", title: "Business details differ between the site and Google",
      recommendation: "Publish one identical name, address and phone on the site's contact page, footer, and the Google profile.",
      impactNote: "Inconsistent details weaken local ranking and make a business look unreliable to anyone checking.",
      impactScore: 4, effortScore: 1 },
    "source-unavailable");

  const reviewCount = Number(profile.userRatingCount ?? 0);
  const rating = Number(profile.rating ?? 0);
  check("gbp-reviews", "Review volume", 4, reviewCount >= 25,
    reviewCount ? `The profile has ${reviewCount} reviews at ${rating || "no"} average rating.` : "The profile has no reviews.",
    { severity: reviewCount === 0 ? "High" : "Medium", title: "Review volume is thin for a local business",
      recommendation: "Ask recent satisfied customers for a review, and respond to every review that arrives.",
      impactNote: "Review count and recency are among the few local ranking factors a business can directly influence.",
      impactScore: 4, effortScore: 2 });

  const hours = profile.regularOpeningHours?.weekdayDescriptions ?? [];
  check("gbp-hours", "Opening hours published", 3, hours.length >= 7,
    hours.length ? `${hours.length} days of opening hours are published.` : "No opening hours are published on the profile.",
    { severity: "Medium", title: "Opening hours are incomplete",
      recommendation: "Publish hours for all seven days, including holiday exceptions.",
      impactNote: "Missing hours suppress the profile in “open now” searches.",
      impactScore: 3, effortScore: 1 });

  const status = String(profile.businessStatus ?? "");
  check("gbp-status", "Profile is operational", 2, status ? status === "OPERATIONAL" : null,
    status ? `The profile reports status ${status}.` : "The profile does not report an operating status.",
    { severity: "High", title: "The profile is not marked operational",
      recommendation: "Correct the profile's operating status; a closed or temporarily-closed profile is heavily suppressed.",
      impactNote: "A profile Google believes is closed will not surface for local searches at all.",
      impactScore: 5, effortScore: 1 },
    "source-unavailable");

  // Fields the API withholds. A person's entry feeds the same checks.
  const reviewed = Boolean(manual.reviewed);
  for (const item of manualCheckList) {
    const value = Number(manual[item.field] ?? 0);
    if (!reviewed) {
      checks.push({
        id: `gbp-${item.id}`, category: "Trust", label: item.label, weight: 2, status: "unverified", earned: 0,
        evidence: `The Places API does not expose ${item.label.toLowerCase()} for a profile we do not own. ${item.prompt} to include it.`,
        unverifiedReason: "not-applicable",
      });
      continue;
    }
    const thresholds = { posts: 30, responses: 50, photos: 10, completeness: 80 };
    const passed = item.id === "posts" ? value > 0 && value <= thresholds.posts : value >= thresholds[item.id];
    check(`gbp-${item.id}`, item.label, 2, passed,
      `${item.label}: ${value} (entered from the live profile).`,
      { severity: "Low", title: `${item.label} needs attention on the Google profile`,
        recommendation: `Bring ${item.label.toLowerCase()} up to a healthy level and keep it current.`,
        impactNote: "Profile activity is a freshness signal and a visible sign the business is attentive.",
        impactScore: 2, effortScore: 2 });
  }

  const verified = checks.filter((item) => item.status !== "unverified").length;
  return {
    findings, checks, reachable: true, manualChecks: reviewed ? [] : manualCheckList,
    message: `Read the Google profile${category ? ` (${category})` : ""}; ${verified} of ${checks.length} checks verified.${reviewed ? "" : " Enter the manual-check values to measure profile activity."}`,
  };
}
