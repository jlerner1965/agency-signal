/**
 * Single-file HTML mockups built from the prospect's own brand tokens. Served
 * at their own public URL — the page is the deliverable, not an image of it.
 *
 * The brand supplies the colours, type and logo; `lib/audit/register.js`
 * supplies the nouns. Nothing on the page is hard-coded to one kind of
 * business, because a supplier shown a page about appointments and insurance
 * reads as a template with the name swapped in.
 */

import { NEUTRAL_REGISTER, vocabularyFor } from "./register.js";

/**
 * A sentence the business actually published, or nothing.
 *
 * The distilled page text starts with header and navigation, so the first
 * sentence of it is usually a menu. A meta description is a deliberate summary
 * and is preferred; failing that, the first run of prose long enough to be a
 * sentence rather than a link label. When neither exists the caller shows the
 * section as a gap — inventing a plausible sentence here would put words in
 * the prospect's mouth on a page carrying their own logo.
 */
function ownSentence(page) {
  const described = String(page?.metaDescription ?? "").replace(/\s+/g, " ").trim();
  if (described.length >= 40) return described.slice(0, 240);

  for (const candidate of bodyText(page).split(/(?<=[.!?])\s+/)) {
    const sentence = candidate.trim();
    // Long enough to be prose, and containing a lower-case word, which a nav
    // label or a title-cased heading generally does not.
    if (sentence.length < 60 || sentence.length > 300) continue;
    if (!/\s[a-z]{3,}\s/.test(sentence)) continue;
    return sentence.slice(0, 240);
  }
  return "";
}

/**
 * The page's copy with its own chrome removed. Distilled text runs the header
 * straight into the first paragraph, so "Home Industries Contact Aragonite
 * raises alkalinity…" is one sentence as far as a splitter is concerned. The
 * page's own H1 is the reliable anchor for where the chrome ends; failing that,
 * its navigation labels are stripped from the front.
 */
function bodyText(page) {
  const text = String(page?.text ?? "").replace(/\s+/g, " ").trim();

  const heading = String(page?.h1?.[0] ?? "").replace(/\s+/g, " ").trim();
  if (heading) {
    const at = text.indexOf(heading);
    if (at >= 0) return text.slice(at + heading.length).trim();
  }

  const labels = (page?.navLinks ?? [])
    .map((link) => String(link?.text ?? "").replace(/\s+/g, " ").trim())
    .filter((label) => label.length > 1);
  let trimmed = text;
  for (let pass = 0; pass < labels.length + 1; pass += 1) {
    const label = labels.find((entry) => trimmed.startsWith(entry));
    if (!label) break;
    trimmed = trimmed.slice(label.length).trim();
  }
  return trimmed;
}

function pathOf(url) {
  try { return new URL(url).pathname.replace(/\/+$/, "") || "/"; } catch { return ""; }
}

/**
 * What the prospect's own site already says, matched to the lines it sells.
 * A concept page built from these sentences shows the business rearranged;
 * one built from placeholder prose only shows a layout.
 *
 * @param pages distilled crawl pages
 * @param serviceLines the analysed service lines, which carry their source URL
 */
export function readMockupContent(pages = [], serviceLines = []) {
  const reachable = pages.filter((page) => page?.ok !== false);
  const byUrl = new Map(reachable.map((page) => [String(page.url ?? ""), page]));
  const home = reachable[0];

  const lines = {};
  for (const line of serviceLines) {
    const page = byUrl.get(String(line.siteUrl ?? ""));
    // The gap table's citation is often just the line's own name — read off a
    // nav label or a heading. Repeating it as the description would print
    // "Agriculture" under a card headed "Agriculture", so it only stands in
    // when it is genuinely a sentence about the line rather than the name of it.
    const quote = String(line.quote ?? "").replace(/\s+/g, " ").trim();
    const name = String(line.name ?? "").replace(/\s+/g, " ").trim();
    const usableQuote = quote.length >= 40 && quote.toLowerCase() !== name.toLowerCase() ? quote : "";

    lines[line.key] = {
      summary: ownSentence(page) || usableQuote,
      source: pathOf(line.siteUrl ?? ""),
      points: (page?.h2 ?? []).map((heading) => String(heading).trim()).filter((heading) => heading.length > 2 && heading.length < 70).slice(0, 3),
    };
  }

  return {
    summary: ownSentence(home),
    source: pathOf(home?.url ?? ""),
    lines,
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
  ));
}

