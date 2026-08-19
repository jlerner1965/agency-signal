/**
 * Single-file HTML mockups built from the prospect's own brand tokens. Served
 * at their own public URL — the page is the deliverable, not an image of it.
 */

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]
  ));
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
@media(max-width:640px){nav.main{display:none}.hero{padding:52px 0}}
</style></head>
<body>
<div class="stamp">CONCEPT MOCKUP — built from ${escapeHtml(brand.businessName || "the business")}'s own brand colours and type. Not a live website.</div>
${body}
</body></html>`;
}

function header(brand, services) {
  const logo = brand.logoUrl
    ? `<img src="${escapeHtml(brand.logoUrl)}" alt="${escapeHtml(brand.businessName)}">`
    : "";
  return `<header class="site"><div class="wrap">
<a class="brand" href="#">${logo}<span>${escapeHtml(brand.businessName || "Your practice")}</span></a>
<nav class="main">${services.slice(0, 5).map((service) => `<a href="#${escapeHtml(service.key ?? "")}">${escapeHtml(service.name)}</a>`).join("")}<a href="#contact">Contact</a></nav>
<a class="tel" href="tel:${escapeHtml((brand.phone ?? "").replace(/[^\d+]/g, "")) || "#"}">${escapeHtml(brand.phone || "Call the clinic")}</a>
<a class="cta" href="#book">Book a consultation</a>
</div></header>`;
}

function footer(brand) {
  return `<footer class="site"><div class="wrap">
<strong>${escapeHtml(brand.businessName || "Your practice")}</strong>
<p>${escapeHtml(brand.address || "Address, city and opening hours published consistently with the Google Business Profile.")}</p>
<p><a href="#book">Book a consultation</a> · <a href="tel:${escapeHtml((brand.phone ?? "").replace(/[^\d+]/g, "")) || "#"}">${escapeHtml(brand.phone || "Call")}</a></p>
</div></footer>`;
}

/**
 * A homepage that answers the findings: a service block per line, one dominant
 * action above the fold, a tappable number, trust proof, and a real form.
 */
export function buildHomepageMockup(brand, serviceLines) {
  const services = serviceLines.length ? serviceLines : [{ name: "Your primary service", key: "service-1" }];
  const body = `${header(brand, services)}
<div class="hero"><div class="wrap">
<h1>${escapeHtml(brand.businessName || "Your practice")} — ${escapeHtml(services[0].name)} and ${services.length > 1 ? `${services.length - 1} more service${services.length > 2 ? "s" : ""}` : "more"} in ${escapeHtml(brand.city || "your area")}</h1>
<p>Every service you offer, named on the page and findable in search — not flattened into one category.</p>
<div class="actions"><a class="cta" href="#book">Book a consultation</a><a class="cta ghost" href="tel:${escapeHtml((brand.phone ?? "").replace(/[^\d+]/g, "")) || "#"}">${escapeHtml(brand.phone || "Call the clinic")}</a></div>
</div></div>

<section><div class="wrap">
<h2>What we treat</h2>
<p class="lede">One page per service, so each can rank for the searches that belong to it.</p>
<div class="grid">${services.map((service) => `<article class="card" id="${escapeHtml(service.key ?? "")}">
<h3>${escapeHtml(service.name)}</h3>
<p>Who it suits, what the first appointment involves, and what the outcome looks like.</p>
<a href="#${escapeHtml(service.key ?? "")}">About ${escapeHtml(service.name.toLowerCase())} →</a></article>`).join("")}</div>
</div></section>

<section class="proof"><div class="wrap">
<h2>Who you'll see</h2>
<p class="lede">Named practitioners with their credentials, because that is what decides it.</p>
<div class="grid">
<div class="card"><h3>Practitioner name, MD</h3><p>Board certification, training, and the services they personally lead.</p></div>
<div class="card"><h3>Practitioner name, NP</h3><p>Board certification, training, and the services they personally lead.</p></div>
<blockquote class="quote">A real patient review, shown on the page where people decide rather than only on the profile.<cite>Verified review</cite></blockquote>
</div></div></section>

<section class="band" id="book"><div class="wrap">
<h2>Book a consultation</h2>
<p>One step from anywhere on the site. No forms that go nowhere.</p>
<a class="cta" href="#contact">Choose a time</a>
</div></section>

<section id="contact"><div class="wrap">
<h2>Send an enquiry</h2>
<p class="lede">Four fields, posting to a real handler that stores the enquiry and confirms it.</p>
<form class="enquiry" method="post" action="/enquiry">
<label>Name<input name="name" required></label>
<label>Email<input type="email" name="email" required></label>
<label>Which service<input name="service" list="services" required></label>
<label>Anything we should know<textarea name="notes" rows="3"></textarea></label>
<button type="submit">Send enquiry</button>
</form>
<datalist id="services">${services.map((service) => `<option value="${escapeHtml(service.name)}"></option>`).join("")}</datalist>
</div></section>
${footer(brand)}`;
  return shell(brand, `${brand.businessName || "Practice"} — homepage concept`, body);
}

/** A service page for the highest-priority line, the page that can actually rank. */
export function buildServicePageMockup(brand, serviceLines) {
  const service = serviceLines[0] ?? { name: "Your primary service", key: "service-1" };
  const others = serviceLines.slice(1, 4);
  const body = `${header(brand, serviceLines)}
<div class="hero"><div class="wrap">
<h1>${escapeHtml(service.name)} in ${escapeHtml(brand.city || "your area")}</h1>
<p>A dedicated page for one service, so it can rank for its own searches instead of sharing a paragraph on the homepage.</p>
<div class="actions"><a class="cta" href="#book">Book a ${escapeHtml(service.name.toLowerCase())} consultation</a><a class="cta ghost" href="tel:${escapeHtml((brand.phone ?? "").replace(/[^\d+]/g, "")) || "#"}">${escapeHtml(brand.phone || "Call")}</a></div>
</div></div>

<section><div class="wrap">
<h2>Is ${escapeHtml(service.name.toLowerCase())} right for you?</h2>
<p class="lede">The problem in the reader's own words, who it suits, and who it does not.</p>
<div class="grid">
<div class="card"><h3>What it treats</h3><p>The specific symptoms and situations this service addresses.</p></div>
<div class="card"><h3>What happens</h3><p>The first appointment, the plan, and the follow-up schedule.</p></div>
<div class="card"><h3>What it costs</h3><p>Pricing or a clear range, and what insurance covers.</p></div>
</div></div></section>

<section class="proof"><div class="wrap">
<h2>Questions we are asked</h2>
<p class="lede">Marked up as FAQ structured data, so the answers can appear in search directly.</p>
<div class="grid">
<div class="card"><h3>How soon will I notice a difference?</h3><p>A specific, honest answer.</p></div>
<div class="card"><h3>How many appointments?</h3><p>A specific, honest answer.</p></div>
</div></div></section>

<section class="band" id="book"><div class="wrap">
<h2>Book ${escapeHtml(service.name.toLowerCase())}</h2>
<p>The same one-step booking path as every other page.</p>
<a class="cta" href="#">Choose a time</a>
</div></section>

${others.length ? `<section><div class="wrap"><h2>Other services</h2><div class="grid">${others.map((other) => `<article class="card"><h3>${escapeHtml(other.name)}</h3><p>Its own page, its own searches.</p><a href="#">Read more →</a></article>`).join("")}</div></div></section>` : ""}
${footer(brand)}`;
  return shell(brand, `${brand.businessName || "Practice"} — ${service.name} page concept`, body);
}
