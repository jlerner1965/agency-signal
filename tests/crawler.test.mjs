import test from "node:test";
import assert from "node:assert/strict";
import { parseRobots, permissiveRobots } from "../lib/audit/robots.js";
import { extractLinks, extractNavigationLinks, prioritizeLinks, navigationIsServerRendered, extractJsonLd, visibleText } from "../lib/audit/html.js";

const BASE = "https://clinic.test/";

test("robots.txt: a group naming us overrides the wildcard entirely", () => {
  const robots = parseRobots(`
User-agent: *
Disallow: /
User-agent: AgencySignal-Audit
Disallow: /private
`, "AgencySignal-Audit");
  assert.equal(robots.isAllowed("/services"), true, "our group replaces the wildcard block");
  assert.equal(robots.isAllowed("/private"), false);
});

test("robots.txt: longest match wins and Allow beats Disallow at equal length", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /admin\nAllow: /admin/public", "AgencySignal-Audit");
  assert.equal(robots.isAllowed("/admin/secret"), false);
  assert.equal(robots.isAllowed("/admin/public"), true);
});

test("robots.txt: wildcards and end anchors are honoured", () => {
  const robots = parseRobots("User-agent: *\nDisallow: /*.pdf$\nDisallow: /wp-*/", "AgencySignal-Audit");
  assert.equal(robots.isAllowed("/files/report.pdf"), false);
  assert.equal(robots.isAllowed("/files/report.pdfx"), true);
  assert.equal(robots.isAllowed("/wp-admin/x"), false);
});

test("robots.txt: an empty Disallow means no restriction", () => {
  const robots = parseRobots("User-agent: *\nDisallow:", "AgencySignal-Audit");
  assert.equal(robots.isAllowed("/anything"), true);
});

test("robots.txt: crawl-delay is read from the group that applies", () => {
  assert.equal(parseRobots("User-agent: *\nCrawl-delay: 5", "AgencySignal-Audit").crawlDelay, 5);
  // Unreachable robots.txt must not be treated as a blanket disallow.
  assert.equal(permissiveRobots().isAllowed("/admin"), true);
  assert.equal(permissiveRobots().crawlDelay, null);
});

test("robots.txt: comments and consecutive user-agent lines parse", () => {
  const robots = parseRobots(`
# a comment
User-agent: SomeBot
User-agent: AgencySignal-Audit
Disallow: /shared   # trailing comment
`, "AgencySignal-Audit");
  assert.equal(robots.isAllowed("/shared"), false);
});

test("links: off-origin, assets, anchors and mailto are excluded", () => {
  const html = `<a href="/services">S</a><a href="https://other.test/x">O</a>
    <a href="/f.pdf">P</a><a href="#top">T</a><a href="mailto:a@b.c">M</a><a href="tel:+1">C</a>`;
  assert.deepEqual(extractLinks(html, BASE).map((link) => new URL(link.url).pathname), ["/services"]);
});

test("links: fragments are stripped so one page is not crawled twice", () => {
  const links = extractLinks('<a href="/services#a">A</a><a href="/services#b">B</a>', BASE);
  assert.equal(links.length, 1);
  assert.equal(links[0].url, "https://clinic.test/services");
});

test("navigation links come only from navigation landmarks", () => {
  const html = `<nav><a href="/services/hormones">Hormones</a></nav><main><a href="/blog/x">Blog</a></main>`;
  assert.deepEqual(extractNavigationLinks(html, BASE).map((link) => link.text), ["Hormones"]);
});

test("crawl order puts service pages first and blog posts last", () => {
  const links = [
    { url: `${BASE}blog/2024/post`, text: "Post" },
    { url: `${BASE}about`, text: "About" },
    { url: `${BASE}services/aesthetics`, text: "Aesthetics" },
    { url: `${BASE}contact`, text: "Contact" },
  ];
  assert.deepEqual(
    prioritizeLinks(links).map((link) => new URL(link.url).pathname),
    ["/services/aesthetics", "/contact", "/about", "/blog/2024/post"],
  );
});

test("a JS-rendered shell is distinguishable from server-rendered navigation", () => {
  assert.equal(navigationIsServerRendered('<nav><a href="/a">A</a><a href="/b">B</a></nav>', BASE), true);
  assert.equal(navigationIsServerRendered('<div id="root"></div><script src="/app.js"></script>', BASE), false);
});

test("JSON-LD is extracted from graphs and arrays, and malformed blocks are skipped", () => {
  const html = `<script type="application/ld+json">{"@graph":[{"@type":"MedicalBusiness","name":"X"}]}</script>
    <script type="application/ld+json">[{"@type":"Service","name":"Y"}]</script>
    <script type="application/ld+json">{ broken</script>`;
  const blocks = extractJsonLd(html);
  assert.deepEqual(blocks.map((block) => block["@type"]), ["MedicalBusiness", "Service"]);
});

test("visible text drops scripts, styles and markup", () => {
  assert.equal(visibleText('<style>a{}</style><script>x()</script><p>Hormone&nbsp;therapy</p>'), "Hormone therapy");
});