/** Their sentence, credited to the page it was read from. */
function quoted(text, source) {
  return `${escapeHtml(text)}${source ? `<span class="src">Read from ${escapeHtml(source)}</span>` : ""}`;
}

/** No sentence to quote. Said plainly rather than filled with invented prose. */
function gap(source) {
  return `<span class="gap">No description was found${source ? ` on ${escapeHtml(source)}` : ""} — this is where it would go.</span>`;
}

function shell(brand, title, body) {
  const fontLink = brand.googleFonts?.length
    ? `<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="stylesheet" href="https://fonts.googleapis.com/css2?${brand.googleFonts.map((font) => `family=${encodeURIComponent(font).replace(/%20/g, "+")}:wght@400;600;700`).join("&")}&display=swap">`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(title)}</title>${fontLink}
<style>
:root{--primary:${brand.primary};--accent:${brand.accent};--ink:${brand.ink};--ground:${brand.ground};--font:${brand.fontStack}}
*{box-sizing:border-box}
body{margin:0;background:var(--ground);color:var(--ink);font-family:var(--font);line-height:1.6}
.wrap{max-width:1080px;margin:0 auto;padding:0 24px}
header.site{background:#fff;border-bottom:1px solid rgba(0,0,0,.08);position:sticky;top:0;z-index:5}
header.site .wrap{display:flex;align-items:center;gap:24px;padding-top:14px;padding-bottom:14px}
.brand{display:flex;align-items:center;gap:10px;font-weight:700;font-size:19px;color:var(--primary);text-decoration:none}
.brand img{height:34px;width:auto}
nav.main{margin-left:auto;display:flex;gap:20px;flex-wrap:wrap}
nav.main a{color:var(--ink);text-decoration:none;font-size:14px}
.tel{font-weight:700;color:var(--primary);text-decoration:none;font-size:14px}
.cta{display:inline-block;background:var(--accent);color:#fff;text-decoration:none;padding:12px 22px;border-radius:4px;font-weight:700;font-size:15px}
.cta.ghost{background:transparent;color:var(--primary);border:2px solid var(--primary)}
.hero{background:var(--primary);color:#fff;padding:72px 0}
.hero h1{margin:0 0 16px;font-size:clamp(2rem,4.6vw,3.1rem);line-height:1.1;max-width:18ch}
.hero p{margin:0 0 28px;font-size:1.12rem;max-width:52ch;opacity:.94}
.hero .actions{display:flex;gap:14px;flex-wrap:wrap}
.hero .cta.ghost{color:#fff;border-color:#fff}
section{padding:56px 0}
h2{font-size:1.7rem;margin:0 0 8px}
.lede{color:rgba(0,0,0,.66);margin:0 0 28px;max-width:60ch}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px}
.card{background:#fff;border:1px solid rgba(0,0,0,.08);border-radius:8px;padding:22px}
.card h3{margin:0 0 8px;font-size:1.12rem;color:var(--primary)}
.card p{margin:0 0 14px;font-size:.95rem;color:rgba(0,0,0,.7)}
.card a{color:var(--accent);font-weight:600;text-decoration:none;font-size:.9rem}
.proof{background:#fff}
.proof .grid{gap:26px}
.quote{border-left:3px solid var(--accent);padding-left:18px;font-size:1rem}
.quote cite{display:block;margin-top:8px;font-style:normal;font-weight:700;font-size:.85rem;color:var(--primary)}
.band{background:var(--primary);color:#fff;text-align:center}
.band h2{margin-bottom:12px}
.band p{max-width:52ch;margin:0 auto 24px;opacity:.94}
.band .cta{background:#fff;color:var(--primary)}
form.enquiry{display:grid;gap:12px;max-width:460px;background:#fff;padding:24px;border-radius:8px;border:1px solid rgba(0,0,0,.08)}
form.enquiry label{display:grid;gap:5px;font-size:.85rem;font-weight:600}
form.enquiry input,form.enquiry textarea{font:inherit;font-size:.95rem;padding:10px;border:1px solid rgba(0,0,0,.2);border-radius:4px}
form.enquiry button{font:inherit;font-weight:700;background:var(--accent);color:#fff;border:0;padding:12px;border-radius:4px;cursor:pointer}
footer.site{background:var(--ink);color:#fff;padding:36px 0;font-size:.85rem}
footer.site a{color:#fff}
.stamp{background:#111;color:#fff;text-align:center;padding:9px 16px;font:600 12px/1.4 system-ui,sans-serif;letter-spacing:.04em}
.src{display:block;margin-top:6px;font-size:.72rem;letter-spacing:.04em;text-transform:uppercase;opacity:.62}
.hero .src{color:#fff}
.gap{display:block;padding:10px 12px;border:1px dashed rgba(0,0,0,.28);border-radius:5px;font-size:.85rem;color:rgba(0,0,0,.55)}
.hero .gap{border-color:rgba(255,255,255,.4);color:rgba(255,255,255,.82)}
.proposed{display:inline-block;margin-bottom:10px;padding:3px 9px;border-radius:99px;background:rgba(0,0,0,.06);font-size:.7rem;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(0,0,0,.55)}
@media(max-width:640px){nav.main{display:none}.hero{padding:52px 0}}
</style></head>
<body>
<div class="stamp">CONCEPT MOCKUP — built from ${escapeHtml(brand.businessName || "the business")}'s own brand colours and type. Not a live website.</div>
${body}
</body></html>`;
}

function header(brand, services, words) {
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.businessName)}">`
    : "";
  return `<header class="site"><div class="wrap">
<a class="brand" href="#">${logo}<span>${escapeHtml(brand.businessName || words.businessFallback)}</span></a>
<nav class="main">${services.slice(0, 5).map((service) => `<a href="#${escapeHtml(service.key ?? "")}">${escapeHtml(service.name)}</a>`).join("")}<a href="#contact">Contact</a></nav>
<a class="tel" href="tel:${escapeHtml((brand.phone ?? "").replace(/[^\d+]/g, "")) || "#"}">${escapeHtml(brand.phone || words.callFallback)}</a>
<a class="cta" href="#book">${escapeHtml(words.cta)}</a>
</div></header>`;
}

function footer(brand, words) {
  return `<footer class="site"><div class="wrap">
<strong>${escapeHtml(brand.businessName || words.businessFallback)}</strong>
<p>${escapeHtml(brand.address || "Address, city and opening hours published consistently with the Google Business Profile.")}</p>
<p><a href="#book">${escapeHtml(words.cta)}</a> · <a href="tel:${escapeHtml((brand.phone ?? "").replace(/[^\d+]/g, "")) || "#"}">${escapeHtml(brand.phone || "Call")}</a></p>
</div></footer>`;
}

/** Only claim a location when one was actually read, never "your area". */
function placeClause(brand) {
  return brand.city ? ` in ${escapeHtml(brand.city)}` : "";
}

/**
 * A homepage that answers the findings: a block per line the site sells, one
 * dominant action above the fold, a tappable number, trust proof, and a real
 * form.
 */
export function buildHomepageMockup(brand, serviceLines, { register = NEUTRAL_REGISTER, content = {} } = {}) {
  const words = vocabularyFor(register);
  const lineContent = content.lines ?? {};
  const services = serviceLines.length ? serviceLines : [{ name: `Your primary ${words.offerNoun}`, key: "service-1" }];
  const remainder = services.length - 1;
  const scope = remainder > 0
    ? ` and ${remainder} more ${remainder === 1 ? escapeHtml(words.offerNoun) : escapeHtml(words.offerNounPlural)}`
    : "";
  const body = `${header(brand, services, words)}
<div class="hero"><div class="wrap">
<h1>${escapeHtml(brand.businessName || words.businessFallback)} — ${escapeHtml(services[0].name)}${scope}${placeClause(brand)}</h1>
<p>${content.summary ? quoted(content.summary, content.source) : escapeHtml(`Every ${words.offerNoun} you offer, named on the page and findable in search — not flattened into one category.`)}</p>
<div class="actions"><a class="cta" href="#book">${escapeHtml(words.cta)}</a><a class="cta ghost" href="tel:${escapeHtml((brand.phone ?? "").replace(/[^\d+]/g, "")) || "#"}">${escapeHtml(brand.phone || words.callFallback)}</a></div>
</div></div>

<section><div class="wrap">
<h2>${escapeHtml(words.offerHeading)}</h2>
<p class="lede">${escapeHtml(words.offerLede)}</p>
<div class="grid">${services.map((service) => `<article class="card" id="${escapeHtml(service.key ?? "")}">
<h3>${escapeHtml(service.name)}</h3>
<p>${lineContent[service.key]?.summary ? quoted(lineContent[service.key].summary, lineContent[service.key].source) : gap(lineContent[service.key]?.source)}</p>
<a href="#${escapeHtml(service.key ?? "")}">About ${escapeHtml(service.name)} →</a></article>`).join("")}</div>
</div></section>

<section class="proof"><div class="wrap">
<h2>${escapeHtml(words.peopleHeading)}</h2>
<p class="lede">${escapeHtml(words.peopleLede)}</p>
<div class="grid">
${words.people.map((person) => `<div class="card"><h3>${escapeHtml(person.name)}</h3><p>${escapeHtml(person.body)}</p></div>`).join("")}
<blockquote class="quote">${escapeHtml(words.quote)}<cite>${escapeHtml(words.quoteCite)}</cite></blockquote>
</div></div></section>

<section class="band" id="book"><div class="wrap">
<h2>${escapeHtml(words.cta)}</h2>
<p>${escapeHtml(words.bandLede)}</p>
<a class="cta" href="#contact">${escapeHtml(words.ctaStep)}</a>
</div></section>

<section id="contact"><div class="wrap">
<h2>Send an enquiry</h2>
<p class="lede">Four fields, posting to a real handler that stores the enquiry and confirms it.</p>
<form class="enquiry" method="post" action="/enquiry">
<label>Name<input name="name" required></label>
<label>Email<input type="email" name="email" required></label>
<label>${escapeHtml(words.enquiryField)}<input name="service" list="services" required></label>
<label>Anything we should know<textarea name="notes" rows="3"></textarea></label>
<button type="submit">Send enquiry</button>
</form>
<datalist id="services">${services.map((service) => `<option value="${escapeHtml(service.name)}"></option>`).join("")}</datalist>
</div></section>
${footer(brand, words)}`;
  return shell(brand, `${brand.businessName || words.businessFallback} — homepage concept`, body);
}

/** A page for the highest-priority line, the page that can actually rank. */
export function buildServicePageMockup(brand, serviceLines, { register = NEUTRAL_REGISTER, content = {} } = {}) {
  const words = vocabularyFor(register);
  const service = serviceLines[0] ?? { name: `Your primary ${words.offerNoun}`, key: "service-1" };
  const others = serviceLines.slice(1, 4);
  const own = (content.lines ?? {})[service.key] ?? null;
  const body = `${header(brand, serviceLines, words)}
<div class="hero"><div class="wrap">
<h1>${escapeHtml(service.name)}${placeClause(brand)}</h1>
<p>${own?.summary ? quoted(own.summary, own.source) : gap(own?.source)}</p>
<div class="actions"><a class="cta" href="#book">${escapeHtml(words.cta)}</a><a class="cta ghost" href="tel:${escapeHtml((brand.phone ?? "").replace(/[^\d+]/g, "")) || "#"}">${escapeHtml(brand.phone || words.callFallback)}</a></div>
</div></div>

<section><div class="wrap">
<span class="proposed">Proposed section</span>
<h2>Is ${escapeHtml(service.name)} right for you?</h2>
<p class="lede">${own?.points?.length ? `Your page already has ${escapeHtml(own.points.join(", "))}. This is the shape the rest would take.` : "The problem in the reader's own words, who it suits, and who it does not."}</p>
<div class="grid">
${words.detailCards.map((card) => `<div class="card"><h3>${escapeHtml(card.title)}</h3><p>${escapeHtml(card.body)}</p></div>`).join("")}
</div></div></section>

<section class="proof"><div class="wrap">
<span class="proposed">Proposed section</span>
<h2>Questions we are asked</h2>
<p class="lede">Marked up as FAQ structured data, so the answers can appear in search directly.</p>
<div class="grid">
${words.faq.map((entry) => `<div class="card"><h3>${escapeHtml(entry.question)}</h3><p>${escapeHtml(entry.answer)}</p></div>`).join("")}
</div></div></section>

<section class="band" id="book"><div class="wrap">
<h2>${escapeHtml(words.ctaFor)} ${escapeHtml(service.name)}</h2>
<p>The same one-step path as every other page.</p>
<a class="cta" href="#">${escapeHtml(words.ctaStep)}</a>
</div></section>

${others.length ? `<section><div class="wrap"><h2>Other ${escapeHtml(words.offerNounPlural)}</h2><div class="grid">${others.map((other) => `<article class="card"><h3>${escapeHtml(other.name)}</h3><p>Its own page, its own searches.</p><a href="#">Read more →</a></article>`).join("")}</div></div></section>` : ""}
${footer(brand, words)}`;
  return shell(brand, `${brand.businessName || words.businessFallback} — ${service.name} page concept`, body);
}
