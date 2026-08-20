/**
 * Which vocabulary a concept mockup speaks in.
 *
 * A mockup is placeholder copy dressed in the prospect's own brand, so the
 * nouns carry the whole illusion. Placeholder copy in the wrong register is
 * worse than none: a minerals supplier shown a page about practitioners,
 * appointments and what insurance covers reads as a template with the name
 * swapped in — which is the one thing the deliverable must never look like.
 *
 * So the register is decided from what the audit already read, it records why,
 * and the neutral register wins whenever the evidence is thin. Nothing here
 * invents a fact about the business; it only chooses which words to place
 * around the facts the audit collected.
 */

/**
 * Google's own category is the most authoritative single statement of what a
 * business is, and it is the fact this whole tool reasons about, so a category
 * match decides the register on its own. Everything else has to corroborate.
 */
const REGISTERS = {
  clinic: {
    category: /\b(clinic|medical|medicine|doctor|physician|dentist|dental|orthodont|chiropract|physiotherap|physical therapist|health|hospital|wellness|veterinar|optometr|dermatolog|psychiat|psycholog|therapist|acupunctur|med ?spa|surgeon|surgery|podiatr|fertility)\b/i,
    schema: /\b(MedicalBusiness|MedicalClinic|MedicalOrganization|Physician|Dentist|Hospital|VeterinaryCare|Optician|MedicalTherapy|MedicalProcedure)\b/,
    copy: [
      /\bpatients?\b/i,
      /\bboard[- ]certified\b/i,
      /\b(?:treatment plan|new patient|referrals?)\b/i,
      /\binsurance (?:accepted|covers|plans|carriers)\b/i,
      /\b(?:telehealth|diagnos(?:is|es|tic)|symptoms?)\b/i,
    ],
  },
  supplier: {
    category: /\b(manufactur|supplier|wholesal|distributor|mining|quarry|mineral|chemical|industrial|factory|foundry|fabricat|refinery|sawmill|logistics|freight|exporter|importer)\b/i,
    schema: /\b(Manufacturer|WholesaleStore|HardwareStore|AutoPartsStore)\b/,
    copy: [
      /\bbulk (?:pricing|order|supply|quantit)/i,
      /\b(?:minimum order|MOQ|lead times?)\b/i,
      /\b(?:technical (?:data|datasheet|specification)|spec(?:ification)? sheet|data sheet|safety data sheet|SDS)\b/i,
      /\bper (?:tonne|ton|pallet|metric ton)\b|\btonnage\b|\bparticle size\b/i,
      /\b(?:industries served|palleti[sz]ed|wholesale (?:pricing|enquir|inquir))\b/i,
    ],
  },
};

/** The neutral register. It has to read correctly for a business we know nothing about. */
const NEUTRAL = "service";

/**
 * @param {object} evidence
 * @param {string} evidence.googleCategory primary category text from Places
 * @param {string[]} evidence.googleTypes Places type taxonomy
 * @param {string[]} evidence.schemaTypes JSON-LD type names found on the site
 * @param {string} evidence.siteText visible copy read from the crawled pages
 * @returns {{register: string, reason: string, signals: string[]}}
 */
export function detectRegister({ googleCategory = "", googleTypes = [], schemaTypes = [], siteText = "" } = {}) {
  const category = [googleCategory, ...googleTypes].join(" ").replace(/_/g, " ");
  const schema = schemaTypes.join(" ");
  const copy = String(siteText).slice(0, 40_000);

  for (const [name, patterns] of Object.entries(REGISTERS)) {
    if (category.trim() && patterns.category.test(category)) {
      return { register: name, reason: `Google categorises the business as “${(googleCategory || googleTypes[0] || "").trim()}”.`, signals: ["google-category"] };
    }
  }

  // No category to go on, so the site has to say it twice before we believe it.
  // One stray word is not a register, and the wrong register is the failure
  // this function exists to prevent.
  const scored = Object.entries(REGISTERS).map(([name, patterns]) => {
    const signals = [];
    if (schema.trim() && patterns.schema.test(schema)) signals.push("structured-data");
    const phrases = patterns.copy.filter((pattern) => pattern.test(copy)).length;
    if (phrases) signals.push(`${phrases} phrase${phrases === 1 ? "" : "s"} in the page copy`);
    return { name, signals, weight: (signals.includes("structured-data") ? 1 : 0) + phrases };
  }).filter((entry) => entry.weight >= 2);

  const [best, runnerUp] = scored.sort((a, b) => b.weight - a.weight);
  if (best && best.weight > (runnerUp?.weight ?? 0)) {
    return { register: best.name, reason: `The site's own ${best.signals.join(" and ")} read as ${best.name} language.`, signals: best.signals };
  }

  return {
    register: NEUTRAL,
    reason: scored.length
      ? "The site reads as more than one kind of business, so the mockup stays in neutral language."
      : "Nothing identified the kind of business with confidence, so the mockup stays in neutral language.",
    signals: [],
  };
}

