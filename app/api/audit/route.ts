import { eq, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, auditFindings, audits, leads } from "@/db/schema";
import type { Finding } from "@/lib/types";
import { requireDashboardApi } from "@/app/dashboard-auth";

function isPrivateHostname(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".local")) return true;
  if (/^(127|10|0)\./.test(host) || /^169\.254\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  return Boolean(match && Number(match[1]) >= 16 && Number(match[1]) <= 31);
}

function safeUrl(input: string) {
  const value = /^https?:\/\//i.test(input) ? input : `https://${input}`;
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || isPrivateHostname(url.hostname)) {
    throw new Error("Please enter a public http or https website.");
  }
  if (url.port && !["80", "443"].includes(url.port)) {
    throw new Error("Custom website ports are not supported.");
  }
  url.hash = "";
  return url;
}

function extract(html: string, expression: RegExp) {
  return html.match(expression)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
}

function addFinding(
  findings: Finding[],
  category: Finding["category"],
  severity: Finding["severity"],
  title: string,
  evidence: string,
  recommendation: string,
  impact: string,
  affectedUrl: string,
) {
  findings.push({
    category,
    severity,
    title,
    evidence,
    recommendation,
    impact,
    affectedUrl,
    sortOrder: findings.length + 1,
  });
}

async function inspectWebsite(input: string) {
  const requestedUrl = safeUrl(input);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12_000);
  let response: Response;
  try {
    response = await fetch(requestedUrl, {
      redirect: "follow",
      signal: controller.signal,
      headers: { "User-Agent": "AgencySignal-Audit/1.0 (+website quality check)" },
    });
  } finally {
    clearTimeout(timeout);
  }
  if (!response.ok) throw new Error(`The website returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) throw new Error("The URL did not return an HTML webpage.");
  const html = (await response.text()).slice(0, 2_000_000);
  const finalUrl = response.url || requestedUrl.toString();
  const lower = html.toLowerCase();
  const findings: Finding[] = [];
  let visibility = 100;
  let conversion = 100;
  let technical = 100;
  let trust = 100;

  const title = extract(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const description = extract(
    html,
    /<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["'][^>]*>/i,
  ) || extract(
    html,
    /<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["'][^>]*>/i,
  );
  const h1Count = (html.match(/<h1\b/gi) ?? []).length;

  if (!title) {
    visibility -= 35;
    addFinding(findings, "Visibility", "High", "Homepage title is missing", "No HTML title element was detected on the audited page.", "Add a concise title naming the agency, primary service and local market.", "A descriptive title helps search engines and prospects understand the page before visiting it.", finalUrl);
  } else if (title.length < 25 || title.length > 70) {
    visibility -= 12;
    addFinding(findings, "Visibility", "Medium", "Homepage title is poorly sized", `The detected title is ${title.length} characters: “${title.slice(0, 100)}”.`, "Use a focused title of roughly 35–65 characters with service and location context.", "A clearer title can improve search-result comprehension and message alignment.", finalUrl);
  }
  if (!description) {
    visibility -= 25;
    addFinding(findings, "Visibility", "High", "Meta description is missing", "No meta description was detected in the homepage HTML.", "Write a specific description explaining the agency’s audience, market and next step.", "A strong description gives searchers a reason to choose this result.", finalUrl);
  } else if (description.length < 70) {
    visibility -= 10;
    addFinding(findings, "Visibility", "Low", "Search description is underdeveloped", `The detected description is only ${description.length} characters.`, "Expand it into a complete, benefit-led summary without keyword stuffing.", "A complete summary communicates value before a prospect reaches the site.", finalUrl);
  }
  if (h1Count === 0) {
    visibility -= 20;
    addFinding(findings, "Visibility", "High", "Primary page heading is missing", "The audit found no H1 element on the homepage.", "Add one clear H1 that states the agency’s main value proposition.", "A clear heading improves page structure for visitors and search systems.", finalUrl);
  } else if (h1Count > 1) {
    visibility -= 8;
    addFinding(findings, "Visibility", "Low", "Heading hierarchy is ambiguous", `${h1Count} H1 elements were detected.`, "Use one primary H1 and organize supporting sections under H2 headings.", "A predictable hierarchy makes the page easier to scan and interpret.", finalUrl);
  }
  if (!/application\/ld\+json/i.test(html)) {
    visibility -= 15;
    addFinding(findings, "Visibility", "Medium", "Structured business data is absent", "No JSON-LD structured data block was detected.", "Add valid Organization or InsuranceAgency structured data using verified business details.", "Structured data gives machines a clearer description of the agency and its identity.", finalUrl);
  }

  if (!/name=["']viewport["']/i.test(html)) {
    technical -= 25;
    addFinding(findings, "Technical", "High", "Mobile viewport configuration is missing", "The homepage does not declare a responsive viewport.", "Add a standard responsive viewport meta tag and verify the page at common mobile widths.", "Without it, mobile rendering and usability may be significantly degraded.", finalUrl);
  }
  if (!/rel=["']canonical["']/i.test(html)) {
    technical -= 12;
    addFinding(findings, "Technical", "Medium", "Canonical page signal is missing", "No canonical link element was detected.", "Add a self-referencing canonical URL using the preferred HTTPS hostname.", "Canonical signals reduce ambiguity when similar URLs are accessible.", finalUrl);
  }
  if (requestedUrl.protocol !== "https:" || !finalUrl.startsWith("https://")) {
    technical -= 30;
    addFinding(findings, "Technical", "High", "Secure HTTPS delivery is inconsistent", `The audited address resolved as ${finalUrl}.`, "Redirect every HTTP request to one HTTPS hostname and update internal links.", "Secure delivery protects submitted information and supports visitor trust.", finalUrl);
  }
  if (/name=["']robots["'][^>]+content=["'][^"']*noindex/i.test(lower)) {
    technical -= 45;
    addFinding(findings, "Technical", "High", "Homepage contains a noindex directive", "A robots meta directive appears to prevent indexing.", "Remove noindex if the public homepage should appear in search results.", "An unintended noindex directive can prevent organic discovery entirely.", finalUrl);
  }

  const hasPhoneLink = /href=["']tel:/i.test(html);
  const hasForm = /<form\b/i.test(html);
  const hasStrongCta = /(request a quote|get a quote|call now|schedule|book|contact us|speak with)/i.test(html);
  if (!hasPhoneLink) {
    conversion -= 20;
    addFinding(findings, "Conversion", "Medium", "Phone number is not tap-to-call", "No telephone link was detected in the homepage HTML.", "Make the primary phone number a tap-to-call link, especially in the mobile header.", "Reducing friction is important for high-intent mobile prospects.", finalUrl);
  }
  if (!hasForm) {
    conversion -= 24;
    addFinding(findings, "Conversion", "High", "No direct lead form is present", "No HTML form was detected on the homepage.", "Provide a short quote or consultation form with only essential fields.", "A direct form captures visitors who are not ready to call immediately.", finalUrl);
  }
  if (!hasStrongCta) {
    conversion -= 30;
    addFinding(findings, "Conversion", "High", "Primary action is unclear", "The homepage copy does not contain a recognizable quote, call, contact or scheduling action.", "Use one dominant action in the header and first viewport, then repeat it after proof sections.", "A clear action gives interested visitors an obvious next step.", finalUrl);
  }

  if (!/rel=["'][^"']*(icon|shortcut icon)/i.test(html)) {
    trust -= 12;
    addFinding(findings, "Trust", "Low", "Brand icon is not declared", "No favicon link was detected in the homepage HTML.", "Add a sharp, correctly branded favicon and application icon set.", "Consistent browser branding makes the site feel maintained and intentional.", finalUrl);
  }
  if (!/property=["']og:image["']/i.test(html)) {
    trust -= 15;
    addFinding(findings, "Trust", "Low", "Shared links lack a branded preview image", "No Open Graph image was detected.", "Add a branded social preview image with the agency name and core offer.", "Professional link previews improve credibility when pages are shared.", finalUrl);
  }
  if (!/(privacy policy|privacy notice)/i.test(html)) {
    trust -= 18;
    addFinding(findings, "Trust", "Medium", "Privacy information is not discoverable", "No visible privacy-policy reference was detected on the homepage.", "Link a clear privacy policy from the footer and beside sensitive lead forms.", "Insurance prospects are more likely to share information when data handling is transparent.", finalUrl);
  }

  visibility = Math.max(0, visibility);
  conversion = Math.max(0, conversion);
  technical = Math.max(0, technical);
  trust = Math.max(0, trust);
  const score = Math.round(visibility * 0.3 + conversion * 0.3 + technical * 0.25 + trust * 0.15);
  const severityRank = { High: 0, Medium: 1, Low: 2 };
  findings.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  findings.forEach((finding, index) => (finding.sortOrder = index + 1));
  return { finalUrl, status: response.status, score, visibility, conversion, technical, trust, findings: findings.slice(0, 8) };
}

export async function POST(request: Request) {
  const denied = await requireDashboardApi();
  if (denied) return denied;
  try {
    const body = (await request.json()) as { leadId?: number; website?: string };
    const leadId = Number(body.leadId);
    const website = String(body.website ?? "").trim();
    if (!Number.isInteger(leadId) || !website) {
      return Response.json({ error: "Lead and website are required." }, { status: 400 });
    }
    const result = await inspectWebsite(website);
    const db = await getDb();
    const [audit] = await db
      .insert(audits)
      .values({
        leadId,
        website: result.finalUrl,
        score: result.score,
        visibilityScore: result.visibility,
        conversionScore: result.conversion,
        technicalScore: result.technical,
        trustScore: result.trust,
        responseStatus: result.status,
      })
      .returning();
    if (result.findings.length) {
      await db.insert(auditFindings).values(
        result.findings.map((finding) => ({ ...finding, auditId: audit.id })),
      );
    }
    const [lead] = await db
      .update(leads)
      .set({
        website: result.finalUrl,
        score: result.score,
        visibilityScore: result.visibility,
        conversionScore: result.conversion,
        technicalScore: result.technical,
        trustScore: result.trust,
        status: "Audit ready",
        lastAuditAt: sql`CURRENT_TIMESTAMP`,
        updatedAt: sql`CURRENT_TIMESTAMP`,
      })
      .where(eq(leads.id, leadId))
      .returning();
    await db.insert(activities).values({
      leadId,
      activityType: "audit_completed",
      description: `Website audit completed with a score of ${result.score}`,
    });
    return Response.json({ lead, audit, findings: result.findings });
  } catch (error) {
    const message = error instanceof Error && error.name === "AbortError"
      ? "The website took too long to respond."
      : error instanceof Error
        ? error.message
        : "Unable to complete the audit.";
    return Response.json({ error: message }, { status: 400 });
  }
}
