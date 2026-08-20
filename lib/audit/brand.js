/**
 * Brand tokens read from the prospect's own site, so a mockup is recognisably
 * theirs. Everything here is extracted from markup and inline CSS; nothing is
 * invented, and every token records whether it was found or defaulted.
 */

const NAMED_FALLBACK = { primary: "#1f4d5c", accent: "#c0663a", ink: "#1b2124", ground: "#f7f6f3" };

function normalizeHex(value) {
  const hex = String(value ?? "").trim().toLowerCase();
  const match = hex.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (!match) return "";
  const body = match[1];
  return `#${body.length === 3 ? body.split("").map((character) => character + character).join("") : body}`;
}

function luminance(hex) {
  const value = normalizeHex(hex);
  if (!value) return 0;
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255);
  const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** Perceptual-enough distance to tell one brand colour from another. */
function distance(a, b) {
  const first = normalizeHex(a);
  const second = normalizeHex(b);
  if (!first || !second) return 0;
  const channels = [1, 3, 5].map((index) => [
    Number.parseInt(first.slice(index, index + 2), 16),
    Number.parseInt(second.slice(index, index + 2), 16),
  ]);
  return Math.sqrt(channels.reduce((sum, [x, y]) => sum + (x - y) ** 2, 0));
}

function saturation(hex) {
  const value = normalizeHex(hex);
  if (!value) return 0;
  const [r, g, b] = [1, 3, 5].map((index) => Number.parseInt(value.slice(index, index + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  return max === 0 ? 0 : (max - min) / max;
}

/** Colours ordered by how often the site uses them, ignoring near-white and near-black. */
export function extractPalette(html) {
  const counts = new Map();
  for (const match of html.matchAll(/#[0-9a-fA-F]{3,6}\b/g)) {
    const hex = normalizeHex(match[0]);
    if (!hex) continue;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  for (const match of html.matchAll(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/g)) {
    const hex = `#${[1, 2, 3].map((index) => Number(match[index]).toString(16).padStart(2, "0")).join("")}`;
    counts.set(hex, (counts.get(hex) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([hex]) => {
      const light = luminance(hex);
      return light > 0.02 && light < 0.95;
    })
    .sort((a, b) => b[1] - a[1])
    .map(([hex, count]) => ({ hex, count }));
}

/**
 * A CSS font family the mockup can safely print.
 *
 * This text comes from the prospect's own stylesheet and is interpolated into
 * the mockup's <style> block, which is served through srcDoc on our own origin.
 * The declaration match stops at ; and }, but not at a closing style tag, so a
 * page declaring `font-family: Arial</style><script>…` used to close the block
 * and run script as us. A font name is letters, digits, spaces and hyphens; if
 * a value is not that, it is not a font name and does not belong on the page.
 */
function safeFontName(value) {
  const name = String(value ?? "").replace(/\s+/g, " ").trim();
  return /^[A-Za-z0-9 _-]{1,50}$/.test(name) ? name : "";
}

/** The declared font stack, preferring what the body is actually set in. */
export function extractFontStack(html) {
  const bodyRule = html.match(/(?:^|[{;\s])body\s*\{[^}]*font-family\s*:\s*([^;}]+)/i)?.[1]
    ?? html.match(/font-family\s*:\s*([^;}]+)/i)?.[1]
    ?? "";
  const stack = bodyRule.replace(/!important/i, "").replace(/["']/g, "").split(",").map(safeFontName).filter(Boolean);
  const googleFonts = [...html.matchAll(/fonts\.googleapis\.com\/css2?\?family=([^"'&]+)/gi)]
    .map((match) => {
      try { return safeFontName(decodeURIComponent(match[1]).split(":")[0].replace(/\+/g, " ")); }
      catch { return ""; }
    })
    .filter(Boolean);
  return { stack: stack.slice(0, 4), googleFonts: [...new Set(googleFonts)].filter(Boolean).slice(0, 3) };
}

function absolute(url, base) {
  try { return new URL(url, base).toString(); } catch { return ""; }
}

/** The logo, preferring a declared one over a guess from the header. */
export function extractLogo(html, baseUrl) {
  const ogImage = html.match(/<meta\b[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1]
    ?? html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i)?.[1];
  const headerImg = html.match(/<header\b[\s\S]{0,4000}?<img\b[^>]*\bsrc=["']([^"']+)["']/i)?.[1];
  const logoNamed = [...html.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)]
    .map((match) => match[0])
    .find((tag) => /logo/i.test(tag))
    ?.match(/\bsrc=["']([^"']+)["']/i)?.[1];
  const icon = html.match(/<link\b[^>]*rel=["'][^"']*icon[^"']*["'][^>]*href=["']([^"']+)["']/i)?.[1];

  const chosen = logoNamed || headerImg || ogImage || icon || "";
  return { url: chosen ? absolute(chosen, baseUrl) : "", source: logoNamed ? "logo-named image" : headerImg ? "header image" : ogImage ? "og:image" : icon ? "favicon" : "none" };
}

/**
 * @param {string} html raw homepage markup
 * @param {string} baseUrl
 */
export function extractBrandTokens(html, baseUrl, businessName = "") {
  const palette = extractPalette(html);
  // The most-used saturated colour reads as the brand colour; the most-used
  // dark one reads as body ink.
  const branded = palette.filter((entry) => saturation(entry.hex) > 0.28);
  const primary = branded[0]?.hex ?? "";
  // An accent has to read as a different colour, not a darker shade of the same
  // one, or the mockup comes out monochrome.
  const accent = branded.find((entry) => entry.hex !== primary && distance(entry.hex, primary) > 90)?.hex ?? "";
  // Ink is the darkest near-neutral, and never one of the brand colours.
  const ink = palette
    .filter((entry) => entry.hex !== primary && entry.hex !== accent && luminance(entry.hex) < 0.22 && saturation(entry.hex) < 0.6)
    .sort((a, b) => luminance(a.hex) - luminance(b.hex))[0]?.hex ?? "";
  const ground = palette.filter((entry) => luminance(entry.hex) > 0.8)
    .sort((a, b) => luminance(b.hex) - luminance(a.hex))[0]?.hex ?? "";
  const fonts = extractFontStack(html);
  const logo = extractLogo(html, baseUrl);

  const found = [];
  const defaulted = [];
  const pick = (name, value, fallback) => {
    if (value) { found.push(name); return value; }
    defaulted.push(name);
    return fallback;
  };

  return {
    primary: pick("primary", primary, NAMED_FALLBACK.primary),
    accent: pick("accent", accent, NAMED_FALLBACK.accent),
    ink: pick("ink", ink, NAMED_FALLBACK.ink),
    ground: pick("ground", ground, NAMED_FALLBACK.ground),
    fontStack: fonts.stack.length ? fonts.stack.join(", ") : "Georgia, 'Times New Roman', serif",
    googleFonts: fonts.googleFonts,
    logoUrl: logo.url,
    logoSource: logo.source,
    businessName,
    paletteSample: palette.slice(0, 8).map((entry) => entry.hex),
    found,
    defaulted,
  };
}