/**
 * The words a mockup needs. Every register supplies the same keys, so the
 * templates never branch on which one is in play.
 */
const VOCABULARY = {
  clinic: {
    businessFallback: "Your practice",
    callFallback: "Call the clinic",
    cta: "Book a consultation",
    ctaFor: "Book a consultation about",
    ctaStep: "Choose a time",
    offerNoun: "service",
    offerNounPlural: "services",
    offerHeading: "What we treat",
    offerLede: "One page per service, so each can rank for the searches that belong to it.",
    offerCardBody: "Who it suits, what the first appointment involves, and what the outcome looks like.",
    peopleHeading: "Who you'll see",
    peopleLede: "Named practitioners with their credentials, because that is what decides it.",
    people: [
      { name: "Practitioner name, MD", body: "Board certification, training, and the services they personally lead." },
      { name: "Practitioner name, NP", body: "Board certification, training, and the services they personally lead." },
    ],
    quote: "A real patient review, shown on the page where people decide rather than only on the profile.",
    quoteCite: "Verified review",
    detailCards: [
      { title: "What it treats", body: "The specific symptoms and situations this service addresses." },
      { title: "What happens", body: "The first appointment, the plan, and the follow-up schedule." },
      { title: "What it costs", body: "Pricing or a clear range, and what insurance covers." },
    ],
    faq: [
      { question: "How soon will I notice a difference?", answer: "A specific, honest answer." },
      { question: "How many appointments?", answer: "A specific, honest answer." },
    ],
    bandLede: "One step from anywhere on the site. No forms that go nowhere.",
    enquiryField: "Which service",
  },
  supplier: {
    businessFallback: "Your business",
    callFallback: "Call the team",
    cta: "Request a quote",
    ctaFor: "Request a quote for",
    ctaStep: "Send the request",
    offerNoun: "product line",
    offerNounPlural: "product lines",
    offerHeading: "What we supply",
    offerLede: "One page per product line, so each can rank for the searches that belong to it.",
    offerCardBody: "What it is, the specification it ships to, and who it suits.",
    peopleHeading: "Who you'll deal with",
    peopleLede: "Named contacts with their remit, because a buyer wants a person rather than a form.",
    people: [
      { name: "Contact name, technical sales", body: "The lines they cover and the specifications they can answer on." },
      { name: "Contact name, logistics", body: "Order sizes, packaging, and delivery into your site." },
    ],
    quote: "A real customer reference, shown on the page where buyers decide rather than only on the profile.",
    quoteCite: "Named customer",
    detailCards: [
      { title: "What it is", body: "The specification, the grades supplied, and what each one is used for." },
      { title: "How it ships", body: "Packaging, order sizes, and lead time to your site." },
      { title: "What it costs", body: "Pricing basis, or the quantities a quote is built from." },
    ],
    faq: [
      { question: "What is the minimum order?", answer: "A specific, honest answer." },
      { question: "What is the lead time?", answer: "A specific, honest answer." },
    ],
    bandLede: "One step from anywhere on the site. No forms that go nowhere.",
    enquiryField: "Which product line",
  },
  service: {
    businessFallback: "Your business",
    callFallback: "Call the team",
    cta: "Request a quote",
    ctaFor: "Request a quote for",
    ctaStep: "Send the request",
    offerNoun: "service",
    offerNounPlural: "services",
    offerHeading: "What we do",
    offerLede: "One page per service, so each can rank for the searches that belong to it.",
    offerCardBody: "What it covers, who it suits, and what the first step involves.",
    peopleHeading: "Who you'll work with",
    peopleLede: "Named people with their credentials, because that is often what decides it.",
    people: [
      { name: "Team member name, role", body: "Qualifications, experience, and the work they personally lead." },
      { name: "Team member name, role", body: "Qualifications, experience, and the work they personally lead." },
    ],
    quote: "A real customer review, shown on the page where people decide rather than only on the profile.",
    quoteCite: "Verified review",
    detailCards: [
      { title: "What it covers", body: "The specific situations this service addresses." },
      { title: "What happens", body: "The first step, what you receive, and how long it takes." },
      { title: "What it costs", body: "Pricing, or a clear range and what changes it." },
    ],
    faq: [
      { question: "How long does it take?", answer: "A specific, honest answer." },
      { question: "What does it cost?", answer: "A specific, honest answer." },
    ],
    bandLede: "One step from anywhere on the site. No forms that go nowhere.",
    enquiryField: "Which service",
  },
};

export function vocabularyFor(register) {
  return VOCABULARY[register] ?? VOCABULARY[NEUTRAL];
}

export const NEUTRAL_REGISTER = NEUTRAL;
