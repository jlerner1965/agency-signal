/**
 * Conversion, weighted light. Form assessment is static only: nothing here
 * issues a request that could write a record into a prospect's CRM, and the
 * evidence text says so in as many words.
 */

const FORM_PROVIDERS = [
  [/hubspot|hsforms/i, "HubSpot"],
  [/jotform/i, "Jotform"],
  [/typeform/i, "Typeform"],
  [/squarespace|sqsp/i, "Squarespace"],
  [/wpforms|gravityforms|contact-form-7|wp-admin\/admin-ajax/i, "a WordPress form plugin"],
  [/formspree|netlify|getform|basin/i, "a hosted form service"],
  [/mailchimp|list-manage/i, "Mailchimp"],
];

/** Static analysis of one form. No request is issued. */
export function describeForm(form, pageUrl) {
  const action = form.action;
  const fields = (form.fields ?? []).filter((field) => !["hidden", "submit", "button"].includes(field.type));
  const required = fields.filter((field) => field.required);
  const problems = [];

  let target = "none";
  if (action === null || action === "") {
    target = "same-page";
  } else if (/^mailto:/i.test(action)) {
    target = "mailto";
    problems.push("submits to a mailto: address, which silently fails on most mobile devices");
  } else {
    const provider = FORM_PROVIDERS.find(([pattern]) => pattern.test(action));
    if (provider) {
      target = provider[1];
    } else {
      try {
        target = new URL(action, pageUrl).origin === new URL(pageUrl).origin ? "same-origin" : "third-party";
      } catch { target = "unparseable"; problems.push("has an action attribute that is not a usable URL"); }
    }
  }

  if (!form.hasSubmit) problems.push("has no submit control");
  if (fields.length === 0) problems.push("has no input fields");
  if (fields.length > 8) problems.push(`asks for ${fields.length} fields, which suppresses completion`);
  if (form.method === "get" && target !== "same-page") problems.push("uses GET, which puts submitted details in the URL");

  return { target, fieldCount: fields.length, requiredCount: required.length, problems };
}

export function analyzeConversion(payloads) {
  const crawl = payloads.find((payload) => payload.source === "crawl");
  const checks = [];
  const findings = [];
  const check = (id, label, weight, passed, evidence, failure, unverifiedReason) => {
    checks.push({
      id, category: "Conversion", label, weight,
      status: passed === null ? "unverified" : passed ? "passed" : "failed",
      earned: passed ? weight : 0, evidence,
      ...(passed === null && unverifiedReason ? { unverifiedReason } : {}),
    });
    if (passed === false && failure) findings.push({ category: "Conversion", evidence, ...failure });
  };

  if (!crawl?.ok || !crawl.payload) {
    return { findings: [], checks: [], reachable: false, message: crawl?.failureReason || "The website could not be read." };
  }

  const pages = (crawl.payload.pages ?? []).filter((page) => page.ok);
  const home = pages[0];
  if (!home) {
    return { findings: [], checks: [], reachable: false, message: "No readable pages were crawled." };
  }

  // Click to call.
  const anyTel = pages.some((page) => (page.telLinks ?? []).length > 0);
  check("cv-tel", "Tap-to-call link present", 5, anyTel,
    anyTel ? `Tap-to-call links were found on ${pages.filter((page) => (page.telLinks ?? []).length).length} of ${pages.length} pages.` : "No tel: link was found on any crawled page.",
    { severity: "High", title: "The phone number is not tappable",
      recommendation: "Wrap the phone number in a tel: link everywhere it appears.",
      impactNote: "On a phone, a number that cannot be tapped is a number that does not get called.",
      impactScore: 5, effortScore: 1, url: home.url });

  check("cv-tel-fold", "Tap-to-call above the fold", 3, anyTel ? Boolean(home.telAboveFold) : null,
    home.telAboveFold ? "A tap-to-call link appears in the first viewport of the homepage." : "No tap-to-call link appears in the first viewport of the homepage.",
    { severity: "Medium", title: "The phone number is below the fold",
      recommendation: "Put the tappable number in the header so it is visible without scrolling.",
      impactNote: "High-intent visitors call immediately or not at all.",
      impactScore: 4, effortScore: 1, url: home.url },
    "not-applicable");

  check("cv-cta-fold", "Primary action above the fold", 4, Boolean(home.ctaAboveFold),
    home.ctaAboveFold ? "A booking or contact action appears in the homepage's first viewport." : "No booking or contact action appears in the homepage's first viewport.",
    { severity: "High", title: "No clear action in the first viewport",
      recommendation: "Place one dominant action in the first viewport and repeat it after each proof section.",
      impactNote: "A visitor who has to hunt for the next step usually does not take it.",
      impactScore: 5, effortScore: 2, url: home.url });

  // Booking flow depth: clicks from the homepage to a booking page.
  const bookingPages = pages.filter((page) => /(book|appointment|schedule|consult|request)/i.test(page.url));
  const bookingFromHome = (home.bookingLinks ?? []).length > 0;
  const depth = bookingFromHome ? 1 : bookingPages.length ? 2 : null;
  check("cv-booking", "Booking reachable in one step", 5, depth === null ? false : depth <= 1,
    depth === null
      ? "No booking, scheduling, or consultation path was found on any crawled page."
      : `A booking path is reachable in ${depth} step${depth === 1 ? "" : "s"} from the homepage.`,
    { severity: depth === null ? "High" : "Medium",
      title: depth === null ? "There is no booking path" : "Booking takes more than one step from the homepage",
      recommendation: "Link the booking or consultation page directly from the header and the first viewport.",
      impactNote: "Every extra click between intent and the booking form loses a share of the people who had it.",
      impactScore: 5, effortScore: 2, url: home.url });

  // Forms: structure only.
  const formPages = pages.filter((page) => (page.forms ?? []).length > 0);
  const described = formPages.flatMap((page) => (page.forms ?? []).map((form) => ({ ...describeForm(form, page.url), url: page.url })));
  const broken = described.filter((form) => form.problems.length > 0);
  const mailtoForms = described.filter((form) => form.target === "mailto");

  const formEvidence = described.length
    ? `${described.length} form${described.length === 1 ? "" : "s"} found across ${formPages.length} pages. Form structure inspected; submission not tested.${broken.length ? ` ${broken.length} have structural problems: ${broken.map((form) => `${new URL(form.url).pathname} ${form.problems.join("; ")}`).join(" · ")}.` : ""}`
    : "No HTML form was found on any crawled page. Form structure inspected; submission not tested.";

  check("cv-form", "A working lead form exists", 5, described.length > 0 && broken.length === 0, formEvidence,
    { severity: described.length === 0 ? "High" : "Medium",
      title: described.length === 0 ? "There is no lead form" : "The lead form has structural problems",
      recommendation: described.length === 0
        ? "Add a short enquiry form asking only for the details needed to follow up."
        : "Fix the form's structure so a submission has somewhere to go and a control to send it.",
      impactNote: "A form captures the visitors who are interested but not ready to phone.",
      impactScore: 5, effortScore: 2, url: described[0]?.url ?? home.url });

  if (mailtoForms.length) {
    findings.push({
      category: "Conversion",
      severity: "High",
      title: "A form submits to a mailto: address",
      evidence: `${mailtoForms.length} form${mailtoForms.length === 1 ? "" : "s"} on ${mailtoForms.map((form) => new URL(form.url).pathname).join(", ")} use a mailto: action. Form structure inspected; submission not tested.`,
      recommendation: "Post the form to a real handler that stores the enquiry and sends a confirmation.",
      impactNote: "A mailto: form depends on the visitor having a configured mail client. On most phones it fails silently, and the enquiry is simply lost.",
      impactScore: 5, effortScore: 2,
      affectedUrl: mailtoForms[0].url,
    });
  }

  // Standalone mailto links are weaker than a form but not broken.
  const mailtoOnly = !described.length && pages.some((page) => (page.mailtoLinks ?? []).length > 0);
  check("cv-contact-path", "A low-friction contact path exists", 3, described.length > 0 || anyTel || mailtoOnly,
    described.length ? "A form is available as a contact path." : anyTel ? "A tap-to-call link is available as a contact path." : mailtoOnly ? "Only a mailto: link is available as a contact path." : "No form, phone link, or email link was found.",
    { severity: "High", title: "There is no way to make contact",
      recommendation: "Provide at least a tappable phone number and a short enquiry form.",
      impactNote: "A site with no contact path cannot convert interest into a conversation.",
      impactScore: 5, effortScore: 1, url: home.url });

  // Trust signals.
  const trust = pages.reduce((accumulator, page) => ({
    bios: accumulator.bios || Boolean(page.trustSignals?.bios),
    credentials: accumulator.credentials || Boolean(page.trustSignals?.credentials),
    onSiteReviews: accumulator.onSiteReviews || Boolean(page.trustSignals?.onSiteReviews),
  }), { bios: false, credentials: false, onSiteReviews: false });
  const trustCount = Object.values(trust).filter(Boolean).length;

  check("cv-trust", "Trust signals are present", 4, trustCount >= 2,
    `Practitioner bios ${trust.bios ? "found" : "not found"}; credentials ${trust.credentials ? "found" : "not found"}; on-site reviews ${trust.onSiteReviews ? "found" : "not found"}.`,
    { severity: "Medium", title: "The site gives little reason to trust it",
      recommendation: "Publish practitioner bios with credentials, and put real customer reviews on the page where people decide.",
      impactNote: "For a health or professional service, who is behind it is often the deciding factor.",
      impactScore: 4, effortScore: 3, url: home.url });

  // Analytics.
  const analytics = pages.reduce((accumulator, page) => ({
    ga4: accumulator.ga4 || Boolean(page.analytics?.ga4),
    plausible: accumulator.plausible || Boolean(page.analytics?.plausible),
    metaPixel: accumulator.metaPixel || Boolean(page.analytics?.metaPixel),
  }), { ga4: false, plausible: false, metaPixel: false });
  const present = Object.entries(analytics).filter(([, found]) => found).map(([name]) => name);

  check("cv-analytics", "Analytics is installed", 3, present.length > 0,
    present.length ? `Detected: ${present.join(", ")}.` : "No GA4, Plausible, or Meta pixel was detected on any crawled page.",
    { severity: "Medium", title: "Nothing is measuring the site",
      recommendation: "Install analytics and mark the booking and form submissions as conversions.",
      impactNote: "Without measurement there is no way to tell which changes worked, so every later decision is a guess.",
      impactScore: 4, effortScore: 2, url: home.url });

  const verified = checks.filter((item) => item.status !== "unverified").length;
  return {
    findings, checks, reachable: true,
    message: `Reviewed conversion paths across ${pages.length} pages; ${verified} of ${checks.length} checks verified. Form structure inspected; submission not tested.`,
  };
}
